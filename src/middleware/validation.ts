import type { Request, Response, NextFunction } from "express";

/**
 * Request validation middleware for chat endpoint
 */
export function validateChatRequest(req: Request, res: Response, next: NextFunction): void {
  const { chatId, userQuery } = req.body;

  if (!userQuery || typeof userQuery !== "string" || userQuery.trim().length === 0) {
    res.status(400).json({
      error: "Validation error",
      message: "Request body must include 'userQuery' field (non-empty string).",
    });
    return;
  }

  if (!chatId || typeof chatId !== "string" || chatId.trim().length === 0) {
    res.status(400).json({
      error: "Validation error",
      message: "Request body must include 'chatId' field (non-empty string) - a unique identifier for this chat session.",
    });
    return;
  }

  // Validate optional fields if provided
  if (req.body.latitude !== undefined && typeof req.body.latitude !== "number") {
    res.status(400).json({
      error: "Validation error",
      message: "'latitude' must be a number if provided.",
    });
    return;
  }

  if (req.body.longitude !== undefined && typeof req.body.longitude !== "number") {
    res.status(400).json({
      error: "Validation error",
      message: "'longitude' must be a number if provided.",
    });
    return;
  }

  next();
}

