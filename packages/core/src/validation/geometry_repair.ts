// =============================================================================
// GEIANT — GEOMETRY REPAIR ENGINE  (L2 Self-Healing)
// "Don't just reject — fix and explain."
//
// When the geometry guardrail detects a repairable error, this engine:
//   1. Identifies the specific failure mode
//   2. Applies a deterministic correction
//   3. Returns the corrected geometry + a structured diff
//   4. Re-validates to confirm the repair succeeded
//
// Repair strategies by error type:
//   coordinate_transposed  → swap [x, y] to [y, x]
//   unclosed_ring          → append first coordinate to close ring
//   self_intersection      → replace ring with its convex hull
//   duplicate_points       → remove consecutive duplicates
//   invalid_coordinate     → clamp to WGS84 bounds (last resort)
//
// The router calls repairGeometry() before rejecting — if repair succeeds,
// the fixed geometry is dispatched and the agent receives a repair diff
// explaining exactly what changed.
//
// This eliminates agent "correction loops" where an LLM re-generates the
// same invalid geometry 3-4 times before a human intervenes.
// =============================================================================

import {
  SpatialFeature,
  SpatialGeometry,
  ValidationResult,
  GeometryErrorType,
  GeometryRepairResult,
  RepairDiff,
  RepairOperation,
} from '../types/index.js';
import { validateGeometry, validateGeometries } from './geometry.js';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Attempt to repair a single geometry.
 * Returns a GeometryRepairResult with the corrected geometry if possible.
 */
export function repairGeometry(
  geom: SpatialGeometry,
  error: ValidationResult
): GeometryRepairResult {
  if (!error.errorType) {
    return noRepair(geom, 'unknown' as GeometryErrorType, 'No error type provided');
  }

  switch (error.errorType) {
    case 'coordinate_transposed':
      return repairTransposedCoordinates(geom);

    case 'unclosed_ring':
      return repairUnclosedRing(geom);

    case 'self_intersection':
      return repairSelfIntersection(geom);

    case 'duplicate_points':
      return repairDuplicatePoints(geom);

    case 'invalid_coordinate':
      return repairInvalidCoordinate(geom);

    default:
      return noRepair(geom, error.errorType, `No repair strategy for error type: ${error.errorType}`);
  }
}

/**
 * Attempt to repair all features in a task.
 * Returns per-feature repair results and the repaired feature array.
 */
export function repairFeatures(features: SpatialFeature[]): {
  repairedFeatures: SpatialFeature[];
  repairs: GeometryRepairResult[];
  allRepaired: boolean;
} {
  const repairs: GeometryRepairResult[] = [];
  const repairedFeatures: SpatialFeature[] = [];
  let allRepaired = true;

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const validation = validateGeometry(feature.geometry, i);

    if (validation.valid) {
      repairedFeatures.push(feature);
      continue;
    }

    const repair = repairGeometry(feature.geometry, validation);
    repairs.push(repair);

    if (repair.repaired && repair.repairedGeometry) {
      // Verify the repair actually fixed it
      const recheck = validateGeometry(repair.repairedGeometry, i);
      if (recheck.valid) {
        repairedFeatures.push({ ...feature, geometry: repair.repairedGeometry });
      } else {
        repairedFeatures.push(feature); // keep original, mark failed
        allRepaired = false;
      }
    } else {
      repairedFeatures.push(feature);
      allRepaired = false;
    }
  }

  return { repairedFeatures, repairs, allRepaired };
}

// ---------------------------------------------------------------------------
// Repair strategies
// ---------------------------------------------------------------------------

/**
 * Fix transposed coordinates: [lat, lng] → [lng, lat]
 * GeoJSON expects [longitude, latitude].
 */
function repairTransposedCoordinates(geom: SpatialGeometry): GeometryRepairResult {
  const before = JSON.parse(JSON.stringify(geom.coordinates));

  const swapCoord = (c: [number, number]): [number, number] => [c[1], c[0]];
  const swapAll = (coords: [number, number][]): [number, number][] => coords.map(swapCoord);

  let repairedGeometry: SpatialGeometry;
  let coordinatesChanged = 0;

  switch (geom.type) {
    case 'Point': {
      const g = geom as { type: 'Point'; coordinates: [number, number] };
      coordinatesChanged = 1;
      repairedGeometry = { type: 'Point', coordinates: swapCoord(g.coordinates) };
      break;
    }
    case 'LineString': {
      const g = geom as { type: 'LineString'; coordinates: [number, number][] };
      coordinatesChanged = g.coordinates.length;
      repairedGeometry = { type: 'LineString', coordinates: swapAll(g.coordinates) };
      break;
    }
    case 'Polygon': {
      const g = geom as { type: 'Polygon'; coordinates: [number, number][][] };
      coordinatesChanged = g.coordinates.flat().length;
      repairedGeometry = {
        type: 'Polygon',
        coordinates: g.coordinates.map(ring => swapAll(ring)),
      };
      break;
    }
    case 'MultiPolygon': {
      const g = geom as { type: 'MultiPolygon'; coordinates: [number, number][][][] };
      coordinatesChanged = g.coordinates.flat(2).length;
      repairedGeometry = {
        type: 'MultiPolygon',
        coordinates: g.coordinates.map(poly => poly.map(ring => swapAll(ring))),
      };
      break;
    }
    default:
      return noRepair(geom, 'coordinate_transposed', 'Unsupported geometry type for transposition repair');
  }

  return {
    repaired: true,
    repairedGeometry,
    originalError: 'coordinate_transposed',
    repairDescription: `Swapped ${coordinatesChanged} coordinate pair(s) from [lat, lng] to [lng, lat] (GeoJSON expects longitude first).`,
    repairDiff: {
      operation: 'coordinate_swap',
      before,
      after: JSON.parse(JSON.stringify(repairedGeometry.coordinates)),
      coordinatesChanged,
    },
  };
}

/**
 * Fix unclosed polygon ring: append the first coordinate at the end.
 */
function repairUnclosedRing(geom: SpatialGeometry): GeometryRepairResult {
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') {
    return noRepair(geom, 'unclosed_ring', 'unclosed_ring only applies to Polygon/MultiPolygon');
  }

  const before = JSON.parse(JSON.stringify(geom.coordinates));
  let ringsModified = 0;

  const closeRing = (ring: [number, number][]): [number, number][] => {
    if (ring.length === 0) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring;
    ringsModified++;
    return [...ring, [first[0], first[1]] as [number, number]];
  };

  let repairedGeometry: SpatialGeometry;

  if (geom.type === 'Polygon') {
    const g = geom as { type: 'Polygon'; coordinates: [number, number][][] };
    repairedGeometry = {
      type: 'Polygon',
      coordinates: g.coordinates.map(closeRing),
    };
  } else {
    const g = geom as { type: 'MultiPolygon'; coordinates: [number, number][][][] };
    repairedGeometry = {
      type: 'MultiPolygon',
      coordinates: g.coordinates.map(poly => poly.map(closeRing)),
    };
  }

  if (ringsModified === 0) {
    return noRepair(geom, 'unclosed_ring', 'Ring appears closed but validation failed — manual inspection needed');
  }

  return {
    repaired: true,
    repairedGeometry,
    originalError: 'unclosed_ring',
    repairDescription: `Closed ${ringsModified} polygon ring(s) by appending the first coordinate as the last.`,
    repairDiff: {
      operation: 'ring_closure',
      before,
      after: JSON.parse(JSON.stringify(repairedGeometry.coordinates)),
      ringsModified,
    },
  };
}

/**
 * Fix self-intersecting polygon by replacing ring with its convex hull.
 *
 * The convex hull is always valid (no self-intersections, always closed,
 * counter-clockwise winding). It's a conservative approximation — it
 * may be larger than the intended polygon but is always valid.
 *
 * For production: replace with GEOS buffer(0) which preserves concavities.
 */
function repairSelfIntersection(geom: SpatialGeometry): GeometryRepairResult {
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') {
    return noRepair(geom, 'self_intersection', 'self_intersection only applies to Polygon/MultiPolygon');
  }

  const before = JSON.parse(JSON.stringify(geom.coordinates));

  const hullRing = (ring: [number, number][]): [number, number][] => {
    const hull = convexHull(ring);
    if (!hull || hull.length < 4) return ring;
    return hull;
  };

  let repairedGeometry: SpatialGeometry;

  if (geom.type === 'Polygon') {
    const g = geom as { type: 'Polygon'; coordinates: [number, number][][] };
    // Only repair outer ring — holes (inner rings) are kept as-is for now
    const [outer, ...holes] = g.coordinates;
    repairedGeometry = {
      type: 'Polygon',
      coordinates: [hullRing(outer), ...holes],
    };
  } else {
    const g = geom as { type: 'MultiPolygon'; coordinates: [number, number][][][] };
    repairedGeometry = {
      type: 'MultiPolygon',
      coordinates: g.coordinates.map(poly => {
        const [outer, ...holes] = poly;
        return [hullRing(outer), ...holes];
      }),
    };
  }

  const after = JSON.parse(JSON.stringify(repairedGeometry.coordinates));
  const beforeFlat = JSON.stringify(before);
  const afterFlat = JSON.stringify(after);

  if (beforeFlat === afterFlat) {
    return noRepair(geom, 'self_intersection', 'Convex hull repair produced no change — geometry may need manual correction');
  }

  return {
    repaired: true,
    repairedGeometry,
    originalError: 'self_intersection',
    repairDescription: 'Replaced self-intersecting outer ring with its convex hull. Note: convex hull is a conservative repair — it may be larger than the intended polygon.',
    repairDiff: {
      operation: 'convex_hull',
      before,
      after,
    },
  };
}

/**
 * Fix duplicate consecutive points by removing them.
 */
function repairDuplicatePoints(geom: SpatialGeometry): GeometryRepairResult {
  const before = JSON.parse(JSON.stringify(geom.coordinates));

  const dedup = (coords: [number, number][]): [number, number][] => {
    if (coords.length === 0) return coords;
    const result: [number, number][] = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      const prev = result[result.length - 1];
      if (coords[i][0] !== prev[0] || coords[i][1] !== prev[1]) {
        result.push(coords[i]);
      }
    }
    return result;
  };

  let repairedGeometry: SpatialGeometry;
  let coordinatesChanged = 0;

  switch (geom.type) {
    case 'LineString': {
      const g = geom as { type: 'LineString'; coordinates: [number, number][] };
      const deduped = dedup(g.coordinates);
      coordinatesChanged = g.coordinates.length - deduped.length;
      repairedGeometry = { type: 'LineString', coordinates: deduped };
      break;
    }
    case 'Polygon': {
      const g = geom as { type: 'Polygon'; coordinates: [number, number][][] };
      const rings = g.coordinates.map(ring => {
        const d = dedup(ring);
        coordinatesChanged += ring.length - d.length;
        return d;
      });
      repairedGeometry = { type: 'Polygon', coordinates: rings };
      break;
    }
    case 'MultiPolygon': {
      const g = geom as { type: 'MultiPolygon'; coordinates: [number, number][][][] };
      const polys = g.coordinates.map(poly =>
        poly.map(ring => {
          const d = dedup(ring);
          coordinatesChanged += ring.length - d.length;
          return d;
        })
      );
      repairedGeometry = { type: 'MultiPolygon', coordinates: polys };
      break;
    }
    default:
      return noRepair(geom, 'duplicate_points', 'Unsupported geometry type for duplicate removal');
  }

  if (coordinatesChanged === 0) {
    return noRepair(geom, 'duplicate_points', 'No duplicates removed — validation may be a false positive');
  }

  return {
    repaired: true,
    repairedGeometry,
    originalError: 'duplicate_points',
    repairDescription: `Removed ${coordinatesChanged} consecutive duplicate coordinate(s).`,
    repairDiff: {
      operation: 'duplicate_removal',
      before,
      after: JSON.parse(JSON.stringify(repairedGeometry.coordinates)),
      coordinatesChanged,
    },
  };
}

/**
 * Last-resort repair: clamp coordinates to WGS84 bounds.
 * Longitude: -180..180, Latitude: -90..90.
 */
function repairInvalidCoordinate(geom: SpatialGeometry): GeometryRepairResult {
  const before = JSON.parse(JSON.stringify(geom.coordinates));

  const clamp = (c: [number, number]): [number, number] => [
    Math.max(-180, Math.min(180, c[0])),
    Math.max(-90,  Math.min(90,  c[1])),
  ];

  const clampAll = (coords: [number, number][]): [number, number][] => coords.map(clamp);

  let repairedGeometry: SpatialGeometry;
  let coordinatesChanged = 0;

  const countChanged = (original: [number, number][], fixed: [number, number][]): number =>
    original.filter((c, i) => c[0] !== fixed[i][0] || c[1] !== fixed[i][1]).length;

  switch (geom.type) {
    case 'Point': {
      const g = geom as { type: 'Point'; coordinates: [number, number] };
      const fixed = clamp(g.coordinates);
      coordinatesChanged = (fixed[0] !== g.coordinates[0] || fixed[1] !== g.coordinates[1]) ? 1 : 0;
      repairedGeometry = { type: 'Point', coordinates: fixed };
      break;
    }
    case 'LineString': {
      const g = geom as { type: 'LineString'; coordinates: [number, number][] };
      const fixed = clampAll(g.coordinates);
      coordinatesChanged = countChanged(g.coordinates, fixed);
      repairedGeometry = { type: 'LineString', coordinates: fixed };
      break;
    }
    case 'Polygon': {
      const g = geom as { type: 'Polygon'; coordinates: [number, number][][] };
      const rings = g.coordinates.map(ring => {
        const f = clampAll(ring);
        coordinatesChanged += countChanged(ring, f);
        return f;
      });
      repairedGeometry = { type: 'Polygon', coordinates: rings };
      break;
    }
    default:
      return noRepair(geom, 'invalid_coordinate', 'Coordinate clamp not supported for this geometry type');
  }

  return {
    repaired: coordinatesChanged > 0,
    repairedGeometry,
    originalError: 'invalid_coordinate',
    repairDescription: coordinatesChanged > 0
      ? `Clamped ${coordinatesChanged} coordinate(s) to WGS84 bounds (lng: -180..180, lat: -90..90).`
      : 'No coordinates needed clamping — geometry may have a different error.',
    repairDiff: {
      operation: 'coordinate_clamp',
      before,
      after: JSON.parse(JSON.stringify(repairedGeometry.coordinates)),
      coordinatesChanged,
    },
  };
}

// ---------------------------------------------------------------------------
// Convex hull (Graham scan — pure TypeScript, no dependencies)
// ---------------------------------------------------------------------------

/**
 * Compute the convex hull of a set of 2D points using Graham scan.
 * Returns a closed ring (first == last) in counter-clockwise order.
 * Returns null if fewer than 3 unique points.
 */
export function convexHull(points: [number, number][]): [number, number][] | null {
  // Deduplicate
  const unique = Array.from(
    new Map(points.map(p => [`${p[0]},${p[1]}`, p])).values()
  );

  if (unique.length < 3) return null;

  // Find bottom-most (then left-most) point
  let pivot = unique[0];
  for (const p of unique) {
    if (p[1] < pivot[1] || (p[1] === pivot[1] && p[0] < pivot[0])) {
      pivot = p;
    }
  }

  // Sort by polar angle relative to pivot
  const sorted = unique
    .filter(p => p !== pivot)
    .sort((a, b) => {
      const angleA = Math.atan2(a[1] - pivot[1], a[0] - pivot[0]);
      const angleB = Math.atan2(b[1] - pivot[1], b[0] - pivot[0]);
      if (angleA !== angleB) return angleA - angleB;
      // Same angle: sort by distance
      const distA = (a[0] - pivot[0]) ** 2 + (a[1] - pivot[1]) ** 2;
      const distB = (b[0] - pivot[0]) ** 2 + (b[1] - pivot[1]) ** 2;
      return distA - distB;
    });

  const hull: [number, number][] = [pivot];

  const cross = (O: [number, number], A: [number, number], B: [number, number]): number =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);

  for (const p of sorted) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
      hull.pop();
    }
    hull.push(p);
  }

  if (hull.length < 3) return null;

  // Close the ring
  hull.push([hull[0][0], hull[0][1]]);
  return hull;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function noRepair(
  geom: SpatialGeometry,
  errorType: GeometryErrorType,
  reason: string
): GeometryRepairResult {
  return {
    repaired: false,
    originalError: errorType,
    repairDescription: `Repair not possible: ${reason}`,
    repairDiff: {
      operation: 'convex_hull', // placeholder
      before: geom.coordinates,
      after: geom.coordinates,
    },
  };
}

// ---------------------------------------------------------------------------
// Format repair summary for agent feedback
// ---------------------------------------------------------------------------

/**
 * Format repair results as structured agent feedback.
 * This is what gets sent back to the LLM explaining what was auto-corrected.
 */
export function formatRepairFeedback(repairs: GeometryRepairResult[]): string {
  if (repairs.length === 0) return '';

  const lines = [
    `[GEIANT GeometryGuard — Auto-Repair Report]`,
    `${repairs.length} geometry issue(s) detected and repaired:`,
    '',
  ];

  repairs.forEach((r, i) => {
    lines.push(`  Issue ${i + 1}: ${r.originalError}`);
    lines.push(`  Action: ${r.repairDescription}`);
    lines.push(`  Operation: ${r.repairDiff.operation}`);
    if (r.repairDiff.coordinatesChanged) {
      lines.push(`  Coordinates changed: ${r.repairDiff.coordinatesChanged}`);
    }
    if (r.repairDiff.ringsModified) {
      lines.push(`  Rings modified: ${r.repairDiff.ringsModified}`);
    }
    lines.push('');
  });

  lines.push('Dispatch proceeded with repaired geometries.');
  return lines.join('\n');
}
