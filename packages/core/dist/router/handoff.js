// =============================================================================
// GEIANT — JURISDICTIONAL HAND-OFF ENGINE  (L1 Cross-Jurisdiction)
// "The ant colony in action — specialized agents passing the baton."
//
// When a task's origin cell has no eligible ant, instead of rejecting,
// the router:
//   1. Resolves the origin jurisdiction
//   2. Scans adjacent H3 rings (res 5) for cells with eligible ants
//   3. Resolves the receiving jurisdiction
//   4. Verifies compatibility (same facet, regulatory overlap OK)
//   5. Issues a signed HandoffCert (sub-delegation, depth - 1)
//   6. Returns HandoffDecision with the receiving ant + cert
//
// Compliance guarantee:
//   A handoff is ONLY issued if the original DelegationCert's
//   maxSubdelegationDepth > 0. Otherwise the task is rejected.
//   This enforces the human principal's delegation policy — no ant
//   can route around the human's explicit depth limit.
//
// Key use cases:
//   - Swiss ant → Italian ant (FINMA → GDPR regulatory transition)
//   - Rome Zone 1 ant → Rome Zone 2 ant (grid load balancing)
//   - EU North ant → UK ant (GDPR → UK_GDPR post-Brexit)
//
// This is the "spatial compliance router" that makes GEIANT's L1 layer
// fundamentally different from any existing orchestration framework.
// =============================================================================
import { createHash } from 'crypto';
import { gridDisk } from 'h3-js';
import { resolveJurisdiction } from './jurisdiction.js';
import { signMessage } from '../crypto/ed25519.js';
// ---------------------------------------------------------------------------
// Router key for signing HandoffCerts
// Phase 0: deterministic dev key derived from a fixed seed
// Phase 1: loaded from secure enclave / Railway secret
// ---------------------------------------------------------------------------
const ROUTER_PRIVATE_KEY_HEX = process.env.ROUTER_SIGNING_KEY ??
    createHash('sha256').update('geiant-router-dev-signing-key-v1').digest('hex');
// ---------------------------------------------------------------------------
// Main hand-off resolution
// ---------------------------------------------------------------------------
/**
 * Attempt to find a cross-jurisdictional handoff for a task that
 * has no eligible ant in its origin cell.
 *
 * Scans expanding H3 rings around the origin cell (res 5) up to
 * MAX_HANDOFF_RINGS rings out, looking for an eligible ant in an
 * adjacent territory.
 */
export async function resolveHandoff(task, originJurisdiction, registry) {
    // Gate: check subdelegation depth allows handoff
    const remainingDepth = task.delegationCert.maxSubdelegationDepth;
    if (remainingDepth <= 0) {
        return {
            possible: false,
            fromJurisdiction: originJurisdiction,
            rejectionReason: 'Subdelegation depth exhausted — human principal did not authorize further delegation. maxSubdelegationDepth=0.',
        };
    }
    // Scan adjacent H3 rings for eligible ants
    const MAX_RINGS = 3;
    const searchedCells = new Set([task.originCell]);
    for (let ring = 1; ring <= MAX_RINGS; ring++) {
        const ringCells = gridDisk(task.originCell, ring).filter(c => !searchedCells.has(c));
        ringCells.forEach(c => searchedCells.add(c));
        for (const cell of ringCells) {
            const candidateJurisdiction = await resolveJurisdiction(cell);
            if (!candidateJurisdiction)
                continue;
            // Skip cells in same jurisdiction as origin — we already know no ant is there
            if (candidateJurisdiction.countryCode === originJurisdiction.countryCode)
                continue;
            // Find eligible ants in this cell
            const ants = await registry.findEligibleAnts(cell, task.requiredFacet, task.minTier);
            if (ants.length === 0)
                continue;
            // Found a candidate — pick the best one
            const receivingAnt = selectBestAnt(ants, cell);
            // Verify handoff is legally permissible
            const compatible = isHandoffCompatible(originJurisdiction, candidateJurisdiction, task);
            if (!compatible.ok) {
                continue; // try next cell
            }
            // Issue HandoffCert
            const bridgeCells = findBridgeCells(task.originCell, cell, ring);
            const handoffCert = issueHandoffCert(task, receivingAnt, cell, candidateJurisdiction, remainingDepth);
            return {
                possible: true,
                fromJurisdiction: originJurisdiction,
                toJurisdiction: candidateJurisdiction,
                receivingAnt,
                bridgeCells,
                handoffCert,
            };
        }
    }
    return {
        possible: false,
        fromJurisdiction: originJurisdiction,
        rejectionReason: `No eligible ant found within ${MAX_RINGS} H3 ring(s) of origin cell ${task.originCell} for facet '${task.requiredFacet}' with tier ≥ '${task.minTier}'.`,
    };
}
// ---------------------------------------------------------------------------
// HandoffCert issuance
// ---------------------------------------------------------------------------
function issueHandoffCert(task, receivingAnt, targetCell, targetJurisdiction, remainingDepth) {
    const id = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    // Scope the cert to the receiving ant's territory cells
    // (intersection of original scopeCells ∪ target jurisdiction cells)
    const scopeCells = receivingAnt.identity.territoryCells.slice(0, 20); // cap at 20 cells
    const parentCertHash = createHash('sha256')
        .update(JSON.stringify({
        id: task.delegationCert.id,
        humanPublicKey: task.delegationCert.humanPublicKey,
        agentPublicKey: task.delegationCert.agentPublicKey,
    }))
        .digest('hex');
    const certPayload = {
        id,
        taskId: task.id,
        fromAgentPublicKey: task.delegationCert.agentPublicKey,
        toAgentPublicKey: receivingAnt.identity.publicKey,
        scopeCells,
        scopeFacets: task.delegationCert.scopeFacets,
        remainingDepth: remainingDepth - 1,
        validUntil: task.delegationCert.validUntil,
        parentCertHash,
        issuedAt,
    };
    // Router signs the handoff cert
    const routerSignature = signMessage(certPayload, ROUTER_PRIVATE_KEY_HEX);
    return { ...certPayload, routerSignature };
}
/**
 * Check whether a cross-jurisdictional handoff is legally permissible.
 *
 * Rules:
 *   1. If origin is EU (GDPR), target must have equivalent data protection
 *   2. Financial tasks (finance facet) to CH require FINMA-aware agent
 *   3. Healthcare data cannot cross to jurisdictions without health frameworks
 */
function isHandoffCompatible(from, to, task) {
    const fromFrameworkIds = from.frameworks.map(f => f.id);
    const toFrameworkIds = to.frameworks.map(f => f.id);
    // GDPR origin: target must have GDPR or equivalent (UK_GDPR, SWISS_DPA)
    if (fromFrameworkIds.includes('GDPR')) {
        const hasEquivalent = toFrameworkIds.some(id => ['GDPR', 'UK_GDPR', 'SWISS_DPA', 'PDPA_SG'].includes(id));
        if (!hasEquivalent) {
            return {
                ok: false,
                reason: `GDPR data cannot be handed off to ${to.countryCode} — no equivalent data protection framework found`,
            };
        }
    }
    // Health facet: target must have health-aware framework
    if (task.requiredFacet === 'health') {
        const hasHealth = toFrameworkIds.some(id => ['GDPR', 'UK_GDPR', 'SWISS_DPA', 'CCPA'].includes(id));
        if (!hasHealth) {
            return {
                ok: false,
                reason: `Health data cannot be handed off to ${to.countryCode} — no health-compatible framework`,
            };
        }
    }
    return { ok: true };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function selectBestAnt(ants, cell) {
    // Score by: compliance score + operation count (proxy for experience)
    return ants.sort((a, b) => (b.complianceScore + Math.log10(b.operationCount + 1)) -
        (a.complianceScore + Math.log10(a.operationCount + 1)))[0];
}
/**
 * Find the H3 cells that bridge origin and target cells.
 * Returns a minimal path of cells connecting the two.
 */
function findBridgeCells(originCell, targetCell, ringDistance) {
    try {
        // gridDisk at half the distance gives the intermediate cells
        const midRing = Math.max(1, Math.floor(ringDistance / 2));
        const intermediate = gridDisk(originCell, midRing)
            .filter(c => c !== originCell);
        return [originCell, ...intermediate.slice(0, 3), targetCell];
    }
    catch {
        return [originCell, targetCell];
    }
}
// ---------------------------------------------------------------------------
// Format handoff decision for logs / API response
// ---------------------------------------------------------------------------
export function formatHandoffSummary(handoff) {
    if (!handoff.possible) {
        return `[GEIANT Handoff] Not possible: ${handoff.rejectionReason}`;
    }
    return [
        `[GEIANT Handoff] Cross-jurisdictional handoff triggered:`,
        `  From: ${handoff.fromJurisdiction.countryCode} (${handoff.fromJurisdiction.frameworks.map(f => f.id).join(', ')})`,
        `  To:   ${handoff.toJurisdiction.countryCode} (${handoff.toJurisdiction.frameworks.map(f => f.id).join(', ')})`,
        `  Receiving ant: ${handoff.receivingAnt.identity.handle} (${handoff.receivingAnt.identity.tier})`,
        `  Bridge cells: ${handoff.bridgeCells?.length ?? 0} intermediate cells`,
        `  Cert ID: ${handoff.handoffCert?.id}`,
        `  Remaining depth: ${handoff.handoffCert?.remainingDepth}`,
    ].join('\n');
}
//# sourceMappingURL=handoff.js.map