import type { WorkflowHandler, WorkflowContext, FlowOutput } from "../types/vendorFlow.js";
import { refineResponse } from "./responseRefiner.js";
import { 
  getCart, 
  addToCart, 
  clearCart, 
  removeFromCart,
  getLastShownServicesWithDiscount,
  getLastShownServices,
  getStoreItemsByType,
} from "../services/memory.js";
import { logger } from "../utils/logger.js";
import { saveMessages, createCartItemFromService, normalizeServiceName, serviceNamesMatch } from "./utils.js";
import type { CartItem } from "../services/memory.js";

/**
 * Handles all cart-related operations: view, add, clear
 */
export class CartWorkflow implements WorkflowHandler {
  canHandle(context: WorkflowContext): boolean {
    return context.analysis.isCartOperation === true && !!context.userId;
  }

  async execute(context: WorkflowContext): Promise<FlowOutput> {
    const { analysis, userQuery, chatHistory, userId, chatId } = context;

    logger.flowStep("Cart Workflow: Handling cart operation", {
      cartAction: analysis.cartAction,
      serviceNames: analysis.serviceNames,
    }, chatId);

    // View cart
    if (analysis.cartAction === "view") {
      return this.handleViewCart(context);
    }

    // Clear cart
    if (analysis.cartAction === "clear") {
      return this.handleClearCart(context);
    }

    // Add to cart
    if (analysis.cartAction === "add") {
      return this.handleAddToCart(context);
    }

    // Remove from cart (if needed in future)
    if (analysis.cartAction === "remove") {
      return this.handleRemoveFromCart(context);
    }

    return {
      ai_voice: "I'm not sure what you'd like to do with your cart.",
      markdown_text: "❓ I'm not sure what you'd like to do with your cart.",
    };
  }

  private async handleViewCart(context: WorkflowContext): Promise<FlowOutput> {
    const { userQuery, chatHistory, cart, userId } = context;

    logger.info("Viewing cart", { itemCount: cart.length });

    const cartResponse = await refineResponse(
      userQuery,
      { data: cart, message: "Cart items" },
      null,
      chatHistory,
      cart
    );

    await saveMessages(userId, userQuery, cartResponse.ai_voice);

    return {
      ai_voice: cartResponse.ai_voice,
      markdown_text: cartResponse.markdown_text,
    };
  }

  private async handleClearCart(context: WorkflowContext): Promise<FlowOutput> {
    const { userQuery, userId } = context;

    logger.info("Clearing cart");
    await clearCart(userId!);

    const response = {
      ai_voice: "Your cart has been cleared.",
      markdown_text: "🛒 Your cart has been cleared.",
    };

    await saveMessages(userId, userQuery, response.ai_voice);

    return response;
  }

  private async handleAddToCart(context: WorkflowContext): Promise<FlowOutput> {
    const { userQuery, chatHistory, analysis, userId } = context;

    // Check if user wants to add discounted service from previously shown services
    const wantsServiceWithDiscount = this.isDiscountRequest(userQuery);
    
    if (wantsServiceWithDiscount && userId) {
      const servicesWithDiscount = getLastShownServicesWithDiscount(userId);
      
      if (servicesWithDiscount.length > 0) {
        logger.info("Found services with discount from last shown services", {
          count: servicesWithDiscount.length,
        });

        const serviceToAdd = servicesWithDiscount[0];
        if (!serviceToAdd) {
          return { error: "Service not found." };
        }
        const cartItem = createCartItemFromService(serviceToAdd);
        
        await addToCart(userId, cartItem);
        
        const updatedCart = await getCart(userId);
        const cartResponse = await refineResponse(
          userQuery,
          { data: updatedCart, message: "Cart items" },
          null,
          chatHistory,
          updatedCart,
          analysis
        );

        await saveMessages(userId, userQuery, cartResponse.ai_voice);

        return {
          ai_voice: cartResponse.ai_voice,
          markdown_text: cartResponse.markdown_text,
        };
      }
    }

    // Handle adding specific services by name
    if (analysis.serviceNames && analysis.serviceNames.length > 0) {
      return this.handleAddServicesByName(context);
    }

    return {
      ai_voice: "I couldn't find the services you want to add. Please specify which services you'd like to add to your cart.",
      markdown_text: "❓ I couldn't find the services you want to add. Please specify which services you'd like to add to your cart.",
    };
  }

  private async handleAddServicesByName(context: WorkflowContext): Promise<FlowOutput> {
    const { userQuery, chatHistory, analysis, userId } = context;
    
    if (!userId || !analysis.serviceNames || analysis.serviceNames.length === 0) {
      return {
        ai_voice: "I couldn't find the services you want to add. Please specify which services you'd like to add to your cart.",
        markdown_text: "❓ I couldn't find the services you want to add. Please specify which services you'd like to add to your cart.",
      };
    }

    logger.info("Adding services to cart from memory", {
      serviceNames: analysis.serviceNames,
      userId,
    });

    const servicesToAdd: CartItem[] = [];
    const notFoundServices: string[] = [];

    // First, try to find in last shown services (has full details)
    const lastShownServices = getLastShownServices(userId);
    
    // Then, try to find in store (has basic info)
    const storeServices = getStoreItemsByType(userId, "service");
    const storeVendors = getStoreItemsByType(userId, "vendor");

    for (const requestedServiceName of analysis.serviceNames) {
      const normalizedRequested = normalizeServiceName(requestedServiceName);
      
      // Try last shown services first (has complete details)
      let foundService = lastShownServices.find(service => 
        serviceNamesMatch(service.serviceName, normalizedRequested)
      );

      // If not found, try store services
      if (!foundService) {
        const storeService = storeServices.find(item => 
          serviceNamesMatch(item.name, normalizedRequested)
        );

        if (storeService && storeService.vendorId) {
          // Get vendor name from store
          const vendor = storeVendors.find(v => v.id === storeService.vendorId);
          const vendorName = vendor?.name || "Unknown Vendor";

          // Create cart item from store data (basic info only)
          const cartItem: CartItem = {
            serviceId: storeService.id,
            serviceName: storeService.name,
            vendorId: storeService.vendorId,
            vendorName: vendorName,
            price: 0, // Price not available in store, will be fetched later if needed
            quantity: 1,
            addedAt: new Date(),
          };

          servicesToAdd.push(cartItem);
          logger.info("Found service in store", {
            serviceName: storeService.name,
            serviceId: storeService.id,
            vendorId: storeService.vendorId,
          });
          continue;
        }
      } else {
        // Found in last shown services - has all details
        const cartItem = createCartItemFromService(foundService);
        servicesToAdd.push(cartItem);
        logger.info("Found service in last shown services", {
          serviceName: foundService.serviceName,
          serviceId: foundService.serviceId,
          vendorId: foundService.vendorId,
        });
        continue;
      }

      // Service not found
      notFoundServices.push(requestedServiceName);
      logger.warn("Service not found in memory", { requestedServiceName });
    }

    // Add all found services to cart
    for (const cartItem of servicesToAdd) {
      await addToCart(userId, cartItem).catch((err) => {
        logger.error("Failed to add item to cart", { cartItem }, err);
      });
    }

    // Get updated cart
    const updatedCart = await getCart(userId);
    
    // Prepare response
    let responseMessage = "";
    if (servicesToAdd.length > 0) {
      const addedNames = servicesToAdd.map(item => item.serviceName).join(", ");
      responseMessage = `Added ${addedNames} to your cart.`;
    }
    
    if (notFoundServices.length > 0) {
      const notFoundNames = notFoundServices.join(", ");
      responseMessage += ` Could not find: ${notFoundNames}.`;
    }

    const cartResponse = await refineResponse(
      userQuery,
      { 
        data: updatedCart, 
        message: "Cart items",
        cartAdded: {
          added: servicesToAdd.map(item => item.serviceName),
          notFound: notFoundServices,
        },
      },
      null,
      chatHistory,
      updatedCart,
      analysis
    );

    await saveMessages(userId, userQuery, cartResponse.ai_voice);

    return {
      ai_voice: cartResponse.ai_voice,
      markdown_text: cartResponse.markdown_text,
    };
  }

  private async handleRemoveFromCart(context: WorkflowContext): Promise<FlowOutput> {
    const { userQuery, chatHistory, analysis, userId, cart } = context;

    if (!userId || !analysis.serviceNames || analysis.serviceNames.length === 0) {
      return {
        ai_voice: "Please specify which items you'd like to remove from your cart.",
        markdown_text: "❓ Please specify which items you'd like to remove from your cart.",
      };
    }

    logger.info("Removing services from cart", {
      serviceNames: analysis.serviceNames,
      userId,
    });

    const removedServices: string[] = [];
    const notFoundServices: string[] = [];

    for (const requestedServiceName of analysis.serviceNames) {
      const normalizedRequested = normalizeServiceName(requestedServiceName);
      
      // Find item in cart
      const cartItem = cart.find(item => 
        serviceNamesMatch(item.serviceName, normalizedRequested)
      );

      if (cartItem) {
        await removeFromCart(userId, cartItem.serviceId, cartItem.vendorId);
        removedServices.push(cartItem.serviceName);
        logger.info("Removed service from cart", {
          serviceName: cartItem.serviceName,
          serviceId: cartItem.serviceId,
        });
      } else {
        notFoundServices.push(requestedServiceName);
        logger.warn("Service not found in cart", { requestedServiceName });
      }
    }

    // Get updated cart
    const updatedCart = await getCart(userId);

    let responseMessage = "";
    if (removedServices.length > 0) {
      const removedNames = removedServices.join(", ");
      responseMessage = `Removed ${removedNames} from your cart.`;
    }
    
    if (notFoundServices.length > 0) {
      const notFoundNames = notFoundServices.join(", ");
      responseMessage += ` Could not find in cart: ${notFoundNames}.`;
    }

    const cartResponse = await refineResponse(
      userQuery,
      { data: updatedCart, message: "Cart items" },
      null,
      chatHistory,
      updatedCart,
      analysis
    );

    await saveMessages(userId, userQuery, cartResponse.ai_voice);

    return {
      ai_voice: cartResponse.ai_voice || responseMessage,
      markdown_text: cartResponse.markdown_text,
    };
  }

  private isDiscountRequest(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return lowerQuery.includes("discount") || 
           lowerQuery.includes("discounted") ||
           lowerQuery.includes("which have discount");
  }
}

