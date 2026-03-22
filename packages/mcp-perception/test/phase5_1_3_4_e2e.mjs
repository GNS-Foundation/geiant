/**
 * Phase 5.1.3 + 5.1.4 E2E Test
 *
 * 1. Call perception_weather 3× via MCP SSE (drops blocks #N, #N+1, #N+2)
 * 2. Roll an epoch via POST /epoch/roll
 * 3. Verify epoch: Merkle root, block count, tier
 * 4. Generate compliance report via GET /compliance
 * 5. Verify report: Art. 12 + Art. 14 fields
 *
 * Usage:
 *   node test/phase5_1_3_4_e2e.mjs                          # against Railway
 *   node test/phase5_1_3_4_e2e.mjs http://localhost:8080     # local
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const BASE = process.argv[2] || 'https://packagesmcp-perception-production.up.railway.app';

function assert(condition, msg) {
  if (!condition) { console.error(`  ❌ FAIL: ${msg}`); process.exit(1); }
  console.log(`  ✅ ${msg}`);
}

async function main() {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Phase 5.1.3 + 5.1.4 End-to-End Test`);
  console.log(`  Target: ${BASE}`);
  console.log(`═══════════════════════════════════════════\n`);

  // ── Step 0: Get baseline chain tip ──
  const h0 = await fetch(`${BASE}/health`).then(r => r.json());
  const baselineTip = h0.chain_tip;
  console.log(`📍 Baseline chain tip: #${baselineTip}\n`);

  // ── Step 1: Drop 3 breadcrumbs via MCP SSE ──
  console.log(`1️⃣  Dropping 3 breadcrumbs via MCP SSE...`);
  const transport = new SSEClientTransport(new URL(`${BASE}/sse`));
  const client = new Client({ name: 'epoch-test', version: '1.0.0' });
  await client.connect(transport);

  for (let i = 0; i < 3; i++) {
    const result = await client.callTool({
      name: 'perception_weather',
      arguments: {
        h3_cell: '851e8053fffffff',
        timestamp: `2026-03-${15 + i}T12:00:00Z`,
        write_to_spatial_memory: false,
      },
    });
    const w = JSON.parse(result.content[0].text);
    console.log(`  🍞 Block #${baselineTip + i}: ${w.temperature_c}°C`);
  }
  await client.close();

  // Verify chain tip advanced by 3
  const h1 = await fetch(`${BASE}/health`).then(r => r.json());
  assert(h1.chain_tip === baselineTip + 3, `Chain tip advanced: ${baselineTip} → ${h1.chain_tip}`);

  // ── Step 2: Roll epoch ──
  console.log(`\n2️⃣  Rolling epoch via POST /epoch/roll...`);
  const epochRes = await fetch(`${BASE}/epoch/roll`, { method: 'POST' });
  const epoch = await epochRes.json();

  if (epoch.error) {
    console.error(`  ❌ Epoch roll failed: ${epoch.error}`);
    process.exit(1);
  }

  console.log(`  📦 Epoch #${epoch.epoch_index}:`);
  console.log(`     Blocks: ${epoch.start_block} → ${epoch.end_block} (${epoch.block_count})`);
  console.log(`     Merkle: ${epoch.merkle_root.substring(0, 24)}...`);
  console.log(`     Tier:   ${epoch.tier_at_close}`);
  console.log(`     Hash:   ${epoch.epoch_hash.substring(0, 24)}...`);

  assert(epoch.success === true, 'Epoch rolled successfully');
  assert(epoch.block_count >= 3, `Epoch contains ≥3 blocks (got ${epoch.block_count})`);
  assert(epoch.merkle_root.length === 64, 'Merkle root is 64-char SHA-256');
  assert(epoch.epoch_hash.length === 64, 'Epoch hash is 64-char SHA-256');

  // ── Step 3: Generate compliance report ──
  console.log(`\n3️⃣  Generating compliance report via GET /compliance...`);
  const reportRes = await fetch(`${BASE}/compliance`);
  const report = await reportRes.json();

  if (report.error) {
    console.error(`  ❌ Compliance report failed: ${report.error}`);
    process.exit(1);
  }

  console.log(`  📊 Compliance Report:`);
  console.log(`     Version:    ${report.version}`);
  console.log(`     Agent:      ${report.agent_pk?.substring(0, 16)}...`);
  console.log(`     Handle:     ${report.agent_handle}`);
  console.log(`     Principal:  ${report.principal_pk?.substring(0, 16)}...`);
  console.log(`     Period:     ${report.reporting_period?.from} → ${report.reporting_period?.to}`);
  console.log(`     Operations: ${report.total_operations}`);
  console.log(`     Epochs:     ${report.epochs?.length}`);
  console.log(`     Tier:       ${report.current_tier}`);
  console.log(`     Trust:      ${report.trust_score}`);
  console.log(`     Violations: ${report.violations?.length}`);

  // Art. 12 checks
  assert(report.version === 1, 'Report version = 1');
  assert(report.total_operations >= 3, `Total operations ≥ 3 (got ${report.total_operations})`);
  assert(Object.keys(report.operations_by_tool).includes('perception_weather'), 'perception_weather in operations_by_tool');
  assert(report.jurisdiction_cells?.includes('851e8053fffffff'), 'Rome H3 cell in jurisdiction_cells');
  assert(report.chain_verification?.is_valid === true, 'Chain verification is valid');
  assert(report.epochs?.length >= 1, `At least 1 epoch (got ${report.epochs?.length})`);

  // Art. 14 checks
  assert(report.delegation_certificate != null, 'Delegation certificate present');
  assert(report.principal_pk?.length === 64, 'Principal PK is 64-char hex');
  assert(typeof report.delegation_chain_depth === 'number', 'Delegation chain depth present');

  // Trust assessment
  assert(typeof report.trust_score === 'number', 'Trust score is numeric');
  assert(Array.isArray(report.violations), 'Violations array present');

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ALL CHECKS PASSED ✅`);
  console.log(`  Phase 5.1.3 (Epoch Rollups) ✅`);
  console.log(`  Phase 5.1.4 (Compliance Report) ✅`);
  console.log(`═══════════════════════════════════════════\n`);

  console.log(`🔎 Verify in Supabase:`);
  console.log(`   SELECT * FROM agent_epochs ORDER BY epoch_index DESC LIMIT 1;`);
  console.log(`   SELECT total_operations, current_tier, trust_score FROM ...`);
  console.log(`   (compliance report is computed live, not persisted)\n`);

  process.exit(0);
}

main().catch(e => {
  console.error('\n❌ Test failed:', e.message || e);
  process.exit(1);
});
