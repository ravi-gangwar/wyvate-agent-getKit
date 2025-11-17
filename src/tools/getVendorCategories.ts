import { z } from "genkit";
import { ai } from "../ai.js";
import { logger } from "../utils/logger.js";
import pgClient from "../database/pgClient.js";

const categorySchema = z.object({
  id: z.number().optional(),
  name: z.string().optional(),
  category_id: z.number().optional(),
  priority: z.number().optional(),
  active: z.boolean().optional(),
}).passthrough();

const vendorCategoriesResponseSchema = z.object({
  message: z.string().optional(),
  categories: z.array(categorySchema).optional(),
  data: z.array(categorySchema).optional(),
}).passthrough();

/**
 * Direct function to fetch vendor categories from database
 */
export async function fetchVendorCategories(params: {
  vendorId: number;
}): Promise<z.infer<typeof vendorCategoriesResponseSchema>> {
  logger.info("Fetching vendor categories from database", {
    vendorId: params.vendorId,
  });

  const client = pgClient();
  await client.connect();

  try {
    const activeStatus = true;
    const approvedStatus = "1";

    const query = `
      SELECT 
        aacm.name, 
        vvc.category_id_id 
      FROM vendor_vendorcategory vvc 
      LEFT JOIN admin_app_categorymodel aacm ON aacm.id = vvc.category_id_id 
      WHERE vvc.vendor_id_id = $1 
        AND vvc.active = $2 
        AND vvc.approved = $3 
        AND aacm.deleted = $4
      ORDER BY vvc.priority ASC
    `;

    const result = await client.query(query, [
      params.vendorId,
      activeStatus,
      approvedStatus,
      false,
    ]);

    // Transform results to match expected format
    const categories = result.rows.map((row: any) => {
      const category: any = {
        name: row.name,
      };

      if (row.category_id_id !== undefined && row.category_id_id !== null) {
        category.category_id = typeof row.category_id_id === 'string' 
          ? parseInt(row.category_id_id, 10) 
          : row.category_id_id;
        category.id = category.category_id; // Also set id for compatibility
      }

      return category;
    });

    logger.info("Vendor categories fetched from database", {
      categoryCount: categories.length,
      vendorId: params.vendorId,
    });

    return {
      message: "Success",
      categories,
      data: categories, // Also include as 'data' for compatibility
    };
  } catch (error) {
    logger.error("Failed to fetch vendor categories from database", {
      vendorId: params.vendorId,
    }, error instanceof Error ? error : new Error(String(error)));

    return {
      message: "Error fetching vendor categories",
      categories: [],
      data: [],
    };
  } finally {
    await client.end();
  }
}

/**
 * Genkit tool definition for AI to use
 */
const getVendorCategories = ai.defineTool(
  {
    name: "getVendorCategories",
    description: "Get categories for a specific vendor. Returns a list of categories available for the vendor.",
    inputSchema: z.object({
      vendorId: z.number().describe("The ID of the vendor"),
    }),
    outputSchema: vendorCategoriesResponseSchema,
  },
  async (input) => {
    return await fetchVendorCategories({
      vendorId: input.vendorId,
    });
  }
);

export default getVendorCategories;

