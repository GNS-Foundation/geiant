// =============================================================================
// GEIANT API — /jurisdiction routes
// =============================================================================

import { Router, Request, Response } from 'express';
import { resolveJurisdiction, isOperationPermitted, AntTier } from '@geiant/core';

export const jurisdictionRoutes = Router();

/**
 * GET /jurisdiction/:cell
 * Resolve the regulatory context for an H3 cell.
 * This is the Jurisdictional Resolution API — the core commercial endpoint.
 */
jurisdictionRoutes.get('/:cell', async (req: Request, res: Response) => {
  const result = await resolveJurisdiction(req.params.cell);
  if (!result) {
    return res.status(422).json({
      success: false,
      error: `Cannot resolve jurisdiction for cell ${req.params.cell}`,
    });
  }
  res.json({ success: true, data: result });
});

/**
 * GET /jurisdiction/:cell/permit/:tier
 * Check if a given agent tier is permitted to operate in this cell
 * under the most restrictive framework.
 */
jurisdictionRoutes.get('/:cell/permit/:tier', async (req: Request, res: Response) => {
  const jurisdiction = await resolveJurisdiction(req.params.cell);
  if (!jurisdiction) {
    return res.status(422).json({ success: false, error: 'Cannot resolve jurisdiction' });
  }

  const tier = req.params.tier as AntTier;
  const result = isOperationPermitted(jurisdiction, tier);

  res.json({
    success: true,
    data: {
      cell: req.params.cell,
      tier,
      permitted: result.permitted,
      restrictingFramework: result.restrictingFramework ?? null,
      jurisdiction,
    },
  });
});

// =============================================================================
// GEIANT API — /health
// =============================================================================

import { InMemoryRegistry } from '@geiant/core';

export const healthRoutes = Router();

healthRoutes.get('/', (req: Request, res: Response) => {
  const registry: InMemoryRegistry = req.app.locals.registry;
  res.json({
    success: true,
    data: {
      service: 'GEIANT API',
      tagline: 'Geo-Identity Agent Navigation & Tasking',
      version: '0.1.0',
      status: 'operational',
      registry: {
        ants: registry.size,
      },
      timestamp: new Date().toISOString(),
    },
  });
});
