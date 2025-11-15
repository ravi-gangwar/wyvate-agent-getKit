import getUserLocation from "../../tools/findLocation.js";
import type { FlowInput, QueryAnalysis, LocationData } from "./types.js";
import { DEFAULT_LOCATION, LOCATION_RADIUS } from "./constants.js";

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

  const locationQuery = input.locationName || analysis.locationName || DEFAULT_LOCATION;
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
For location-based queries, use latitude BETWEEN ${location.latitude - LOCATION_RADIUS} AND ${location.latitude + LOCATION_RADIUS} AND longitude BETWEEN ${location.longitude - LOCATION_RADIUS} AND ${location.longitude + LOCATION_RADIUS}`;
};

