/**
 * Socket.IO type definitions
 */

export interface SocketLogEvent {
  chatId: string; // Unique chat ID from frontend
  step: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

