/**
 * Memory and user-related type definitions
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface ChatHistory {
  messages: ChatMessage[];
}

export interface UserLocation {
  latitude: number;
  longitude: number;
  name: string;
}

export interface StoreItem {
  type: "vendor" | "service" | "category";
  id: number;
  name: string;
  vendorId?: number; // For services/categories, which vendor they belong to
  categoryId?: number; // For categories
  lastMentioned: Date;
}

export interface CartItem {
  serviceId: number;
  serviceName: string;
  vendorId: number;
  vendorName: string;
  price: number;
  quantity: number;
  addedAt: Date;
  // Additional service details
  discount?: number;
  discountType?: string;
  veg?: boolean;
  categoryId?: number;
  categoryName?: string;
}

export interface LastShownService {
  serviceId: number;
  serviceName: string;
  vendorId: number;
  vendorName: string;
  price: number;
  discount?: number;
  discountType?: string;
  veg?: boolean;
  categoryId?: number;
  categoryName?: string;
  shownAt: Date;
}

export interface UserMemory {
  messages: ChatMessage[];
  location: UserLocation | null;
  store: StoreItem[]; // Unified array of all vendor/service/category information
  cart: CartItem[]; // User's shopping cart
  lastServicePage: number; // Track pagination for services (page number, 0-indexed)
  lastShownServices: LastShownService[]; // Last services shown to user (for context)
}

