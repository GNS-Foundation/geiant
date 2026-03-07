// =============================================================================
// GEIANT — GEOMETRY VALIDATION LAYER
// Deterministic geometry guardrails — catches LLM coordinate hallucinations
// before they enter the Spatial Memory graph.
// =============================================================================
//
// Every task containing geometries passes through this layer before dispatch.
// Invalid geometries are REJECTED with a structured error and suggestion.
// The router never dispatches a task with invalid geometry.
//
// Validation checks (in order):
//   1. Coordinate range       — WGS84 bounds check
//   2. Coordinate transposition — lat/lng swap heuristic
//   3. Ring closure           — polygon rings must close
//   4. Self-intersection      — basic winding check
//   5. Empty geometry         — no zero-coordinate features
//   6. Duplicate points       — consecutive identical coordinates
// =============================================================================
// ---------------------------------------------------------------------------
// Main validation entry point
// ---------------------------------------------------------------------------
/**
 * Validate an array of spatial features.
 * Returns on first invalid feature (fail-fast).
 */
export function validateGeometries(features) {
    for (let i = 0; i < features.length; i++) {
        const result = validateFeature(features[i], i);
        if (!result.valid)
            return result;
    }
    return { valid: true };
}
export function validateFeature(feature, index = 0) {
    if (!feature.geometry) {
        return {
            valid: false,
            featureIndex: index,
            errorType: 'empty_geometry',
            errorMessage: 'Feature has no geometry',
        };
    }
    return validateGeometry(feature.geometry, index);
}
export function validateGeometry(geom, featureIndex = 0) {
    switch (geom.type) {
        case 'Point':
            return validatePoint(geom.coordinates, featureIndex);
        case 'LineString':
            return validateLineString(geom.coordinates, featureIndex);
        case 'Polygon':
            return validatePolygon(geom.coordinates, featureIndex);
        case 'MultiPolygon':
            for (const poly of geom.coordinates) {
                const r = validatePolygon(poly, featureIndex);
                if (!r.valid)
                    return r;
            }
            return { valid: true };
        case 'MultiPoint':
            for (const pt of geom.coordinates) {
                const r = validatePoint(pt, featureIndex);
                if (!r.valid)
                    return r;
            }
            return { valid: true };
        default:
            return { valid: true };
    }
}
// ---------------------------------------------------------------------------
// Coordinate validation
// ---------------------------------------------------------------------------
function validatePoint(coord, featureIndex) {
    const [x, y] = coord;
    if (!isFinite(x) || !isFinite(y)) {
        return {
            valid: false, featureIndex,
            errorType: 'invalid_coordinate',
            errorMessage: `Non-finite coordinate: [${x}, ${y}]`,
            suggestion: 'Coordinates must be finite numbers (no NaN, Infinity)',
        };
    }
    // WGS84 bounds: lng -180..180, lat -90..90
    if (x < -180 || x > 180 || y < -90 || y > 90) {
        // Check for likely lat/lng transposition:
        // If y is a valid latitude (-90..90) but x is out of lng range,
        // the values were likely swapped (lat placed in lng slot).
        if (y >= -90 && y <= 90) {
            return {
                valid: false, featureIndex,
                errorType: 'coordinate_transposed',
                errorMessage: `Coordinates appear transposed: [${x}, ${y}]. GeoJSON expects [longitude, latitude].`,
                suggestion: `Try swapping to [${y}, ${x}]`,
            };
        }
        return {
            valid: false, featureIndex,
            errorType: 'invalid_coordinate',
            errorMessage: `Coordinate out of WGS84 range: [${x}, ${y}]`,
            suggestion: 'GeoJSON coordinates are [longitude, latitude] in WGS84. Longitude: -180 to 180, Latitude: -90 to 90',
        };
    }
    return { valid: true };
}
function validateLineString(coords, featureIndex) {
    if (coords.length < 2) {
        return {
            valid: false, featureIndex,
            errorType: 'empty_geometry',
            errorMessage: 'LineString must have at least 2 coordinates',
        };
    }
    for (const coord of coords) {
        const r = validatePoint(coord, featureIndex);
        if (!r.valid)
            return r;
    }
    if (hasDuplicateConsecutivePoints(coords)) {
        return {
            valid: false, featureIndex,
            errorType: 'duplicate_points',
            errorMessage: 'LineString contains consecutive duplicate coordinates',
            suggestion: 'Remove consecutive duplicate points',
        };
    }
    return { valid: true };
}
function validatePolygon(rings, featureIndex) {
    if (rings.length === 0) {
        return {
            valid: false, featureIndex,
            errorType: 'empty_geometry',
            errorMessage: 'Polygon has no rings',
        };
    }
    for (const ring of rings) {
        // Each ring needs at least 4 points (closed)
        if (ring.length < 4) {
            return {
                valid: false, featureIndex,
                errorType: 'unclosed_ring',
                errorMessage: `Polygon ring has only ${ring.length} points (minimum 4 for a closed ring)`,
                suggestion: 'A polygon ring needs at least 4 coordinates, with first = last to close the ring',
            };
        }
        // Validate each coordinate
        for (const coord of ring) {
            const r = validatePoint(coord, featureIndex);
            if (!r.valid)
                return r;
        }
        // Check ring closure
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            return {
                valid: false, featureIndex,
                errorType: 'unclosed_ring',
                errorMessage: `Polygon ring is not closed. First: [${first}], Last: [${last}]`,
                suggestion: `Add [${first[0]}, ${first[1]}] as the last coordinate to close the ring`,
            };
        }
        // Self-intersection check (simplified — convex hull heuristic)
        const selfIntersect = detectSelfIntersection(ring);
        if (selfIntersect) {
            return {
                valid: false, featureIndex,
                errorType: 'self_intersection',
                errorMessage: 'Polygon ring appears to self-intersect',
                suggestion: 'Ensure polygon edges do not cross each other. Consider splitting into simpler polygons.',
            };
        }
        if (hasDuplicateConsecutivePoints(ring)) {
            return {
                valid: false, featureIndex,
                errorType: 'duplicate_points',
                errorMessage: 'Polygon ring contains consecutive duplicate coordinates',
                suggestion: 'Remove consecutive duplicate points',
            };
        }
    }
    return { valid: true };
}
// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function hasDuplicateConsecutivePoints(coords) {
    for (let i = 0; i < coords.length - 1; i++) {
        if (coords[i][0] === coords[i + 1][0] && coords[i][1] === coords[i + 1][1]) {
            return true;
        }
    }
    return false;
}
/**
 * Simplified self-intersection detection using segment crossing test.
 * For production, replace with a GEOS binding or Turf.js kinkFinder.
 *
 * Tests all non-adjacent edge pairs in the ring.
 */
function detectSelfIntersection(ring) {
    const n = ring.length - 1; // last == first, ignore last
    for (let i = 0; i < n - 1; i++) {
        for (let j = i + 2; j < n; j++) {
            // Skip adjacent edges
            if (i === 0 && j === n - 1)
                continue;
            if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
                return true;
            }
        }
    }
    return false;
}
/** 2D segment intersection test (CCW-based) */
function segmentsIntersect(p1, p2, p3, p4) {
    const ccw = (A, B, C) => (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
    return (ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
        ccw(p1, p2, p3) !== ccw(p1, p2, p4));
}
// ---------------------------------------------------------------------------
// Exported utilities
// ---------------------------------------------------------------------------
/** Quick check — does this look like coordinates were swapped? */
export function looksTransposed(lng, lat) {
    // If passed value is plausible as lat but not as lng, likely swapped
    return (lng > 90 || lng < -90) && lat >= -90 && lat <= 90;
}
/** Format a ValidationResult as a structured error message for agent feedback */
export function formatValidationError(result) {
    if (result.valid)
        return 'Geometry is valid.';
    return [
        `[GEIANT GeometryGuard] Validation failed.`,
        `Error type: ${result.errorType}`,
        `Detail: ${result.errorMessage}`,
        result.suggestion ? `Suggestion: ${result.suggestion}` : '',
    ]
        .filter(Boolean)
        .join('\n');
}
//# sourceMappingURL=geometry.js.map