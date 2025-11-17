import type { FlowInput, QueryAnalysis, LocationData, WorkflowContext } from "../types/vendorFlow.js";
import type { CartItem } from "../services/memory.js";
import { getCart } from "../services/memory.js";

/**
 * Builds workflow context from flow input and analysis
 */
export async function buildWorkflowContext(
  input: FlowInput,
  userQuery: string,
  chatHistory: string,
  analysis: QueryAnalysis,
  location: LocationData | null
): Promise<WorkflowContext> {
  const cart = input.userId ? await getCart(input.userId) : [];

  const context: WorkflowContext = {
    input,
    userQuery,
    chatHistory,
    analysis,
    location,
    cart,
  };

  // Only include userId and chatId if they are defined (for exactOptionalPropertyTypes)
  if (input.userId !== undefined) {
    context.userId = input.userId;
  }
  if (input.chatId !== undefined) {
    context.chatId = input.chatId;
  }

  return context;
}

