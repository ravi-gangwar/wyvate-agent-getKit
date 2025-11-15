import { googleAI } from "@genkit-ai/google-genai";
import { genkit } from "genkit";

// Initialize AI
export const ai = genkit({
    plugins: [googleAI({apiKey: process.env.GEMINI_API_KEY || ''})],
    model: googleAI.model('gemini-2.5-flash', {
      temperature: 0.8,
    }),
});

