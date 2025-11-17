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
   * Emit log event to specific chat
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

    const logEvent: SocketLogEvent = {
      chatId,
      step,
      message,
      timestamp: new Date().toISOString(),
    };

    if (metadata) {
      logEvent.metadata = metadata;
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

