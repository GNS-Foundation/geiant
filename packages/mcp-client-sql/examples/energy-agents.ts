/**
 * Example: GEIANT-governed LangChain agent
 * querying Terna smart-meter data via Microsoft SQL MCP Server.
 *
 * Run:
 *   npx ts-node examples/energy-agent.ts
 */

import { ChatOpenAI }       from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { GNSAgentIdentity } from 'langchain-gns-aip';
import { SqlMcpClient }     from '@geiant/mcp-client-sql';
import { geoToH3 }          from 'h3-js';
import { generateAgentIdentity, createDelegationCert } from '@gns-aip/sdk';

// ── 1. Identities ─────────────────────────────────────────────────────────────

// Human principal — in production this key never leaves the mobile device
const principal = generateAgentIdentity();

// AI agent identity
const agent = generateAgentIdentity();

// H3 cell for the Sicilian Terna pilot area (Catania)
const CATANIA_R7 = geoToH3(37.5079, 15.0830, 7);

// ── 2. Delegation certificate (human → agent) ─────────────────────────────────

const cert = await createDelegationCert({
  agentIdentity:     agent.publicKey,
  principalIdentity: principal.publicKey,
  territoryCells:    [CATANIA_R7],
  facetPermissions:  ['energy'],
  validityHours:     720,          // 30 days
}, principal.secretKey);

console.log('Delegation cert:', cert.certHash);
console.log('Territory:',       CATANIA_R7, '(Catania R7)');

// ── 3. Connect to Microsoft SQL MCP Server ────────────────────────────────────

const sqlClient = await SqlMcpClient.connect(
  {
    // Data API builder endpoint — replace with Terna's actual endpoint
    endpoint:       process.env.TERNA_SQL_MCP_URL ?? 'https://terna-dab.azure-api.net/mcp/sse',
    agentIdentity:  agent,
    delegationCert: cert,
    operationCell:  CATANIA_R7,
    facet:          'energy',
    authToken:      process.env.TERNA_API_KEY,
    // Supabase audit storage
    supabaseUrl:    process.env.SUPABASE_URL,
    supabaseKey:    process.env.SUPABASE_SERVICE_KEY,
  },
  // Breadcrumb callback — fires after every governed SQL call
  ({ breadcrumb, toolName, durationMs }) => {
    console.log(`✓ Breadcrumb #${breadcrumb.blockIndex} | ${toolName} | ${durationMs}ms | ${breadcrumb.blockHash.slice(0, 12)}…`);
  },
);

// ── 4. Wrap with GEIANT LangChain identity ────────────────────────────────────

const gnsId = await GNSAgentIdentity.provision({ domain: 'energy', handle: 'terna-monitor' });
await gnsId.delegate(principal.publicKey, {
  scope: { territoryCells: [CATANIA_R7], facets: ['energy'], validityHours: 720 },
});

// SQL tools come pre-governed from the SqlMcpClient
const sqlTools = await sqlClient.asLangChainTools();

console.log('Available SQL tools:', sqlTools.map(t => t.name));
// e.g. ['sql_query_entities', 'sql_get_by_pk', 'sql_execute_stored_procedure']

// ── 5. Build LangChain agent ──────────────────────────────────────────────────

const llm = new ChatOpenAI({ model: 'gpt-4o', temperature: 0 });

const prompt = ChatPromptTemplate.fromMessages([
  ['system', `You are an energy grid monitoring agent for Terna's Sicilian network.
You have access to smart meter and sensor data via SQL tools.
Your territory is Catania (H3: ${CATANIA_R7}).
Every query you make is cryptographically audited for EU AI Act compliance.`],
  ['human', '{input}'],
  ['placeholder', '{agent_scratchpad}'],
]);

const agentRunnable = createToolCallingAgent({ llm, tools: sqlTools, prompt });
const executor      = new AgentExecutor({ agent: agentRunnable, tools: sqlTools, verbose: true });

// ── 6. Run ────────────────────────────────────────────────────────────────────

const result = await executor.invoke({
  input: 'Show me the 5 smart meters with the highest anomaly score in the last 24 hours.',
});

console.log('\n─── Agent result ───');
console.log(result.output);
console.log('\n─── Chain tip ───');
console.log('Block #:', sqlClient.tip?.blockIndex);
console.log('Hash:',    sqlClient.tip?.blockHash.slice(0, 16) + '…');

// ── 7. Compliance report ──────────────────────────────────────────────────────

const report = await fetch(`${process.env.SUPABASE_URL}/functions/v1/compliance?agent_pk=${agent.publicKey}`, {
  headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
}).then(r => r.json());

console.log('\n─── EU AI Act Art. 12/14 Compliance ───');
console.log('Total operations:', report.total_operations);
console.log('Chain valid:',      report.chain_verification?.is_valid);
console.log('Violations:',       report.violations?.length ?? 0);
console.log('Trust tier:',       report.current_tier);

await sqlClient.close();
