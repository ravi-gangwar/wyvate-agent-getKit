import { googleAI } from "@genkit-ai/google-genai";
import { z } from "genkit";
import { ai } from "./ai.js";
import getUserLocation from "./tools/findLocation.js";
import databaseTool from "./tools/dbCall.js";
import nearbyVendorsFlow from "./flows/nearbyVendors/index.js";

// Re-export ai for convenience
export { ai };

// Example: Category generation flow
const input = z.object({
    category: z.string().describe('is this is veg or non veg'),
  });
  
const output = z.object({
    category: z.enum(['veg', 'non-veg']),
  });

const catGenenrateFlow = ai.defineFlow({
    name: "catGenenrateFlow",
    inputSchema: input,
    outputSchema: output, 
  }, async (input) => {
        const prompt = `You are a helpful assistant that generates a category for a given input.
        The input is ${input.category}.
        Determine if this is veg or non-veg and return only the category.`

        const response = await ai.generate({
          model: googleAI.model('gemini-2.5-flash', {
            temperature: 0.8,
          }),
          prompt: prompt,
          output: {
            schema: output,
          },
        });

        if(!response.output) {
            throw new Error("No result from AI");
        }

        return response.output;
  });

// Export flows and tools
export { catGenenrateFlow, nearbyVendorsFlow, getUserLocation, databaseTool };

async function main() {
    // Example: Generalized vendor query flow
    const result = await nearbyVendorsFlow({
      userQuery: "this is my location name is kanpur give me the nearby vendors",
    });
  
    console.log(JSON.stringify(result, null, 2));
  }
  
  main().catch(console.error);