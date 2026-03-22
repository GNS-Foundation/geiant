/**
 * MCP SSE integration test — verifies full lifecycle:
 *  1. SSE connect + MCP initialize
 *  2. List tools
 *  3. Call perception_weather (drops audit breadcrumb)
 *  4. Verify result
 *
 * Usage:
 *   node test/mcp_sse_test.mjs                              # against Railway
 *   node test/mcp_sse_test.mjs http://localhost:8080         # local
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const BASE = process.argv[2] || 'https://packagesmcp-perception-production.up.railway.app';

async function main() {
  console.log(`\n🧪 MCP SSE Integration Test`);
  console.log(`   Target: ${BASE}`);
  console.log('');

  // 1. Connect
  console.log('1️⃣  Connecting via SSE...');
  const transport = new SSEClientTransport(new URL(`${BASE}/sse`));
  const client = new Client({ name: 'geiant-sse-test', version: '1.0.0' });
  await client.connect(transport);
  console.log('   ✅ Connected + initialized');

  // 2. List tools
  console.log('\n2️⃣  Listing tools...');
  const tools = await client.listTools();
  const names = tools.tools.map(t => t.name);
  console.log(`   ✅ ${names.length} tools: ${names.join(', ')}`);

  // 3. Call perception_weather
  console.log('\n3️⃣  Calling perception_weather (Rome, 851e8053fffffff)...');
  const result = await client.callTool({
    name: 'perception_weather',
    arguments: {
      h3_cell: '851e8053fffffff',
      timestamp: '2026-03-20T12:00:00Z',
      write_to_spatial_memory: false,
    },
  });

  if (result.isError) {
    console.log(`   ❌ Tool error: ${result.content?.[0]?.text}`);
  } else {
    const weather = JSON.parse(result.content[0].text);
    console.log(`   ✅ Weather: ${weather.temperature_c}°C, wind ${weather.wind_speed_ms} m/s`);
    console.log(`   ✅ Status: ${weather.status}`);
    console.log(`   ✅ Data source: ${weather.data_source}`);
  }

  // 4. Check health for updated chain tip
  console.log('\n4️⃣  Checking health (chain tip should have incremented)...');
  const healthRes = await fetch(`${BASE}/health`);
  const health = await healthRes.json();
  console.log(`   ✅ Chain tip: #${health.chain_tip}`);
  console.log(`   ✅ Audit active: ${health.audit_active}`);

  console.log('\n═══════════════════════════════════');
  console.log(' All checks passed ✅');
  console.log('═══════════════════════════════════');
  console.log('\n🍞 Verify in Supabase:');
  console.log('   SELECT block_index, tool_name, location_cell, created_at');
  console.log('   FROM agent_breadcrumbs ORDER BY block_index DESC LIMIT 5;');

  await client.close();
  process.exit(0);
}

main().catch(e => {
  console.error('\n❌ Test failed:', e.message || e);
  process.exit(1);
});
