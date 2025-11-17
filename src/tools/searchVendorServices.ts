import { z } from "genkit";
import { ai } from "../ai.js";
import { logger } from "../utils/logger.js";
import pgClient from "../database/pgClient.js";

const serviceSchema = z.object({
  id: z.number().optional(),
  name: z.string().optional(),
  price: z.number().optional(),
  discount: z.number().nullable().optional(),
  discount_type: z.string().nullable().optional(),
  veg: z.boolean().optional(),
  category_id: z.number().optional(),
  category_name: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
}).passthrough();

const servicesSearchResponseSchema = z.object({
  message: z.string().optional(),
  services: z.array(serviceSchema).optional(),
  data: z.array(serviceSchema).optional(),
  results: z.array(serviceSchema).optional(),
  total: z.number().optional(),
}).passthrough();

/**
 * Direct function to search services for a vendor from database
 */
export async function searchVendorServices(params: {
  vendorId: number;
  search: string;
}): Promise<z.infer<typeof servicesSearchResponseSchema>> {
  logger.info("Searching vendor services from database", {
    vendorId: params.vendorId,
    searchTerm: params.search,
  });

  const client = pgClient();
  await client.connect();

  try {
    // Search query - case-insensitive search on service name
    const query = `
      SELECT
        vvs.vendor_service_id_id AS service_id,
        aasm.name AS service_name,
        vvs.price AS service_price,
        vvs.discount AS service_discount,
        vvs.discount_type,
        aasm.veg,
        vvc.category_id_id AS category_id,
        aacm.name AS category_name
      FROM
        vendor_vendorservice vvs
      LEFT JOIN
        admin_app_servicemodel aasm
        ON aasm.id = vvs.vendor_service_id_id
      LEFT JOIN
        vendor_vendorcategory vvc
        ON vvc.id = vvs.vendor_category_id_id
      LEFT JOIN
        admin_app_categorymodel aacm
        ON aacm.id = vvc.category_id_id
      WHERE
        vvs.vendor_id_id = $1
        AND vvs.eye_toggle = true
        AND vvs.active = true
        AND vvs.price IS NOT NULL
        AND vvs.price > 0
        AND vvs.approved = '1'
        AND vvc.approved = '1'
        AND vvc.active = true
        AND LOWER(aasm.name) LIKE LOWER($2)
      ORDER BY
        vvc.priority ASC,
        vvs.priority ASC
      LIMIT 50
    `;

    const searchPattern = `%${params.search}%`;
    const result = await client.query(query, [params.vendorId, searchPattern]);

    // Transform results to match expected format
    const services = result.rows.map((row: any) => {
      const service: any = {
        id: typeof row.service_id === 'string' ? parseInt(row.service_id, 10) : row.service_id,
        name: row.service_name,
        price: row.service_price ? parseFloat(String(row.service_price)) : 0,
      };

      // Add discount if available
      if (row.service_discount !== undefined && row.service_discount !== null) {
        let discount = parseFloat(String(row.service_discount));
        // Calculate discount based on discount type (1 = percentage, 0 = flat)
        if (row.discount_type === 1) {
          discount = service.price * (discount / 100);
        }
        service.discount = discount;
        service.discount_type = row.discount_type;
      }

      // Add optional fields
      if (row.veg !== undefined && row.veg !== null) {
        service.veg = row.veg;
      }
      if (row.category_id !== undefined && row.category_id !== null) {
        service.category_id = typeof row.category_id === 'string' ? parseInt(row.category_id, 10) : row.category_id;
      }
      if (row.category_name) {
        service.category_name = row.category_name;
      }

      return service;
    });

    logger.info("Vendor services search completed", {
      vendorId: params.vendorId,
      searchTerm: params.search,
      serviceCount: services.length,
    });

    return {
      message: "Success",
      services,
      data: services,
      results: services,
      total: services.length,
    };
  } catch (error) {
    logger.error("Failed to search vendor services from database", {
      vendorId: params.vendorId,
      searchTerm: params.search,
    }, error instanceof Error ? error : new Error(String(error)));

    return {
      message: "Error searching vendor services",
      services: [],
      data: [],
      results: [],
      total: 0,
    };
  } finally {
    await client.end();
  }
}

/**
 * Genkit tool definition for AI to use
 */
const searchVendorServicesTool = ai.defineTool(
  {
    name: "searchVendorServices",
    description: "Search for services/items within a specific vendor's menu. Returns matching services based on the search term.",
    inputSchema: z.object({
      vendorId: z.number().describe("The ID of the vendor"),
      search: z.string().describe("Search term to find services (e.g., 'Bombay Grilled', 'Pizza', etc.)"),
    }),
    outputSchema: servicesSearchResponseSchema,
  },
  async (input) => {
    return await searchVendorServices({
      vendorId: input.vendorId,
      search: input.search,
    });
  }
);

export default searchVendorServicesTool;

