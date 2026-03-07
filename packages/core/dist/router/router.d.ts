import { GeiantTask } from '../types/index.js';
import type { AgentRegistry } from '../registry/registry.js';
import type { HandoffRoutingDecision } from '../types/index.js';
export declare class GeiantRouter {
    private registry;
    constructor(registry: AgentRegistry);
    /**
     * Route a task through all four gates and dispatch to the best-fit ant.
     *
     * This method is intentionally synchronous in its decision logic —
     * every rejection reason is deterministic and auditable.
     */
    route(task: GeiantTask): Promise<HandoffRoutingDecision>;
    private reject;
}
//# sourceMappingURL=router.d.ts.map