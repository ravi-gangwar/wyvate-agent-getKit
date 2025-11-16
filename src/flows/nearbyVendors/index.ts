import { z } from "genkit";
import { ai } from "../../ai.js";
import databaseTool from "../../tools/dbCall.js";
import type { FlowInput, FlowOutput } from "./types.js";
import { analyzeUserQuery, correctSpelling } from "./queryAnalysis.js";
import { getLocationCoordinates } from "./locationHandler.js";
import { generateSqlQuery } from "./sqlGenerator.js";
import { refineResponse } from "./responseRefiner.js";
import { getChatHistory, saveMessage, formatChatHistoryForPrompt, getUserLocation, saveUserLocation, extractAndSaveIds, getVendorId, getServiceId, getCart, addToCart, removeFromCart, clearCart, getLastServicePage, setLastServicePage, getStoreItemsByType, getStoreItemsByVendor, getMostRecentVendor, saveLastShownServices, getLastShownServices, getLastShownServicesWithDiscount } from "../../services/memory.js";
import type { CartItem, LastShownService } from "../../services/memory.js";
import { logger } from "../../utils/logger.js";

const inputSchema = z.object({
  userQuery: z.string().describe("User's query about vendors or any database query"),
  userId: z.string().optional().describe("User ID for chat history"),
  chatId: z.string().optional().describe("Unique chat/request ID from frontend for socket tracking"),
  locationName: z.string().optional().describe("Location name if already known (e.g., 'Kanpur')"),
  latitude: z.number().optional().describe("Latitude if already known"),
  longitude: z.number().optional().describe("Longitude if already known"),
});

const outputSchema = z.object({
  ai_voice: z.string().optional(),
  markdown_text: z.string().optional(),
  error: z.string().optional(),
});

const nearbyVendorsFlow = ai.defineFlow(
  {
    name: "nearbyVendorsFlow",
    inputSchema: inputSchema,
    outputSchema: outputSchema,
  },
  async (input: FlowInput): Promise<FlowOutput> => {
    const startTime = Date.now();
    logger.flowStep("Flow Started", {
      userId: input.userId,
      userQuery: input.userQuery,
      locationName: input.locationName,
      latitude: input.latitude,
      longitude: input.longitude,
    }, input.chatId);

    try {
      // Step 0: Retrieve chat history and saved location if userId is provided
      logger.flowStep("Step 0: Retrieving chat history and location", { userId: input.userId }, input.chatId);
      let chatHistory = "";
      let savedLocation = null;
      if (input.userId) {
        const previousMessages = await getChatHistory(input.userId);
        chatHistory = formatChatHistoryForPrompt(previousMessages);
        savedLocation = await getUserLocation(input.userId);
        logger.info("Retrieved chat history and location", {
          userId: input.userId,
          messageCount: previousMessages.length,
          hasSavedLocation: savedLocation !== null,
        });
      }

      // Step 1: Correct spelling mistakes based on previous interactions
      logger.flowStep("Step 1: Correcting spelling", { originalQuery: input.userQuery }, input.chatId);
      const correctedQuery = await correctSpelling(input.userQuery, chatHistory);
      
      // Use corrected query for the rest of the flow
      const userQuery = correctedQuery;
      if (correctedQuery !== input.userQuery) {
        logger.info("Query spelling corrected", {
          original: input.userQuery,
          corrected: correctedQuery,
        });
      }

      // Step 2: Analyze user query (with chat history context)
      logger.flowStep("Step 2: Analyzing user query", undefined, input.chatId);
      const analysis = await analyzeUserQuery(userQuery, chatHistory);
      logger.info("Query analysis completed", {
        analysis: {
          needsLocation: analysis.needsLocation,
          locationName: analysis.locationName,
          queryType: analysis.queryType,
          isCartOperation: analysis.isCartOperation,
          cartAction: analysis.cartAction,
          isPaginationRequest: analysis.isPaginationRequest,
          serviceNames: analysis.serviceNames,
        },
      });

      // Step 2.5: Handle cart operations
      if (analysis.isCartOperation && input.userId) {
        logger.flowStep("Step 2.5: Handling cart operation", {
          cartAction: analysis.cartAction,
          serviceNames: analysis.serviceNames,
        }, input.chatId);
        const cart = await getCart(input.userId);
        logger.info("Retrieved cart", { itemCount: cart.length });
        
        if (analysis.cartAction === "view") {
          logger.info("Viewing cart");
          const cartResponse = await refineResponse(
            userQuery,
            { data: cart, message: "Cart items" },
            null,
            chatHistory,
            cart
          );
          
          if (input.userId) {
            await saveMessage(input.userId, "user", userQuery).catch(console.error);
            await saveMessage(input.userId, "assistant", cartResponse.ai_voice).catch(console.error);
          }
          
          return {
            ai_voice: cartResponse.ai_voice,
            markdown_text: cartResponse.markdown_text,
          };
        }
        
        if (analysis.cartAction === "clear") {
          logger.info("Clearing cart");
          await clearCart(input.userId);
          const response = {
            ai_voice: "Your cart has been cleared.",
            markdown_text: "🛒 Your cart has been cleared.",
          };
          
          if (input.userId) {
            await saveMessage(input.userId, "user", userQuery).catch((err) => {
              logger.error("Failed to save user message", { userId: input.userId }, err);
            });
            await saveMessage(input.userId, "assistant", response.ai_voice).catch((err) => {
              logger.error("Failed to save assistant message", { userId: input.userId }, err);
            });
          }
          
          logger.flowStep("Flow Completed", { duration: Date.now() - startTime }, input.chatId);
          return response;
        }
        
        if (analysis.cartAction === "add") {
          // Check if user wants to add a service with discount from previously shown services
          const wantsServiceWithDiscount = userQuery.toLowerCase().includes("discount") || 
                                          userQuery.toLowerCase().includes("discounted") ||
                                          userQuery.toLowerCase().includes("which have discount");
          
          if (wantsServiceWithDiscount && input.userId) {
            const servicesWithDiscount = getLastShownServicesWithDiscount(input.userId);
            
            logger.info("Checking for services with discount", {
              wantsServiceWithDiscount,
              lastShownServicesCount: getLastShownServices(input.userId).length,
              servicesWithDiscountCount: servicesWithDiscount.length,
            });
            
            if (servicesWithDiscount.length > 0) {
              logger.info("Found services with discount from last shown services", {
                count: servicesWithDiscount.length,
                services: servicesWithDiscount.map(s => s.serviceName),
              });
              
              // Add the first service with discount to cart
              const serviceToAdd = servicesWithDiscount[0];
              if (serviceToAdd) {
                const cartItem: CartItem = {
                  serviceId: serviceToAdd.serviceId,
                  serviceName: serviceToAdd.serviceName,
                  vendorId: serviceToAdd.vendorId,
                  vendorName: serviceToAdd.vendorName,
                  price: serviceToAdd.price,
                  quantity: 1,
                  addedAt: new Date(),
                };
                
                if (serviceToAdd.discount !== undefined) {
                  cartItem.discount = serviceToAdd.discount;
                }
                if (serviceToAdd.discountType !== undefined) {
                  cartItem.discountType = serviceToAdd.discountType;
                }
                if (serviceToAdd.veg !== undefined) {
                  cartItem.veg = serviceToAdd.veg;
                }
                if (serviceToAdd.categoryId !== undefined) {
                  cartItem.categoryId = serviceToAdd.categoryId;
                }
              
                await addToCart(input.userId, cartItem).catch((err) => {
                  logger.error("Failed to add service to cart", { cartItem }, err);
                });
                
                logger.info("Added service with discount to cart", {
                  serviceName: cartItem.serviceName,
                  vendorName: cartItem.vendorName,
                  price: cartItem.price,
                  discount: cartItem.discount,
                });
                
                // Get updated cart and show it
                const updatedCart = await getCart(input.userId);
                const cartResponse = await refineResponse(
                  userQuery,
                  { data: updatedCart, message: "Cart items" },
                  null,
                  chatHistory,
                  updatedCart,
                  analysis
                );
                
                if (input.userId) {
                  await saveMessage(input.userId, "user", userQuery).catch((err) => {
                    logger.error("Failed to save user message", { userId: input.userId }, err);
                  });
                  await saveMessage(input.userId, "assistant", cartResponse.ai_voice).catch((err) => {
                    logger.error("Failed to save assistant message", { userId: input.userId }, err);
                  });
                }
                
                logger.flowStep("Flow Completed", { duration: Date.now() - startTime }, input.chatId);
                return {
                  ai_voice: cartResponse.ai_voice,
                  markdown_text: cartResponse.markdown_text,
                };
              }
            }
          }
          
          // If specific service names provided, continue to normal flow
          if (analysis.serviceNames && analysis.serviceNames.length > 0) {
            // Services will be added after we get DB results or from store memory
            // Continue to normal flow to get service details
          }
        }
      }

      // Step 3: Check if location is needed and available
      const needsLocation = analysis.needsLocation === true;
      
      // Check for location from: saved memory, explicit input, or analysis
      const hasLocationInput =
        !!input.latitude || !!input.longitude || !!input.locationName;
      const hasSavedLocation = savedLocation !== null;
      const hasLocationInAnalysis = !!analysis.locationName && analysis.locationName !== null;

      logger.info("Location check", {
        needsLocation,
        hasLocationInput,
        hasSavedLocation,
        hasLocationInAnalysis,
        analysisLocationName: analysis.locationName,
      });

      // If location is needed but not available from any source, ask simply for it
      if (needsLocation && !hasLocationInput && !hasSavedLocation && !hasLocationInAnalysis) {
        logger.info("Location needed but not available, asking user");
        const response = {
          ai_voice: "Please share your city name or current location to find nearby vendors.",
          markdown_text: "📍 Please share your **city name** or **current location** to find nearby vendors.",
        };

        // Save messages if userId is provided (save corrected query)
        if (input.userId) {
          await saveMessage(input.userId, "user", userQuery).catch((err) => {
            logger.error("Failed to save user message", { userId: input.userId }, err);
          });
          await saveMessage(input.userId, "assistant", response.ai_voice).catch((err) => {
            logger.error("Failed to save assistant message", { userId: input.userId }, err);
          });
        }

        return response;
      }

      // Step 4: Get location coordinates (use saved location if available, otherwise get from query/analysis)
      logger.flowStep("Step 4: Getting location coordinates", undefined, input.chatId);
      let location = savedLocation;
      
      // If no saved location, try to get from analysis or input
      if (!location) {
        // Create a modified input with locationName from analysis if available
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
        
        // Save location to memory if we got it and userId is provided
        if (location && input.userId) {
          await saveUserLocation(input.userId, location).catch((err) => {
            logger.error("Failed to save user location", { userId: input.userId, location }, err);
          });
          logger.info("Location saved to memory", {
            userId: input.userId,
            locationName: location.name,
          });
        }
      } else {
        logger.info("Using saved location", {
          locationName: location.name,
        });
      }

      // Step 5: Handle pagination and get last vendor context
      let offset = 0;
      let lastVendorId: number | null = null;
      let lastVendorName: string | null = null;
      
      if (analysis.isPaginationRequest && input.userId) {
        offset = (getLastServicePage(input.userId) + 1) * 10;
        
        // Get the most recent vendor from store for pagination context
        const lastVendor = getMostRecentVendor(input.userId);
        if (lastVendor) {
          lastVendorId = lastVendor.id;
          lastVendorName = lastVendor.name;
          logger.info("Pagination requested, using last vendor from context", {
            vendorId: lastVendorId,
            vendorName: lastVendorName,
            offset,
          });
        }
      }

      // Step 5.5: Generate SQL query (with chat history context and ID mappings)
      logger.flowStep("Step 5.5: Generating SQL query", {
        offset,
        hasLocation: location !== null,
        chatHistoryLength: chatHistory.length,
        lastVendorId,
        lastVendorName,
      }, input.chatId);
      const sqlQueryStartTime = Date.now();
      const sqlQuery = await generateSqlQuery(userQuery, location, chatHistory, input.userId, offset, lastVendorId, lastVendorName);
      logger.info("SQL query generated", {
        duration: Date.now() - sqlQueryStartTime,
        queryLength: sqlQuery.length,
      });

      // Step 6: Execute SQL query
      logger.flowStep("Step 6: Executing SQL query", undefined, input.chatId);
      const dbQueryStartTime = Date.now();
      const dbResult = await databaseTool({ query: sqlQuery });
      const dbQueryDuration = Date.now() - dbQueryStartTime;
      logger.sqlQuery(sqlQuery, undefined, dbQueryDuration, dbResult?.data?.length, input.chatId);
      logger.info("SQL query executed", {
        duration: dbQueryDuration,
        resultCount: dbResult?.data?.length || 0,
        hasError: !!dbResult?.error,
      });

      // Step 6.5: Extract and save vendor/service/category IDs from results
      if (input.userId && dbResult?.data) {
        logger.flowStep("Step 6.5: Extracting and saving IDs from results", undefined, input.chatId);
        // Also pass location context to help with vendor ID extraction for categories
        await extractAndSaveIds(input.userId, dbResult, location?.name).catch((err) => {
          logger.error("Failed to extract and save IDs", { userId: input.userId }, err);
        });
        logger.info("IDs extracted and saved", { userId: input.userId });
        
        // Save last shown services for future reference (when user wants to add services)
        if (Array.isArray(dbResult.data) && dbResult.data.length > 0) {
          const lastShownServices: LastShownService[] = [];
          
          for (const row of dbResult.data) {
            if (!row.name && !row.service_name) continue;
            
            const vendorId = (row.vendor_id_id as number) || (row.id as number);
            const serviceId = (row.vendor_service_id_id as number) || (row.service_id as number);
            const vendorName = (row.store_name as string) || "Unknown Vendor";
            const serviceName = (row.name as string) || (row.service_name as string) || "Unknown Service";
            
            if (!serviceId || !vendorId) continue;
            
            const service: LastShownService = {
              serviceId,
              serviceName,
              vendorId,
              vendorName,
              price: (row.price as number) || 0,
              shownAt: new Date(),
            };
            
            if (row.discount !== undefined && row.discount !== null) {
              service.discount = row.discount as number;
            }
            if (row.discount_type !== undefined && row.discount_type !== null) {
              service.discountType = row.discount_type as string;
            }
            if (row.veg !== undefined && row.veg !== null) {
              service.veg = row.veg as boolean;
            }
            if (row.category_id_id !== undefined && row.category_id_id !== null) {
              service.categoryId = row.category_id_id as number;
            }
            if (row.category_name !== undefined && row.category_name !== null) {
              service.categoryName = row.category_name as string;
            }
            
            lastShownServices.push(service);
          }
          
          if (lastShownServices.length > 0) {
            saveLastShownServices(input.userId, lastShownServices);
            logger.info("Saved last shown services", {
              count: lastShownServices.length,
              services: lastShownServices.map(s => ({ name: s.serviceName, discount: s.discount })),
            });
          }
        }
        
        // Handle add to cart operation
        if (analysis.isCartOperation && analysis.cartAction === "add" && analysis.serviceNames && analysis.serviceNames.length > 0) {
          // Try to find services in current DB results first
          const servicesToAdd: CartItem[] = [];
          
          for (const requestedServiceName of analysis.serviceNames) {
            // Normalize service name for matching (remove extra spaces, lowercase)
            const normalizedRequested = requestedServiceName.toLowerCase().trim().replace(/\s+/g, ' ');
            
            // First, try to find in current DB results
            let serviceRow = dbResult.data?.find((row: any) => {
              const rowName = (row.name || row.service_name || "").toLowerCase().trim();
              return rowName === normalizedRequested || 
                     rowName.includes(normalizedRequested) ||
                     normalizedRequested.includes(rowName);
            });
            
            // If not found in results, try to find in store memory
            if (!serviceRow && input.userId) {
              const storeServices = getStoreItemsByType(input.userId, "service");
              const storeService = storeServices.find(item => {
                const itemName = item.name.toLowerCase().trim().replace(/\s+/g, ' ');
                return itemName === normalizedRequested || 
                       itemName.includes(normalizedRequested) ||
                       normalizedRequested.includes(itemName);
              });
              
              if (storeService && storeService.vendorId) {
                // Found in store, need to query DB for full details
                // Get vendor name from store
                const vendorStoreItem = getStoreItemsByType(input.userId, "vendor").find(
                  v => v.id === storeService.vendorId
                );
                const vendorName = vendorStoreItem?.name || "Unknown Vendor";
                
                // Query DB to get service details using IDs
                try {
                  const serviceDetailsQuery = `
                    SELECT 
                      vvs.id AS vendor_service_id,
                      vvs.vendor_id_id,
                      vvs.price,
                      vvs.discount,
                      vvs.discount_type,
                      aasm.name AS service_name,
                      aasm.veg,
                      vvm.store_name
                    FROM vendor_vendorservice vvs
                    JOIN admin_app_servicemodel aasm ON aasm.id = vvs.vendor_service_id_id
                    JOIN vendor_vendormodel vvm ON vvm.id = vvs.vendor_id_id
                    WHERE vvs.vendor_service_id_id = ${storeService.id}
                      AND vvs.vendor_id_id = ${storeService.vendorId}
                      AND vvs.approved = '1'
                      AND vvs.active = true
                      AND vvs.eye_toggle = true
                    LIMIT 1
                  `;
                  
                  const serviceDetailsResult = await databaseTool({ query: serviceDetailsQuery });
                  if (serviceDetailsResult?.data && serviceDetailsResult.data.length > 0 && serviceDetailsResult.data[0]) {
                    const fetchedRow = serviceDetailsResult.data[0];
                    fetchedRow.store_name = vendorName; // Use vendor name from store
                    serviceRow = fetchedRow;
                  }
                } catch (error) {
                  console.error("Error fetching service details from DB:", error);
                }
              }
            }
            
            // Add to cart if service found
            if (serviceRow) {
              const vendorId = (serviceRow.vendor_id_id as number) || (serviceRow.id as number);
              const serviceId = (serviceRow.vendor_service_id_id as number) || (serviceRow.service_id as number) || (serviceRow.vendor_service_id as number);
              const vendorName = (serviceRow.store_name as string) || "Unknown Vendor";
              const serviceName = (serviceRow.name as string) || (serviceRow.service_name as string) || requestedServiceName;
              
              if (vendorId && serviceId && typeof vendorId === 'number' && typeof serviceId === 'number') {
                const cartItem: CartItem = {
                  serviceId,
                  serviceName,
                  vendorId,
                  vendorName,
                  price: (serviceRow.price as number) || 0,
                  quantity: 1,
                  addedAt: new Date(),
                };
                
                if (serviceRow.discount !== undefined) {
                  cartItem.discount = serviceRow.discount as number;
                }
                if (serviceRow.discount_type !== undefined) {
                  cartItem.discountType = serviceRow.discount_type as string;
                }
                if (serviceRow.veg !== undefined) {
                  cartItem.veg = serviceRow.veg as boolean;
                }
                if (serviceRow.category_id_id !== undefined) {
                  cartItem.categoryId = serviceRow.category_id_id as number;
                }
                
                servicesToAdd.push(cartItem);
              }
            }
          }
          
          // Add all found services to cart
          const addedServices: string[] = [];
          const notFoundServices: string[] = [];
          
          logger.info("Adding services to cart", {
            servicesToAdd: servicesToAdd.length,
            requestedServices: analysis.serviceNames,
          });
          
          for (const cartItem of servicesToAdd) {
            await addToCart(input.userId, cartItem).catch((err) => {
              logger.error("Failed to add item to cart", { cartItem }, err);
            });
            addedServices.push(cartItem.serviceName);
            logger.info("Added service to cart", {
              serviceName: cartItem.serviceName,
              vendorName: cartItem.vendorName,
              price: cartItem.price,
            });
          }
          
          // Track which services were not found
          for (const requestedName of analysis.serviceNames) {
            if (!addedServices.some(added => added.toLowerCase().includes(requestedName.toLowerCase()))) {
              notFoundServices.push(requestedName);
            }
          }
          
          // If we added services, update the response to reflect this
          if (addedServices.length > 0) {
            // Modify dbResult to include success message
            if (!dbResult.data) {
              dbResult.data = [];
            }
            (dbResult as any).cartAdded = {
              added: addedServices,
              notFound: notFoundServices,
            };
          }
        }
        
        // Update pagination if showing services
        if (dbResult.data && dbResult.data.length > 0 && input.userId) {
          setLastServicePage(input.userId, Math.floor(offset / 10));
        }
      }

      // Step 7: Get cart for response
      const cart = input.userId ? await getCart(input.userId) : [];

      // Step 8: Refine and return response (with chat history context, filter out IDs)
      logger.flowStep("Step 8: Refining response", undefined, input.chatId);
      const refineStartTime = Date.now();
      const refinedResponse = await refineResponse(
        userQuery,
        dbResult,
        location,
        chatHistory,
        cart,
        analysis
      );
      logger.info("Response refined", {
        duration: Date.now() - refineStartTime,
        aiVoiceLength: refinedResponse.ai_voice?.length || 0,
        markdownLength: refinedResponse.markdown_text?.length || 0,
      });

      // Step 9: Save messages to memory if userId is provided (save corrected query)
      if (input.userId) {
        logger.flowStep("Step 9: Saving messages to memory", undefined, input.chatId);
        await saveMessage(input.userId, "user", userQuery).catch((err) => {
          logger.error("Failed to save user message", { userId: input.userId }, err);
        });
        await saveMessage(input.userId, "assistant", refinedResponse.ai_voice).catch((err) => {
          logger.error("Failed to save assistant message", { userId: input.userId }, err);
        });
      }

      logger.flowStep("Flow Completed Successfully", {
        duration: Date.now() - startTime,
        totalSteps: 9,
      }, input.chatId);

      return {
        ai_voice: refinedResponse.ai_voice,
        markdown_text: refinedResponse.markdown_text,
      };
    } catch (error) {
      logger.error("Flow execution failed", {
        userId: input.userId,
        userQuery: input.userQuery,
        duration: Date.now() - startTime,
      }, error instanceof Error ? error : new Error(String(error)));
      
      return {
        error: error instanceof Error ? error.message : "An unexpected error occurred while processing your request.",
      };
    }
  }
);

export default nearbyVendorsFlow;

