import { z } from "genkit";
import { ai } from "../ai.js";
import getData from "../utils/getData.js";
import dbSchema from "../schema/schema.js";

const vendorRowSchema = z.object({
  store_name: z.string().optional(),
  city: z.string().optional(),
  vendor_rating: z.number().nullable().optional(),
  online: z.boolean().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  distance_km: z.number().optional(),
  distance_miles: z.number().optional(),
}).passthrough();

const databaseOutputSchema = z.object({
  data: z.array(vendorRowSchema).optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  total_found: z.number().optional(),
});

const databaseTool = ai.defineTool(
    {
      name: "databaseTool",
      description: `TABLE SCHEMA : ${dbSchema} Use this to fetch data from the database. Provide a complete SQL query with actual numeric values (not placeholders). For location-based queries, calculate latitude/longitude ranges around target coordinates (e.g., ±0.1 degrees for ~11km radius). Table: vendor_vendormodel with columns: store_name, city, vendor_rating, online, latitude, longitude. Always include LIMIT 10 in your queries.`,
      inputSchema: z.object({
        query: z.string().describe('SQL query to fetch data from the database. Must include LIMIT clause.'),
      }),
      outputSchema: databaseOutputSchema,
    },  
    async (input) => {
      const result = await getData(input.query);
      return result;
    }
  );

export default databaseTool;