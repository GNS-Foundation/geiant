import { SpatialFeature, SpatialGeometry, ValidationResult } from '../types/index.js';
/**
 * Validate an array of spatial features.
 * Returns on first invalid feature (fail-fast).
 */
export declare function validateGeometries(features: SpatialFeature[]): ValidationResult;
export declare function validateFeature(feature: SpatialFeature, index?: number): ValidationResult;
export declare function validateGeometry(geom: SpatialGeometry, featureIndex?: number): ValidationResult;
/** Quick check — does this look like coordinates were swapped? */
export declare function looksTransposed(lng: number, lat: number): boolean;
/** Format a ValidationResult as a structured error message for agent feedback */
export declare function formatValidationError(result: ValidationResult): string;
//# sourceMappingURL=geometry.d.ts.map