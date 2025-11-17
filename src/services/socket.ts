/**
 * Socket.IO service for real-time communication with frontend
 */

import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import type { SocketLogEvent } from "../types/socket.js";

// Re-export type for backward compatibility
export type { SocketLogEvent };

class SocketService {
  private io: SocketIOServer | null = null;
  private chatSockets: Map<string, Set<string>> = new Map(); // chatId -> Set of socketIds

  /**
   * Initialize Socket.IO server
   */
  initialize(httpServer: HTTPServer): void {
    const corsOrigin = process.env.FRONTEND_URL || "*";
    
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: corsOrigin,
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    console.log(`[Socket] Socket.IO server initialized with CORS origin: ${corsOrigin}`);

    this.io.on("connection", (socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      // Handle chat identification
      socket.on("identify", (data: { chatId: string }) => {
        const { chatId } = data;
        if (chatId) {
          if (!this.chatSockets.has(chatId)) {
            this.chatSockets.set(chatId, new Set());
          }
          this.chatSockets.get(chatId)!.add(socket.id);
          socket.data.chatId = chatId;
          console.log(`[Socket] Chat ${chatId} identified with socket ${socket.id}`);
        }
      });

      // Handle disconnection
      socket.on("disconnect", () => {
        const chatId = socket.data.chatId;
        if (chatId && this.chatSockets.has(chatId)) {
          const sockets = this.chatSockets.get(chatId)!;
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            this.chatSockets.delete(chatId);
          }
          console.log(`[Socket] Chat ${chatId} disconnected (socket ${socket.id})`);
        } else {
          console.log(`[Socket] Client disconnected: ${socket.id}`);
        }
      });
    });
  }

  /**
   * Get Socket.IO instance
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * Sanitize metadata to remove sensitive data and circular references
   */
  private sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> | undefined {
    if (!metadata) return undefined;

    const sanitized: Record<string, any> = {};
    const seen = new WeakSet();

    const sanitizeValue = (value: any, depth: number = 0): any => {
      // Limit depth to prevent deep nesting
      if (depth > 3) return '[Too Deep]';

      // Handle null/undefined
      if (value === null || value === undefined) return value;

      // Handle primitives
      if (typeof value !== 'object') {
        // Truncate long strings
        if (typeof value === 'string' && value.length > 200) {
          return value.substring(0, 200) + '...';
        }
        return value;
      }

      // Handle arrays
      if (Array.isArray(value)) {
        return value.slice(0, 10).map((item, idx) => {
          if (idx >= 10) return '[More items...]';
          return sanitizeValue(item, depth + 1);
        });
      }

      // Handle objects
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
        };
      }

      if (value instanceof Date) {
        return value.toISOString();
      }

      // Check for circular references
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);

      const result: Record<string, any> = {};
      let keyCount = 0;
      for (const [key, val] of Object.entries(value)) {
        // Skip sensitive fields
        if (['password', 'token', 'secret', 'apiKey', 'apikey', 'authorization'].some(s => key.toLowerCase().includes(s))) {
          result[key] = '[Redacted]';
          continue;
        }

        // Skip functions
        if (typeof val === 'function') {
          continue;
        }

        // Limit number of keys
        if (keyCount >= 20) {
          result['...'] = '[More fields...]';
          break;
        }

        result[key] = sanitizeValue(val, depth + 1);
        keyCount++;
      }

      return result;
    };

    for (const [key, value] of Object.entries(metadata)) {
      // Skip sensitive keys
      if (['password', 'token', 'secret', 'apiKey', 'apikey', 'authorization'].some(s => key.toLowerCase().includes(s))) {
        sanitized[key] = '[Redacted]';
        continue;
      }

      sanitized[key] = sanitizeValue(value);
    }

    return sanitized;
  }

  /**
   * Abstract technical log messages to user-friendly messages
   */
  private abstractMessage(step: string, message: string, metadata?: Record<string, any>): string {
    // If message is already user-friendly, use it
    if (message && !message.includes('[') && !message.includes('Error:') && message.length < 100) {
      return message;
    }

    // Abstract common technical messages
    const abstractions: Record<string, string> = {
      'Flow Started': 'Processing your request...',
      'Retrieving chat history': 'Loading conversation history...',
      'Correcting spelling': 'Checking spelling...',
      'Analyzing user query': 'Understanding your request...',
      'Handling cart': 'Processing cart...',
      'Getting location': 'Finding your location...',
      'Generating SQL': 'Preparing database query...',
      'Executing SQL': 'Searching database...',
      'Querying database': 'Searching database...',
      'Extracting and saving': 'Processing results...',
      'Refining response': 'Preparing your response...',
      'Saving messages': 'Saving conversation...',
      'Flow Completed': 'Request completed',
      'SQL Query Execution': 'Searching database...',
      'Query Analysis': 'Understanding your request...',
      'Response Refinement': 'Preparing response...',
    };

    // Check for partial matches
    for (const [key, abstracted] of Object.entries(abstractions)) {
      if (step.includes(key) || message.includes(key)) {
        return abstracted;
      }
    }

    // Default abstraction
    if (step.toLowerCase().includes('error') || message.toLowerCase().includes('error')) {
      return 'An error occurred. Please try again.';
    }

    if (step.toLowerCase().includes('query') || step.toLowerCase().includes('database')) {
      return 'Searching database...';
    }

    if (step.toLowerCase().includes('ai') || step.toLowerCase().includes('generating')) {
      return 'Processing with AI...';
    }

    // Return simplified version of original message
    return message.length > 100 ? message.substring(0, 100) + '...' : message;
  }

  /**
   * Emit log event to specific chat with abstraction
   */
  emitLog(chatId: string, step: string, message: string, metadata?: Record<string, any>): void {
    if (!this.io) {
      console.warn("[Socket] Socket.IO not initialized");
      return;
    }

    const sockets = this.chatSockets.get(chatId);
    if (!sockets || sockets.size === 0) {
      // Chat not connected, skip emission
      return;
    }

    // Abstract the message for user-friendly display
    const abstractedMessage = this.abstractMessage(step, message, metadata);

    // Sanitize metadata
    const sanitizedMetadata = this.sanitizeMetadata(metadata);

    const logEvent: SocketLogEvent = {
      chatId,
      step,
      message: abstractedMessage,
      timestamp: new Date().toISOString(),
    };

    if (sanitizedMetadata && Object.keys(sanitizedMetadata).length > 0) {
      logEvent.metadata = sanitizedMetadata;
    }

    // Emit to all sockets for this chat
    sockets.forEach((socketId: string) => {
      this.io!.to(socketId).emit("log", logEvent);
    });
  }

  /**
   * Emit log event to all connected clients (broadcast)
   */
  emitLogBroadcast(step: string, message: string, metadata?: Record<string, any>): void {
    if (!this.io) {
      console.warn("[Socket] Socket.IO not initialized");
      return;
    }

    // Broadcast to all connected chats
    this.chatSockets.forEach((sockets, chatId) => {
      const logEvent: SocketLogEvent = {
        chatId,
        step,
        message,
        timestamp: new Date().toISOString(),
      };

      if (metadata) {
        logEvent.metadata = metadata;
      }

      sockets.forEach((socketId: string) => {
        this.io!.to(socketId).emit("log", logEvent);
      });
    });
  }

  /**
   * Get connected chats count
   */
  getConnectedChatsCount(): number {
    return this.chatSockets.size;
  }

  /**
   * Check if chat is connected
   */
  isChatConnected(chatId: string): boolean {
    const sockets = this.chatSockets.get(chatId);
    return sockets !== undefined && sockets.size > 0;
  }

  /**
   * Get all connected chat IDs
   */
  getConnectedChatIds(): string[] {
    return Array.from(this.chatSockets.keys());
  }
}

// Export singleton instance
export const socketService = new SocketService();

