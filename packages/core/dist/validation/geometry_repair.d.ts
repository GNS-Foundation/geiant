import { SpatialFeature, SpatialGeometry, ValidationResult, GeometryRepairResult } from '../types/index.js';
/**
 * Attempt to repair a single geometry.
 * Returns a GeometryRepairResult with the corrected geometry if possible.
 */
export declare function repairGeometry(geom: SpatialGeometry, error: ValidationResult): GeometryRepairResult;
/**
 * Attempt to repair all features in a task.
 * Returns per-feature repair results and the repaired feature array.
 */
export declare function repairFeatures(features: SpatialFeature[]): {
    repairedFeatures: SpatialFeature[];
    repairs: GeometryRepairResult[];
    allRepaired: boolean;
};
/**
 * Compute the convex hull of a set of 2D points using Graham scan.
 * Returns a closed ring (first == last) in counter-clockwise order.
 * Returns null if fewer than 3 unique points.
 */
export declare function convexHull(points: [number, number][]): [number, number][] | null;
/**
 * Format repair results as structured agent feedback.
 * This is what gets sent back to the LLM explaining what was auto-corrected.
 */
export declare function formatRepairFeedback(repairs: GeometryRepairResult[]): string;
//# sourceMappingURL=geometry_repair.d.ts.map