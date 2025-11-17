import express from "express";
import { createServer } from "http";
import { socketService } from "./services/socket.js";
import { logger } from "./utils/logger.js";
import { config, validateEnv } from "./config/env.js";
import { corsMiddleware } from "./middleware/cors.js";
import chatRoutes from "./routes/chat.js";
import healthRoutes from "./routes/health.js";

// Validate environment variables
validateEnv();

// Initialize Express app
const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO for real-time logging
socketService.initialize(httpServer);

// Middleware
app.use(corsMiddleware);
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  if (req.path !== "/health") {
    logger.info("Incoming request", {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });
  }
  next();
});

// Routes
app.use("/", healthRoutes);
app.use("/", chatRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error("Unhandled error", {
    path: req.path,
    method: req.method,
  }, err);

  res.status(500).json({
    error: "Internal server error",
    message: config.nodeEnv === "development" ? err.message : "An unexpected error occurred",
  });
});

// Start server
const PORT = config.port;

httpServer.listen(PORT, () => {
  logger.info("Server started", {
    port: PORT,
    environment: config.nodeEnv,
    frontendUrl: config.frontendUrl,
  });
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📡 Socket.IO server initialized`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
});