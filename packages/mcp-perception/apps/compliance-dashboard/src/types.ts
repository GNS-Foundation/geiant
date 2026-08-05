export interface ComplianceReport {
  agent: {
    handle: string;
    publicKey: string;
    territory: string;
    territoryLabel: string;
  };
  trustScore: {
    score: number;
    tier: string;
    totalOps: number;
    violations: number;
    nextTier: string;
    nextTierThreshold: number;
    opsToNextTier: number;
  };
  chain: {
    valid: boolean;
    blockCount: number;
    issues: number;
    firstBlock: string;
    lastBlock: string;
  };
  epochs: Array<{
    index: number;
    blockRange: [number, number];
    merkleRoot: string;
    valid: boolean;
  }>;
  delegation: {
    principal: string;
    territory: string;
    territoryLabel: string;
    validFrom: string;
    validUntil: string;
    facets: string[];
  };
  regulatory: {
    articles: Array<{ id: string; label: string; compliant: boolean }>;
    enforcementDate: string;
  };
}
