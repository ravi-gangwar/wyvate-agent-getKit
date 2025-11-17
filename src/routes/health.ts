import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

/**
 * GET /health - Health check endpoint
 */
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "vendor-flow-api",
  });
});

export default router;

