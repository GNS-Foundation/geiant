import { SpatialMemoryNode, SpatialFeature, GeometryMutationType, H3Cell, VirtualBreadcrumb } from '../types/index.js';
export interface SpatialMemoryQuery {
    cell?: H3Cell;
    agentPublicKey?: string;
    taskId?: string;
    mutationType?: GeometryMutationType;
    since?: string;
    until?: string;
    limit?: number;
}
export interface MutationResult {
    node: SpatialMemoryNode;
    breadcrumb: VirtualBreadcrumb;
}
export interface RollbackResult {
    restoredNode: SpatialMemoryNode;
    tombstone: SpatialMemoryNode;
}
export declare class SpatialMemoryGraph {
    private nodes;
    private cellIndex;
    private taskIndex;
    private agentIndex;
    private heads;
    /**
     * Add a new geometry to spatial memory (genesis node — no previous hash).
     * Validates geometry before accepting.
     */
    create(params: {
        feature: SpatialFeature;
        featureId: string;
        taskId: string;
        agentPublicKey: string;
        delegationCertHash: string;
    }): Promise<MutationResult>;
    /**
     * Mutate an existing geometry — creates a new node linked to the current head.
     * The previous node is preserved in the graph (immutable history).
     *
     * @param featureId - stable ID of the feature being mutated
     * @param newFeature - the new geometry state
     * @param mutationType - what kind of mutation occurred
     */
    mutate(params: {
        featureId: string;
        newFeature: SpatialFeature;
        mutationType: GeometryMutationType;
        taskId: string;
        agentPublicKey: string;
        delegationCertHash: string;
    }): Promise<MutationResult>;
    /**
     * Rollback a feature to a specific previous node hash.
     * Does not delete nodes — creates a tombstone on the rolled-back head
     * and sets the head pointer back.
     */
    rollback(params: {
        featureId: string;
        targetHash: string;
        taskId: string;
        agentPublicKey: string;
        delegationCertHash: string;
    }): Promise<RollbackResult>;
    /** Get the current head node for a feature */
    getHead(featureId: string): SpatialMemoryNode | null;
    /** Get the full mutation history of a feature, newest first */
    getHistory(featureId: string): Promise<SpatialMemoryNode[]>;
    /** Get the geometry state of a feature at a specific point in time */
    getAtTime(featureId: string, isoTimestamp: string): Promise<SpatialMemoryNode | null>;
    /**
     * Query nodes by various criteria.
     * The core spatial query: "what changed in this H3 cell since timestamp X?"
     */
    query(q: SpatialMemoryQuery): Promise<SpatialMemoryNode[]>;
    /** Verify the integrity of the chain for a feature */
    verifyChain(featureId: string): Promise<{
        valid: boolean;
        nodeCount: number;
        brokenAt?: string;
    }>;
    /** Stats */
    get stats(): {
        totalNodes: number;
        totalFeatures: number;
        indexedCells: number;
    };
    private storeNode;
}
export declare class GeometryValidationError extends Error {
    readonly validationResult: any;
    constructor(message: string, validationResult: any);
}
/**
 * Verify an agent signature for a node hash.
 * Phase 0: uses the deterministic dev private key derivation.
 */
export declare function verifyAgentSignature(agentPublicKey: string, hash: string, signature: string): boolean;
export declare function getSpatialMemory(): SpatialMemoryGraph;
export declare function resetSpatialMemory(): void;
//# sourceMappingURL=spatial_memory.d.ts.map