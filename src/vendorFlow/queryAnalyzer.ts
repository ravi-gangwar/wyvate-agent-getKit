import { z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../ai.js";
import { retryWithBackoff } from "../utils/retryWithBackoff.js";
import type { QueryAnalysis } from "../types/vendorFlow.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";
import { logger } from "../utils/logger.js";

export const analyzeUserQuery = async (
  userQuery: string,
  chatHistory: string = "",
  chatId?: string
): Promise<QueryAnalysis> => {
  const historyContext = chatHistory ? `\n\n${chatHistory}` : "";
  
  const prompt = `You are Wyvate AI, an intelligent assistant designed to serve Wyvate customers for any kind of request related to Wyvate's features. Your primary responsibilities include:
- Helping customers find nearby vendors and services
- Assisting with food ordering and cart management
- Providing information about vendors, services, menus, and offers
- Answering questions about locations, vendors, and services
- Managing customer shopping carts (add, remove, update, view items)

Analyze this user query: "${userQuery}"${historyContext}

      First, correct any spelling mistakes in the query based on the previous conversation context (especially vendor names, locations, and services mentioned before). Then analyze the corrected query.

      Tasks:
      1. Correct spelling mistakes (especially vendor names, locations, services from chat history). If no mistakes, return the original query.
      2. Does the corrected query require a location? (yes/no)
      3. Extract the location name (city, landmark, or address) if mentioned by the user. Look for patterns like:
         - "my city is [location]" or "my city name is [location]"
         - "I am in [location]" or "I'm in [location]"
         - "location is [location]" or "my location is [location]"
         - "I live in [location]" or "I'm from [location]"
         - Direct mentions like "find vendors in [location]" or "show restaurants in [location]"
         - If the user is providing their location information (e.g., "my city is kanpur"), extract "kanpur" as the locationName
         - If location is mentioned in previous conversation context, use that location
         - If the user did NOT mention a location anywhere, return null (NOT a default location).
      4. What type of data is the user asking for?
      5. Is this a cart operation? (add to cart, remove from cart, view cart, clear cart, update cart/quantity)
      6. If cart operation, extract:
         - serviceNames: Array of service/item names mentioned (e.g., ["pizza", "burger"] for "add pizza and burger")
         - quantities: Array of quantities mentioned (e.g., [2, 3] for "add 2 pizza and 3 burger"). If quantity not mentioned for a service, use null in the array (will default to 1 later). Match quantities to serviceNames by position.
      7. If user wants to update quantity (e.g., "change pizza quantity to 5", "update burger to 3"), set cartAction to "update" and extract serviceNames and quantities.
      8. Is this a pagination request? (show more, next page, show next 10, explore more services, more services, etc.) - If user says "explore more services" or "more services" after viewing services, this is pagination.
      9. If the user wants to explore a specific vendor (e.g., "explore Namaste India", "show me services from Pizza Hut", "what does McDonald's offer"), extract the vendor name. Set vendorName to the vendor name if mentioned, otherwise null.
      10. If the user wants to explore services/items/menu (e.g., "explore food items", "show me services", "show menu", "explore food menu", "show all services", "what items are available"), set wantsServices to true. This means they want to see actual services/items, not just categories.
      ${chatHistory ? "11. Consider the previous conversation context when analyzing the query. If location was mentioned in previous messages, you can use that. If user previously viewed services and now says 'more services' or 'explore more', this is pagination. If a vendor was mentioned before, you can use that vendor name. If services were shown in previous messages, use those service names when user says 'add this' or 'add that'." : ""}

      IMPORTANT: 
      - Only set locationName if the user explicitly mentioned a location in their query or in previous conversation. Do NOT use any default location. If no location is mentioned, set locationName to null.
      - Return the corrected query in correctedQuery field. If no corrections needed, return the original query.`;

  const queryAnalysisSchema = z.object({
    correctedQuery: z.string().describe("Corrected query with spelling fixes (or original if no corrections needed)"),
    needsLocation: z.boolean().describe("Whether the query requires a location"),
    locationName: z.string().nullable().describe("Location name if explicitly mentioned, null otherwise"),
    queryType: z.string().describe("Description of what the user wants"),
    isCartOperation: z.boolean().optional().describe("Whether this is a cart operation"),
    isPaginationRequest: z.boolean().optional().describe("Whether this is a pagination request"),
    cartAction: z.enum(["add", "remove", "view", "clear", "update"]).nullable().optional().describe("Type of cart operation"),
    serviceNames: z.array(z.string()).nullable().optional().describe("Array of service names if adding/updating/removing multiple items from cart"),
    quantities: z.array(z.number()).nullable().optional().describe("Array of quantities corresponding to serviceNames (e.g., [2, 3] for 'add 2 pizza and 3 burger'). Extract numbers from query. If not specified, default to 1."),
    vendorName: z.string().nullable().optional().describe("Vendor name if user wants to explore a specific vendor (e.g., 'Namaste India', 'Pizza Hut')"),
    wantsServices: z.boolean().optional().describe("True if user wants to see services/items/menu (not just categories). Set to true for queries like 'explore food items', 'show services', 'show menu', 'explore food menu'."),
  });

  const startTime = Date.now();
  const aiActionDetails: {
    query: string;
    hasChatHistory: boolean;
    chatHistoryLength: number;
    chatId?: string;
  } = {
    query: userQuery,
    hasChatHistory: !!chatHistory,
    chatHistoryLength: chatHistory.length,
  };
  if (chatId !== undefined) {
    aiActionDetails.chatId = chatId;
  }
  logger.aiAction("Query Analysis", aiActionDetails);

  try {
    const response = await retryWithBackoff(() =>
      ai.generate({
        model: googleAI.model(AI_MODEL, {
          temperature: AI_TEMPERATURES.ANALYSIS,
        }),
        prompt,
        output: {
          schema: queryAnalysisSchema,
        },
      })
    );

    const duration = Date.now() - startTime;

    try {
      // Try to get structured output first, fallback to text parsing
      let analysis: QueryAnalysis;
      
      if (response.output) {
        // Use structured output if available
        analysis = response.output as QueryAnalysis;
      } else {
        // Extract JSON from markdown code blocks if present
        let analysisText = response.text?.trim() || "{}";
        analysisText = analysisText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        
        const parsed = JSON.parse(analysisText);
        // Validate with schema
        analysis = queryAnalysisSchema.parse(parsed) as QueryAnalysis;
      }
      
      const completedDetails: {
        query: string;
        duration: number;
        analysis: QueryAnalysis;
        response: string;
        chatId?: string;
      } = {
        query: userQuery,
        duration,
        analysis,
        response: response.text || "",
      };
      if (chatId !== undefined) {
        completedDetails.chatId = chatId;
      }
      logger.aiAction("Query Analysis Completed", completedDetails);
      
      return analysis;
    } catch (parseError) {
      logger.error("Failed to parse query analysis response", {
        query: userQuery,
        response: response.text,
      }, parseError instanceof Error ? parseError : new Error(String(parseError)), chatId);
      
      return {
        needsLocation: false,
        locationName: null,
        queryType: "general query",
      };
    }
  } catch (error) {
    // Handle API errors (after all retries exhausted)
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Query analysis API error", {
        query: userQuery,
        duration,
        error: errorMessage,
      }, error instanceof Error ? error : new Error(String(error)), chatId);
    
    // Return default analysis to allow flow to continue
    // This prevents the flow from crashing and allows basic functionality
    return {
      correctedQuery: userQuery, // Use original query as fallback
      needsLocation: true, // Default to needing location for vendor queries
      locationName: null,
      queryType: "general query",
    };
  }
};

