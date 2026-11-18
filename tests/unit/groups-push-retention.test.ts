import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { NOTIFICATION_TTL_MS, pruneNotifications, takePending } from '@/lib/groups-push';
import { makeUser } from './helpers';

// Los avisos push guardan hasta 240 caracteres del mensaje: no pueden quedar
// guardados después de entregados ni más de 24 h sin entregar.

async function insert(ws: string, person: string, createdAt: string, deliveredAt: string | null = null): Promise<string> {
  const id = randomUUID();
  await getDb()
    .prepare('INSERT INTO groups_notifications (id, user_id, person_id, chat_id, title, body, url, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ws, person, null, 't', 'texto del aviso', '/app/lines/inbox', createdAt, deliveredAt);
  return id;
}

async function exists(id: string): Promise<boolean> {
  return !!(await getDb().prepare('SELECT 1 FROM groups_notifications WHERE id = ?').get(id));
}

describe('retención de los avisos push', () => {
  it('entregar un aviso lo borra (no queda el texto) y se entrega una sola vez', async () => {
    const u = await makeUser('push-ret-take');
    const id = await insert(u.id, u.id, new Date().toISOString());
    const [a, b] = await Promise.all([takePending(u.id, u.id), takePending(u.id, u.id)]);
    expect(a.length + b.length).toBe(1);
    expect([...a, ...b][0]).toMatchObject({ id, body: 'texto del aviso' });
    expect(await exists(id)).toBe(false);
  });

  it('el cron borra lo no entregado de más de 24 h y lo marcado como entregado, y deja lo reciente', async () => {
    const u = await makeUser('push-ret-prune');
    const now = Date.now();
    const old = await insert(u.id, u.id, new Date(now - NOTIFICATION_TTL_MS - 60_000).toISOString());
    const delivered = await insert(u.id, u.id, new Date(now - 60_000).toISOString(), new Date(now - 30_000).toISOString());
    const fresh = await insert(u.id, u.id, new Date(now - 60_000).toISOString());
    expect(await pruneNotifications(now)).toBeGreaterThanOrEqual(2);
    expect(await exists(old)).toBe(false);
    expect(await exists(delivered)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    // Idempotente: otra corrida no toca lo reciente.
    await pruneNotifications(now);
    expect(await exists(fresh)).toBe(true);
  });

  it('borra por lotes hasta vaciar lo vencido', async () => {
    const u = await makeUser('push-ret-batch');
    const now = Date.now();
    const ids = await Promise.all(Array.from({ length: 7 }, () => insert(u.id, u.id, new Date(now - 2 * NOTIFICATION_TTL_MS).toISOString())));
    await pruneNotifications(now, 3, 10);
    for (const id of ids) expect(await exists(id)).toBe(false);
  });
});
