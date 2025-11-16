/**
 * Logger utility for debugging and tracking execution
 */

import chalk from "chalk";
import { socketService } from "../services/socket.js";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  error?: Error;
}

class Logger {
  private logLevel: LogLevel;
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000; // Keep last 1000 logs in memory

  constructor(logLevel: LogLevel = LogLevel.INFO) {
    this.logLevel = logLevel;
  }

  /**
   * Set the log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Format log entry
   */
  private formatLog(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    
    if (context) {
      entry.context = context;
    }
    
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } as any;
    }
    
    return entry;
  }

  /**
   * Add log entry
   */
  private addLog(entry: LogEntry): void {
    this.logs.push(entry);
    
    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * Format context for display
   */
  private formatContext(context?: Record<string, any>): string {
    if (!context || Object.keys(context).length === 0) {
      return "";
    }
    
    try {
      // Remove circular references and limit depth
      const sanitized = JSON.stringify(context, (key, value) => {
        if (key === 'parent' || key === 'circular') return '[Circular]';
        if (typeof value === 'function') return '[Function]';
        if (value instanceof Error) return { name: value.name, message: value.message };
        if (typeof value === 'object' && value !== null) {
          // Limit object depth
          if (key && key.length > 50) return '[Too Long]';
        }
        return value;
      }, 2);
      
      return chalk.gray(`\nContext: ${sanitized}`);
    } catch (e) {
      return chalk.gray(`\nContext: [Unable to serialize]`);
    }
  }

  /**
   * Format error for display
   */
  private formatError(error?: Error): string {
    if (!error) return "";
    const errorName = chalk.red.bold(error.name);
    const errorMsg = chalk.red(error.message);
    const stack = error.stack ? chalk.gray(`\nStack: ${error.stack}`) : '';
    return `\n${chalk.red('Error:')} ${errorName}: ${errorMsg}${stack}`;
  }

  /**
   * Format timestamp with color
   */
  private formatTimestamp(timestamp: string): string {
    return chalk.gray(timestamp);
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, any>): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      const entry = this.formatLog(LogLevel.DEBUG, message, context);
      this.addLog(entry);
      const levelTag = chalk.cyan.bold("[DEBUG]");
      const timestamp = this.formatTimestamp(entry.timestamp);
      const msg = chalk.cyan(message);
      console.debug(`${levelTag} ${timestamp} - ${msg}${this.formatContext(context)}`);
    }
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, any>): void {
    if (this.logLevel <= LogLevel.INFO) {
      const entry = this.formatLog(LogLevel.INFO, message, context);
      this.addLog(entry);
      const levelTag = chalk.blue.bold("[INFO]");
      const timestamp = this.formatTimestamp(entry.timestamp);
      const msg = chalk.white(message);
      console.log(`${levelTag} ${timestamp} - ${msg}${this.formatContext(context)}`);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, any>, error?: Error): void {
    if (this.logLevel <= LogLevel.WARN) {
      const entry = this.formatLog(LogLevel.WARN, message, context, error);
      this.addLog(entry);
      const levelTag = chalk.yellow.bold("[WARN]");
      const timestamp = this.formatTimestamp(entry.timestamp);
      const msg = chalk.yellow(message);
      console.warn(`${levelTag} ${timestamp} - ${msg}${this.formatContext(context)}${this.formatError(error)}`);
    }
  }

  /**
   * Log error message
   */
  error(message: string, context?: Record<string, any>, error?: Error): void {
    if (this.logLevel <= LogLevel.ERROR) {
      const entry = this.formatLog(LogLevel.ERROR, message, context, error);
      this.addLog(entry);
      const levelTag = chalk.red.bold("[ERROR]");
      const timestamp = this.formatTimestamp(entry.timestamp);
      const msg = chalk.red.bold(message);
      console.error(`${levelTag} ${timestamp} - ${msg}${this.formatContext(context)}${this.formatError(error)}`);
    }
  }

  /**
   * Log AI action (special method for AI-related logs)
   */
  aiAction(action: string, details: {
    model?: string;
    prompt?: string;
    response?: string;
    duration?: number;
    userId?: string;
    query?: string;
    [key: string]: any;
  }): void {
    const context: Record<string, any> = {
      action,
      ...details,
    };

    // Truncate long prompts/responses for readability
    if (context.prompt && context.prompt.length > 500) {
      context.prompt = context.prompt.substring(0, 500) + '... [truncated]';
    }
    if (context.response && context.response.length > 500) {
      context.response = context.response.substring(0, 500) + '... [truncated]';
    }

    // Format AI action with special color
    const entry = this.formatLog(LogLevel.INFO, `AI Action: ${action}`, context);
    this.addLog(entry);
    
    if (this.logLevel <= LogLevel.INFO) {
      const levelTag = chalk.magenta.bold("[AI]");
      const timestamp = this.formatTimestamp(entry.timestamp);
      const actionName = chalk.magenta.bold(action);
      const durationStr = details.duration ? chalk.cyan(` (${details.duration}ms)`) : '';
      console.log(`${levelTag} ${timestamp} - ${actionName}${durationStr}${this.formatContext(context)}`);
    }
  }

  /**
   * Log SQL query execution
   */
  sqlQuery(query: string, params?: any[], duration?: number, resultCount?: number, chatId?: string): void {
    const entry = this.formatLog(LogLevel.INFO, 'SQL Query Execution', {
      query: query.length > 500 ? query.substring(0, 500) + '... [truncated]' : query,
      params,
      duration: duration ? `${duration}ms` : undefined,
      resultCount,
    });
    this.addLog(entry);
    
    if (this.logLevel <= LogLevel.INFO) {
      const levelTag = chalk.green.bold("[SQL]");
      const timestamp = this.formatTimestamp(entry.timestamp);
      const durationStr = duration ? chalk.cyan(` (${duration}ms)`) : '';
      const resultStr = resultCount !== undefined ? chalk.green(` - ${resultCount} results`) : '';
      const queryPreview = query.length > 100 ? query.substring(0, 100) + '...' : query;
      console.log(`${levelTag} ${timestamp}${durationStr}${resultStr}\n${chalk.gray(queryPreview)}${this.formatContext(entry.context)}`);
    }

    // Emit socket event for SQL query
    if (chatId) {
      socketService.emitLog(
        chatId,
        "SQL Query Execution",
        `Querying database${resultCount !== undefined ? ` (${resultCount} results)` : ""}`,
        { duration, resultCount }
      );
    }
  }

  /**
   * Log flow execution step
   */
  flowStep(step: string, details?: Record<string, any>, chatId?: string): void {
    const entry = this.formatLog(LogLevel.INFO, `Flow Step: ${step}`, details);
    this.addLog(entry);
    
    if (this.logLevel <= LogLevel.INFO) {
      const levelTag = chalk.blue.bold("[FLOW]");
      const timestamp = this.formatTimestamp(entry.timestamp);
      const stepName = chalk.blue(step);
      console.log(`${levelTag} ${timestamp} - ${stepName}${this.formatContext(details)}`);
    }

    // Emit socket event for main flow steps
    if (chatId) {
      const mainSteps = [
        "Flow Started",
        "Step 0: Retrieving chat history and location",
        "Step 1: Correcting spelling",
        "Step 2: Analyzing user query",
        "Step 2.5: Handling cart operation",
        "Step 3: Checking location",
        "Step 4: Getting location coordinates",
        "Step 5: Handling pagination",
        "Step 5.5: Generating SQL query",
        "Step 6: Executing SQL query",
        "Step 6.5: Extracting and saving IDs from results",
        "Step 7: Getting cart",
        "Step 8: Refining response",
        "Step 9: Saving messages to memory",
        "Flow Completed Successfully",
      ];

      // Only emit for main flow steps
      if (mainSteps.some(mainStep => step.includes(mainStep) || mainStep.includes(step))) {
        // Extract a user-friendly message from step
        let message = step;
        if (step.includes("Retrieving chat history")) {
          message = "Retrieving chat history and location";
        } else if (step.includes("Correcting spelling")) {
          message = "Correcting spelling";
        } else if (step.includes("Analyzing user query")) {
          message = "Analyzing your query";
        } else if (step.includes("Handling cart")) {
          message = "Processing cart operation";
        } else if (step.includes("Getting location")) {
          message = "Finding location";
        } else if (step.includes("Generating SQL")) {
          message = "Generating database query";
        } else if (step.includes("Executing SQL")) {
          message = "Querying database";
        } else if (step.includes("Extracting and saving")) {
          message = "Processing results";
        } else if (step.includes("Refining response")) {
          message = "Preparing response";
        } else if (step.includes("Saving messages")) {
          message = "Saving conversation";
        } else if (step.includes("Flow Started")) {
          message = "Processing your request";
        } else if (step.includes("Flow Completed")) {
          message = "Request completed";
        }

        socketService.emitLog(chatId, step, message, details);
      }
    }
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level >= level);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get logs as formatted string
   */
  getLogsAsString(level?: LogLevel): string {
    const logsToFormat = level !== undefined ? this.getLogsByLevel(level) : this.logs;
    return logsToFormat.map(log => {
      const levelName = LogLevel[log.level];
      const contextStr = log.context ? `\n${JSON.stringify(log.context, null, 2)}` : '';
      const errorStr = log.error ? `\nError: ${JSON.stringify(log.error, null, 2)}` : '';
      return `[${levelName}] ${log.timestamp} - ${log.message}${contextStr}${errorStr}`;
    }).join('\n\n');
  }
}

// Export singleton instance
export const logger = new Logger(
  process.env.LOG_LEVEL === 'DEBUG' ? LogLevel.DEBUG :
  process.env.LOG_LEVEL === 'WARN' ? LogLevel.WARN :
  process.env.LOG_LEVEL === 'ERROR' ? LogLevel.ERROR :
  LogLevel.INFO
);

// Export class for custom instances if needed
export { Logger };

