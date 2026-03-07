// =============================================================================
// GEIANT ROUTER — Standalone HTTP Routing Service
// Phase 2: GeoRouter as a public API
//
// Exposes the GeiantRouter (from @geiant/core) as a REST service.
// Any developer can POST a task and get back a compliant agent dispatch.
//
// Endpoints:
//   POST /route                  — 4-gate task routing
//   POST /delegate/verify        — delegation certificate validation
//   GET  /jurisdiction/:h3cell   — regulatory framework lookup
//   GET  /health                 — liveness check
//   GET  /                       — API info + links
//
// Deploy: Railway, same monorepo pattern as apps/api
// =============================================================================

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { GeiantRouter, SupabaseRegistry, createSupabaseRegistry, resolveJurisdiction, isOperationPermitted, validateDelegation } from '@geiant/core';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8081', 10);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request logger
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[GEIANT Router] ${req.method} ${req.path}`);
  next();
});

// ---------------------------------------------------------------------------
// Registry + Router initialisation
// ---------------------------------------------------------------------------

let router: GeiantRouter;

async function init() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const registry = await createSupabaseRegistry();
  const ants = await registry.list();
  console.log(`[GEIANT Router] ✓ SupabaseRegistry connected — ${ants.length} ant(s) loaded`);

  router = new GeiantRouter(registry);
  console.log('[GEIANT Router] ✓ GeiantRouter ready');
}

// ---------------------------------------------------------------------------
// GET / — API info
// ---------------------------------------------------------------------------

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'GEIANT GeoRouter',
    version: '0.1.0',
    description: 'Geospatial AI agent routing service. Routes tasks to compliant agents via 4-gate enforcement.',
    phase: 2,
    endpoints: {
      'POST /route': 'Route a task through jurisdiction, delegation, geometry, and registry checks',
      'POST /delegate/verify': 'Validate a delegation certificate chain',
      'GET /jurisdiction/:h3cell': 'Resolve regulatory frameworks for an H3 cell',
      'GET /health': 'Service liveness',
    },
    links: {
      benchmark: 'https://huggingface.co/datasets/cayerbe/geiant-benchmark',
      spec: 'https://github.com/GNS-Foundation/geiant/docs/GEIANT_PROTOCOL_SPEC.md',
      registry: process.env.GEIANT_API_URL ?? 'https://geiantapi-production.up.railway.app',
    },
    protocol: 'GEIANT/0.1 — Geo-Identity Agent Navigation & Tasking',
  });
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    router: router ? 'ready' : 'initializing',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /jurisdiction/:h3cell
// ---------------------------------------------------------------------------

app.get('/jurisdiction/:h3cell', async (req: Request, res: Response) => {
  const { h3cell } = req.params;

  if (!h3cell || h3cell.length < 10) {
    return res.status(400).json({
      error: 'invalid_cell',
      message: 'Provide a valid H3 cell ID (e.g. 8928308280fffff)',
    });
  }

  try {
    const jurisdiction = await resolveJurisdiction(h3cell);

    if (!jurisdiction) {
      return res.status(404).json({
        error: 'no_jurisdiction',
        message: `Cannot resolve jurisdiction for cell ${h3cell}`,
        cell: h3cell,
      });
    }

    // Include tier permission analysis if tier query param provided
    const tier = req.query.tier as string | undefined;
    let operationCheck;
    if (tier) {
      operationCheck = isOperationPermitted(jurisdiction, tier as any);
    }

    return res.json({
      cell: h3cell,
      jurisdiction,
      ...(operationCheck ? { operationPermitted: operationCheck } : {}),
    });
  } catch (err: any) {
    console.error('[GEIANT Router] /jurisdiction error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /delegate/verify
// ---------------------------------------------------------------------------

app.post('/delegate/verify', (req: Request, res: Response) => {
  const { cert, task } = req.body;

  if (!cert) {
    return res.status(400).json({
      error: 'missing_cert',
      message: 'Provide a delegation certificate in the request body as { cert, task }',
    });
  }

  try {
    const result = validateDelegation(cert, task ?? {});
    return res.json({
      valid: result.valid,
      ...(result.errorReason ? { errorReason: result.errorReason } : {}),
      cert: {
        id: cert.id,
        humanPublicKey: cert.humanPublicKey ? cert.humanPublicKey.substring(0, 16) + '...' : null,
        agentPublicKey: cert.agentPublicKey ? cert.agentPublicKey.substring(0, 16) + '...' : null,
        validUntil: cert.validUntil,
        maxSubdelegationDepth: cert.maxSubdelegationDepth,
        scopeFacets: cert.scopeFacets,
        scopeCellCount: cert.scopeCells?.length ?? 0,
      },
    });
  } catch (err: any) {
    console.error('[GEIANT Router] /delegate/verify error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /route  — the main event
// ---------------------------------------------------------------------------

app.post('/route', async (req: Request, res: Response) => {
  if (!router) {
    return res.status(503).json({
      error: 'not_ready',
      message: 'Router is still initializing. Retry in a few seconds.',
    });
  }

  const task = req.body;

  // Basic shape check before hitting the 4-gate router
  const required = ['id', 'originCell', 'requiredFacet', 'minTier', 'delegationCert'];
  const missing = required.filter(k => !task[k]);
  if (missing.length > 0) {
    return res.status(400).json({
      error: 'missing_fields',
      message: `Task is missing required fields: ${missing.join(', ')}`,
      required,
      example: {
        id: 'task_01HXYZ',
        originCell: '8928308280fffff',
        requiredFacet: 'infrastructure',
        minTier: 'trusted',
        callerPublicKey: '<ed25519 hex>',
        callerSignature: '<ed25519 sig hex or empty string in dev>',
        delegationCert: {
          id: 'cert_01HXYZ',
          humanPublicKey: '<ed25519 hex>',
          agentPublicKey: '<ed25519 hex>',
          scopeCells: ['8928308280fffff'],
          scopeFacets: ['infrastructure'],
          validUntil: new Date(Date.now() + 3600_000).toISOString(),
          maxSubdelegationDepth: 1,
          issuedAt: new Date().toISOString(),
          humanSignature: '<ed25519 sig hex>',
        },
        geometries: [],  // optional GeoJSON Feature[]
      },
    });
  }

  try {
    const decision = await router.route(task);

    const status = decision.success ? 200 : 422;
    return res.status(status).json({
      ...decision,
      // Redact full public keys in response — show prefix only
      selectedAnt: decision.selectedAnt ? {
        handle: decision.selectedAnt.identity.handle,
        tier: decision.selectedAnt.identity.tier,
        publicKey: decision.selectedAnt.identity.publicKey.substring(0, 16) + '...',
        territoryCellCount: decision.selectedAnt.identity.territoryCells.length,
        complianceScore: decision.selectedAnt.complianceScore,
        facet: decision.selectedAnt.identity.facet,
      } : null,
    });
  } catch (err: any) {
    console.error('[GEIANT Router] /route error:', err.message);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found', message: 'See GET / for available endpoints.' });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

init()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log(`🌍 GEIANT GeoRouter running on port ${PORT}`);
      console.log('   Phase 2 — Standalone Jurisdictional Routing Service');
      console.log('   Protocol: GEIANT/0.1');
      console.log('');
    });
  })
  .catch(err => {
    console.error('[GEIANT Router] Fatal init error:', err);
    process.exit(1);
  });
