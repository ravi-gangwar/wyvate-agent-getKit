import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../../ai.js";
import { retryWithBackoff } from "../../utils/retryWithBackoff.js";
import type { LocationData } from "./types.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";

export const refineResponse = async (
  userQuery: string,
  dbResult: any,
  location: LocationData | null
): Promise<string> => {
  const locationInfo = location
    ? `Location: ${location.name} (${location.latitude}, ${location.longitude})`
    : "";

  const prompt = `You are a helpful assistant. The user asked: "${userQuery}"

${locationInfo}

Data retrieved from database:
${JSON.stringify(dbResult, null, 2)}

Provide a friendly, helpful response that:
- Directly addresses the user's query
- Presents the data in a clear and organized way
- Is conversational and user-friendly
- Highlights important information
- Keeps the response concise but informative`;

  const response = await retryWithBackoff(() =>
    ai.generate({
      model: googleAI.model(AI_MODEL, {
        temperature: AI_TEMPERATURES.RESPONSE_REFINEMENT,
      }),
      prompt,
    })
  );

  return response.text || "Data retrieved, but unable to generate response.";
};

