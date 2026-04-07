// packages/brain-graph/src/temporal.ts
// Archivist Hunt — Temporal endpoint handlers
// Mount these in index.ts: import { registerTemporalEndpoints } from './temporal';
// Then call: registerTemporalEndpoints(app);

import { Hono } from 'hono';
import { runTemporalMigration } from './schema';

interface Env {
  BRAIN_DB: D1Database;
  GITHUB_TOKEN: string;
}

export function registerTemporalEndpoints(app: Hono<{ Bindings: Env }>) {

  // POST /migrate/temporal — add temporal validity columns to brain_nodes
  app.post('/migrate/temporal', async (c) => {
    try {
      await runTemporalMigration(c.env.BRAIN_DB);
      return c.json({ success: true, message: 'Temporal columns added + backfilled' });
    } catch (e) {
      return c.json({ success: false, error: (e as Error).message }, 500);
    }
  });

  // POST /node/supersede — mark a node as superseded by a newer one
  app.post('/node/supersede', async (c) => {
    try {
      const { old_id, new_id } = await c.req.json<{ old_id: string; new_id: string }>();
      if (!old_id || !new_id) {
        return c.json({ error: 'old_id and new_id are required' }, 400);
      }
      const now = new Date().toISOString();

      // Verify both nodes exist
      const oldNode = await c.env.BRAIN_DB.prepare('SELECT id, title FROM brain_nodes WHERE id = ?')
        .bind(old_id).first();
      const newNode = await c.env.BRAIN_DB.prepare('SELECT id, title FROM brain_nodes WHERE id = ?')
        .bind(new_id).first();

      if (!oldNode) return c.json({ error: `Node ${old_id} not found` }, 404);
      if (!newNode) return c.json({ error: `Node ${new_id} not found` }, 404);

      await c.env.BRAIN_DB.prepare(
        `UPDATE brain_nodes SET status = 'superseded', valid_to = ?, superseded_by = ? WHERE id = ?`
      ).bind(now, new_id, old_id).run();

      return c.json({
        success: true,
        superseded: old_id,
        by: new_id,
        valid_to: now,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  // GET /node/history/:id — view a node's temporal history (what superseded what)
  app.get('/node/history/:id', async (c) => {
    const id = c.req.param('id');
    try {
      // Get the node itself
      const node = await c.env.BRAIN_DB.prepare('SELECT * FROM brain_nodes WHERE id = ?')
        .bind(id).first();
      if (!node) return c.json({ error: 'Node not found' }, 404);

      // Get nodes this one superseded
      const superseded = await c.env.BRAIN_DB.prepare(
        'SELECT id, title, status, valid_from, valid_to FROM brain_nodes WHERE superseded_by = ?'
      ).bind(id).all();

      // Get node that superseded this one (if any)
      const supersededBy = (node as any).superseded_by
        ? await c.env.BRAIN_DB.prepare(
            'SELECT id, title, status, valid_from FROM brain_nodes WHERE id = ?'
          ).bind((node as any).superseded_by).first()
        : null;

      return c.json({
        node,
        superseded_nodes: superseded.results,
        superseded_by: supersededBy,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });
}
