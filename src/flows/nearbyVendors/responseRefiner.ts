import { googleAI } from "@genkit-ai/google-genai";
import { ai } from "../../ai.js";
import { retryWithBackoff } from "../../utils/retryWithBackoff.js";
import type { LocationData, QueryAnalysis } from "./types.js";
import type { CartItem } from "../../services/memory.js";
import { AI_MODEL, AI_TEMPERATURES } from "./constants.js";
import { logger } from "../../utils/logger.js";

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
  
  // Check if showing services (has price field, which categories don't have)
  const isShowingServices = dbResult?.data && Array.isArray(dbResult.data) && 
    dbResult.data.some((row: any) => {
      const hasServiceName = row.name || row.service_name;
      const hasPrice = row.price !== undefined && row.price !== null;
      return hasServiceName && hasPrice;
    });
  
  // Check if showing categories (has name but no price, typically from category queries)
  const isShowingCategories = dbResult?.data && Array.isArray(dbResult.data) && 
    dbResult.data.some((row: any) => {
      const hasName = row.name;
      const hasNoPrice = row.price === undefined || row.price === null;
      // Category queries typically return just name, no price/service details
      return hasName && hasNoPrice && !row.service_name;
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
${isShowingCategories ? "- CRITICAL: When showing categories, ask the user: 'Which category would you like to explore?' or 'Which category would you like to see services from?' DO NOT ask about adding to cart - categories are not services!" : ""}
${isShowingServices ? "- When showing services, ask the user: 'Which service would you like to add to your cart?' or 'Would you like to add any of these services to your cart?'" : ""}
${isPagination ? "- If this is showing next page of results, mention 'Here are the next 10 services' or similar." : ""}
${cartAdded ? "- Services were just added to cart. Confirm which ones were added successfully and mention any that couldn't be found." : ""}
${cart.length > 0 ? "- The user has items in their cart. Include a brief mention in your response, but DO NOT format the cart details yourself - it will be added automatically." : ""}
- Prepare TWO versions of the answer:
  1) ai_voice: A plain, friendly sentence or two suitable for text-to-speech.\n     - No markdown and no special formatting symbols.\n     - Use only normal letters, numbers, commas, periods, and basic punctuation.\n     - Keep it concise and easy to speak (max 2-3 sentences).\n     - If cart has items, mention "You have X items in your cart" briefly.
  2) markdown_text: A rich markdown response.\n     - If results found: Use headings, bullet points, and bold text to present vendors and services/items.\n     - If showing categories: Ask which category they want to explore (e.g., "Which category would you like to explore?").\n     - If showing services: Ask which service they want to add to cart.\n     - If pagination: Mention "next 10 services" or similar.\n     - If no results: Keep it brief, just inform the user simply.\n     - Clearly list vendor names, services/items, prices, and any other important info.\n     - Make it visually nice for a chat UI.\n     - DO NOT include cart details in markdown_text - it will be appended automatically.

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

  const response = await retryWithBackoff(() =>
    ai.generate({
      model: googleAI.model(AI_MODEL, {
        temperature: AI_TEMPERATURES.RESPONSE_REFINEMENT,
      }),
      prompt,
    })
  );

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

