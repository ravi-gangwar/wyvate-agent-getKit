import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../../ai.js";
import { retryWithBackoff } from "../../utils/retryWithBackoff.js";
import type { LocationData } from "./types.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";

export const refineResponse = async (
  userQuery: string,
  dbResult: any,
  location: LocationData | null
): Promise<{ ai_voice: string; markdown_text: string }> => {
  const locationInfo = location
    ? `Location: ${location.name} (${location.latitude}, ${location.longitude})`
    : "";

  const prompt = `You are a helpful assistant. The user asked: "${userQuery}"

${locationInfo}

Data retrieved from database:
${JSON.stringify(dbResult, null, 2)}

Your task:
- Understand the user's request and the data.
- Prepare TWO versions of the answer:
  1) ai_voice: A plain, friendly sentence or two suitable for text-to-speech.\n     - No markdown and no special formatting symbols.\n     - Use only normal letters, numbers, commas, periods, and basic punctuation.\n     - Keep it concise and easy to speak.
  2) markdown_text: A rich markdown response.\n     - Use headings, bullet points, and bold text to present vendors and services/items.\n     - Clearly list vendor names, services/items, prices, and any other important info.\n     - Make it visually nice for a chat UI.

Respond ONLY in valid JSON with this exact shape:
{
  "ai_voice": "plain speech friendly text here",
  "markdown_text": "markdown formatted text here"
}`;

  const response = await retryWithBackoff(() =>
    ai.generate({
      model: googleAI.model(AI_MODEL, {
        temperature: AI_TEMPERATURES.RESPONSE_REFINEMENT,
      }),
      prompt,
    })
  );

  const rawText = response.text?.trim() || "";

  // Extract JSON from markdown code blocks and clean up
  const extractJson = (text: string): string => {
    let cleaned = text.trim();
    
    // Remove "json" prefix if present
    cleaned = cleaned.replace(/^json\s+/i, "").trim();
    
    // Remove markdown code blocks (```json ... ```)
    cleaned = cleaned.replace(/^```[\w]*\n?/i, "").replace(/\n?```$/i, "").trim();
    
    // Find the first complete JSON object
    let braceCount = 0;
    let startIdx = -1;
    
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') {
        if (startIdx === -1) startIdx = i;
        braceCount++;
      } else if (cleaned[i] === '}') {
        braceCount--;
        if (braceCount === 0 && startIdx !== -1) {
          return cleaned.substring(startIdx, i + 1);
        }
      }
    }
    
    // Fallback: try regex match
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    
    return cleaned;
  };

  try {
    const jsonText = extractJson(rawText);
    const parsed = JSON.parse(jsonText) as {
      ai_voice?: string;
      markdown_text?: string;
    };

    // Clean ai_voice for TTS - remove markdown symbols and normalize
    let ai_voice = parsed.ai_voice || "";
    
    // Remove common markdown symbols
    ai_voice = ai_voice
      .replace(/[*_`#>\[\]-]/g, " ")
      .replace(/\\n/g, " ")
      .replace(/\\"/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    // Extract markdown_text and unescape newlines
    let markdown_text = parsed.markdown_text || "";
    
    // Unescape markdown text (handle \n, etc.)
    markdown_text = markdown_text
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\t/g, "\t");

    if (!ai_voice) {
      ai_voice = "Data retrieved, but unable to generate voice response.";
    }
    
    if (!markdown_text) {
      markdown_text = "Data retrieved, but unable to generate markdown response.";
    }

    return { ai_voice, markdown_text };
  } catch (error) {
    // Fallback: clean the whole text for ai_voice and reuse as markdown_text
    let ai_voice = rawText
      .replace(/^json\s+/i, "")
      .replace(/^```[\w]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .replace(/[*_`#>\[\]-]/g, " ")
      .replace(/\\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    let markdown_text = rawText
      .replace(/^json\s+/i, "")
      .replace(/^```[\w]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .replace(/\\n/g, "\n");

    return {
      ai_voice: ai_voice || "Data retrieved, but unable to generate response.",
      markdown_text: markdown_text || "Data retrieved, but unable to generate response.",
    };
  }
};

