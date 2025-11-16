import getUserLocation from "../../tools/findLocation.js";
import type { FlowInput, QueryAnalysis, LocationData } from "./types.js";
import { LOCATION_RADIUS } from "./constants.js";

export const getLocationCoordinates = async (
  input: FlowInput,
  analysis: QueryAnalysis
): Promise<LocationData | null> => {
  const needsLocation = analysis.needsLocation || input.latitude || input.longitude;

  if (!needsLocation) {
    return null;
  }

  if (input.latitude && input.longitude) {
    return {
      latitude: input.latitude,
      longitude: input.longitude,
      name: input.locationName || analysis.locationName || "Unknown Location",
    };
  }

  // Only use location if explicitly provided - don't use default
  const locationQuery = input.locationName || analysis.locationName;
  
  if (!locationQuery) {
    return null;
  }
  
  const locationResult = await getUserLocation({ query: locationQuery });

  return {
    latitude: locationResult.latitude,
    longitude: locationResult.longitude,
    name: locationQuery,
  };
};

export const buildLocationContext = (location: LocationData | null): string => {
  if (!location) return "";

  return `User's location: ${location.name} (latitude: ${location.latitude}, longitude: ${location.longitude})

CRITICAL: For finding vendors by location, ALWAYS use latitude and longitude coordinates, NOT city name.
- Use: latitude BETWEEN ${location.latitude - LOCATION_RADIUS} AND ${location.latitude + LOCATION_RADIUS} AND longitude BETWEEN ${location.longitude - LOCATION_RADIUS} AND ${location.longitude + LOCATION_RADIUS}
- DO NOT use city name filtering (e.g., city = 'kanpur' or LOWER(city) = LOWER('kanpur'))
- Coordinates are more accurate and reliable than city names
- Example query pattern:
  SELECT store_name, city, vendor_rating, online, latitude, longitude
  FROM vendor_vendormodel
  WHERE latitude BETWEEN ${location.latitude - LOCATION_RADIUS} AND ${location.latitude + LOCATION_RADIUS}
    AND longitude BETWEEN ${location.longitude - LOCATION_RADIUS} AND ${location.longitude + LOCATION_RADIUS}
  LIMIT 10;`;
};

