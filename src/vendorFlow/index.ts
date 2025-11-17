import { z } from "genkit";
import { ai } from "../ai.js";
import type { FlowInput, FlowOutput } from "../types/vendorFlow.js";
import { analyzeUserQuery } from "./queryAnalyzer.js";
import { getLocationCoordinates } from "./locationHandler.js";
import { refineResponse } from "./responseRefiner.js";
import { 
  getChatHistory, 
  saveMessage, 
  formatChatHistoryForPrompt, 
  getUserLocation, 
  saveUserLocation,
  getCart,
} from "../services/memory.js";
import { logger } from "../utils/logger.js";
import { WorkflowRouter } from "./workflowRouter.js";
import { buildWorkflowContext } from "./context.js";
import { saveMessages } from "./utils.js";

const inputSchema = z.object({
  userQuery: z.string().describe("User's query about vendors or any database query"),
  chatId: z.string().optional().describe("Unique chat/request ID from frontend for socket tracking and memory"),
  locationName: z.string().optional().describe("Location name if already known (e.g., 'Kanpur')"),
  latitude: z.number().optional().describe("Latitude if already known"),
  longitude: z.number().optional().describe("Longitude if already known"),
});

const outputSchema = z.object({
  ai_voice: z.string().optional(),
  markdown_text: z.string().optional(),
  error: z.string().optional(),
});

const workflowRouter = new WorkflowRouter();

const nearbyVendorsFlow = ai.defineFlow(
  {
    name: "nearbyVendorsFlow",
    inputSchema: inputSchema,
    outputSchema: outputSchema,
  },
  async (input: FlowInput): Promise<FlowOutput> => {
    const startTime = Date.now();
    logger.flowStep("Flow Started", {
      chatId: input.chatId,
      userQuery: input.userQuery,
      locationName: input.locationName,
      latitude: input.latitude,
      longitude: input.longitude,
    }, input.chatId);

    try {
      // Step 0: Retrieve chat history and saved location
      logger.flowStep("Step 0: Retrieving chat history and location", { chatId: input.chatId }, input.chatId);
      const { chatHistory, savedLocation } = await loadUserContext(input.chatId);

      // Step 1: Analyze user query (includes spelling correction)
      logger.flowStep("Step 1: Analyzing user query and correcting spelling", { originalQuery: input.userQuery }, input.chatId);
      const analysis = await analyzeUserQuery(input.userQuery, chatHistory, input.chatId);
      
      // Use corrected query if available, otherwise use original
      const userQuery = analysis.correctedQuery || input.userQuery;
      logger.info("Query analysis completed", { 
        analysis,
        originalQuery: input.userQuery,
        correctedQuery: userQuery,
        wasCorrected: analysis.correctedQuery && analysis.correctedQuery !== input.userQuery,
      });

      // Step 3: Handle location requirements
      const location = await handleLocation(input, analysis, savedLocation, userQuery, chatHistory);
      if (!location && analysis.needsLocation) {
        // Location was requested but not available
        return createLocationRequestResponse(userQuery, input.chatId);
      }

      // Step 4: Build workflow context and route to appropriate workflow
      logger.flowStep("Step 4: Routing to workflow", { 
        queryType: analysis.queryType,
        isCartOperation: analysis.isCartOperation,
      }, input.chatId);
      
      const workflowContext = await buildWorkflowContext(input, userQuery, chatHistory, analysis, location);
      const workflowResult = await workflowRouter.route(workflowContext);

      // Step 5: Handle workflow results
      if (!workflowResult) {
        return {
          error: "Unable to process your request. Please try again.",
        };
      }

      // Handle workflow result refinement
      // Skip refinement for cart operations (they return complete responses)
      const finalResult = (workflowResult as any)._needsRefinement || (workflowResult as any)._needsExploration
        ? await handleWorkflowResult(workflowResult, input, userQuery, chatHistory, location, analysis)
        : workflowResult;

      await saveMessages(input.chatId, userQuery, finalResult.ai_voice || "");

      logger.flowStep("Flow Completed Successfully", {
        duration: Date.now() - startTime,
      }, input.chatId);

      return finalResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Flow execution failed", {
        chatId: input.chatId,
        userQuery: input.userQuery,
        duration,
        error: error instanceof Error ? error.message : String(error),
      }, error instanceof Error ? error : new Error(String(error)), input.chatId);
      
      // Return user-friendly error message without exposing technical details
      const errorMessage = getUserFriendlyErrorMessage(error);
      
      return {
        error: errorMessage,
        ai_voice: errorMessage,
        markdown_text: `## Unable to Process Request\n\n${errorMessage}\n\nPlease try again in a few moments.`,
      };
    }
  }
);

/**
 * Convert technical errors to user-friendly messages
 */
function getUserFriendlyErrorMessage(error: any): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = error?.code || error?.status;
  
  // Check for model overload or service unavailable errors
  if (
    errorCode === 503 ||
    errorCode === 'UNAVAILABLE' ||
    errorMessage.includes('overloaded') ||
    errorMessage.includes('503') ||
    errorMessage.includes('Service Unavailable')
  ) {
    return "I'm currently experiencing high demand. Please try again in a few moments.";
  }
  
  // Check for rate limiting
  if (
    errorCode === 429 ||
    errorMessage.includes('429') ||
    errorMessage.includes('rate limit')
  ) {
    return "Too many requests. Please wait a moment and try again.";
  }
  
  // Check for network errors
  if (
    errorMessage.includes('fetch') ||
    errorMessage.includes('network') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('timeout')
  ) {
    return "I'm having trouble connecting right now. Please check your internet connection and try again.";
  }
  
  // Generic fallback
  return "I encountered an issue processing your request. Please try again in a moment.";
}

// Helper methods
async function loadUserContext(chatId?: string): Promise<{ chatHistory: string; savedLocation: any }> {
  let chatHistory = "";
  let savedLocation = null;

  if (chatId) {
    const previousMessages = await getChatHistory(chatId);
    chatHistory = formatChatHistoryForPrompt(previousMessages);
    savedLocation = await getUserLocation(chatId);
    logger.info("Retrieved chat history and location", {
      chatId,
      messageCount: previousMessages.length,
      hasSavedLocation: savedLocation !== null,
    });
  }

  return { chatHistory, savedLocation };
}

async function handleLocation(
  input: FlowInput,
  analysis: any,
  savedLocation: any,
  userQuery: string,
  chatHistory: string
): Promise<any> {
  const needsLocation = analysis.needsLocation === true;
  const hasLocationInput = !!input.latitude || !!input.longitude || !!input.locationName;
  const hasSavedLocation = savedLocation !== null;
  const hasLocationInAnalysis = !!analysis.locationName && analysis.locationName !== null;

  logger.info("Location check", {
    needsLocation,
    hasLocationInput,
    hasSavedLocation,
    hasLocationInAnalysis,
    analysisLocationName: analysis.locationName,
  });

  // If location needed but not available, return null (will be handled by caller)
  if (needsLocation && !hasLocationInput && !hasSavedLocation && !hasLocationInAnalysis) {
    return null;
  }

  // Get location coordinates
  logger.flowStep("Step 3: Getting location coordinates", undefined, input.chatId);
  let location = savedLocation;

  if (!location) {
    const locationInput = {
      ...input,
      locationName: analysis.locationName || input.locationName,
    };
    
    location = await getLocationCoordinates(locationInput, analysis);
    
    logger.info("Location coordinates retrieved", {
      location: location ? {
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
      } : null,
      source: savedLocation ? "saved" : analysis.locationName ? "analysis" : "input",
    });

    // Save location to memory
    if (location && input.chatId) {
      await saveUserLocation(input.chatId, location).catch((err) => {
        logger.error("Failed to save user location", { chatId: input.chatId, location }, err);
      });
      logger.info("Location saved to memory", {
        chatId: input.chatId,
        locationName: location.name,
      });
    }
  } else {
    logger.info("Using saved location", { locationName: location.name });
  }

  return location;
}

function createLocationRequestResponse(userQuery: string, chatId?: string): FlowOutput {
  const response = {
    ai_voice: "Please share your city name or current location to find nearby vendors.",
    markdown_text: "📍 Please share your **city name** or **current location** to find nearby vendors.",
  };

  // Save messages
  if (chatId) {
    saveMessage(chatId, "user", userQuery).catch((err) => {
      logger.error("Failed to save user message", { chatId }, err);
    });
    saveMessage(chatId, "assistant", response.ai_voice).catch((err) => {
      logger.error("Failed to save assistant message", { chatId }, err);
    });
  }

  return response;
}

/**
 * Handle workflow result - refine if needed or return as-is
 */
async function handleWorkflowResult(
  workflowResult: FlowOutput,
  input: FlowInput,
  userQuery: string,
  chatHistory: string,
  location: any,
  analysis: any
): Promise<FlowOutput> {
  const result = workflowResult as any;

  // Check if cart workflow needs to continue to exploration
  if (result._needsExploration) {
    logger.flowStep("Step 5: Routing to exploration workflow for service details", undefined, input.chatId);
    const explorationContext = await buildWorkflowContext(input, userQuery, chatHistory, analysis, location);
    const explorationResult = await workflowRouter.route(explorationContext);
    
    if (explorationResult && (explorationResult as any)._needsRefinement) {
      return await refineWorkflowResult(explorationResult, input, userQuery, chatHistory, location, analysis);
    }
  }

  // Check if workflow needs refinement (exploration workflows)
  if (result._needsRefinement) {
    return await refineWorkflowResult(workflowResult, input, userQuery, chatHistory, location, analysis);
  }

  // Workflow returned a complete response (cart operations)
  return workflowResult;
}

/**
 * Refine workflow result with response refinement
 */
async function refineWorkflowResult(
  workflowResult: FlowOutput,
  input: FlowInput,
  userQuery: string,
  chatHistory: string,
  location: any,
  analysis: any
): Promise<FlowOutput> {
  try {
    const result = workflowResult as any;
    const dbResult = result.dbResult;
    const cart = input.chatId ? await getCart(input.chatId) : [];

    logger.flowStep("Step 5: Refining response", undefined, input.chatId);
    const refinedResponse = await refineResponse(
      userQuery,
      dbResult,
      location,
      chatHistory,
      cart,
      analysis
    );

    return {
      ai_voice: refinedResponse.ai_voice,
      markdown_text: refinedResponse.markdown_text,
    };
  } catch (error) {
    logger.error("Failed to refine workflow result", {
      userQuery,
      error: error instanceof Error ? error.message : String(error),
    }, error instanceof Error ? error : new Error(String(error)));
    
    // Return user-friendly error message
    const errorMessage = getUserFriendlyErrorMessage(error);
    return {
      ai_voice: errorMessage,
      markdown_text: `## Unable to Process Request\n\n${errorMessage}\n\nPlease try again in a few moments.`,
    };
  }
}

export default nearbyVendorsFlow;

