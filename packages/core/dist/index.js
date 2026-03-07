// =============================================================================
// @geiant/core — Public API
// =============================================================================
// Types — re-export everything
export * from './types/index.js';
// Agent identity
export { computeTier, tierSatisfies, isInTerritory, cellsFromRadius, buildHandle, parseHandle, derivestellarAccountId, validateManifestStructure, scoreAntFitness, } from './agent/identity.js';
// Geometry validation
export { validateGeometries, validateFeature, validateGeometry, looksTransposed, formatValidationError, } from './validation/geometry.js';
// Delegation
export { validateDelegation, createSubDelegation, hashCert, } from './validation/delegation.js';
// Router
export { GeiantRouter } from './router/router.js';
// Jurisdiction
export { resolveJurisdiction, isOperationPermitted, } from './router/jurisdiction.js';
// Registry
export { InMemoryRegistry, getRegistry, setRegistry, seedDevRegistry, } from './registry/registry.js';
// Spatial Memory
export { SpatialMemoryGraph, GeometryValidationError, getSpatialMemory, resetSpatialMemory, } from './memory/spatial_memory.js';
// Ed25519 Crypto
export { generateKeypair, keypairFromSeed, publicKeyFromPrivate, signMessage, signHash, verifyMessage, verifyHash, signDelegationCert, verifyDelegationCert, isValidPublicKey, isValidSignature, isStubSignature, canonicalMessage, } from './crypto/ed25519.js';
// Supabase Registry
export { SupabaseRegistry, createSupabaseRegistry } from './registry/supabase_registry.js';
// MCP Switchboard
export { McpSwitchboard, createSwitchboard } from './mcp/switchboard.js';
//# sourceMappingURL=index.js.map