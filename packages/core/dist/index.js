"use strict";
// =============================================================================
// @geiant/core — Public API
// =============================================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSwitchboard = exports.McpSwitchboard = exports.createSupabaseRegistry = exports.SupabaseRegistry = exports.canonicalMessage = exports.isStubSignature = exports.isValidSignature = exports.isValidPublicKey = exports.verifyDelegationCert = exports.signDelegationCert = exports.verifyHash = exports.verifyMessage = exports.signHash = exports.signMessage = exports.publicKeyFromPrivate = exports.keypairFromSeed = exports.generateKeypair = exports.resetSpatialMemory = exports.getSpatialMemory = exports.GeometryValidationError = exports.SpatialMemoryGraph = exports.seedDevRegistry = exports.setRegistry = exports.getRegistry = exports.InMemoryRegistry = exports.isOperationPermitted = exports.resolveJurisdiction = exports.GeiantRouter = exports.hashCert = exports.createSubDelegation = exports.validateDelegation = exports.formatValidationError = exports.looksTransposed = exports.validateGeometry = exports.validateFeature = exports.validateGeometries = exports.scoreAntFitness = exports.validateManifestStructure = exports.derivestellarAccountId = exports.parseHandle = exports.buildHandle = exports.cellsFromRadius = exports.isInTerritory = exports.tierSatisfies = exports.computeTier = void 0;
// Types — re-export everything
__exportStar(require("./types/index.js"), exports);
// Agent identity
var identity_js_1 = require("./agent/identity.js");
Object.defineProperty(exports, "computeTier", { enumerable: true, get: function () { return identity_js_1.computeTier; } });
Object.defineProperty(exports, "tierSatisfies", { enumerable: true, get: function () { return identity_js_1.tierSatisfies; } });
Object.defineProperty(exports, "isInTerritory", { enumerable: true, get: function () { return identity_js_1.isInTerritory; } });
Object.defineProperty(exports, "cellsFromRadius", { enumerable: true, get: function () { return identity_js_1.cellsFromRadius; } });
Object.defineProperty(exports, "buildHandle", { enumerable: true, get: function () { return identity_js_1.buildHandle; } });
Object.defineProperty(exports, "parseHandle", { enumerable: true, get: function () { return identity_js_1.parseHandle; } });
Object.defineProperty(exports, "derivestellarAccountId", { enumerable: true, get: function () { return identity_js_1.derivestellarAccountId; } });
Object.defineProperty(exports, "validateManifestStructure", { enumerable: true, get: function () { return identity_js_1.validateManifestStructure; } });
Object.defineProperty(exports, "scoreAntFitness", { enumerable: true, get: function () { return identity_js_1.scoreAntFitness; } });
// Geometry validation
var geometry_js_1 = require("./validation/geometry.js");
Object.defineProperty(exports, "validateGeometries", { enumerable: true, get: function () { return geometry_js_1.validateGeometries; } });
Object.defineProperty(exports, "validateFeature", { enumerable: true, get: function () { return geometry_js_1.validateFeature; } });
Object.defineProperty(exports, "validateGeometry", { enumerable: true, get: function () { return geometry_js_1.validateGeometry; } });
Object.defineProperty(exports, "looksTransposed", { enumerable: true, get: function () { return geometry_js_1.looksTransposed; } });
Object.defineProperty(exports, "formatValidationError", { enumerable: true, get: function () { return geometry_js_1.formatValidationError; } });
// Delegation
var delegation_js_1 = require("./validation/delegation.js");
Object.defineProperty(exports, "validateDelegation", { enumerable: true, get: function () { return delegation_js_1.validateDelegation; } });
Object.defineProperty(exports, "createSubDelegation", { enumerable: true, get: function () { return delegation_js_1.createSubDelegation; } });
Object.defineProperty(exports, "hashCert", { enumerable: true, get: function () { return delegation_js_1.hashCert; } });
// Router
var router_js_1 = require("./router/router.js");
Object.defineProperty(exports, "GeiantRouter", { enumerable: true, get: function () { return router_js_1.GeiantRouter; } });
// Jurisdiction
var jurisdiction_js_1 = require("./router/jurisdiction.js");
Object.defineProperty(exports, "resolveJurisdiction", { enumerable: true, get: function () { return jurisdiction_js_1.resolveJurisdiction; } });
Object.defineProperty(exports, "isOperationPermitted", { enumerable: true, get: function () { return jurisdiction_js_1.isOperationPermitted; } });
// Registry
var registry_js_1 = require("./registry/registry.js");
Object.defineProperty(exports, "InMemoryRegistry", { enumerable: true, get: function () { return registry_js_1.InMemoryRegistry; } });
Object.defineProperty(exports, "getRegistry", { enumerable: true, get: function () { return registry_js_1.getRegistry; } });
Object.defineProperty(exports, "setRegistry", { enumerable: true, get: function () { return registry_js_1.setRegistry; } });
Object.defineProperty(exports, "seedDevRegistry", { enumerable: true, get: function () { return registry_js_1.seedDevRegistry; } });
// Spatial Memory
var spatial_memory_1 = require("./memory/spatial_memory");
Object.defineProperty(exports, "SpatialMemoryGraph", { enumerable: true, get: function () { return spatial_memory_1.SpatialMemoryGraph; } });
Object.defineProperty(exports, "GeometryValidationError", { enumerable: true, get: function () { return spatial_memory_1.GeometryValidationError; } });
Object.defineProperty(exports, "getSpatialMemory", { enumerable: true, get: function () { return spatial_memory_1.getSpatialMemory; } });
Object.defineProperty(exports, "resetSpatialMemory", { enumerable: true, get: function () { return spatial_memory_1.resetSpatialMemory; } });
// Ed25519 Crypto
var ed25519_1 = require("./crypto/ed25519");
Object.defineProperty(exports, "generateKeypair", { enumerable: true, get: function () { return ed25519_1.generateKeypair; } });
Object.defineProperty(exports, "keypairFromSeed", { enumerable: true, get: function () { return ed25519_1.keypairFromSeed; } });
Object.defineProperty(exports, "publicKeyFromPrivate", { enumerable: true, get: function () { return ed25519_1.publicKeyFromPrivate; } });
Object.defineProperty(exports, "signMessage", { enumerable: true, get: function () { return ed25519_1.signMessage; } });
Object.defineProperty(exports, "signHash", { enumerable: true, get: function () { return ed25519_1.signHash; } });
Object.defineProperty(exports, "verifyMessage", { enumerable: true, get: function () { return ed25519_1.verifyMessage; } });
Object.defineProperty(exports, "verifyHash", { enumerable: true, get: function () { return ed25519_1.verifyHash; } });
Object.defineProperty(exports, "signDelegationCert", { enumerable: true, get: function () { return ed25519_1.signDelegationCert; } });
Object.defineProperty(exports, "verifyDelegationCert", { enumerable: true, get: function () { return ed25519_1.verifyDelegationCert; } });
Object.defineProperty(exports, "isValidPublicKey", { enumerable: true, get: function () { return ed25519_1.isValidPublicKey; } });
Object.defineProperty(exports, "isValidSignature", { enumerable: true, get: function () { return ed25519_1.isValidSignature; } });
Object.defineProperty(exports, "isStubSignature", { enumerable: true, get: function () { return ed25519_1.isStubSignature; } });
Object.defineProperty(exports, "canonicalMessage", { enumerable: true, get: function () { return ed25519_1.canonicalMessage; } });
// Supabase Registry
var supabase_registry_1 = require("./registry/supabase_registry");
Object.defineProperty(exports, "SupabaseRegistry", { enumerable: true, get: function () { return supabase_registry_1.SupabaseRegistry; } });
Object.defineProperty(exports, "createSupabaseRegistry", { enumerable: true, get: function () { return supabase_registry_1.createSupabaseRegistry; } });
// MCP Switchboard
var switchboard_1 = require("./mcp/switchboard");
Object.defineProperty(exports, "McpSwitchboard", { enumerable: true, get: function () { return switchboard_1.McpSwitchboard; } });
Object.defineProperty(exports, "createSwitchboard", { enumerable: true, get: function () { return switchboard_1.createSwitchboard; } });
//# sourceMappingURL=index.js.map