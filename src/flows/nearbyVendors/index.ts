import { z } from "genkit";
import { ai } from "../../ai.js";
import databaseTool from "../../tools/dbCall.js";
import type { FlowInput, FlowOutput } from "./types.js";
import { analyzeUserQuery } from "./queryAnalysis.js";
import { getLocationCoordinates } from "./locationHandler.js";
import { generateSqlQuery } from "./sqlGenerator.js";
import { refineResponse } from "./responseRefiner.js";

const inputSchema = z.object({
  userQuery: z.string().describe("User's query about vendors or any database query"),
  locationName: z.string().optional().describe("Location name if already known (e.g., 'Kanpur')"),
  latitude: z.number().optional().describe("Latitude if already known"),
  longitude: z.number().optional().describe("Longitude if already known"),
});

const outputSchema = z.object({
  response: z.string().optional(),
  error: z.string().optional(),
});

const nearbyVendorsFlow = ai.defineFlow(
  {
    name: "nearbyVendorsFlow",
    inputSchema: inputSchema,
    outputSchema: outputSchema,
  },
  async (input: FlowInput): Promise<FlowOutput> => {
    try {
      // Step 1: Analyze user query
      const analysis = await analyzeUserQuery(input.userQuery);

      // Step 2: Get location coordinates if needed
      const location = await getLocationCoordinates(input, analysis);

      // Step 3: Generate SQL query
      const sqlQuery = await generateSqlQuery(input.userQuery, location);

      // Step 4: Execute SQL query
      const dbResult = await databaseTool({ query: sqlQuery });

      // Step 5: Refine and return response
      const refinedResponse = await refineResponse(input.userQuery, dbResult, location);

      return { response: refinedResponse };
    } catch (error: any) {
      return {
        error: error.message || "An unexpected error occurred while processing your request.",
      };
    }
  }
);

export default nearbyVendorsFlow;

