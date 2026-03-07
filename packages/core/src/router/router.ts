// =============================================================================
// GEIANT — GEOSPATIAL ROUTER
// The central dispatch engine. Routes tasks to ants via 4 sequential checks.
// =============================================================================
//
// Every task passes through four gates before dispatch:
//
//   Gate 1 — Signature Verification
//             Task caller's Ed25519 signature is verified.
//
//   Gate 2 — Jurisdiction Resolution
//             The task's origin H3 cell is resolved to a regulatory context.
//             Tasks with no resolvable jurisdiction are rejected.
//
//   Gate 3 — Delegation Chain Verification
//             The human delegation cert is validated: format, time window,
//             scope cells, scope facets, sub-delegation depth, signature.
//
//   Gate 4 — Geometry Pre-flight
//             If the task contains geometries, all are validated before
//             dispatch. Invalid geometry = rejection with structured error.
//
//   Dispatch — Agent Registry Lookup
//             Router queries the registry for eligible ants (H3 overlap +
//             facet match + tier ≥ required). Best-fit ant is selected.
//
// This is what makes GEIANT fundamentally different from LangChain:
// the router is a compliance enforcement point, not a load balancer.
// =============================================================================

import {
  GeiantTask,
  RoutingDecision,
  RoutingRejectionReason,
  AntManifest,
  VirtualBreadcrumb,
  BreadcrumbEventType,
} from '../types/index.js';
import { validateGeometries } from '../validation/geometry.js';
import { repairFeatures, formatRepairFeedback } from '../validation/geometry_repair.js';
import { validateDelegation, hashCert } from '../validation/delegation.js';
import { scoreAntFitness, tierSatisfies } from '../agent/identity.js';
import { resolveJurisdiction } from './jurisdiction.js';
import { resolveHandoff, formatHandoffSummary } from './handoff.js';
import type { AgentRegistry } from '../registry/registry.js';
import { verifyMessage, isValidPublicKey, isValidSignature } from '../crypto/ed25519';
import type { HandoffRoutingDecision, GeometryRepairResult } from '../types/index.js';

// ---------------------------------------------------------------------------
// Router class
// ---------------------------------------------------------------------------

export class GeiantRouter {
  private registry: AgentRegistry;

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  /**
   * Route a task through all four gates and dispatch to the best-fit ant.
   *
   * This method is intentionally synchronous in its decision logic —
   * every rejection reason is deterministic and auditable.
   */
  async route(task: GeiantTask): Promise<HandoffRoutingDecision> {
    const startedAt = new Date().toISOString();

    // ── Gate 1: Signature verification ──────────────────────────────────────
    const sigValid = verifyTaskSignature(task);
    if (!sigValid) {
      return this.reject(task, 'signature_invalid', 'Task signature verification failed', startedAt);
    }

    // ── Gate 2: Jurisdiction resolution ─────────────────────────────────────
    const jurisdiction = await resolveJurisdiction(task.originCell);
    if (!jurisdiction) {
      return this.reject(task, 'no_jurisdiction',
        `Cannot resolve jurisdiction for H3 cell ${task.originCell}`, startedAt);
    }

    // ── Gate 3: Delegation chain verification ────────────────────────────────
    const delegationResult = validateDelegation(task.delegationCert, task);
    if (!delegationResult.valid) {
      return this.reject(task, 'invalid_delegation', delegationResult.errorReason!, startedAt, {
        jurisdiction,
        delegationValidation: delegationResult,
      });
    }

    // ── Gate 4: Geometry pre-flight (with L2 Self-Healing) ──────────────────
    let activeGeometries = task.geometries;
    let geometryRepairs: GeometryRepairResult[] | undefined;
    let geometryRepaired = false;

    if (task.geometries && task.geometries.length > 0) {
      const geomResult = validateGeometries(task.geometries);
      if (!geomResult.valid) {
        // Attempt L2 self-healing before rejecting
        const repairResult = repairFeatures(task.geometries);

        if (repairResult.allRepaired) {
          // Repair succeeded — proceed with fixed geometries
          activeGeometries = repairResult.repairedFeatures;
          geometryRepairs = repairResult.repairs;
          geometryRepaired = true;
          console.log(formatRepairFeedback(repairResult.repairs));
        } else {
          // Repair failed — reject with original error + repair attempt info
          return this.reject(task, 'invalid_geometry',
            geomResult.errorMessage ?? 'Geometry validation failed', startedAt, {
              jurisdiction,
              delegationValidation: delegationResult,
              geometryValidation: geomResult,
            });
        }
      }
    }

    // ── Dispatch: Registry lookup ────────────────────────────────────────────
    const candidates = await this.registry.findEligibleAnts(
      task.originCell,
      task.requiredFacet,
      task.minTier
    );

    if (candidates.length === 0) {
      // ── L1 Cross-Jurisdictional Hand-off ─────────────────────────────────
      // No ant in origin jurisdiction — try adjacent territories
      const handoff = await resolveHandoff(task, jurisdiction, this.registry);

      if (handoff.possible) {
        console.log(formatHandoffSummary(handoff));
        const breadcrumb = buildBreadcrumb(task, handoff.receivingAnt!, 'territory_boundary_crossed',
          hashCert(task.delegationCert));

        return {
          taskId: task.id,
          success: true,
          selectedAnt: handoff.receivingAnt,
          jurisdiction: handoff.toJurisdiction,
          delegationValidation: delegationResult,
          geometryValidation: activeGeometries?.length ? { valid: true } : undefined,
          breadcrumb,
          routedAt: new Date().toISOString(),
          handoff,
          geometryRepaired,
          geometryRepairs,
        };
      }

      // Handoff also failed — reject
      const tierMismatch = await this.registry.hasAntsForFacet(task.requiredFacet);
      const reason: RoutingRejectionReason = tierMismatch ? 'tier_insufficient' : 'no_eligible_ant';

      return this.reject(task, reason,
        `No ant found for facet '${task.requiredFacet}' in cell ${task.originCell} with tier ≥ '${task.minTier}'. Handoff also failed: ${handoff.rejectionReason}`,
        startedAt, { jurisdiction, delegationValidation: delegationResult });
    }

    // Score and rank candidates
    const scored = candidates
      .map(ant => ({
        ant,
        score: scoreAntFitness(ant, task.originCell, task.minTier),
      }))
      .filter(s => s.score >= 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return this.reject(task, 'territory_mismatch',
        `No ant's territory covers cell ${task.originCell}`, startedAt,
        { jurisdiction, delegationValidation: delegationResult });
    }

    const selectedAnt = scored[0].ant;

    // ── Build success routing decision ───────────────────────────────────────
    const breadcrumb = buildBreadcrumb(task, selectedAnt, 'task_dispatched',
      hashCert(task.delegationCert));

    return {
      taskId: task.id,
      success: true,
      selectedAnt,
      jurisdiction,
      geometryValidation: activeGeometries?.length ? { valid: true } : undefined,
      delegationValidation: delegationResult,
      breadcrumb,
      routedAt: new Date().toISOString(),
      geometryRepaired,
      geometryRepairs,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private reject(
    task: GeiantTask,
    reason: RoutingRejectionReason,
    details: string,
    startedAt: string,
    partial?: Partial<HandoffRoutingDecision>
  ): HandoffRoutingDecision {
    const breadcrumb = buildBreadcrumb(
      task, null, 'task_failed',
      task.delegationCert ? hashCert(task.delegationCert) : 'no_cert'
    );

    return {
      taskId: task.id,
      success: false,
      rejectionReason: reason,
      rejectionDetails: details,
      breadcrumb,
      routedAt: new Date().toISOString(),
      ...partial,
    };
  }
}

// ---------------------------------------------------------------------------
// Virtual breadcrumb factory
// ---------------------------------------------------------------------------

function buildBreadcrumb(
  task: GeiantTask,
  ant: AntManifest | null,
  eventType: BreadcrumbEventType,
  delegationCertHash: string
): VirtualBreadcrumb {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // In production: SHA-256 of canonical JSON of this breadcrumb
  const hash = `bc_${id.replace(/-/g, '').substring(0, 16)}`;

  return {
    id,
    agentPublicKey: ant?.identity.publicKey ?? 'router',
    taskId: task.id,
    cell: task.originCell,
    eventType,
    delegationCertHash,
    hash,
    agentSignature: 'stub_sig', // TODO: sign with router's Ed25519 key
    timestamp,
  };
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the task caller's Ed25519 signature.
 * Accepts real Ed25519 signatures (128 hex) or legacy stubs in dev mode.
 */
function verifyTaskSignature(task: GeiantTask): boolean {
  const { callerSignature, ...payload } = task as any;

  if (!callerSignature || callerSignature.length === 0) {
    return process.env.NODE_ENV === 'development' || process.env.GEIANT_ENV === 'dev';
  }

  if (isValidSignature(callerSignature) && isValidPublicKey(task.callerPublicKey ?? '')) {
    return verifyMessage(payload, callerSignature, task.callerPublicKey!);
  }

  // Legacy stub signatures accepted in dev
  if (process.env.NODE_ENV === 'development' || process.env.GEIANT_ENV === 'dev') {
    return callerSignature.length > 0;
  }

  return false;
}
