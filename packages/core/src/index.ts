// =============================================================================
// @geiant/core — Public API
// =============================================================================

// Types — re-export everything
export * from './types/index.js';

// Agent identity
export {
  computeTier,
  tierSatisfies,
  isInTerritory,
  cellsFromRadius,
  buildHandle,
  parseHandle,
  derivestellarAccountId,
  validateManifestStructure,
  scoreAntFitness,
  cgrBand,
  effectiveTrust,
  cgrCapabilityAdvisory,
} from './agent/identity.js';

// CGR — Foundation attestation verification (consumed from grafomem)
export {
  verifyCGRAttestation,
  canonCGRBody,
  getFoundationPubKey,
  CGR_ATTESTATION_SCHEMA,
  CGR_ISSUER,
  CGR_BAND_RANK,
} from './agent/cgr.js';
export type { VerifyOptions as CGRVerifyOptions, VerifyResult as CGRVerifyResult } from './agent/cgr.js';

// Geometry validation
export {
  validateGeometries,
  validateFeature,
  validateGeometry,
  looksTransposed,
  formatValidationError,
} from './validation/geometry.js';

// Delegation
export {
  validateDelegation,
  createSubDelegation,
  hashCert,
} from './validation/delegation.js';

// Router
export { GeiantRouter } from './router/router.js';

// Jurisdiction
export {
  resolveJurisdiction,
  isOperationPermitted,
} from './router/jurisdiction.js';

// Registry
export {
  InMemoryRegistry,
  getRegistry,
  setRegistry,
  seedDevRegistry,
} from './registry/registry.js';
export type { AgentRegistry } from './registry/registry.js';

// Spatial Memory
export {
  SpatialMemoryGraph,
  GeometryValidationError,
  getSpatialMemory,
  resetSpatialMemory,
} from './memory/spatial_memory.js';
export type { SpatialMemoryQuery, MutationResult, RollbackResult } from './memory/spatial_memory.js';

// Ed25519 Crypto
export {
  generateKeypair,
  keypairFromSeed,
  publicKeyFromPrivate,
  signMessage,
  signHash,
  verifyMessage,
  verifyRawMessage,
  verifyHash,
  signDelegationCert,
  verifyDelegationCert,
  isValidPublicKey,
  isValidSignature,
  isStubSignature,
  canonicalMessage,
} from './crypto/ed25519.js';
export type { Ed25519Keypair } from './crypto/ed25519.js';

// Supabase Registry
export { SupabaseRegistry, createSupabaseRegistry } from './registry/supabase_registry.js';

// MCP Switchboard
export { McpSwitchboard, createSwitchboard } from './mcp/switchboard.js';
export type { McpToolCall, SwitchboardResult, McpServerConfig } from './mcp/switchboard.js';
