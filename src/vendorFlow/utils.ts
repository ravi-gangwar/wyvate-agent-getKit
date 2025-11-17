import { saveMessage } from "../services/memory.js";
import { logger } from "../utils/logger.js";
import type { CartItem, LastShownService } from "../services/memory.js";

/**
 * Save user and assistant messages to memory
 */
export async function saveMessages(
  chatId: string | undefined,
  userQuery: string,
  assistantResponse: string
): Promise<void> {
  if (!chatId) return;

  await saveMessage(chatId, "user", userQuery).catch((err) => {
    logger.error("Failed to save user message", { chatId }, err);
  });
  await saveMessage(chatId, "assistant", assistantResponse).catch((err) => {
    logger.error("Failed to save assistant message", { chatId }, err);
  });
}

/**
 * Normalize service name for matching (remove extra spaces, lowercase)
 */
export function normalizeServiceName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if two service names match (fuzzy matching)
 */
export function serviceNamesMatch(name1: string, name2: string): boolean {
  const normalized1 = normalizeServiceName(name1);
  const normalized2 = normalizeServiceName(name2);
  return normalized1 === normalized2 ||
         normalized1.includes(normalized2) ||
         normalized2.includes(normalized1);
}

/**
 * Create cart item from service data
 */
export function createCartItemFromService(service: LastShownService): CartItem {
  const cartItem: CartItem = {
    serviceId: service.serviceId,
    serviceName: service.serviceName,
    vendorId: service.vendorId,
    vendorName: service.vendorName,
    price: service.price,
    quantity: 1,
    addedAt: new Date(),
  };

  if (service.discount !== undefined) cartItem.discount = service.discount;
  if (service.discountType !== undefined) cartItem.discountType = service.discountType;
  if (service.veg !== undefined) cartItem.veg = service.veg;
  if (service.categoryId !== undefined) cartItem.categoryId = service.categoryId;
  if (service.categoryName !== undefined) cartItem.categoryName = service.categoryName;

  return cartItem;
}

/**
 * Create cart item from database row
 */
export function createCartItemFromRow(row: any, requestedName: string): CartItem | null {
  const vendorId = (row.vendor_id_id as number) || (row.id as number);
  const serviceId = (row.vendor_service_id_id as number) || 
                    (row.service_id as number) || 
                    (row.vendor_service_id as number);
  const vendorName = (row.store_name as string) || "Unknown Vendor";
  const serviceName = (row.name as string) || (row.service_name as string) || requestedName;

  if (!vendorId || !serviceId || typeof vendorId !== 'number' || typeof serviceId !== 'number') {
    return null;
  }

  const cartItem: CartItem = {
    serviceId,
    serviceName,
    vendorId,
    vendorName,
    price: (row.price as number) || 0,
    quantity: 1,
    addedAt: new Date(),
  };

  if (row.discount !== undefined) cartItem.discount = row.discount as number;
  if (row.discount_type !== undefined) cartItem.discountType = row.discount_type as string;
  if (row.veg !== undefined) cartItem.veg = row.veg as boolean;
  if (row.category_id_id !== undefined) cartItem.categoryId = row.category_id_id as number;

  return cartItem;
}

