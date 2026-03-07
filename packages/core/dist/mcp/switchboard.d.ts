import type { GeiantTask, HandoffRoutingDecision } from '../types/index.js';
export interface McpToolCall {
    tool: string;
    server: string;
    params: Record<string, unknown>;
}
export interface SwitchboardResult {
    success: boolean;
    taskId: string;
    toolCalled: string;
    serverUsed: string;
    result?: unknown;
    error?: string;
    latencyMs: number;
    breadcrumbHash: string;
}
export interface McpServerConfig {
    name: string;
    url: string;
    apiKey: string;
    capabilities: string[];
}
export declare class McpSwitchboard {
    private servers;
    constructor(servers: McpServerConfig[]);
    dispatch(task: GeiantTask, routingDecision: HandoffRoutingDecision): Promise<SwitchboardResult>;
    private selectTool;
    private errorResult;
    private buildBreadcrumbHash;
    addServer(config: McpServerConfig): void;
    getServers(): McpServerConfig[];
    ping(serverName: string): Promise<boolean>;
    pingAll(): Promise<Record<string, boolean>>;
}
export declare function createSwitchboard(): McpSwitchboard;
//# sourceMappingURL=switchboard.d.ts.map