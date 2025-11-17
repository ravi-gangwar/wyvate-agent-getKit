import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../ai.js";
import { retryWithBackoff } from "../utils/retryWithBackoff.js";
import type { LocationData, QueryAnalysis } from "../types/vendorFlow.js";
import type { CartItem } from "../services/memory.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";
import { logger } from "../utils/logger.js";

/**
 * Filter out IDs and unwanted technical details from database results
 */
const filterUserFacingData = (dbResult: any): any => {
  if (!dbResult?.data || !Array.isArray(dbResult.data)) {
    return dbResult;
  }

  // Fields to exclude from user-facing responses
  const excludeFields = [
    'id',
    'vendor_id_id',
    'vendor_service_id_id',
    'vendor_category_id_id',
    'service_id',
    'category_id',
    'vendor_add_on_id_id',
    'group_id_id',
    'offer_id_id',
    'created_at',
    'updated_at',
    'is_deleted',
    'is_admin',
    'approved',
    'active',
    'eye_toggle',
    'priority',
  ];

  const filteredData = dbResult.data.map((row: any) => {
    const filtered: any = {};
    for (const [key, value] of Object.entries(row)) {
      // Only include fields that are user-friendly
      if (!excludeFields.includes(key.toLowerCase())) {
        filtered[key] = value;
      }
    }
    return filtered;
  });

  return {
    ...dbResult,
    data: filteredData,
  };
};

export const refineResponse = async (
  userQuery: string,
  dbResult: any,
  location: LocationData | null,
  chatHistory: string = "",
  cart: CartItem[] = [],
  analysis?: QueryAnalysis
): Promise<{ ai_voice: string; markdown_text: string }> => {
  logger.debug("Refining response", {
    query: userQuery,
    resultCount: dbResult?.data?.length || 0,
    hasLocation: location !== null,
    cartItemCount: cart.length,
    hasAnalysis: !!analysis,
  });

  const locationInfo = location
    ? `Location: ${location.name} (${location.latitude}, ${location.longitude})`
    : "";
  const historyContext = chatHistory ? `\n\n${chatHistory}` : "";

  // Filter out IDs and technical details before showing to user
  const userFacingData = filterUserFacingData(dbResult);
  logger.debug("Filtered user-facing data", {
    originalCount: dbResult?.data?.length || 0,
    filteredCount: userFacingData?.data?.length || 0,
  });
  
  // Check if showing vendors (has store_name field, which vendors have)
  const isShowingVendors = dbResult?.data && Array.isArray(dbResult.data) && 
    dbResult.data.some((row: any) => {
      return row.store_name !== undefined && row.store_name !== null;
    });
  
  // Check if data has nested services structure (services grouped by category)
  const hasNestedServices = dbResult?.data && Array.isArray(dbResult.data) && 
    dbResult.data.some((row: any) => {
      return Array.isArray(row.services) && row.services.length > 0 && 
             row.services.some((s: any) => s.price !== undefined && s.price !== null);
    });
  
  // Check if showing services (has price field, which categories don't have)
  // Also check for nested services structure (services grouped by category)
  const isShowingServices = !isShowingVendors && (
    hasNestedServices ||
    (dbResult?.data && Array.isArray(dbResult.data) && 
      dbResult.data.some((row: any) => {
        const hasServiceName = row.name || row.service_name;
        const hasPrice = row.price !== undefined && row.price !== null;
        return hasServiceName && hasPrice;
      }))
  );
  
  // Check if showing categories (has name but no price, typically from category queries)
  // Only if NOT showing services and NOT showing nested services
  const isShowingCategories = !isShowingVendors && !isShowingServices && !hasNestedServices && 
    dbResult?.data && Array.isArray(dbResult.data) && 
    dbResult.data.some((row: any) => {
      const hasName = row.name || row.category_name;
      const hasNoPrice = row.price === undefined || row.price === null;
      const hasNoServices = !Array.isArray(row.services) || row.services.length === 0;
      // Category queries typically return just name, no price/service details
      return hasName && hasNoPrice && hasNoServices && !row.service_name;
    });
  
  // Check if pagination request
  const isPagination = analysis?.isPaginationRequest || false;
  
  logger.debug("Response type detection", {
    isShowingServices,
    isShowingCategories,
    isPagination,
    sampleRow: dbResult?.data?.[0] ? Object.keys(dbResult.data[0]) : null,
  });
  
  // Build cart context for AI prompt
  let cartContext = "";
  if (cart.length > 0) {
    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    cartContext = `\n\nUser's Shopping Cart (${cart.length} items, Total: ₹${cartTotal}):\n${JSON.stringify(cart.map(item => ({
      service: item.serviceName,
      vendor: item.vendorName,
      price: item.price,
      quantity: item.quantity,
      itemTotal: item.price * item.quantity
    })), null, 2)}`;
  }
  
  // Check if services were just added to cart
  const cartAdded = (dbResult as any)?.cartAdded;
  let cartAddedContext = "";
  if (cartAdded) {
    if (cartAdded.added && cartAdded.added.length > 0) {
      cartAddedContext = `\n\n✅ Successfully added to cart: ${cartAdded.added.join(", ")}`;
    }
    if (cartAdded.notFound && cartAdded.notFound.length > 0) {
      cartAddedContext += `\n\n❌ Could not find: ${cartAdded.notFound.join(", ")}`;
    }
  }

  /**
   * Format cart in well-structured markdown
   */
  /**
   * Create a fallback response when AI refinement fails
   */
  const createFallbackResponse = (
    userFacingData: any,
    cart: CartItem[],
    isShowingServices: boolean,
    isPagination: boolean,
    userQuery: string
  ): { ai_voice: string; markdown_text: string } => {
    let ai_voice = "";
    let markdown_text = "";

    // Generate basic response based on data
    if (userFacingData?.data && userFacingData.data.length > 0) {
      if (isShowingServices) {
        const services = userFacingData.data.flatMap((category: any) => 
          category.services || []
        );
        ai_voice = `I found ${services.length} service${services.length > 1 ? 's' : ''} available.`;
        markdown_text = `## Available Services\n\n`;
        services.forEach((service: any) => {
          const name = service.name || service.service_name || "Unknown";
          const price = service.price || service.service_price || 0;
          const discount = service.discount || 0;
          const finalPrice = price - discount;
          markdown_text += `- **${name}** - ₹${finalPrice.toFixed(2)}`;
          if (discount > 0) {
            markdown_text += ` (Original: ₹${price.toFixed(2)}, Save: ₹${discount.toFixed(2)})`;
          }
          markdown_text += "\n";
        });
      } else {
        // Showing vendors
        const vendors = userFacingData.data;
        ai_voice = `I found ${vendors.length} vendor${vendors.length > 1 ? 's' : ''} near you.`;
        markdown_text = `## Nearby Vendors\n\n`;
        vendors.forEach((vendor: any) => {
          const name = vendor.store_name || vendor.name || "Unknown";
          const distance = vendor.distance_km || vendor.distance;
          const rating = vendor.vendor_rating || vendor.rating;
          markdown_text += `- **${name}**`;
          if (distance !== undefined && distance !== null) {
            if (distance < 0.1) {
              markdown_text += ` (at your location)`;
            } else {
              markdown_text += ` (approx. ${distance.toFixed(1)} km away)`;
            }
          }
          if (rating !== undefined && rating !== null) {
            markdown_text += ` - Rating: ${rating} stars`;
          }
          markdown_text += "\n";
        });
      }
    } else {
      ai_voice = "I couldn't find any results for your query. Please try again.";
      markdown_text = "## No Results Found\n\nI couldn't find any results matching your query. Please try rephrasing or check your location.";
    }

    // Add cart if present
    if (cart.length > 0) {
      const cartMarkdown = formatCartMarkdown(cart);
      markdown_text += "\n" + cartMarkdown;
    }

    return {
      ai_voice: ai_voice || "Data retrieved, but unable to generate response.",
      markdown_text: markdown_text || "Data retrieved, but unable to generate response.",
    };
  };

  const formatCartMarkdown = (cartItems: CartItem[]): string => {
    if (cartItems.length === 0) return "";
    
    const cartTotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    
    let cartMarkdown = `\n\n---\n\n🛒 **Your Cart** (${itemCount} ${itemCount === 1 ? 'item' : 'items'}, Total: **₹${cartTotal}**)\n\n`;
    
    cartItems.forEach((item, index) => {
      const itemTotal = item.price * item.quantity;
      cartMarkdown += `${index + 1}. **${item.serviceName}** (${item.vendorName})\n`;
      cartMarkdown += `   - Quantity: ${item.quantity}\n`;
      cartMarkdown += `   - Price: ₹${item.price} each\n`;
      if (item.quantity > 1) {
        cartMarkdown += `   - Subtotal: ₹${itemTotal}\n`;
      }
      if (item.veg !== undefined) {
        cartMarkdown += `   - ${item.veg ? '🟢 Veg' : '🔴 Non-Veg'}\n`;
      }
      cartMarkdown += `\n`;
    });
    
    cartMarkdown += `**Total: ₹${cartTotal}**\n`;
    
    return cartMarkdown;
  };

  const prompt = `You are a helpful assistant. The user asked: "${userQuery}"${historyContext}

${locationInfo}

Data retrieved from database:
${JSON.stringify(userFacingData, null, 2)}${cartContext}${cartAddedContext}

Your task:
- Understand the user's request and the data.
${chatHistory ? "- Consider the previous conversation context to provide more relevant and contextual responses." : ""}
- If no results found, keep the response SHORT and simple. Just inform the user briefly, don't provide long explanations or suggestions.
${isShowingVendors ? "- CRITICAL: When showing VENDORS, format each vendor with ONLY: name, distance (if available as distance_km or distance_miles), and rating (if available as vendor_rating). Format distance as 'at your location' if distance_km is 0 or very small (< 0.1), otherwise as 'approx. X km away'. Do NOT include description, preparing time, offers, or any other details. Keep it simple and clean." : ""}
${isShowingCategories ? "- CRITICAL: When showing categories, ask the user: 'Which category would you like to explore?' or 'Which category would you like to see services from?' DO NOT ask about adding to cart - categories are not services!" : ""}
${isShowingServices ? "- CRITICAL: When showing SERVICES (items/menu), list ALL services with their names, prices, and discounts (if any). Group them by category if they are grouped. Show the actual food items/services, NOT just category names. Format each service clearly with name and price. Example: '* Service Name - ₹100' or '* Service Name - ₹100 (Save ₹20)' if discount available. Then ask: 'Which service would you like to add to your cart?'" : ""}
${hasNestedServices ? "- CRITICAL: The data has services grouped by category. Show ALL services from ALL categories. List each service with its name, price, and discount (if any). Format as: '## Category Name\n* Service 1 - ₹100\n* Service 2 - ₹150 (Save ₹20)\n\n## Another Category\n* Service 3 - ₹200\n...' Show ALL services, not just category names!" : ""}
${isPagination ? "- If this is showing next page of results, mention 'Here are the next 10 services' or similar." : ""}
${cartAdded ? "- Services were just added to cart. Confirm which ones were added successfully and mention any that couldn't be found." : ""}
${cart.length > 0 ? "- The user has items in their cart. Include a brief mention in your response, but DO NOT format the cart details yourself - it will be added automatically." : ""}
- Prepare TWO versions of the answer:
  1) ai_voice: A plain, friendly sentence or two suitable for text-to-speech.\n     - No markdown and no special formatting symbols.\n     - Use only normal letters, numbers, commas, periods, and basic punctuation.\n     - Keep it concise and easy to speak (max 2-3 sentences).\n     - If cart has items, mention "You have X items in your cart" briefly.
  2) markdown_text: A rich markdown response.\n     ${isShowingVendors ? "- If showing VENDORS: List each vendor with ONLY name, distance (e.g., 'at your location' or 'approx. X km away'), and rating (if exists, e.g., 'Rating: X stars'). Format as simple bullet points. Example: '* Vendor Name (at your location) - Rating: 4 stars' or '* Vendor Name (approx. 5.4 km away)'. Do NOT include description, preparing time, offers, or other details. Group vendors by distance if helpful (e.g., 'Very Close' vs 'Other Vendors')." : ""}\n     - If showing categories: Ask which category they want to explore (e.g., "Which category would you like to explore?").\n     - If showing services: Ask which service they want to add to cart.\n     - If pagination: Mention "next 10 services" or similar.\n     - If no results: Keep it brief, just inform the user simply.\n     - Make it visually nice for a chat UI.\n     - DO NOT include cart details in markdown_text - it will be appended automatically.

Respond ONLY in valid JSON with this exact shape:
{
  "ai_voice": "plain speech friendly text here",
  "markdown_text": "markdown formatted text here"
}`;

  const refineStartTime = Date.now();
  logger.aiAction("Response Refinement", {
    query: userQuery,
    resultCount: userFacingData?.data?.length || 0,
    hasCart: cart.length > 0,
    isShowingServices,
    isPagination,
  });

  let response;
  try {
    response = await retryWithBackoff(() =>
      ai.generate({
        model: googleAI.model(AI_MODEL, {
          temperature: AI_TEMPERATURES.RESPONSE_REFINEMENT,
        }),
        prompt,
      })
    );
  } catch (error) {
    const duration = Date.now() - refineStartTime;
    logger.error("Response refinement failed after retries", {
      query: userQuery,
      duration,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : new Error(String(error)));
    
    // Return a fallback response
    return createFallbackResponse(userFacingData, cart, isShowingServices, isPagination, userQuery);
  }

  const duration = Date.now() - refineStartTime;
  const rawText = response.text?.trim() || "";

  logger.aiAction("Response Refinement Completed", {
    query: userQuery,
    duration,
    responseLength: rawText.length,
    response: rawText.length > 500 ? rawText.substring(0, 500) + '... [truncated]' : rawText,
  });

  // Extract JSON from markdown code blocks and clean up
  const extractJson = (text: string): string => {
    let cleaned = text.trim();
    
    // Remove "json" prefix if present
    cleaned = cleaned.replace(/^json\s+/i, "").trim();
    
    // Remove markdown code blocks (```json ... ```)
    cleaned = cleaned.replace(/^```[\w]*\n?/i, "").replace(/\n?```$/i, "").trim();
    
    // Find the first complete JSON object
    let braceCount = 0;
    let startIdx = -1;
    
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') {
        if (startIdx === -1) startIdx = i;
        braceCount++;
      } else if (cleaned[i] === '}') {
        braceCount--;
        if (braceCount === 0 && startIdx !== -1) {
          return cleaned.substring(startIdx, i + 1);
        }
      }
    }
    
    // Fallback: try regex match
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    
    return cleaned;
  };

  try {
    const jsonText = extractJson(rawText);
    const parsed = JSON.parse(jsonText) as {
      ai_voice?: string;
      markdown_text?: string;
    };

    // Clean ai_voice for TTS - remove markdown symbols and normalize
    let ai_voice = parsed.ai_voice || "";
    
    // Remove common markdown symbols
    ai_voice = ai_voice
      .replace(/[*_`#>\[\]-]/g, " ")
      .replace(/\\n/g, " ")
      .replace(/\\"/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    // Extract markdown_text and unescape newlines
    let markdown_text = parsed.markdown_text || "";
    
    // Unescape markdown text (handle \n, etc.)
    markdown_text = markdown_text
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\t/g, "\t");

    // Append well-formatted cart to markdown_text if cart has items
    if (cart.length > 0) {
      const cartMarkdown = formatCartMarkdown(cart);
      markdown_text += cartMarkdown;
    }

    if (!ai_voice) {
      logger.warn("AI voice response is empty", { query: userQuery });
      ai_voice = "Data retrieved, but unable to generate voice response.";
    }
    
    if (!markdown_text) {
      logger.warn("Markdown response is empty", { query: userQuery });
      markdown_text = "Data retrieved, but unable to generate markdown response.";
    }

    logger.info("Response refinement successful", {
      aiVoiceLength: ai_voice.length,
      markdownLength: markdown_text.length,
      hasCart: cart.length > 0,
    });

    return { ai_voice, markdown_text };
  } catch (error) {
    logger.error("Failed to refine response", {
      query: userQuery,
      resultCount: dbResult?.data?.length || 0,
    }, error instanceof Error ? error : new Error(String(error)));
    // Fallback: clean the whole text for ai_voice and reuse as markdown_text
    let ai_voice = rawText
      .replace(/^json\s+/i, "")
      .replace(/^```[\w]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .replace(/[*_`#>\[\]-]/g, " ")
      .replace(/\\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    let markdown_text = rawText
      .replace(/^json\s+/i, "")
      .replace(/^```[\w]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .replace(/\\n/g, "\n");

    // Append well-formatted cart to markdown_text if cart has items (even in fallback)
    if (cart.length > 0) {
      const cartMarkdown = formatCartMarkdown(cart);
      markdown_text += cartMarkdown;
    }

    return {
      ai_voice: ai_voice || "Data retrieved, but unable to generate response.",
      markdown_text: markdown_text || "Data retrieved, but unable to generate response.",
    };
  }
};

