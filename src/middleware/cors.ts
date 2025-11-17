import cors from "cors";

/**
 * CORS configuration middleware
 */
export const corsMiddleware = cors({
  origin: process.env.FRONTEND_URL || "*", // Allow all origins in development, set specific URL in production
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-user-id", "user-id"],
  credentials: true,
});

