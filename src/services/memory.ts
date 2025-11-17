/**
 * Memory service for managing user data in-memory
 */

import type {
  ChatMessage,
  ChatHistory,
  UserLocation,
  StoreItem,
  CartItem,
  LastShownService,
  UserMemory,
} from "../types/memory.js";

// Re-export types for backward compatibility
export type {
  ChatMessage,
  ChatHistory,
  UserLocation,
  StoreItem,
  CartItem,
  LastShownService,
  UserMemory,
};

// In-memory storage: Map<userId, UserMemory>
const userMemoryMap = new Map<string, UserMemory>();

/**
 * Initialize user memory if it doesn't exist
 */
function ensureUserMemory(userId: string): UserMemory {
  if (!userMemoryMap.has(userId)) {
    userMemoryMap.set(userId, {
      messages: [],
      location: null,
      store: [],
      cart: [],
      lastServicePage: 0,
      lastShownServices: [],
    });
  }
  return userMemoryMap.get(userId)!;
}

/**
 * Save a chat message to in-memory storage
 */
export async function saveMessage(
  userId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const userMemory = ensureUserMemory(userId);
  
  userMemory.messages.push({
    role,
    content,
    timestamp: new Date(),
  });

  // Keep only the last 100 messages per user to prevent memory issues
  if (userMemory.messages.length > 100) {
    userMemory.messages.shift(); // Remove oldest message
  }
}

/**
 * Retrieve chat history for a user (limited to last N messages)
 */
export async function getChatHistory(
  userId: string,
  limit: number = 20
): Promise<ChatMessage[]> {
  const userMemory = userMemoryMap.get(userId);
  if (!userMemory) {
    return [];
  }
  
  // Return the last N messages (most recent)
  return userMemory.messages.slice(-limit);
}

/**
 * Get saved user location from memory
 */
export async function getUserLocation(userId: string): Promise<UserLocation | null> {
  const userMemory = userMemoryMap.get(userId);
  return userMemory?.location || null;
}

/**
 * Save user location to memory
 */
export async function saveUserLocation(
  userId: string,
  location: UserLocation
): Promise<void> {
  const userMemory = ensureUserMemory(userId);
  userMemory.location = location;
}

/**
 * Format chat history as a string for AI prompts
 */
export function formatChatHistoryForPrompt(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return "";
  }

  const formattedMessages = messages.map((msg) => {
    const roleLabel = msg.role === "user" ? "User" : "Assistant";
    return `${roleLabel}: ${msg.content}`;
  });

  return `Previous conversation history:\n${formattedMessages.join("\n\n")}\n\n`;
}

/**
 * Clear chat history for a user (optional utility)
 */
export async function clearChatHistory(userId: string): Promise<void> {
  userMemoryMap.delete(userId);
}

/**
 * Clear user location (optional utility)
 */
export async function clearUserLocation(userId: string): Promise<void> {
  const userMemory = userMemoryMap.get(userId);
  if (userMemory) {
    userMemory.location = null;
  }
}

/**
 * Save store item (vendor, service, or category) to unified store
 */
export async function saveStoreItem(
  userId: string,
  item: StoreItem
): Promise<void> {
  const userMemory = ensureUserMemory(userId);
  
  // Check if item already exists (by type, id, and name)
  const existingIndex = userMemory.store.findIndex(
    (existing) =>
      existing.type === item.type &&
      existing.id === item.id &&
      existing.name.toLowerCase() === item.name.toLowerCase()
  );
  
  if (existingIndex >= 0) {
    // Update existing item
    userMemory.store[existingIndex] = item;
  } else {
    // Add new item
    userMemory.store.push(item);
  }
  
  // Keep only last 500 items to prevent memory issues
  if (userMemory.store.length > 500) {
    // Sort by lastMentioned and keep most recent
    userMemory.store.sort((a, b) => 
      b.lastMentioned.getTime() - a.lastMentioned.getTime()
    );
    userMemory.store = userMemory.store.slice(0, 500);
  }
}

/**
 * Get vendor ID by name (case-insensitive)
 */
export async function getVendorId(
  userId: string,
  vendorName: string
): Promise<number | null> {
  const userMemory = userMemoryMap.get(userId);
  if (!userMemory) return null;
  
  const searchName = vendorName.toLowerCase().trim();
  const vendor = userMemory.store.find(
    (item) => item.type === "vendor" && item.name.toLowerCase() === searchName
  );
  
  return vendor?.id || null;
}

/**
 * Get service ID by name (case-insensitive)
 */
export async function getServiceId(
  userId: string,
  serviceName: string
): Promise<number | null> {
  const userMemory = userMemoryMap.get(userId);
  if (!userMemory) return null;
  
  const searchName = serviceName.toLowerCase().trim();
  const service = userMemory.store.find(
    (item) => item.type === "service" && item.name.toLowerCase() === searchName
  );
  
  return service?.id || null;
}

/**
 * Get category ID by name (case-insensitive)
 */
export async function getCategoryId(
  userId: string,
  categoryName: string
): Promise<number | null> {
  const userMemory = userMemoryMap.get(userId);
  if (!userMemory) return null;
  
  const searchName = categoryName.toLowerCase().trim();
  const category = userMemory.store.find(
    (item) => item.type === "category" && item.name.toLowerCase() === searchName
  );
  
  return category?.id || null;
}

/**
 * Get store items by type
 */
export function getStoreItemsByType(
  userId: string,
  type: "vendor" | "service" | "category"
): StoreItem[] {
  const userMemory = userMemoryMap.get(userId);
  if (!userMemory) return [];
  
  return userMemory.store.filter((item) => item.type === type);
}

/**
 * Get store items by vendor ID
 */
export function getStoreItemsByVendor(
  userId: string,
  vendorId: number
): StoreItem[] {
  const userMemory = userMemoryMap.get(userId);
  if (!userMemory) return [];
  
  return userMemory.store.filter((item) => item.vendorId === vendorId);
}

/**
 * Get most recently mentioned vendor from store
 */
export function getMostRecentVendor(userId: string): StoreItem | null {
  const userMemory = userMemoryMap.get(userId);
  if (!userMemory) return null;
  
  const vendors = userMemory.store.filter((item) => item.type === "vendor");
  if (vendors.length === 0) return null;
  
  // Sort by lastMentioned and get most recent
  const sortedVendors = [...vendors].sort((a, b) => 
    b.lastMentioned.getTime() - a.lastMentioned.getTime()
  );
  
  return sortedVendors[0] || null;
}

/**
 * Extract and save vendor/service/category IDs from database results
 */
export async function extractAndSaveIds(
  userId: string,
  dbResult: any,
  vendorContext?: string // Optional vendor name from context to help link categories
): Promise<void> {
  if (!userId || !dbResult?.data || !Array.isArray(dbResult.data)) {
    return;
  }

  for (const row of dbResult.data) {
    // Extract vendor ID and name from vendor_vendormodel (has id and store_name)
    if (row.id && row.store_name) {
      // Check if this is a vendor row (has store_name but no vendor_id_id)
      if (!row.vendor_id_id) {
        await saveStoreItem(userId, {
          type: "vendor",
          id: row.id,
          name: row.store_name,
          lastMentioned: new Date(),
        }).catch(console.error);
      }
    }
    
    // Extract vendor ID from vendor_vendorservice (has vendor_id_id)
    if (row.vendor_id_id && row.store_name) {
      await saveStoreItem(userId, {
        type: "vendor",
        id: row.vendor_id_id,
        name: row.store_name,
        lastMentioned: new Date(),
      }).catch(console.error);
    }

    // Extract service ID and name from vendor_vendorservice
    if (row.vendor_service_id_id && row.name) {
      await saveStoreItem(userId, {
        type: "service",
        id: row.vendor_service_id_id,
        name: row.name,
        vendorId: row.vendor_id_id,
        lastMentioned: new Date(),
      }).catch(console.error);
    }
    
    // Extract service ID from admin_app_servicemodel (has id and name)
    if (row.service_id && row.service_name) {
      await saveStoreItem(userId, {
        type: "service",
        id: row.service_id,
        name: row.service_name,
        vendorId: row.vendor_id_id,
        lastMentioned: new Date(),
      }).catch(console.error);
    }
    
    // Extract category ID and name (from category queries)
    // Category queries return: aacm.name, vvc.category_id_id
    if (row.category_id_id && row.name) {
      await saveStoreItem(userId, {
        type: "category",
        id: row.category_id_id,
        name: row.name,
        vendorId: row.vendor_id_id,
        categoryId: row.category_id_id,
        lastMentioned: new Date(),
      }).catch(console.error);
    }
    
    // Also check if this is a category query result (has category_id_id from vvc)
    // and name from aacm, but might not have vendor_id_id in the result
    // Try to find vendor ID from context if vendor name is provided
    if (row.category_id_id && row.name && !row.vendor_id_id && vendorContext) {
      const vendorId = await getVendorId(userId, vendorContext);
      if (vendorId) {
        await saveStoreItem(userId, {
          type: "category",
          id: row.category_id_id,
          name: row.name,
          vendorId: vendorId,
          categoryId: row.category_id_id,
          lastMentioned: new Date(),
        }).catch(console.error);
      } else {
        // Save without vendorId if vendor not found
        await saveStoreItem(userId, {
          type: "category",
          id: row.category_id_id,
          name: row.name,
          categoryId: row.category_id_id,
          lastMentioned: new Date(),
        }).catch(console.error);
      }
    }
    
    // Also check for name field as service name (common in joined queries)
    if (row.name && (row.vendor_service_id_id || row.service_id) && !row.category_id_id) {
      const serviceId = row.vendor_service_id_id || row.service_id;
      await saveStoreItem(userId, {
        type: "service",
        id: serviceId,
        name: row.name,
        vendorId: row.vendor_id_id,
        lastMentioned: new Date(),
      }).catch(console.error);
    }
  }
}

/**
 * Add item to cart
 */
export async function addToCart(
  userId: string,
  cartItem: CartItem
): Promise<void> {
  const userMemory = ensureUserMemory(userId);
  
  // Check if item already exists in cart (same serviceId and vendorId)
  const existingIndex = userMemory.cart.findIndex(
    (item) => item.serviceId === cartItem.serviceId && item.vendorId === cartItem.vendorId
  );
  
  if (existingIndex >= 0) {
    // Update quantity if item exists
    const existingItem = userMemory.cart[existingIndex];
    if (existingItem) {
      existingItem.quantity += cartItem.quantity || 1;
    }
  } else {
    // Add new item
    userMemory.cart.push({
      ...cartItem,
      quantity: cartItem.quantity || 1,
      addedAt: new Date(),
    });
  }
}

/**
 * Get user's cart
 */
export async function getCart(userId: string): Promise<CartItem[]> {
  const userMemory = userMemoryMap.get(userId);
  return userMemory?.cart || [];
}

/**
 * Remove item from cart
 */
export async function removeFromCart(
  userId: string,
  serviceId: number,
  vendorId: number
): Promise<void> {
  const userMemory = userMemoryMap.get(userId);
  if (!userMemory) return;
  
  userMemory.cart = userMemory.cart.filter(
    (item) => !(item.serviceId === serviceId && item.vendorId === vendorId)
  );
}

/**
 * Clear user's cart
 */
export async function clearCart(userId: string): Promise<void> {
  const userMemory = userMemoryMap.get(userId);
  if (userMemory) {
    userMemory.cart = [];
  }
}

/**
 * Update last service page for pagination
 */
export function setLastServicePage(userId: string, page: number): void {
  const userMemory = ensureUserMemory(userId);
  userMemory.lastServicePage = page;
}

/**
 * Get last service page
 */
export function getLastServicePage(userId: string): number {
  const userMemory = userMemoryMap.get(userId);
  return userMemory?.lastServicePage || 0;
}

/**
 * Save last shown services to memory (for context when user wants to add services)
 */
export function saveLastShownServices(userId: string, services: LastShownService[]): void {
  const userMemory = ensureUserMemory(userId);
  userMemory.lastShownServices = services;
}

/**
 * Get last shown services from memory
 */
export function getLastShownServices(userId: string): LastShownService[] {
  const userMemory = userMemoryMap.get(userId);
  return userMemory?.lastShownServices || [];
}

/**
 * Get services with discount from last shown services
 */
export function getLastShownServicesWithDiscount(userId: string): LastShownService[] {
  const services = getLastShownServices(userId);
  return services.filter(service => service.discount && service.discount > 0);
}

/**
 * Get all user IDs that have memory (useful for debugging/admin)
 */
export function getAllUserIds(): string[] {
  return Array.from(userMemoryMap.keys());
}

