import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../../ai.js";
import { retryWithBackoff } from "../../utils/retryWithBackoff.js";
import dbSchema from "../../schema/schema.js";
import type { LocationData } from "./types.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";
import { buildLocationContext } from "./locationHandler.js";
import { getVendorId, getServiceId, getCategoryId, getStoreItemsByType } from "../../services/memory.js";
import { logger } from "../../utils/logger.js";

export const cleanSqlQuery = (query: string): string => {
  return query
    .replace(/^```[\w]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
};

export const generateSqlQuery = async (
  userQuery: string,
  location: LocationData | null,
  chatHistory: string = "",
  userId?: string,
  offset: number = 0,
  lastVendorId?: number | null,
  lastVendorName?: string | null
): Promise<string> => {
  const locationContext = buildLocationContext(location);
  const historyContext = chatHistory ? `\n\n${chatHistory}` : "";
  
  // Try to get vendor/service IDs from memory if userId is provided
  let idContext = "";
  if (userId && chatHistory) {
    // Use AI to extract vendor/service names from query and chat history
    try {
      logger.debug("Extracting vendor/service/category names from query", {
        userId,
        query: userQuery,
        hasChatHistory: !!chatHistory,
      });

      const extractPrompt = `Extract vendor names, service/item names, and category names from this query: "${userQuery}"

${chatHistory}

Return a JSON object with:
{
  "vendors": ["vendor name 1", "vendor name 2"],
  "services": ["service name 1", "service name 2"],
  "categories": ["category name 1", "category name 2"]
}

If no vendors, services, or categories found, return empty arrays. Return ONLY the JSON, nothing else.`;

      const extractStartTime = Date.now();
      logger.aiAction("Extracting Names from Query", {
        query: userQuery,
        userId,
      });

      const extractResponse = await retryWithBackoff(() =>
        ai.generate({
          model: googleAI.model(AI_MODEL, {
            temperature: 0.1,
          }),
          prompt: extractPrompt,
        })
      );

      logger.aiAction("Name Extraction Completed", {
        duration: Date.now() - extractStartTime,
        response: extractResponse.text,
      });

      try {
        // Extract JSON from markdown code blocks if present
        let extractedText = extractResponse.text?.trim() || "{}";
        extractedText = extractedText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        
        const extracted = JSON.parse(extractedText);
        const vendors = extracted.vendors || [];
        const services = extracted.services || [];
        const categories = extracted.categories || [];

        // Check each vendor name for ID
        const vendorIdsFound: Record<string, number> = {};
        for (const vendorName of vendors) {
          if (typeof vendorName === 'string') {
            const vendorId = await getVendorId(userId, vendorName);
            if (vendorId) {
              vendorIdsFound[vendorName] = vendorId;
              idContext += `\n\nIMPORTANT: Use vendor_id_id = ${vendorId} instead of searching by name "${vendorName}". This is more reliable.`;
            }
          }
        }

        // Check each service name for ID
        const serviceIdsFound: Record<string, number> = {};
        for (const serviceName of services) {
          if (typeof serviceName === 'string') {
            const serviceId = await getServiceId(userId, serviceName);
            if (serviceId) {
              serviceIdsFound[serviceName] = serviceId;
              idContext += `\n\nIMPORTANT: Use vendor_service_id_id = ${serviceId} instead of searching by name "${serviceName}". This is more reliable.`;
            }
          }
        }

        logger.info("ID lookups completed", {
          vendorsFound: Object.keys(vendorIdsFound).length,
          servicesFound: Object.keys(serviceIdsFound).length,
          vendorIds: vendorIdsFound,
          serviceIds: serviceIdsFound,
        });

        // Check each category name for ID
        let categoryIdFound: number | null = null;
        let vendorIdForCategory: number | null = null;
        
        for (const categoryName of categories) {
          if (typeof categoryName === 'string') {
            const categoryId = await getCategoryId(userId, categoryName);
            if (categoryId) {
              categoryIdFound = categoryId;
              idContext += `\n\nIMPORTANT: Use category_id_id = ${categoryId} instead of searching by name "${categoryName}". This is more reliable.`;
              
              // Try to find vendor ID from store for this category
              const categoryItems = getStoreItemsByType(userId, "category");
              const categoryItem = categoryItems.find(item => 
                item.id === categoryId && item.vendorId
              );
              if (categoryItem?.vendorId) {
                vendorIdForCategory = categoryItem.vendorId;
                idContext += `\n\nIMPORTANT: This category belongs to vendor_id_id = ${vendorIdForCategory}. Use this vendor_id_id when querying services for this category.`;
              }
            }
          }
        }
        
        // If user wants to explore a category but no vendor mentioned, try to get most recent vendor from store
        if (categories.length > 0 && !vendorIdForCategory && userId) {
          // Check if query mentions exploring a category (broader detection)
          const queryLower = userQuery.toLowerCase();
          const isCategoryExploration = 
            queryLower.includes("explore") || 
            queryLower.includes("show me") ||
            queryLower.includes("want to see") ||
            queryLower.match(/\b(burger|pizza|appetizer|beverage|chinese|barbeque|biryani|bread|burger|appetizers|barbeque|beverages|maincourse)\b/i);
          
          // Also check chat history for category context
          const hasCategoryContext = chatHistory.toLowerCase().includes("category") || 
                                    chatHistory.toLowerCase().includes("categories");
          
          if (isCategoryExploration || hasCategoryContext) {
            // Get most recently mentioned vendor from store
            const vendors = getStoreItemsByType(userId, "vendor");
            if (vendors.length > 0) {
              // Sort by lastMentioned and get most recent
              const sortedVendors = [...vendors].sort((a, b) => 
                b.lastMentioned.getTime() - a.lastMentioned.getTime()
              );
              const mostRecentVendor = sortedVendors[0];
              if (mostRecentVendor) {
                vendorIdForCategory = mostRecentVendor.id;
                idContext += `\n\nCRITICAL: User wants to explore a category. Use vendor_id_id = ${vendorIdForCategory} (from previous conversation where categories were shown) along with category_id_id when querying services. This is essential for category exploration queries. The query MUST filter by both vendor_id_id AND category_id_id.`;
              }
            }
          }
        }
      } catch (parseError) {
        // If extraction fails, continue without ID context
        logger.error("Failed to parse vendor/service names", {
          userId,
          query: userQuery,
        }, parseError instanceof Error ? parseError : new Error(String(parseError)));
      }
    } catch (error) {
      // If extraction fails, continue without ID context
      logger.error("Failed to extract vendor/service names", {
        userId,
        query: userQuery,
      }, error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  // Add last vendor context for pagination
  let vendorContext = "";
  if (lastVendorId && lastVendorName) {
    vendorContext = `\n\nCRITICAL: User wants to explore more services. The last vendor they were viewing was "${lastVendorName}" with vendor_id_id = ${lastVendorId}. 

IMPORTANT: When generating the SQL query for pagination:
- Use vendor_id_id = ${lastVendorId} directly in WHERE clause (NOT a subquery)
- Filter vendor_vendorservice (vvs) by vvs.vendor_id_id = ${lastVendorId}
- Use OFFSET ${offset} LIMIT 10 for pagination
- Order by vvs.priority ASC
- Join with admin_app_servicemodel (aasm) to get service names

Example pattern:
SELECT vvs.*, aasm.name AS service_name, aasm.veg
FROM vendor_vendorservice vvs
JOIN admin_app_servicemodel aasm ON aasm.id = vvs.vendor_service_id_id
WHERE vvs.vendor_id_id = ${lastVendorId}
  AND vvs.approved = '1'
  AND vvs.active = true
  AND vvs.eye_toggle = true
  AND vvs.price IS NOT NULL
  AND vvs.price > 0
ORDER BY vvs.priority ASC
OFFSET ${offset} LIMIT 10;

This is essential for pagination requests.`;
    logger.info("Adding last vendor context for pagination", {
      vendorId: lastVendorId,
      vendorName: lastVendorName,
    });
  }

  logger.debug("Generating SQL query", {
    userId,
    hasIdContext: !!idContext,
    offset,
    hasLocation: location !== null,
    lastVendorId,
    lastVendorName,
  });

  const prompt = `Generate a SQL query based on this user query: "${userQuery}"${historyContext}${idContext}${vendorContext}

Database Schema:
${dbSchema}

${locationContext}

Requirements:
- Use actual values, not placeholders
- Include LIMIT 10 if not already present
- For pagination (when showing next 10 services), use OFFSET ${offset} LIMIT 10
- Order services by priority ASC (most important first)
- For location queries:
  - CRITICAL: ALWAYS use latitude/longitude coordinates when available (provided in location context above)
  - DO NOT use city name filtering (e.g., city = 'city_name' or LOWER(city) = LOWER('city_name'))
  - Use the latitude/longitude ranges provided in the location context: latitude BETWEEN {lat-0.1} AND {lat+0.1} AND longitude BETWEEN {lng-0.1} AND {lng+0.1}
  - Coordinates are more accurate and reliable than city names
  - Only use city name if coordinates are NOT available (which should be rare)
- ALWAYS prefer using IDs (vendor_id_id, vendor_service_id_id, category_id_id) over names when IDs are available - this is more reliable and accurate
- If the user asks to explore services/items of a specific vendor, query services from vendor_vendorservice (vvs), joined with admin_app_servicemodel (aasm) to get service names and veg info, filtered by vendor_id_id (use ID if available, otherwise by name), ORDER BY vvs.priority ASC, and return a list of services/items.
- If the user asks for categories of a vendor, use the Category Query Pattern: SELECT aacm.name, vvc.category_id_id FROM vendor_vendorcategory vvc LEFT JOIN admin_app_categorymodel aacm ON aacm.id = vvc.category_id_id WHERE vvc.vendor_id_id = {vendor_id} AND vvc.active = true AND vvc.approved = '1' AND aacm.deleted = false ORDER BY vvc.priority ASC
- CRITICAL: If the user asks to explore a category (e.g., "I want to explore burger", "show me burger items"), you MUST:
  1. Use the vendor_id_id from the previous conversation (the vendor they were viewing categories for)
  2. Use category_id_id from memory if available (more reliable than name matching)
  3. Use the Category Services Query Pattern from the schema
  4. Join vendor_vendorservice (vvs) with vendor_vendorcategory (vvc) using vvs.vendor_category_id_id = vvc.id
  5. Filter by BOTH vvc.vendor_id_id = {vendor_id} AND vvc.category_id_id = {category_id}
  6. The query MUST include both vendor_id_id and category_id_id filters - this is essential!
- CRITICAL: If the user asks to "explore more services" or "show more services" (pagination), you MUST:
  1. Use the vendor_id_id from the last vendor they were viewing (provided in context above)
  2. Query services from vendor_vendorservice (vvs) filtered by vendor_id_id = {last_vendor_id}
  3. Use OFFSET ${offset} LIMIT 10 for pagination
  4. Order by vvs.priority ASC
  5. The query MUST filter by vendor_id_id - this is essential for pagination!
${chatHistory ? "- CRITICAL: When user asks to explore a category, use the vendor from previous conversation context. If categories were shown, use that same vendor_id_id for the category exploration query." : ""}
${chatHistory ? "- CRITICAL: When user asks for more services (pagination), use the vendor from previous conversation context. The last vendor they viewed is provided above." : ""}
${chatHistory ? "- Consider previous conversation context when understanding references (e.g., 'that vendor', 'the restaurant I mentioned', 'that category', 'more services', etc.)" : ""}
- Return only the SQL query, nothing else`;

  const sqlGenStartTime = Date.now();
  const aiActionContext: Record<string, any> = {
    query: userQuery,
    hasIdContext: !!idContext,
    offset,
  };
  if (userId) {
    aiActionContext.userId = userId;
  }
  logger.aiAction("SQL Generation", aiActionContext);

  const response = await retryWithBackoff(() =>
    ai.generate({
      model: googleAI.model(AI_MODEL, {
        temperature: AI_TEMPERATURES.SQL_GENERATION,
      }),
      prompt,
    })
  );

  const duration = Date.now() - sqlGenStartTime;
  const sqlQuery = cleanSqlQuery(response.text?.trim() || "");

  logger.aiAction("SQL Generation Completed", {
    query: userQuery,
    duration,
    sqlQuery: sqlQuery.length > 500 ? sqlQuery.substring(0, 500) + '... [truncated]' : sqlQuery,
    response: response.text,
  });

  if (!sqlQuery) {
    logger.error("Failed to generate SQL query", {
      userId,
      query: userQuery,
      response: response.text,
    });
    throw new Error("Failed to generate SQL query");
  }

  return sqlQuery;
};

