import type { WorkflowHandler, WorkflowContext, FlowOutput } from "../types/vendorFlow.js";
import { CartWorkflow } from "./cartHandler.js";
import { ExplorationWorkflow } from "./explorationHandler.js";
import { logger } from "../utils/logger.js";

/**
 * Workflow router that determines which workflow handler to use
 */
export class WorkflowRouter {
  private handlers: WorkflowHandler[] = [];

  constructor() {
    // Register workflow handlers in priority order
    this.handlers = [
      new CartWorkflow(),      // Cart operations have highest priority
      new ExplorationWorkflow(), // Then exploration workflows
    ];
  }

  /**
   * Route the context to the appropriate workflow handler
   */
  async route(context: WorkflowContext): Promise<FlowOutput | null> {
    for (const handler of this.handlers) {
      if (handler.canHandle(context)) {
        logger.info("Workflow routed", {
          handler: handler.constructor.name,
          queryType: context.analysis.queryType,
          isCartOperation: context.analysis.isCartOperation,
        });

        return await handler.execute(context);
      }
    }

    logger.warn("No workflow handler found for context", {
      queryType: context.analysis.queryType,
      isCartOperation: context.analysis.isCartOperation,
    });

    return null;
  }
}

