import express from "express";
import cors from "cors";
import nearbyVendorsFlow from "./flows/nearbyVendors/index.js";

const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || "*", // Allow all origins in development, set specific URL in production
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());

app.post("/chat", async (req, res) => {
  try {
    // Support both plain string body and JSON with { userQuery }
    let userQuery: string | undefined;

    if (typeof req.body === "string") {
      userQuery = req.body;
    } else if (req.body && typeof req.body.userQuery === "string") {
      userQuery = req.body.userQuery;
    }

    if (!userQuery) {
      return res
        .status(400)
        .json({ error: "Request body must be a string (user query) or an object with 'userQuery' field." });
    }

    const result = await nearbyVendorsFlow({
      userQuery,
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

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});