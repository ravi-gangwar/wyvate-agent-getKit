/**
 * Environment configuration and validation
 */

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  frontendUrl: process.env.FRONTEND_URL || "*",
  nodeEnv: process.env.NODE_ENV || "development",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
};

/**
 * Validate required environment variables
 */
export function validateEnv(): void {
  const required = ["GEMINI_API_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missing.join(", ")}`);
    console.warn("Some features may not work correctly.");
  }
}

