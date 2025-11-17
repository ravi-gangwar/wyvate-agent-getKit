import type { WorkflowHandler, WorkflowContext, FlowOutput } from "../types/vendorFlow.js";
import { refineResponse } from "./responseRefiner.js";
import { 
  getCart, 
  addToCart, 
  clearCart, 
  removeFromCart,
  updateCartItemQuantity,
  updateCartItem,
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

    // Remove from cart
    if (analysis.cartAction === "remove") {
      return this.handleRemoveFromCart(context);
    }

    // Update cart (quantity or other fields)
    if (analysis.cartAction === "update") {
      return this.handleUpdateCart(context);
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
        }, context.chatId);

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

    // Check if user said "add this", "add that", "add it", etc. - extract from last shown services
    if (this.isGenericAddRequest(userQuery) && userId) {
      const lastShownServices = getLastShownServices(userId);
      if (lastShownServices.length > 0) {
        logger.info("Generic add request detected, using last shown services", {
          serviceCount: lastShownServices.length,
        }, context.chatId);
        
        // Use last shown service(s) - if multiple, use the first one or all based on context
        const servicesToAdd = lastShownServices.slice(0, 1); // For now, add first one
        const quantities = analysis.quantities || [1];
        
        for (let i = 0; i < servicesToAdd.length; i++) {
          const service = servicesToAdd[i];
          if (service) {
            const cartItem = createCartItemFromService(service);
            cartItem.quantity = quantities[i] || 1;
            await addToCart(userId, cartItem);
          }
        }
        
        const updatedCart = await getCart(userId);
        const cartResponse = await refineResponse(
          userQuery,
          { 
            data: updatedCart, 
            message: "Cart items",
            cartAdded: {
              added: servicesToAdd.map(s => s.serviceName),
              notFound: [],
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

  private isGenericAddRequest(query: string): boolean {
    const lowerQuery = query.toLowerCase().trim();
    const genericPatterns = [
      "add this",
      "add that",
      "add it",
      "add them",
      "add these",
      "add to cart",
      "put in cart",
      "add item",
      "add service",
    ];
    
    return genericPatterns.some(pattern => lowerQuery.includes(pattern));
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
      quantities: analysis.quantities,
      userId,
    }, context.chatId);

    const servicesToAdd: CartItem[] = [];
    const notFoundServices: string[] = [];
    const quantities = analysis.quantities || [];

    // First, try to find in last shown services (has full details)
    const lastShownServices = getLastShownServices(userId);
    
    // Then, try to find in store (has basic info)
    const storeServices = getStoreItemsByType(userId, "service");
    const storeVendors = getStoreItemsByType(userId, "vendor");

    for (let i = 0; i < analysis.serviceNames.length; i++) {
      const requestedServiceName = analysis.serviceNames[i];
      if (!requestedServiceName) continue;
      
      const normalizedRequested = normalizeServiceName(requestedServiceName);
      // Get quantity for this service (default to 1 if not specified)
      const quantity = quantities[i] !== undefined && quantities[i] !== null ? quantities[i] : 1;
      
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
          if (storeService.vendorId === undefined) continue;
          
          const cartItem: CartItem = {
            serviceId: storeService.id,
            serviceName: storeService.name,
            vendorId: storeService.vendorId,
            vendorName: vendorName,
            price: 0, // Price not available in store, will be fetched later if needed
            quantity: quantity || 1,
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
        // Update quantity if specified
        cartItem.quantity = quantity || 1;
        servicesToAdd.push(cartItem);
        logger.info("Found service in last shown services", {
          serviceName: foundService.serviceName,
          serviceId: foundService.serviceId,
          vendorId: foundService.vendorId,
          quantity,
        }, context.chatId);
        continue;
      }

      // Service not found
      if (requestedServiceName) {
        notFoundServices.push(requestedServiceName);
        logger.warn("Service not found in memory", { requestedServiceName }, undefined, context.chatId);
      }
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

  private async handleUpdateCart(context: WorkflowContext): Promise<FlowOutput> {
    const { userQuery, chatHistory, analysis, userId, cart } = context;

    if (!userId || !analysis.serviceNames || analysis.serviceNames.length === 0) {
      return {
        ai_voice: "Please specify which items you'd like to update in your cart.",
        markdown_text: "❓ Please specify which items you'd like to update in your cart.",
      };
    }

    logger.info("Updating cart items", {
      serviceNames: analysis.serviceNames,
      quantities: analysis.quantities,
      userId,
    }, context.chatId);

    const updatedServices: string[] = [];
    const notFoundServices: string[] = [];
    const quantities = analysis.quantities || [];

    for (let i = 0; i < analysis.serviceNames.length; i++) {
      const requestedServiceName = analysis.serviceNames[i];
      if (!requestedServiceName) continue;
      
      const normalizedRequested = normalizeServiceName(requestedServiceName);
      
      // Find item in cart
      const cartItem = cart.find(item => 
        serviceNamesMatch(item.serviceName, normalizedRequested)
      );

      if (cartItem) {
        // Get quantity (use provided quantity or keep existing quantity)
        const providedQuantity = quantities[i];
        const quantity = providedQuantity !== undefined && providedQuantity !== null 
          ? providedQuantity 
          : cartItem.quantity; // Keep existing quantity if not specified

        if (quantity <= 0) {
          // Remove if quantity is 0 or negative
          await removeFromCart(userId, cartItem.serviceId, cartItem.vendorId);
          updatedServices.push(`${cartItem.serviceName} (removed)`);
        } else {
          // Update quantity
          await updateCartItemQuantity(userId, cartItem.serviceId, cartItem.vendorId, quantity);
          updatedServices.push(`${cartItem.serviceName} (quantity: ${quantity})`);
        }
        
        logger.info("Updated cart item", {
          serviceName: cartItem.serviceName,
          serviceId: cartItem.serviceId,
          quantity,
        }, context.chatId);
      } else {
        notFoundServices.push(requestedServiceName);
        logger.warn("Service not found in cart for update", { requestedServiceName }, undefined, context.chatId);
      }
    }

    // Get updated cart
    const updatedCart = await getCart(userId);

    let responseMessage = "";
    if (updatedServices.length > 0) {
      responseMessage = `Updated: ${updatedServices.join(", ")}.`;
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

