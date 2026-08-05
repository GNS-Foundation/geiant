import './node-shims'; // MUST be first: sets global Buffer before any @geiant/core import
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ComplianceDashboard } from './ComplianceDashboard';
import { ReputationPanel } from './ReputationPanel';
import type { ComplianceReport } from './types';
import './global.css';

// ── MCP App SDK integration ────────────────────────────────
// Uses useApp() hook inside the React tree. The hook connects
// to the host, receives tool results, and exposes callServerTool.

const MOCK_REPORT: ComplianceReport = {
  agent: {
    handle: 'energy@italy-geiant',
    publicKey: 'c14094ea7b3f2a1d9e6c8b4f0a5d7e2c3b1a9f8e7d6c5b4a3f2e1d0c9b8a7f6',
    territory: '851e8053fffffff',
    territoryLabel: 'Rome, Italy',
  },
  trustScore: {
    score: 20.99,
    tier: 'Provisioned',
    totalOps: 8,
    violations: 0,
    nextTier: 'Observed',
    nextTierThreshold: 25,
    opsToNextTier: 42,
  },
  chain: {
    valid: true,
    blockCount: 8,
    issues: 0,
    firstBlock: '2026-03-20T10:00:00Z',
    lastBlock: '2026-03-22T14:30:00Z',
  },
  epochs: [
    { index: 0, blockRange: [0, 4], merkleRoot: '6fa3e35a9c2b1d4e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5', valid: true },
    { index: 1, blockRange: [5, 7], merkleRoot: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2', valid: true },
  ],
  delegation: {
    principal: '262507c6d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8',
    territory: '851e8053fffffff',
    territoryLabel: 'Rome, Italy',
    validFrom: '2026-03-20T00:00:00Z',
    validUntil: '2027-03-20T00:00:00Z',
    facets: ['energy@italy-geiant'],
  },
  regulatory: {
    articles: [
      { id: 'art-12', label: 'Art. 12 — Record-keeping', compliant: true },
      { id: 'art-14', label: 'Art. 14 — Human oversight', compliant: true },
      { id: 'art-9',  label: 'Art. 9 — Risk management', compliant: true },
      { id: 'art-13', label: 'Art. 13 — Transparency', compliant: true },
    ],
    enforcementDate: '2026-08-02T00:00:00Z',
  },
};

const TAB_CSS = `
.shell-tabs{display:flex;gap:6px;justify-content:center;padding:14px 12px 0}
.shell-tab{background:transparent;border:1px solid var(--geiant-border);color:var(--geiant-text2);
  border-radius:999px;padding:6px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-sans,var(--geiant-sans))}
.shell-tab.on{background:var(--geiant-bg2);color:var(--geiant-cyan);border-color:var(--geiant-cyan)}
`;

function Root() {
  // Reuse the compliance-dashboard shell; the Reputation panel (#8b) is the default
  // view, with the existing compliance report available on the other tab.
  const [tab, setTab] = useState<'reputation' | 'compliance'>('reputation');
  return (
    <>
      <style>{TAB_CSS}</style>
      <div className="shell-tabs">
        <button className={`shell-tab ${tab === 'reputation' ? 'on' : ''}`} onClick={() => setTab('reputation')}>CGR Reputation</button>
        <button className={`shell-tab ${tab === 'compliance' ? 'on' : ''}`} onClick={() => setTab('compliance')}>Compliance Report</button>
      </div>
      {tab === 'reputation' ? <ReputationPanel /> : <ComplianceDashboard mockReport={MOCK_REPORT} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
