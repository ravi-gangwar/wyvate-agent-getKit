/**
 * Vendor flow type definitions
 */

import type { CartItem } from "./memory.js";

/**
 * User query analysis result
 */
export interface QueryAnalysis {
  needsLocation: boolean;
  locationName: string | null;
  queryType: string;
  correctedQuery?: string; // Corrected query with spelling fixes (if any)
  isCartOperation?: boolean; // true if user wants to add/remove/view cart
  isPaginationRequest?: boolean; // true if user wants next page of results
  cartAction?: "add" | "remove" | "view" | "clear" | "update"; // Type of cart operation
  serviceNames?: string[]; // Array of service names to add/update/remove from cart (can be multiple)
  quantities?: number[]; // Array of quantities corresponding to serviceNames (optional, defaults to 1)
  vendorName?: string | null; // Vendor name if user wants to explore a specific vendor
  wantsServices?: boolean; // True if user wants to see services/items/menu (not just categories)
}

/**
 * Location data with coordinates
 */
export interface LocationData {
  latitude: number;
  longitude: number;
  name: string;
}

/**
 * Flow input parameters
 */
export interface FlowInput {
  userQuery: string;
  userId?: string | undefined;
  chatId?: string | undefined; // Unique chat/request ID from frontend for socket tracking
  locationName?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

/**
 * Flow output response
 */
export interface FlowOutput {
  ai_voice?: string;
  markdown_text?: string;
  error?: string;
}

/**
 * Workflow context containing all necessary data for workflow execution
 */
export interface WorkflowContext {
  input: FlowInput;
  userQuery: string;
  chatHistory: string;
  analysis: QueryAnalysis;
  location: LocationData | null;
  cart: CartItem[];
  userId?: string;
  chatId?: string;
}

/**
 * Base workflow handler interface
 */
export interface WorkflowHandler {
  canHandle(context: WorkflowContext): boolean;
  execute(context: WorkflowContext): Promise<FlowOutput>;
}

