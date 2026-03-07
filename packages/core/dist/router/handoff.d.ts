import { GeiantTask, HandoffDecision, JurisdictionResult } from '../types/index.js';
import type { AgentRegistry } from '../registry/registry.js';
/**
 * Attempt to find a cross-jurisdictional handoff for a task that
 * has no eligible ant in its origin cell.
 *
 * Scans expanding H3 rings around the origin cell (res 5) up to
 * MAX_HANDOFF_RINGS rings out, looking for an eligible ant in an
 * adjacent territory.
 */
export declare function resolveHandoff(task: GeiantTask, originJurisdiction: JurisdictionResult, registry: AgentRegistry): Promise<HandoffDecision>;
export declare function formatHandoffSummary(handoff: HandoffDecision): string;
//# sourceMappingURL=handoff.d.ts.map