/**
 * Vendor-related type definitions
 */

/**
 * Filter type for vendor services
 * 0 = All items
 * 1 = Vegetarian only
 * 2 = Non-vegetarian only
 * 3 = Eggeterian only
 */
export enum ServiceFilter {
  ALL = 0,
  VEG = 1,
  NON_VEG = 2,
  EGGETERIAN = 3,
}

/**
 * Service filter type (can be enum value or number)
 */
export type ServiceFilterType = ServiceFilter | number;

