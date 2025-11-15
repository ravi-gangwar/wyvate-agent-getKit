import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../../ai.js";
import { retryWithBackoff } from "../../utils/retryWithBackoff.js";
import type { QueryAnalysis } from "./types.js";
import { DEFAULT_LOCATION, AI_MODEL, AI_TEMPERATURES } from "./constants.js";

export const analyzeUserQuery = async (userQuery: string): Promise<QueryAnalysis> => {
  const prompt = `Analyze this user query: "${userQuery}"

      Determine:
      1. Does this query require a location? (yes/no)
      2. If yes, extract the location name (city, landmark, or address). If no location mentioned, return "${DEFAULT_LOCATION}" as default.
      3. What type of data is the user asking for?

      Respond in JSON format:
      {
        "needsLocation": true/false,
        "locationName": "location name or null",
        "queryType": "description of what user wants"
      }`;

  const response = await retryWithBackoff(() =>
    ai.generate({
      model: googleAI.model(AI_MODEL, {
        temperature: AI_TEMPERATURES.ANALYSIS,
      }),
      prompt,
    })
  );

  try {
    const analysisText = response.text?.trim() || "{}";
    return JSON.parse(analysisText);
  } catch {
    return {
      needsLocation: false,
      locationName: null,
      queryType: "general query",
    };
  }
};

