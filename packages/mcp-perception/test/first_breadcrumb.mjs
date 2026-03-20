import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const BASE = 'https://packagesmcp-perception-production.up.railway.app';

async function main() {
  console.log('🔌 Connecting...');
  const transport = new SSEClientTransport(new URL(`${BASE}/sse`));
  const client = new Client({ name: 'breadcrumb-test', version: '1.0.0' });
  await client.connect(transport);
  console.log('✅ Connected');

  console.log('🌤️  Calling perception_weather for Rome...');
  const result = await client.callTool({
    name: 'perception_weather',
    arguments: {
      h3_cell: '851e8053fffffff',
      timestamp: '2026-03-15T12:00:00Z',
      write_to_spatial_memory: false,
    },
  });

  const weather = JSON.parse(result.content[0].text);
  console.log(`🌡️  Rome: ${weather.temperature_c}°C, wind ${weather.wind_speed_ms} m/s, status=${weather.status}`);
  console.log('\n🍞 Check Supabase for Block #0!');

  await client.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
