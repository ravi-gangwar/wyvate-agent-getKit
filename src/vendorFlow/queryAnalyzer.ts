import { z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../ai.js";
import { retryWithBackoff } from "../utils/retryWithBackoff.js";
import type { QueryAnalysis } from "../types/vendorFlow.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";
import { logger } from "../utils/logger.js";

export const analyzeUserQuery = async (
  userQuery: string,
  chatHistory: string = ""
): Promise<QueryAnalysis> => {
  const historyContext = chatHistory ? `\n\n${chatHistory}` : "";
  
  const prompt = `Analyze this user query: "${userQuery}"${historyContext}

      First, correct any spelling mistakes in the query based on the previous conversation context (especially vendor names, locations, and services mentioned before). Then analyze the corrected query.

      Tasks:
      1. Correct spelling mistakes (especially vendor names, locations, services from chat history). If no mistakes, return the original query.
      2. Does the corrected query require a location? (yes/no)
      3. If yes, extract the location name (city, landmark, or address) ONLY if explicitly mentioned by the user. If the user did NOT mention a location, return null (NOT a default location).
      4. What type of data is the user asking for?
      5. Is this a cart operation? (add to cart, remove from cart, view cart, clear cart)
      6. Is this a pagination request? (show more, next page, show next 10, explore more services, more services, etc.) - If user says "explore more services" or "more services" after viewing services, this is pagination.
      ${chatHistory ? "7. Consider the previous conversation context when analyzing the query. If location was mentioned in previous messages, you can use that. If user previously viewed services and now says 'more services' or 'explore more', this is pagination." : ""}

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
    cartAction: z.enum(["add", "remove", "view", "clear"]).nullable().optional().describe("Type of cart operation"),
    serviceNames: z.array(z.string()).nullable().optional().describe("Array of service names if adding multiple to cart"),
  });

  const startTime = Date.now();
  logger.aiAction("Query Analysis", {
    query: userQuery,
    hasChatHistory: !!chatHistory,
    chatHistoryLength: chatHistory.length,
  });

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
      
      logger.aiAction("Query Analysis Completed", {
        query: userQuery,
        duration,
        analysis,
        response: response.text,
      });
      
      return analysis;
    } catch (parseError) {
      logger.error("Failed to parse query analysis response", {
        query: userQuery,
        response: response.text,
      }, parseError instanceof Error ? parseError : new Error(String(parseError)));
      
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
    }, error instanceof Error ? error : new Error(String(error)));
    
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

