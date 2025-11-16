import express from "express";
import cors from "cors";
import { createServer } from "http";
import nearbyVendorsFlow from "./flows/nearbyVendors/index.js";
import { socketService } from "./services/socket.js";

const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
socketService.initialize(httpServer);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || "*", // Allow all origins in development, set specific URL in production
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-user-id", "user-id"],
  credentials: true
}));

app.use(express.json());

app.post("/chat", async (req, res) => {
  try {
    // Get chatId from request body (unique key from frontend)
    const chatId = req.body?.chatId;
    // Get userId from req.userId (set by middleware) or from body or default to "1"
    const userId = (req as any).userId || req.body?.userId || "1";

    // Extract userQuery from request body
    const userQuery = req.body?.userQuery;

    if (!userQuery || typeof userQuery !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must be an object with 'userQuery' field (string)." });
    }

    if (!chatId || typeof chatId !== "string") {
      return res
        .status(400)
        .json({ error: "Request body must include 'chatId' field (string) - a unique identifier for this chat session." });
    }

    const result = await nearbyVendorsFlow({
      userQuery,
      userId: userId as string,
      chatId: chatId as string,
    });

    return res.json(result);
  } catch (error: any) {
    console.error("Error in /chat:", error);
    return res.status(500).json({
      error:
        error?.message || "An unexpected error occurred while processing request.",
    });
  }
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Socket.IO server initialized`);
});