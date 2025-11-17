const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Temporarily suppress console.error to prevent Genkit from logging retryable errors
 */
function suppressConsoleError(): () => void {
  const originalError = console.error;
  const originalWarn = console.warn;
  
  // Suppress error and warn logs
  console.error = () => {};
  console.warn = () => {};
  
  // Return restore function
  return () => {
    console.error = originalError;
    console.warn = originalWarn;
  };
}

export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  initialDelay: number = 1000
): Promise<T> => {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check for retryable errors
      // GenkitError has status as string ('UNAVAILABLE') and code as number (503)
      const status = error.status || error.code;
      const code = error.code || error.status;
      const isRetryable = 
        status === 503 || 
        status === 429 || 
        status === 'UNAVAILABLE' ||
        code === 503 || 
        code === 429 ||
        (error.message && error.message.includes('overloaded')) ||
        (error.message && error.message.includes('503'));
      
      // If not retryable or max retries reached, throw error
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      // Calculate exponential backoff delay
      const delay = initialDelay * Math.pow(2, attempt);
      
      // Suppress console.error/warn during retry to prevent Genkit error logs
      const restoreConsole = suppressConsoleError();
      
      // Log retry attempt (suppress full error stack for retryable errors)
      const errorMessage = error.message || String(error);
      const shortMessage = errorMessage.length > 100 
        ? errorMessage.substring(0, 100) + '...' 
        : errorMessage;
      
      // Restore console immediately after logging
      restoreConsole();
      
      console.log(`⚠️  API temporarily unavailable. Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms... (${shortMessage})`);
      
      await sleep(delay);
    }
  }
  
  throw lastError;
};

