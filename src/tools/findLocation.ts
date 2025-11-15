import { z } from "genkit";
import { ai } from "../ai.js";

const getUserLocation = ai.defineTool(
    {
      name: 'getUserLocation',
      description: 'Gets the current location of the user, based on the user query, return the latitude and longitude',
      inputSchema: z.object({
        query: z.string().describe('City name, landmark, address provided by the user'),
      }),
      outputSchema: z.object({
        latitude: z.number().describe('The latitude of the location'),
        longitude: z.number().describe('The longitude of the location'),
      }),
    },
    async (input) => {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;

      console.log("FINDING LOCATION.........................");
      console.log(input.query);
      
      if (!apiKey) {
        throw new Error('GOOGLE_MAPS_API_KEY environment variable is not set');
      }

      const encodedQuery = encodeURIComponent(input.query);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedQuery}&key=${apiKey}`;

      try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'ZERO_RESULTS') {
          throw new Error(`No results found for location: ${input.query}`);
        }

        if (data.status !== 'OK') {
          throw new Error(`Google Maps API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
        }

        if (!data.results || data.results.length === 0) {
          throw new Error(`No results found for location: ${input.query}`);
        }

        const location = data.results[0].geometry.location;
        
        return {
          latitude: location.lat,
          longitude: location.lng,
        };
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(`Failed to fetch location: ${String(error)}`);
      }
    },
  );

export default getUserLocation;