import type { WorkflowHandler, WorkflowContext, FlowOutput } from "../types/vendorFlow.js";
import { fetchVendorsFromDB } from "../tools/getVendorsFromDB.js";
import { fetchVendorServices } from "../tools/getVendorServices.js";
import { saveStoreItem, getVendorId, saveLastShownServices, getStoreItemsByType, getMostRecentVendor } from "../services/memory.js";
import { logger } from "../utils/logger.js";
import type { LastShownService } from "../types/memory.js";

/**
 * Handles vendor, category, and service exploration workflows
 */
export class ExplorationWorkflow implements WorkflowHandler {
  canHandle(context: WorkflowContext): boolean {
    // Handle all exploration requests (not cart operations)
    return context.analysis.isCartOperation !== true;
  }

  async execute(context: WorkflowContext): Promise<FlowOutput> {
    const { analysis, location, userQuery, chatId } = context;

    // Check if location is available (required for vendor exploration)
    if (!location) {
      logger.warn("Exploration Workflow: Location not available", { userQuery }, undefined, chatId);
      return {
        error: "Location is required to find nearby vendors. Please provide your location.",
      };
    }

    // Check if user wants to explore services/items/menu (not just categories)
    const wantsServices = analysis.wantsServices === true;
    
    // Check if user wants to explore a specific vendor OR wants services
    if ((analysis.vendorName || wantsServices) && chatId) {
      // Try to find vendor ID from store (memory)
      let vendorId: number | null = null;
      let actualVendorName: string | null = null;
      
      if (analysis.vendorName) {
        vendorId = await getVendorId(chatId, analysis.vendorName);
        actualVendorName = analysis.vendorName;
      } else if (wantsServices) {
        // User wants services but didn't specify vendor - use most recent vendor
        const mostRecentVendor = getMostRecentVendor(chatId);
        if (mostRecentVendor) {
          vendorId = mostRecentVendor.id;
          actualVendorName = mostRecentVendor.name;
          logger.info("Using most recent vendor for services request", {
            vendorId,
            vendorName: actualVendorName,
            chatId,
          }, chatId);
        }
      }

      logger.flowStep("Exploration Workflow: Exploring vendor services", {
        vendorName: actualVendorName || analysis.vendorName || "Unknown",
        queryType: analysis.queryType,
        wantsServices,
      }, chatId);

      // If found in store, get the actual vendor name from store
      if (vendorId) {
        const storeVendors = getStoreItemsByType(chatId, "vendor");
        const foundStoreVendor = storeVendors.find(v => v.id === vendorId);
        if (foundStoreVendor) {
          actualVendorName = foundStoreVendor.name;
        }
      }

        // If not found in store, fetch vendors and try to find it
      if (!vendorId && analysis.vendorName) {
        logger.info("Vendor not found in store, fetching vendors", {
          vendorName: analysis.vendorName,
          chatId,
        }, chatId);

        const vendorsResult = await fetchVendorsFromDB({
          latitude: location.latitude,
          longitude: location.longitude,
          vendorType: "Food",
          limit: 50,
        });

        // Save vendors to memory first
        if (chatId && vendorsResult.Vendors) {
          for (const vendor of vendorsResult.Vendors) {
            if (vendor.id && vendor.store_name) {
              await saveStoreItem(chatId, {
                type: "vendor",
                id: vendor.id,
                name: vendor.store_name,
                lastMentioned: new Date(),
              }).catch((err) => {
                logger.error("Failed to save vendor to store", { vendorId: vendor.id }, err, chatId);
              });
            }
          }
        }

        // Try to find vendor in fetched list (case-insensitive)
        const normalizedVendorName = analysis.vendorName.toLowerCase().trim();
        const foundVendor = vendorsResult.Vendors?.find(
          (v) => v.store_name.toLowerCase().includes(normalizedVendorName) ||
                 normalizedVendorName.includes(v.store_name.toLowerCase())
        );

        if (foundVendor) {
          vendorId = foundVendor.id;
          actualVendorName = foundVendor.store_name;
          logger.info("Found vendor in fetched list", {
            vendorName: analysis.vendorName,
            vendorId,
            storeName: foundVendor.store_name,
          }, chatId);
        }
      }

      // If vendor found, fetch its services
      if (vendorId) {
        logger.info("Fetching services for vendor", {
          vendorId,
          vendorName: analysis.vendorName,
        }, chatId);

        // Fetch more services if user wants to see all services/items/menu
        const serviceLimit = wantsServices ? 325 : 50;
        
        const servicesResult = await fetchVendorServices({
          vendorId,
          limit: serviceLimit,
          page: 1,
        });

        // Transform services to match expected format (grouped by category)
        const servicesByCategory = new Map<number, any>();
        const lastShownServices: LastShownService[] = [];
        
        for (const service of servicesResult.services || []) {
          const categoryId = service.category_id || 0;
          const categoryName = service.category_name || "Other";

          if (!servicesByCategory.has(categoryId)) {
            servicesByCategory.set(categoryId, {
              category_id: categoryId,
              category_name: categoryName,
              services: [],
            });
          }

          const category = servicesByCategory.get(categoryId)!;
          category.services.push(service);

          // Save to last shown services for cart operations
          if (service.id && service.name) {
            lastShownServices.push({
              serviceId: service.id,
              serviceName: service.name,
              vendorId: vendorId,
              vendorName: actualVendorName || "Unknown",
              price: service.price || 0,
              discount: service.discount || 0,
              shownAt: new Date(),
            });

            // Also save service to store
            if (chatId) {
              await saveStoreItem(chatId, {
                type: "service",
                id: service.id,
                name: service.name,
                vendorId: vendorId,
                lastMentioned: new Date(),
              }).catch((err) => {
                logger.error("Failed to save service to store", { serviceId: service.id }, err, chatId);
              });
            }
          }
        }

        const servicesData = Array.from(servicesByCategory.values());

        // Save last shown services to memory
        if (chatId && lastShownServices.length > 0) {
          saveLastShownServices(chatId, lastShownServices);
        }

        logger.info("Vendor services fetched", {
          vendorId,
          vendorName: actualVendorName,
          categoryCount: servicesData.length,
          totalServices: servicesResult.services?.length || 0,
        }, chatId);

        // Return services data for refinement
        return {
          _needsRefinement: true,
          dbResult: {
            data: servicesData,
            message: `Services for ${actualVendorName}`,
            total_found: servicesResult.services?.length || 0,
            isShowingServices: true,
          },
        } as any;
      } else {
        logger.warn("Vendor not found", {
          vendorName: analysis.vendorName,
          chatId,
        }, undefined, chatId);
      }
    }

    // Default: Fetch nearby vendors
    logger.flowStep("Exploration Workflow: Fetching nearby vendors", {
      queryType: analysis.queryType,
      latitude: location.latitude,
      longitude: location.longitude,
    }, chatId);

    const dbStartTime = Date.now();
    const vendorsResult = await fetchVendorsFromDB({
      latitude: location.latitude,
      longitude: location.longitude,
      vendorType: "Food", // Default to Food for now
      limit: 50, // Limit results
    });
    const dbDuration = Date.now() - dbStartTime;

    logger.info("Vendors database query completed", {
      duration: dbDuration,
      vendorCount: vendorsResult.Vendors?.length || 0,
    }, chatId);

    // Transform response to match expected format
    const dbResult = {
      data: vendorsResult.Vendors || [],
      message: vendorsResult.message || "Vendors retrieved successfully",
      total_found: vendorsResult.Vendors?.length || 0,
    };

    // Process results (extract IDs, save to memory)
    if (chatId && dbResult.data) {
      await this.processResults(context, dbResult);
    }

    // Return result wrapped in a special format so main flow knows to refine it
    return {
      _needsRefinement: true,
      dbResult,
    } as any;
  }

  private async processResults(
    context: WorkflowContext,
    dbResult: any
  ): Promise<void> {
    const { chatId } = context;

    if (!chatId || !Array.isArray(dbResult.data)) {
      return;
    }

    logger.flowStep("Exploration Workflow: Processing vendor results", {
      vendorCount: dbResult.data.length,
    }, chatId);

    // Save vendors to memory store
    for (const vendor of dbResult.data) {
      if (vendor.id && vendor.store_name) {
        await saveStoreItem(chatId, {
          type: "vendor",
          id: vendor.id,
          name: vendor.store_name,
          lastMentioned: new Date(),
        }).catch((err) => {
          logger.error("Failed to save vendor to store", { vendorId: vendor.id }, err, chatId);
        });
      }
    }

    logger.info("Processed vendor results", {
      vendorCount: dbResult.data.length,
      chatId,
    }, chatId);
  }

}






