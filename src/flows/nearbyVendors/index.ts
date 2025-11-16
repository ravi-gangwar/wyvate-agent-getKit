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
  ai_voice: z.string().optional(),
  markdown_text: z.string().optional(),
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

      // If user is asking for nearby vendors/services but no location info is available,
      // ask explicitly for location instead of guessing a default.
      const needsLocation = analysis.needsLocation === true;
      // Only treat location as available if the user explicitly provided it
      // via API input (coords or locationName). Do NOT infer from analysis here.
      const hasLocationInput =
        !!input.latitude || !!input.longitude || !!input.locationName;

      if (needsLocation && !hasLocationInput) {
        return {
          ai_voice:
            "To find nearby vendors and their services, please share your city name or current location.",
          markdown_text:
            "To find nearby vendors and their services, please share your **city name** or **current location**.",
        };
      }

      // Step 2: Get location coordinates if needed
      const location = await getLocationCoordinates(input, analysis);

      // Step 3: Generate SQL query
      const sqlQuery = await generateSqlQuery(input.userQuery, location);

      // Step 4: Execute SQL query
      const dbResult = await databaseTool({ query: sqlQuery });

      // Step 5: Refine and return response
      const refinedResponse = await refineResponse(
        input.userQuery,
        dbResult,
        location
      );

      return {
        ai_voice: refinedResponse.ai_voice,
        markdown_text: refinedResponse.markdown_text,
      };
    } catch (error: any) {
      return {
        error: error.message || "An unexpected error occurred while processing your request.",
      };
    }
  }
);

export default nearbyVendorsFlow;

