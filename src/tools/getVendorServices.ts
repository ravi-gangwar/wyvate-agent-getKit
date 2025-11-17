import { z } from "genkit";
import { ai } from "../ai.js";
import { logger } from "../utils/logger.js";
import { ServiceFilter, type ServiceFilterType } from "../types/vendor.js";
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

const vendorServicesResponseSchema = z.object({
  message: z.string().optional(),
  services: z.array(serviceSchema).optional(),
  total: z.number().optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
  totalPages: z.number().optional(),
}).passthrough();

/**
 * Direct function to fetch vendor services from database (simplified - only required fields)
 */
export async function fetchVendorServices(params: {
  vendorId: number;
  limit?: number;
  page?: number;
  filter?: ServiceFilterType;
}): Promise<z.infer<typeof vendorServicesResponseSchema>> {
  const limit = params.limit || 325;
  const page = params.page || 1;
  const offset = (page - 1) * limit;
  const filter = params.filter !== undefined ? params.filter : ServiceFilter.ALL;

  logger.info("Fetching vendor services from database", {
    vendorId: params.vendorId,
    limit,
    page,
    filter,
  });

  const client = pgClient();
  await client.connect();

  try {
    // Get total count
    const countQuery = `
      SELECT COUNT(*) AS total_count
      FROM vendor_vendorservice vvs
      LEFT JOIN admin_app_servicemodel aasm ON aasm.id = vvs.vendor_service_id_id
      WHERE vvs.vendor_id_id = $1
        AND vvs.eye_toggle = true
        AND vvs.active = true
        AND vvs.price IS NOT NULL
        AND vvs.price > 0
        AND vvs.approved = '1'
        ${filter !== ServiceFilter.ALL ? 'AND aasm.veg = $2' : ''}
    `;

    const countParams = filter !== ServiceFilter.ALL 
      ? [params.vendorId, filter]
      : [params.vendorId];

    const totalResult = await client.query(countQuery, countParams);
    const totalCount = parseInt(totalResult.rows[0].total_count, 10);

    // Simplified query - only fetch what we need
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
        ${filter !== ServiceFilter.ALL ? 'AND aasm.veg = $4' : ''}
      ORDER BY
        vvc.priority ASC,
        vvs.priority ASC
      LIMIT $2 OFFSET $3
    `;

    const queryParams = filter !== ServiceFilter.ALL
      ? [params.vendorId, limit, offset, filter]
      : [params.vendorId, limit, offset];

    const result = await client.query(query, queryParams);

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

    logger.info("Vendor services fetched from database", {
      serviceCount: services.length,
      total: totalCount,
      page,
    });

    return {
      message: "Success",
      services,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
    };
  } catch (error) {
    logger.error("Failed to fetch vendor services from database", {
      vendorId: params.vendorId,
      limit,
      page,
      filter,
    }, error instanceof Error ? error : new Error(String(error)));

    return {
      message: "Error fetching vendor services",
      services: [],
      total: 0,
      page,
      limit,
      totalPages: 0,
    };
  } finally {
    await client.end();
  }
}

/**
 * Genkit tool definition for AI to use
 */
const getVendorServices = ai.defineTool(
  {
    name: "getVendorServices",
    description: "Get services/items for a specific vendor. Filter can be: 0=All, 1=Vegetarian, 2=Non-vegetarian, 3=Eggeterian.",
    inputSchema: z.object({
      vendorId: z.number().describe("The ID of the vendor"),
      limit: z.number().optional().describe("Number of services to return per page (default: 325)"),
      page: z.number().optional().describe("Page number (default: 1)"),
      filter: z.number().optional().describe("Filter type: 0=All, 1=Vegetarian, 2=Non-vegetarian, 3=Eggeterian (default: 0)"),
    }),
    outputSchema: vendorServicesResponseSchema,
  },
  async (input) => {
    const params: {
      vendorId: number;
      limit?: number;
      page?: number;
      filter?: ServiceFilterType;
    } = {
      vendorId: input.vendorId,
    };
    
    if (input.limit !== undefined) {
      params.limit = input.limit;
    }
    if (input.page !== undefined) {
      params.page = input.page;
    }
    if (input.filter !== undefined) {
      params.filter = input.filter;
    }
    
    return await fetchVendorServices(params);
  }
);

export default getVendorServices;

