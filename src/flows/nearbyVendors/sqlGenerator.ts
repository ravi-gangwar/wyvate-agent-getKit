import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../../ai.js";
import { retryWithBackoff } from "../../utils/retryWithBackoff.js";
import dbSchema from "../../schema/schema.js";
import type { LocationData } from "./types.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";
import { buildLocationContext } from "./locationHandler.js";

export const cleanSqlQuery = (query: string): string => {
  return query
    .replace(/^```[\w]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
};

export const generateSqlQuery = async (
  userQuery: string,
  location: LocationData | null
): Promise<string> => {
  const locationContext = buildLocationContext(location);
  const prompt = `Generate a SQL query based on this user query: "${userQuery}"

Database Schema:
${dbSchema}

${locationContext}

Requirements:
- Use actual values, not placeholders
- Include LIMIT 10 if not already present
- For location queries, calculate distance if needed
- Return only the SQL query, nothing else`;

  const response = await retryWithBackoff(() =>
    ai.generate({
      model: googleAI.model(AI_MODEL, {
        temperature: AI_TEMPERATURES.SQL_GENERATION,
      }),
      prompt,
    })
  );

  const sqlQuery = cleanSqlQuery(response.text?.trim() || "");

  if (!sqlQuery) {
    throw new Error("Failed to generate SQL query");
  }

  return sqlQuery;
};

