import { Router } from "express";
import type { Request, Response } from "express";
import nearbyVendorsFlow from "../vendorFlow/index.js";
import { logger } from "../utils/logger.js";
import { validateChatRequest } from "../middleware/validation.js";

const router = Router();

/**
 * POST /chat - Main chat endpoint for vendor queries
 * 
 * Request body:
 * - chatId: string (required) - Unique chat session identifier (used for memory and socket tracking)
 * - userQuery: string (required) - User's query/question
 * - locationName: string (optional) - Location name if known
 * - latitude: number (optional) - Latitude if known
 * - longitude: number (optional) - Longitude if known
 */
router.post("/chat", validateChatRequest, async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    // Extract request body (already validated by middleware)
    const { chatId, userQuery, locationName, latitude, longitude } = req.body;

    logger.info("Chat request received", {
      chatId,
      queryLength: userQuery.length,
      hasLocation: !!(locationName || latitude || longitude),
    });

    // Execute vendor flow
    const result = await nearbyVendorsFlow({
      userQuery,
      chatId,
      locationName,
      latitude,
      longitude,
    });

    const duration = Date.now() - startTime;
    logger.info("Chat request completed", {
      chatId,
      duration,
      hasError: !!result.error,
    });

    return res.json(result);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    
    logger.error("Chat request failed", {
      chatId: req.body?.chatId,
      duration,
      error: errorMessage,
    }, error instanceof Error ? error : new Error(String(error)));

    return res.status(500).json({
      error: "Internal server error",
      message: errorMessage,
    });
  }
});

export default router;

