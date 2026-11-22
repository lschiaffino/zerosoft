import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { updateContact } from '@/lib/crm';
import type { SessionUser } from '@/lib/session';
import { resetFakeHubspotPortal, seedSyncPortal, type FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { runInboundStep } from '@/lib/crm-hubspot-sync/inbound';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

/**
 * Conflictos del sync con HubSpot y reintento de rechazados (S4): quién ve,
 * lee los valores de cada lado y resuelve (anónimo, otro workspace, persona
 * del equipo, admin y owner). Ninguna respuesta lleva la clave.
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const conn = await import('@/app/api/crm/hubspot-sync/route');
const inbound = await import('@/app/api/crm/hubspot-sync/inbound/route');
const outbound = await import('@/app/api/crm/hubspot-sync/outbound/route');
const conflicts = await import('@/app/api/crm/hubspot-sync/conflicts/route');

const KEY = 'pat-na1-conflicts-access-legacy';
let portal: FakeHubspotPortal;

beforeEach(() => {
  vi.stubEnv('CRM_IMPORT_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  portal = resetFakeHubspotPortal('crm', seedSyncPortal);
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

const URL = 'http://localhost/api/crm/hubspot-sync/conflicts';
const post = (body: unknown) => conflicts.POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
const get = () => conflicts.GET(new NextRequest(URL));

async function inboundPass(ws: string) {
  await getDb().prepare('UPDATE crm_hubspot_inbound SET next_run_at = NULL, locked_until = NULL WHERE user_id = ?').run(ws);
  for (let i = 0; i < 50; i++) if ((await runInboundStep(ws, { budgetMs: 30_000 })) === 'idle') break;
}

/** Owner conectado, con la entrada al día y un contacto en conflicto. */
async function withConflict(label: string) {
  const w = await workspaceWithMember(label);
  session.user = asOwner(w.owner);
  expect((await conn.POST(new NextRequest('http://localhost/api/crm/hubspot-sync', { method: 'POST', body: JSON.stringify({ token: KEY }) }))).status).toBe(200);
  expect((await inbound.POST(new NextRequest('http://localhost/api/crm/hubspot-sync/inbound', { method: 'POST', body: JSON.stringify({ action: 'start' }) }))).status).toBe(200);
  await inboundPass(w.owner.id);
  const link = (await getDb().prepare(`SELECT record_id FROM crm_hubspot_links WHERE user_id = ? AND object = 'contact' AND hubspot_id = '4001'`).get(w.owner.id)) as { record_id: string };
  await updateContact(w.owner.id, link.record_id, { jobTitle: 'Title here' });
  portal.edit('contacts', '4001', { jobtitle: 'Title there' });
  await inboundPass(w.owner.id);
  return { ...w, id: link.record_id };
}

describe('quién entra', () => {
  it('solo owners y admins listan, leen los dos lados, resuelven y reintentan; nada lleva la clave', async () => {
    const w = await withConflict('hsconfacc');
    const admin = asMember(w.owner, w.friend, 'admin');
    for (const r of [...roles(w), { name: 'admin' as const, user: admin }]) {
      session.user = r.user;
      const calls = {
        list: await get(),
        detail: await post({ action: 'detail', object: 'contact', recordId: w.id }),
        dismiss: await post({ action: 'dismiss', object: 'activity', recordId: 'none' }),
        retry: await outbound.POST(new NextRequest('http://localhost/api/crm/hubspot-sync/outbound', { method: 'POST', body: JSON.stringify({ action: 'retry_failed' }) })),
      };
      for (const res of Object.values(calls)) expect(await res.clone().text()).not.toContain(KEY);
      if (r.name === 'anonymous') for (const [k, res] of Object.entries(calls)) expect(res.status, k).toBe(401);
      else if (r.name === 'teammate') for (const [k, res] of Object.entries(calls)) expect(res.status, k).toBe(403);
      else if (r.name === 'other_workspace') {
        // Su workspace no tiene conflictos ni ve los del otro.
        expect(((await calls.list.json()) as { conflicts: { total: number } }).conflicts.total).toBe(0);
        expect(calls.detail.status).toBe(404);
        expect((await post({ action: 'resolve', object: 'contact', recordId: w.id, keep: { job_title: 'hubspot' } })).status).toBe(404);
        expect((await post({ action: 'resolve_all', keep: 'hubspot' })).status).toBe(409);
      } else {
        expect(((await calls.list.json()) as { conflicts: { total: number } }).conflicts.total).toBe(1);
        expect(calls.detail.status).toBe(200);
        expect(calls.retry.status).toBe(200);
        expect(calls.dismiss.status).toBe(404);
      }
    }
    // El conflicto sigue (nadie lo resolvió); lo resuelve un admin.
    expect(await getDb().prepare('SELECT job_title FROM crm_contacts WHERE id = ?').get(w.id)).toEqual({ job_title: 'Title here' });
    session.user = admin;
    const res = await post({ action: 'resolve', object: 'contact', recordId: w.id, keep: { job_title: 'hubspot' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, resolved: 1, remaining: 0 });
    expect(await getDb().prepare('SELECT job_title FROM crm_contacts WHERE id = ?').get(w.id)).toEqual({ job_title: 'Title there' });
    // Una persona del equipo no puede resolver.
    session.user = asMember(w.owner, w.member);
    expect((await post({ action: 'resolve_all', keep: 'here' })).status).toBe(403);
  });

  it('valida el cuerpo', async () => {
    const w = await withConflict('hsconfacc2');
    expect((await post({ action: 'nope' })).status).toBe(400);
    expect((await post({ action: 'resolve', object: 'contact', recordId: w.id, keep: {} })).status).toBe(400);
    expect((await post({ action: 'resolve', object: 'contact', recordId: w.id, keep: { job_title: 'both' } })).status).toBe(400);
    expect((await post({ action: 'resolve_all', keep: 'hubspot', object: 'activity' })).status).toBe(400);
    expect((await post({ action: 'detail', object: 'contact', recordId: w.id, extra: 1 })).status).toBe(400);
  });
});
