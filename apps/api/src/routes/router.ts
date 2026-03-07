// =============================================================================
// GEIANT API — /route
// Submit a task to the geospatial router.
// =============================================================================

import { Router, Request, Response } from 'express';
import { GeiantRouter, GeiantTask, McpSwitchboard } from '@geiant/core';
import { z } from 'zod';

export const routerRoutes = Router();

// ---------------------------------------------------------------------------
// POST /route — submit a task
// ---------------------------------------------------------------------------

/**
 * @route  POST /route
 * @desc   Submit a GeiantTask for routing. Returns a RoutingDecision.
 *
 * The router runs all 4 gates:
 *   1. Signature verification
 *   2. Jurisdiction resolution
 *   3. Delegation chain validation
 *   4. Geometry pre-flight
 *
 * Then selects the best-fit ant from the registry.
 */
routerRoutes.post('/', async (req: Request, res: Response) => {
  const geiantRouter: GeiantRouter = req.app.locals.geiantRouter;

  // Basic shape validation
  const taskSchema = z.object({
    id: z.string().uuid(),
    originCell: z.string().min(15),
    requiredFacet: z.string(),
    minTier: z.enum(['provisioned', 'observed', 'trusted', 'certified', 'sovereign']),
    payload: z.object({
      type: z.string(),
      instruction: z.string(),
      params: z.record(z.unknown()).optional(),
    }),
    delegationCert: z.object({
      id: z.string(),
      humanPublicKey: z.string().length(64),
      humanHandle: z.string(),
      agentPublicKey: z.string().length(64),
      scopeCells: z.array(z.string()),
      scopeFacets: z.array(z.string()),
      validFrom: z.string(),
      validUntil: z.string(),
      maxSubdelegationDepth: z.number().int().min(0),
      humanSignature: z.string().length(128),
    }),
    geometries: z.array(z.any()).optional(),
    callerPublicKey: z.string().length(64),
    callerSignature: z.string().min(1),
  });

  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid task format',
      details: parsed.error.flatten(),
    });
  }

  const task = parsed.data as GeiantTask;
  task.submittedAt = new Date().toISOString();

  try {
    const decision = await geiantRouter.route(task);

    // If routing succeeded and task has a spatial payload → dispatch to MCP
    let mcpResult = null;
    if (decision.success && decision.selectedAnt) {
      const switchboard: McpSwitchboard = req.app.locals.switchboard;
      const spatialTypes = ['spatial_analysis', 'gis_operation', 'jurisdictional_check', 'compliance_audit', 'general'];
      if (spatialTypes.includes(task.payload.type)) {
        try {
          mcpResult = await switchboard.dispatch(task, decision);
        } catch (mcpErr) {
          // MCP dispatch failure is non-fatal — routing still succeeded
          console.warn('⚠️  MCP dispatch error (non-fatal):', mcpErr);
        }
      }
    }

    const status = decision.success ? 200 : 422;
    return res.status(status).json({
      success: decision.success,
      data: decision,
      ...(mcpResult && { mcp: mcpResult }),
    });
  } catch (err) {
    console.error('🐜💥 Router error:', err);
    return res.status(500).json({ success: false, error: 'Router internal error' });
  }
});

// ---------------------------------------------------------------------------
// GET /route/test — quick health check with a synthetic task
// ---------------------------------------------------------------------------

routerRoutes.get('/test', async (req: Request, res: Response) => {
  const geiantRouter: GeiantRouter = req.app.locals.geiantRouter;

  // Synthetic task — Rome, grid facet
  const task: GeiantTask = {
    id: crypto.randomUUID(),
    originCell: '851e8053fffffff', // Rome H3 res-5 cell (matches grid ant territory)
    requiredFacet: 'grid',
    minTier: 'observed',
    payload: {
      type: 'spatial_analysis',
      instruction: 'Compute area of Rome grid zone',
      params: { operation: 'area' },
    },
    delegationCert: {
      id: crypto.randomUUID(),
      humanPublicKey: 'a'.repeat(64),
      humanHandle: '@test_human',
      agentPublicKey: 'b'.repeat(64),
      scopeCells: ['851e8053fffffff'],
      scopeFacets: ['grid', 'general'],
      validFrom: new Date(Date.now() - 3600000).toISOString(),
      validUntil: new Date(Date.now() + 3600000).toISOString(),
      maxSubdelegationDepth: 1,
      humanSignature: 'a'.repeat(128),
    },
    geometries: [{
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[12.3, 41.8], [12.7, 41.8], [12.7, 42.1], [12.3, 42.1], [12.3, 41.8]]],
      },
      properties: { name: 'Rome test zone' },
    }],
    submittedAt: new Date().toISOString(),
    callerPublicKey: 'b'.repeat(64),
    callerSignature: 'test_sig',
  };

  const decision = await geiantRouter.route(task);

  // Dispatch to MCP switchboard if routing succeeded
  let mcpResult = null;
  if (decision.success && decision.selectedAnt) {
    const switchboard: McpSwitchboard = req.app.locals.switchboard;
    try {
      mcpResult = await switchboard.dispatch(task, decision);
    } catch (e) {
      console.warn('MCP dispatch error in test:', e);
    }
  }

  return res.json({ success: true, data: decision, ...(mcpResult && { mcp: mcpResult }) });
});
