export interface QueryAnalysis {
  needsLocation: boolean;
  locationName: string | null;
  queryType: string;
  isCartOperation?: boolean; // true if user wants to add/remove/view cart
  isPaginationRequest?: boolean; // true if user wants next page of results
  cartAction?: "add" | "remove" | "view" | "clear"; // Type of cart operation
  serviceNames?: string[]; // Array of service names to add to cart (can be multiple)
}

export interface LocationData {
  latitude: number;
  longitude: number;
  name: string;
}

export interface FlowInput {
  userQuery: string;
  userId?: string | undefined;
  chatId?: string | undefined; // Unique chat/request ID from frontend for socket tracking
  locationName?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

export interface FlowOutput {
  ai_voice?: string;
  markdown_text?: string;
  error?: string;
}

