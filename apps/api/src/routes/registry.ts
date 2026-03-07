// =============================================================================
// GEIANT API — /registry routes
// =============================================================================

import { Router, Request, Response } from 'express';
import { InMemoryRegistry, AntManifest } from '@geiant/core';

export const registryRoutes = Router();

/** GET /registry — list all registered ants */
registryRoutes.get('/', async (req: Request, res: Response) => {
  const registry: InMemoryRegistry = req.app.locals.registry;
  const ants = await registry.list();
  res.json({ success: true, data: { count: ants.length, ants } });
});

/** GET /registry/:publicKey — get a specific ant */
registryRoutes.get('/:publicKey', async (req: Request, res: Response) => {
  const registry: InMemoryRegistry = req.app.locals.registry;
  const ant = await registry.get(req.params.publicKey);
  if (!ant) return res.status(404).json({ success: false, error: 'Ant not found' });
  res.json({ success: true, data: ant });
});

/** POST /registry — register a new ant */
registryRoutes.post('/', async (req: Request, res: Response) => {
  const registry: InMemoryRegistry = req.app.locals.registry;
  try {
    await registry.register(req.body as AntManifest);
    res.status(201).json({ success: true, message: 'Ant registered' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/** DELETE /registry/:publicKey — unregister an ant */
registryRoutes.delete('/:publicKey', async (req: Request, res: Response) => {
  const registry: InMemoryRegistry = req.app.locals.registry;
  await registry.unregister(req.params.publicKey);
  res.json({ success: true, message: 'Ant unregistered' });
});
