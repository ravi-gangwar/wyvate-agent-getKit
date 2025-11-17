import { logger } from "../utils/logger.js";
import pgClient from "../database/pgClient.js";

/**
 * Simplified query to fetch only required vendor data: id, name, distance, rating
 */
export async function fetchVendorsFromDB(params: {
  latitude: number;
  longitude: number;
  vendorType?: string;
  limit?: number;
}): Promise<{
  Vendors: Array<{
    id: number;
    store_name: string;
    distance_km?: number;
    vendor_rating?: number | null;
  }>;
  masterProfiles: any[];
  message: string;
}> {
  const vendorType = params.vendorType || "Food";
  const limit = params.limit || 50; // Default limit

  logger.info("Fetching vendors from database", {
    latitude: params.latitude,
    longitude: params.longitude,
    vendorType,
    limit,
  });

  const client = pgClient();
  await client.connect();

  try {
    // First, get vendor type ID
    const vendortypeQuery = `SELECT id FROM vendor_vendorvendortype WHERE name = $1`;
    const vendortypeResult = await client.query(vendortypeQuery, [vendorType]);

    if (!vendortypeResult.rows || vendortypeResult.rows.length === 0) {
      logger.warn("Vendor type not found", { vendorType });
      return {
        Vendors: [],
        masterProfiles: [],
        message: `Vendor type '${vendorType}' not found`,
      };
    }

    const vendorTypeId = vendortypeResult.rows[0].id;

    // Simplified query - only fetch what we need
    const query = `
      SELECT
        vvm.id,
        vvm.store_name,
        vvm.vendor_rating,
        earth_distance(
          ll_to_earth($1, $2),
          ll_to_earth(vvm.latitude, vvm.longitude)
        ) / 1000.0 AS distance_km
      FROM
        vendor_vendormodel vvm
      LEFT JOIN
        vendor_vendorrules vvr
        ON vvr.id = vvm.rule_id_id
      WHERE
        vvm.status = $3
        AND vvr.listing = $4
        AND vvm.vendor_type_id = $5
      GROUP BY
        vvm.id,
        vvm.store_name,
        vvm.vendor_rating,
        vvm.latitude,
        vvm.longitude
      ORDER BY
        distance_km ASC
      LIMIT $6
    `;

    const queryParams = [
      params.latitude,
      params.longitude,
      "6", // status
      true, // listing
      vendorTypeId,
      limit,
    ];

    const result = await client.query(query, queryParams);

    // Transform results to match expected format
    const vendors = result.rows.map((row: any) => {
      const vendor: {
        id: number;
        store_name: string;
        distance_km?: number;
        vendor_rating?: number | null;
      } = {
        id: typeof row.id === 'string' ? parseInt(row.id, 10) : row.id,
        store_name: row.store_name,
      };

      if (row.distance_km !== undefined && row.distance_km !== null) {
        vendor.distance_km = parseFloat(String(row.distance_km));
      }

      if (row.vendor_rating !== undefined && row.vendor_rating !== null) {
        vendor.vendor_rating = parseFloat(String(row.vendor_rating));
      }

      return vendor;
    });

    logger.info("Vendors fetched from database", {
      vendorCount: vendors.length,
    });

    return {
      Vendors: vendors,
      masterProfiles: [], // Not needed for now
      message: "Success",
    };
  } catch (error) {
    logger.error("Failed to fetch vendors from database", {
      latitude: params.latitude,
      longitude: params.longitude,
      vendorType,
    }, error instanceof Error ? error : new Error(String(error)));

    return {
      Vendors: [],
      masterProfiles: [],
      message: "Error fetching vendors",
    };
  } finally {
    await client.end();
  }
}

