import type { Db } from '../db/pool.js';
import { pool } from '../db/pool.js';

export interface Actor {
  type: 'admin' | 'kiosk' | 'system' | 'provider';
  id?: number | null;
  name?: string | null;
  ip?: string | null;
}

export const systemActor: Actor = { type: 'system', name: 'system' };

export async function audit(
  actor: Actor,
  action: string,
  entityType: string | null,
  entityId: string | number | null,
  details: Record<string, unknown> = {},
  db: Db = pool,
) {
  await db.query(
    `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity_type, entity_id, details, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.type, actor.id ?? null, actor.name ?? null, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(details), actor.ip ?? null],
  );
}
