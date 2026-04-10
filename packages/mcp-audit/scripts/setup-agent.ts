#!/usr/bin/env node
// ===========================================
// GEIANT Phase 5.1.1 — Agent Setup Script
// Generates Ed25519 keypair + delegation certificate
// Location: packages/mcp-audit/scripts/setup-agent.ts
//
// Usage:
//   npx tsx scripts/setup-agent.ts
//
// Or with custom principal key:
//   PRINCIPAL_SK=<128-hex> npx tsx scripts/setup-agent.ts
//
// Output: .env.agent file with all required env vars
// ===========================================

import nacl from 'tweetnacl';
import * as fs from 'fs';
import * as path from 'path';

// ---- Utilities (inline to keep script self-contained) ----

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    b[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return b;
}

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(k => `"${k}":${canonicalJson((obj as Record<string, unknown>)[k])}`);
  return '{' + pairs.join(',') + '}';
}

function sha256Hex(data: string): string {
  const encoder = new TextEncoder();
  const full = nacl.hash(encoder.encode(data));
  return bytesToHex(full.slice(0, 32));
}

// ---- Configuration ----

const ROME_H3 = '851e8053fffffff';
const DEFAULT_FACET = 'energy@italy-geiant';
const VALIDITY_DAYS = 365;

// Allowed MCP tools (Phase 4 perception + Phase 5 additions)
const ALLOWED_TOOLS = [
  'perception_fetch_tile',
  'perception_classify',
  'perception_embed',
  'perception_weather',
  'spatial_query',
  'trajectory_audit',
  'compliance_report',
  'gns_get_compliance_report',
  'gns_get_trust_score',
  'gns_verify_chain',
  'gns_roll_epoch',
];

// ---- Main ----

function main() {
  console.log('===========================================');
  console.log('GEIANT Agent Setup — Phase 5.1.1');
  console.log('===========================================\n');

  // 1. Generate or load principal keypair
  let principalKp: nacl.SignKeyPair;
  if (process.env.PRINCIPAL_SK) {
    console.log('📋 Loading principal key from PRINCIPAL_SK env var...');
    const skBytes = hexToBytes(process.env.PRINCIPAL_SK);
    principalKp = nacl.sign.keyPair.fromSecretKey(skBytes);
  } else {
    console.log('🔑 No PRINCIPAL_SK provided — generating NEW principal keypair.');
    console.log('   ⚠️  In production, use your GCRUMBS identity key instead.\n');
    principalKp = nacl.sign.keyPair();
  }

  const principalPk = bytesToHex(principalKp.publicKey);
  const principalSk = bytesToHex(principalKp.secretKey);

  console.log(`   Principal PK: ${principalPk.substring(0, 16)}...`);

  // 2. Generate agent keypair
  console.log('\n🤖 Generating agent Ed25519 keypair...');
  const agentKp = process.env.AGENT_SK
    ? nacl.sign.keyPair.fromSecretKey(hexToBytes(process.env.AGENT_SK))
    : nacl.sign.keyPair();
  const agentPk = bytesToHex(agentKp.publicKey);
  const agentSk = bytesToHex(agentKp.secretKey);

  console.log(`   Agent PK: ${agentPk.substring(0, 16)}...`);
  console.log(`   Agent SK: ${agentSk.substring(0, 16)}... (128 hex chars)`);

  // 3. Build delegation certificate
  console.log('\n📜 Building delegation certificate...');

  const now = new Date();
  const notBefore = now.toISOString();
  const notAfter = new Date(now.getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const certBody = {
    version: 1 as const,
    agent_pk: agentPk,
    principal_pk: principalPk,
    h3_cells: [ROME_H3],
    facets: [DEFAULT_FACET],
    not_before: notBefore,
    not_after: notAfter,
    max_depth: 0,
    constraints: {
      allowed_tools: ALLOWED_TOOLS,
      max_ops_per_hour: 1000,
    },
  };

  // 4. Sign the certificate with principal key
  const dataToSign = canonicalJson({
    version: certBody.version,
    agent_pk: certBody.agent_pk,
    principal_pk: certBody.principal_pk,
    h3_cells: certBody.h3_cells,
    facets: certBody.facets,
    not_before: certBody.not_before,
    not_after: certBody.not_after,
    max_depth: certBody.max_depth,
    constraints: certBody.constraints,
  });

  const encoder = new TextEncoder();
  const sigBytes = nacl.sign.detached(encoder.encode(dataToSign), principalKp.secretKey);
  const principalSignature = bytesToHex(sigBytes);

  const cert = {
    ...certBody,
    principal_signature: principalSignature,
  };

  // 5. Verify the certificate
  const verified = nacl.sign.detached.verify(
    encoder.encode(dataToSign),
    sigBytes,
    principalKp.publicKey,
  );
  console.log(`   Signature valid: ${verified ? '✅' : '❌'}`);

  const certHash = sha256Hex(dataToSign);
  console.log(`   Cert hash: ${certHash.substring(0, 16)}...`);
  console.log(`   Valid: ${notBefore} → ${notAfter}`);
  console.log(`   H3 cells: ${cert.h3_cells.join(', ')}`);
  console.log(`   Facets: ${cert.facets.join(', ')}`);
  console.log(`   Allowed tools: ${ALLOWED_TOOLS.length} tools`);

  // 6. Generate .env.agent file content
  const certJson = JSON.stringify(cert);
  const envContent = `# ===========================================
# GEIANT Agent Configuration
# Generated: ${now.toISOString()}
# ===========================================
# ⚠️  NEVER commit this file to git!
# Add .env.agent to .gitignore

# Supabase (GEIANT project)
GEIANT_SUPABASE_URL=https://kaqwkxfaclyqjlfhxrmt.supabase.co
GEIANT_SUPABASE_SERVICE_KEY=<paste-your-service-role-key>

# Agent Identity
GEIANT_AGENT_SK=${agentSk}
GEIANT_AGENT_PK=${agentPk}

# Principal Identity (human who authorized this agent)
GEIANT_PRINCIPAL_PK=${principalPk}

# Delegation Certificate (JSON — single line for env var)
GEIANT_DELEGATION_CERT='${certJson}'

# Defaults
GEIANT_DEFAULT_FACET=${DEFAULT_FACET}
GEIANT_DEFAULT_H3_CELL=${ROME_H3}
GEIANT_DEFAULT_H3_RES=5
`;

  // 7. Write to .env.agent
  const outPath = path.join(process.cwd(), '.env.agent');
  fs.writeFileSync(outPath, envContent, 'utf-8');

  console.log(`\n✅ Written to ${outPath}`);
  console.log('\n===========================================');
  console.log('Next steps:');
  console.log('===========================================');
  console.log('1. Paste your Supabase service_role key into .env.agent');
  console.log('2. Copy env vars to Railway:');
  console.log('   railway variables set GEIANT_AGENT_SK=...');
  console.log('3. Add .env.agent to .gitignore');
  console.log('4. Run tests: npx vitest run test/phase5_1_0.test.ts');
  console.log('===========================================\n');

  // 8. Also output the cert as pretty JSON for inspection
  const prettyPath = path.join(process.cwd(), 'delegation-cert.json');
  fs.writeFileSync(prettyPath, JSON.stringify(cert, null, 2), 'utf-8');
  console.log(`📄 Pretty cert written to ${prettyPath}\n`);

  // Summary object for programmatic use
  return {
    agentPk,
    agentSk,
    principalPk,
    principalSk: process.env.PRINCIPAL_SK ? undefined : principalSk,
    cert,
    certHash,
  };
}

main();
