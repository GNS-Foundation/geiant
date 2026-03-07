// =============================================================================
// GEIANT API — Express server
// =============================================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { InMemoryRegistry, GeiantRouter, seedDevRegistry, createSwitchboard } from '@geiant/core';
import { SupabaseRegistry } from '@geiant/core';
import { routerRoutes } from './routes/router.js';
import { registryRoutes } from './routes/registry.js';
import { jurisdictionRoutes } from './routes/jurisdiction.js';
import { healthRoutes } from './routes/health.js';
import { memoryRoutes } from './routes/memory.js';
import type { AgentRegistry } from '@geiant/core';

const app = express();
const PORT = process.env.PORT || 3100;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request logging — emoji prefix for easy Railway log correlation
app.use((req, _res, next) => {
  console.log(`🐜 ${req.method} ${req.path}`);
  next();
});

// ---------------------------------------------------------------------------
// Bootstrap registry + router
// ---------------------------------------------------------------------------
// SupabaseRegistry when env vars present, InMemoryRegistry as fallback.
// ---------------------------------------------------------------------------

async function bootstrapRegistry(): Promise<AgentRegistry> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    const sbRegistry = new SupabaseRegistry(supabaseUrl, serviceKey);
    const alive = await sbRegistry.ping();
    if (alive) {
      console.log('[GEIANT API] ✓ SupabaseRegistry connected');
      const ants = await sbRegistry.list();
      console.log(`[GEIANT API]   ${ants.length} ants loaded from Supabase`);
      return sbRegistry;
    }
    console.warn('[GEIANT API] ⚠ Supabase unreachable — falling back to InMemoryRegistry');
  } else {
    console.log('[GEIANT API] No Supabase env vars — using InMemoryRegistry');
  }

  const mem = new InMemoryRegistry();
  await seedDevRegistry(mem);
  return mem;
}

const registry      = await bootstrapRegistry();
const geiantRouter  = new GeiantRouter(registry);
const switchboard   = createSwitchboard();

// Attach to app for route handlers
app.locals.registry     = registry;
app.locals.geiantRouter = geiantRouter;
app.locals.switchboard  = switchboard;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/health',       healthRoutes);
app.use('/route',        routerRoutes);
app.use('/registry',     registryRoutes);
app.use('/jurisdiction', jurisdictionRoutes);
app.use('/memory',       memoryRoutes);

// ---------------------------------------------------------------------------
// 404 + error handlers
// ---------------------------------------------------------------------------

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\n🐜 GEIANT API running on port ${PORT}`);
  console.log(`   Geo-Identity Agent Navigation & Tasking`);
  console.log(`   Registry: ${process.env.SUPABASE_URL ? 'Supabase' : 'InMemory'}`);
  console.log(`   ENV: ${process.env.NODE_ENV ?? 'development'}\n`);
});

export default app;
