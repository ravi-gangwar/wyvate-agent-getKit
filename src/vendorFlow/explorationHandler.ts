import type { WorkflowHandler, WorkflowContext, FlowOutput } from "../types/vendorFlow.js";
import { fetchVendorsFromDB } from "../tools/getVendorsFromDB.js";
import { saveStoreItem } from "../services/memory.js";
import { logger } from "../utils/logger.js";

/**
 * Handles vendor, category, and service exploration workflows
 */
export class ExplorationWorkflow implements WorkflowHandler {
  canHandle(context: WorkflowContext): boolean {
    // Handle all exploration requests (not cart operations)
    return context.analysis.isCartOperation !== true;
  }

  async execute(context: WorkflowContext): Promise<FlowOutput> {
    const { analysis, location, userQuery, userId, chatId } = context;

    // Check if location is available (required for vendor exploration)
    if (!location) {
      logger.warn("Exploration Workflow: Location not available", { userQuery }, undefined);
      return {
        error: "Location is required to find nearby vendors. Please provide your location.",
      };
    }

    logger.flowStep("Exploration Workflow: Fetching nearby vendors", {
      queryType: analysis.queryType,
      latitude: location.latitude,
      longitude: location.longitude,
    }, chatId);

    // Fetch vendors using database query (simplified - only required fields)
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
      chatId,
    });

    // Transform response to match expected format
    const dbResult = {
      data: vendorsResult.Vendors || [],
      message: vendorsResult.message || "Vendors retrieved successfully",
      total_found: vendorsResult.Vendors?.length || 0,
    };

    // Process results (extract IDs, save to memory)
    if (userId && dbResult.data) {
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
    const { userId, chatId } = context;

    if (!userId || !Array.isArray(dbResult.data)) {
      return;
    }

    logger.flowStep("Exploration Workflow: Processing vendor results", {
      vendorCount: dbResult.data.length,
    }, chatId);

    // Save vendors to memory store
    for (const vendor of dbResult.data) {
      if (vendor.id && vendor.store_name) {
        await saveStoreItem(userId, {
          type: "vendor",
          id: vendor.id,
          name: vendor.store_name,
          lastMentioned: new Date(),
        }).catch((err) => {
          logger.error("Failed to save vendor to store", { vendorId: vendor.id }, err);
        });
      }
    }

    logger.info("Processed vendor results", {
      vendorCount: dbResult.data.length,
      userId,
    });
  }

}






