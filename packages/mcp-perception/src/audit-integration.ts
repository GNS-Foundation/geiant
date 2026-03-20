// ===========================================
// GEIANT Phase 5.1.1 — Integration Example
// How to wire AuditEngine into mcp-perception tools
// Location: packages/mcp-perception/src/audit-integration.ts
// ===========================================
//
// This file shows how to wrap the four Phase 4 perception
// tools with the audit middleware. Each tool call will:
//
//   1. Pre-flight: check jurisdiction, facet, tool whitelist
//   2. Execute: run the actual tool handler
//   3. Post-flight: drop a signed virtual breadcrumb to Supabase
//
// The existing tool handlers remain UNCHANGED — the middleware
// wraps them transparently.
//
// ===========================================

import { AuditEngine, createAuditEngine } from '@geiant/mcp-audit/middleware.js';

// --- Existing tool handlers (unchanged from Phase 4) ---
// These are your current exports from mcp-perception/src/index.ts
import {
  handleFetchTile,
  handleClassifyTile,
  handleEmbedTile,
  handleGetWeather,
} from './tools.js';  // adjust import path to match your actual structure

// ===========================================
// 1. Create the audit engine (once at startup)
// ===========================================

const audit = createAuditEngine({
  // These come from env vars in production:
  // GEIANT_SUPABASE_URL, GEIANT_SUPABASE_SERVICE_KEY,
  // GEIANT_AGENT_SK, GEIANT_DELEGATION_CERT
});

// ===========================================
// 2. Wrap each tool handler
// ===========================================

// fetch_tile — location derived dynamically from input H3 cell
export const auditedFetchTile = audit.wrapTool(
  'fetch_tile',
  handleFetchTile,
  {
    locationCell: (input: any) => input.h3_cell ?? '851e8053fffffff',
  },
);

// classify_tile — uses RunPod GPU, include model metadata
export const auditedClassifyTile = audit.wrapTool(
  'classify_tile',
  handleClassifyTile,
  {
    locationCell: (input: any) => input.h3_cell ?? '851e8053fffffff',
    modelId: 'prithvi-eo-2.0',
    runpodEndpoint: 'o7emejiwlumgj6',
  },
);

// embed_tile — Clay v1.5 embeddings
export const auditedEmbedTile = audit.wrapTool(
  'embed_tile',
  handleEmbedTile,
  {
    locationCell: (input: any) => input.h3_cell ?? '851e8053fffffff',
    modelId: 'clay-v1.5',
    runpodEndpoint: 'o7emejiwlumgj6',
  },
);

// get_weather — Open-Meteo ERA5, no GPU
export const auditedGetWeather = audit.wrapTool(
  'get_weather',
  handleGetWeather,
  {
    locationCell: (input: any) => input.h3_cell ?? '851e8053fffffff',
  },
);

// ===========================================
// 3. Register in MCP server (replace originals)
// ===========================================
//
// In your MCP server setup, replace the handler references:
//
//   BEFORE:
//     server.tool('fetch_tile', schema, handleFetchTile);
//     server.tool('classify_tile', schema, handleClassifyTile);
//     server.tool('embed_tile', schema, handleEmbedTile);
//     server.tool('get_weather', schema, handleGetWeather);
//
//   AFTER:
//     server.tool('fetch_tile', schema, auditedFetchTile);
//     server.tool('classify_tile', schema, auditedClassifyTile);
//     server.tool('embed_tile', schema, auditedEmbedTile);
//     server.tool('get_weather', schema, auditedGetWeather);
//
// That's it. Zero changes to the tool logic. The audit
// middleware handles signing, chaining, and persistence.

// ===========================================
// 4. Environment variables needed in Railway
// ===========================================
//
// GEIANT_SUPABASE_URL=https://kaqwkxfaclyqjlfhxrmt.supabase.co
// GEIANT_SUPABASE_SERVICE_KEY=<service_role_key>
// GEIANT_AGENT_SK=<128-hex Ed25519 secret key>
// GEIANT_DELEGATION_CERT=<JSON string of DelegationCertificate>
// GEIANT_DEFAULT_FACET=energy@italy-geiant
// GEIANT_DEFAULT_H3_CELL=851e8053fffffff
// GEIANT_DEFAULT_H3_RES=5
//
// To generate agent keypair (one-time):
//
//   import nacl from 'tweetnacl';
//   const kp = nacl.sign.keyPair();
//   console.log('SK:', Buffer.from(kp.secretKey).toString('hex'));
//   console.log('PK:', Buffer.from(kp.publicKey).toString('hex'));
//
// The PK becomes the agent's GNS identity + Stellar address.
// The SK goes into GEIANT_AGENT_SK (never leaves the server).

// ===========================================
// 5. What happens on each tool call
// ===========================================
//
// Example: classify_tile({ h3_cell: '851e8053fffffff', band: 'B04' })
//
// PREFLIGHT:
//   ✓ Cert active? yes (2026-01-01 to 2027-01-01)
//   ✓ Cell 851e8053fffffff in delegation? yes
//   ✓ Facet energy@italy-geiant in delegation? yes
//   ✓ Tool classify_tile in whitelist? yes
//
// EXECUTE:
//   → RunPod /run endpoint, Prithvi-EO-2.0, 1200ms
//   ← { classification: 'no_flood', confidence: 0.95 }
//
// BREADCRUMB:
//   Block #47 {
//     identity: "a1b2c3d4...",
//     timestamp: "2026-03-20T14:30:00Z",
//     location_cell: "851e8053fffffff",
//     context_digest: SHA-256(input+output),
//     previous_hash: Block#46.block_hash,
//     delegation_cert_hash: "e5f6a7b8...",
//     tool_name: "classify_tile",
//     facet: "energy@italy-geiant",
//     meta_flags: {
//       tool_duration_ms: 1200,
//       tier: "provisioned",
//       model_id: "prithvi-eo-2.0",
//       runpod_endpoint: "o7emejiwlumgj6"
//     },
//     signature: Ed25519(agent_sk, dataToSign),
//     block_hash: SHA-256(dataToSign + signature)
//   }
//   → Written to Supabase agent_breadcrumbs
//   → Trigger auto-updates agent_registry.breadcrumb_count
//   → Tier auto-promotes when thresholds crossed
