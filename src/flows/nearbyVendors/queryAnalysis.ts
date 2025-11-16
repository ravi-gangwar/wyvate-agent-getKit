import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../../ai.js";
import { retryWithBackoff } from "../../utils/retryWithBackoff.js";
import type { QueryAnalysis } from "./types.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";
import { logger } from "../../utils/logger.js";

/**
 * Correct spelling mistakes in user query based on chat history context
 */
export const correctSpelling = async (
  userQuery: string,
  chatHistory: string = ""
): Promise<string> => {
  // If no chat history, return query as-is (no context for correction)
  if (!chatHistory) {
    return userQuery;
  }

  const prompt = `Correct any spelling mistakes in this user query based on the previous conversation context: "${userQuery}"

${chatHistory}

Instructions:
- Fix spelling mistakes, especially for vendor names, locations, and services mentioned in previous conversations
- If a word appears misspelled but matches something from the chat history (e.g., "Aroms" should be "Aromas" if "Aromas" was mentioned before), correct it
- Keep the user's intent and meaning exactly the same
- Only correct obvious spelling mistakes, don't change valid words
- Return ONLY the corrected query, nothing else
- If there are no spelling mistakes, return the original query unchanged

Corrected query:`;

  try {
    const startTime = Date.now();
    logger.aiAction("Spell Correction", {
      query: userQuery,
      hasChatHistory: !!chatHistory,
    });

    const response = await retryWithBackoff(() =>
      ai.generate({
        model: googleAI.model(AI_MODEL, {
          temperature: AI_TEMPERATURES.SPELL_CORRECTION,
        }),
        prompt,
      })
    );

    const duration = Date.now() - startTime;
    const correctedQuery = response.text?.trim() || userQuery;
    
    // Clean up the response (remove quotes if present, trim whitespace)
    const cleaned = correctedQuery
      .replace(/^["']|["']$/g, "")
      .trim();
    
    const wasCorrected = cleaned && cleaned !== userQuery;
    
    logger.aiAction("Spell Correction Completed", {
      original: userQuery,
      corrected: cleaned,
      wasCorrected,
      duration,
      response: response.text,
    });
    
    // Return corrected query if it's different and not empty, otherwise return original
    return wasCorrected ? cleaned : userQuery;
  } catch (error) {
    // If spell correction fails, return original query
    logger.error("Error correcting spelling", { userQuery }, error instanceof Error ? error : new Error(String(error)));
    return userQuery;
  }
};

export const analyzeUserQuery = async (
  userQuery: string,
  chatHistory: string = ""
): Promise<QueryAnalysis> => {
  const historyContext = chatHistory ? `\n\n${chatHistory}` : "";
  
  const prompt = `Analyze this user query: "${userQuery}"${historyContext}

      Determine:
      1. Does this query require a location? (yes/no)
      2. If yes, extract the location name (city, landmark, or address) ONLY if explicitly mentioned by the user. If the user did NOT mention a location, return null (NOT a default location).
      3. What type of data is the user asking for?
      4. Is this a cart operation? (add to cart, remove from cart, view cart, clear cart)
      5. Is this a pagination request? (show more, next page, show next 10, explore more services, more services, etc.) - If user says "explore more services" or "more services" after viewing services, this is pagination.
      ${chatHistory ? "6. Consider the previous conversation context when analyzing the query. If location was mentioned in previous messages, you can use that. If user previously viewed services and now says 'more services' or 'explore more', this is pagination." : ""}

      IMPORTANT: Only set locationName if the user explicitly mentioned a location in their query or in previous conversation. Do NOT use any default location. If no location is mentioned, set locationName to null.

      Respond in JSON format:
      {
        "needsLocation": true/false,
        "locationName": "location name or null (null if user did not mention any location)",
        "queryType": "description of what user wants",
        "isCartOperation": true/false,
        "isPaginationRequest": true/false,
        "cartAction": "add/remove/view/clear or null",
        "serviceNames": ["service name 1", "service name 2"] or null (array of service names if adding multiple to cart)
      }`;

  const startTime = Date.now();
  logger.aiAction("Query Analysis", {
    query: userQuery,
    hasChatHistory: !!chatHistory,
    chatHistoryLength: chatHistory.length,
  });

  const response = await retryWithBackoff(() =>
    ai.generate({
      model: googleAI.model(AI_MODEL, {
        temperature: AI_TEMPERATURES.ANALYSIS,
      }),
      prompt,
    })
  );

  const duration = Date.now() - startTime;

  try {
    // Extract JSON from markdown code blocks if present
    let analysisText = response.text?.trim() || "{}";
    analysisText = analysisText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    
    const analysis = JSON.parse(analysisText);
    
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
};

