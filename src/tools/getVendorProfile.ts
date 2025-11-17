import { z } from "genkit";
import { ai } from "../ai.js";
import { logger } from "../utils/logger.js";
import pgClient from "../database/pgClient.js";

const vendorProfileSchema = z.object({
  id: z.number().optional(),
  store_name: z.string().optional(),
  city: z.string().optional(),
  vendor_rating: z.number().nullable().optional(),
  online: z.boolean().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  distance_km: z.number().optional(),
  distance_miles: z.number().optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  opening_hours: z.string().optional(),
  closing_hours: z.string().optional(),
  image: z.string().optional(),
  phoneNumber: z.string().optional(),
  landmark: z.string().optional(),
  placeId: z.string().optional(),
  avg_preparing_time: z.number().optional(),
  tax_type: z.string().optional(),
  cgst: z.number().optional(),
  sgst: z.number().optional(),
  eat_in: z.boolean().optional(),
  vendor_type_id: z.number().optional(),
  cover_images: z.array(z.string()).optional(),
  features: z.array(z.object({ name: z.string() })).optional(),
  navUrl: z.string().optional(),
  distance: z.number().optional(),
}).passthrough();

const vendorProfileResponseSchema = z.object({
  message: z.string().optional(),
  vendor: vendorProfileSchema.optional(),
  data: vendorProfileSchema.optional(),
  profile: vendorProfileSchema.optional(),
}).passthrough();

/**
 * Direct function to fetch vendor profile from database
 */
export async function fetchVendorProfile(params: {
  vendorId: number;
  latitude: number;
  longitude: number;
  day?: number; // Day of week (0-6, where 0 is Sunday)
}): Promise<z.infer<typeof vendorProfileResponseSchema>> {
  const day = params.day !== undefined ? params.day : new Date().getDay();
  
  logger.info("Fetching vendor profile from database", {
    vendorId: params.vendorId,
    latitude: params.latitude,
    longitude: params.longitude,
    day,
  });

  const client = pgClient();
  await client.connect();

  try {
    const activeStatus = true;

    // Get current date string (YYYY-MM-DD)
    const dateObject = new Date();
    const year = dateObject.getFullYear();
    const month = String(dateObject.getMonth() + 1).padStart(2, "0");
    const dayy = String(dateObject.getDate()).padStart(2, "0");
    const dateString = `${year}-${month}-${dayy}`;

    // Fetch features
    const featuresQuery = `
      SELECT aaf.name 
      FROM vendor_vendorfeature vvf 
      LEFT JOIN admin_app_features aaf ON vvf.feature_id_id = aaf.id 
      WHERE vvf.vendor_id_id = $1
    `;
    const featuresResult = await client.query(featuresQuery, [params.vendorId]);
    const features = featuresResult.rows.map((row: any) => ({ name: row.name }));

    // Fetch vendor profile with schedule
    const profileQuery = `
      SELECT
        vvm.id,
        vvm.contact_phone AS phoneNumber,
        vvm.image,
        vvm.store_name,
        vvm.landmark,
        vvm.latitude,
        vvm.longitude,
        vvm.vendor_rating,
        vvm."placeId",
        vvm.avg_preparing_time,
        vvr.tax_type,
        vvr.cgst,
        vvr.sgst,
        vsc.opening_time,
        vsc.closing_time,
        vvr.eat_in,
        vvm.online,
        vvm.vendor_type_id,
        COALESCE(array_agg(DISTINCT aac.image) FILTER (WHERE aac.image IS NOT NULL), '{}') AS cover_images,
        earth_distance(
          ll_to_earth($2, $3),
          ll_to_earth(vvm.latitude, vvm.longitude)
        ) / 1000.0 AS distance_km
      FROM
        vendor_vendormodel vvm 
      LEFT JOIN
        vendor_vendorrules vvr 
        ON vvr.id = vvm.rule_id_id 
      LEFT JOIN
        vendor_schedule AS vsc 
        ON vsc.vendor_id_id = vvm.id 
        AND vsc.day = $4
      LEFT JOIN
        vendor_vendorslotsmodel AS vvsl
        ON vvsl.vendor_id_id = vvm.id
        AND vvsl.active = $5     
      LEFT JOIN 
        admin_app_coverimage AS aac
        ON aac.vendor_id_id = vvm.id
      WHERE
        vvm.id = $1 
      GROUP BY
        vvm.id,
        vvm.contact_phone,
        vvm.image,
        vvm.store_name,
        vvm.landmark,
        vvm.latitude,
        vvm.longitude,
        vvm.vendor_rating,
        vvm."placeId",
        vvm.avg_preparing_time,
        vvr.tax_type,
        vvr.cgst,
        vvr.sgst,
        vsc.opening_time,
        vsc.closing_time,
        vvr.eat_in,
        vvm.online,
        vvm.vendor_type_id
    `;

    const profileResult = await client.query(profileQuery, [
      params.vendorId,
      params.latitude,
      params.longitude,
      day,
      activeStatus,
    ]);

    if (!profileResult.rows || profileResult.rows.length === 0) {
      logger.warn("Vendor profile not found", { vendorId: params.vendorId });
      return {
        message: "Vendor profile not found",
        vendor: undefined,
        data: undefined,
        profile: undefined,
      };
    }

    const row = profileResult.rows[0];
    
    // Transform the result
    const profile: any = {
      id: typeof row.id === 'string' ? parseInt(row.id, 10) : row.id,
      store_name: row.store_name,
      phoneNumber: row.phoneNumber,
      phone: row.phoneNumber,
      image: row.image,
      landmark: row.landmark,
      latitude: row.latitude ? parseFloat(String(row.latitude)) : undefined,
      longitude: row.longitude ? parseFloat(String(row.longitude)) : undefined,
      vendor_rating: row.vendor_rating !== null && row.vendor_rating !== undefined 
        ? parseFloat(String(row.vendor_rating)) 
        : null,
      placeId: row.placeId,
      avg_preparing_time: row.avg_preparing_time ? parseFloat(String(row.avg_preparing_time)) : undefined,
      tax_type: row.tax_type,
      cgst: row.cgst ? parseFloat(String(row.cgst)) : undefined,
      sgst: row.sgst ? parseFloat(String(row.sgst)) : undefined,
      opening_hours: row.opening_time,
      closing_hours: row.closing_time,
      eat_in: row.eat_in,
      online: row.online,
      vendor_type_id: row.vendor_type_id ? (typeof row.vendor_type_id === 'string' ? parseInt(row.vendor_type_id, 10) : row.vendor_type_id) : undefined,
      features,
    };

    // Add distance
    if (row.distance_km !== undefined && row.distance_km !== null) {
      const distanceKm = parseFloat(String(row.distance_km));
      profile.distance_km = distanceKm;
      profile.distance = distanceKm;
      profile.distance_miles = distanceKm * 0.621371; // Convert to miles
    }

    // Add cover images
    if (row.cover_images && Array.isArray(row.cover_images)) {
      profile.cover_images = row.cover_images;
    }

    // Add navigation URL if placeId exists
    if (row.placeId) {
      profile.navUrl = `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${row.placeId}`;
    }

    logger.info("Vendor profile fetched from database", {
      vendorId: params.vendorId,
      storeName: profile.store_name,
      distanceKm: profile.distance_km,
    });

    return {
      message: "Success",
      vendor: profile,
      data: profile,
      profile: profile,
    };
  } catch (error) {
    logger.error("Failed to fetch vendor profile from database", {
      vendorId: params.vendorId,
      latitude: params.latitude,
      longitude: params.longitude,
    }, error instanceof Error ? error : new Error(String(error)));

    return {
      message: "Error fetching vendor profile",
      vendor: undefined,
      data: undefined,
      profile: undefined,
    };
  } finally {
    await client.end();
  }
}

/**
 * Genkit tool definition for AI to use
 */
const getVendorProfile = ai.defineTool(
  {
    name: "getVendorProfile",
    description: "Get detailed profile information for a specific vendor including rating, distance, hours, contact info, etc. Requires vendor ID and user's location coordinates.",
    inputSchema: z.object({
      vendorId: z.number().describe("The ID of the vendor"),
      latitude: z.number().describe("Latitude coordinate of the user's location (for distance calculation)"),
      longitude: z.number().describe("Longitude coordinate of the user's location (for distance calculation)"),
    }),
    outputSchema: vendorProfileResponseSchema,
  },
  async (input) => {
    return await fetchVendorProfile({
      vendorId: input.vendorId,
      latitude: input.latitude,
      longitude: input.longitude,
    });
  }
);

export default getVendorProfile;

