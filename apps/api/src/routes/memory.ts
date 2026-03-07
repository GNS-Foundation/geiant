// =============================================================================
// GEIANT API — /memory routes
// Spatial Memory graph endpoints
// =============================================================================

import { Router, Request, Response } from 'express';
import { getSpatialMemory, GeometryValidationError } from '@geiant/core';

export const memoryRoutes = Router();

const mem = getSpatialMemory();

/** POST /memory/features — create a new geometry in spatial memory */
memoryRoutes.post('/features', async (req: Request, res: Response) => {
  const { featureId, feature, taskId, agentPublicKey, delegationCertHash } = req.body;
  if (!featureId || !feature || !taskId || !agentPublicKey || !delegationCertHash) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  try {
    const result = await mem.create({ featureId, feature, taskId, agentPublicKey, delegationCertHash });
    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    if (err instanceof GeometryValidationError) {
      return res.status(422).json({ success: false, error: err.message, validation: err.validationResult });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /memory/features/:featureId/mutate — mutate an existing geometry */
memoryRoutes.post('/features/:featureId/mutate', async (req: Request, res: Response) => {
  const { newFeature, mutationType, taskId, agentPublicKey, delegationCertHash } = req.body;
  try {
    const result = await mem.mutate({
      featureId: req.params.featureId,
      newFeature,
      mutationType,
      taskId,
      agentPublicKey,
      delegationCertHash,
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    if (err instanceof GeometryValidationError) {
      return res.status(422).json({ success: false, error: err.message, validation: err.validationResult });
    }
    return res.status(404).json({ success: false, error: err.message });
  }
});

/** GET /memory/features/:featureId — get current head */
memoryRoutes.get('/features/:featureId', (req: Request, res: Response) => {
  const node = mem.getHead(req.params.featureId);
  if (!node) return res.status(404).json({ success: false, error: 'Feature not found' });
  res.json({ success: true, data: node });
});

/** GET /memory/features/:featureId/history — full mutation history */
memoryRoutes.get('/features/:featureId/history', async (req: Request, res: Response) => {
  const history = await mem.getHistory(req.params.featureId);
  res.json({ success: true, data: { count: history.length, history } });
});

/** GET /memory/features/:featureId/verify — verify chain integrity */
memoryRoutes.get('/features/:featureId/verify', async (req: Request, res: Response) => {
  const result = await mem.verifyChain(req.params.featureId);
  res.json({ success: true, data: result });
});

/** POST /memory/features/:featureId/rollback — rollback to a previous hash */
memoryRoutes.post('/features/:featureId/rollback', async (req: Request, res: Response) => {
  const { targetHash, taskId, agentPublicKey, delegationCertHash } = req.body;
  try {
    const result = await mem.rollback({
      featureId: req.params.featureId,
      targetHash,
      taskId,
      agentPublicKey,
      delegationCertHash,
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/** GET /memory/query — query nodes by criteria */
memoryRoutes.get('/query', async (req: Request, res: Response) => {
  const { cell, agentPublicKey, taskId, mutationType, since, until, limit } = req.query;
  const results = await mem.query({
    cell: cell as string,
    agentPublicKey: agentPublicKey as string,
    taskId: taskId as string,
    mutationType: mutationType as any,
    since: since as string,
    until: until as string,
    limit: limit ? parseInt(limit as string) : undefined,
  });
  res.json({ success: true, data: { count: results.length, nodes: results } });
});

/** GET /memory/stats — graph statistics */
memoryRoutes.get('/stats', (_req: Request, res: Response) => {
  res.json({ success: true, data: mem.stats });
});
