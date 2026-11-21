import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { resetFakeHubspotPortal, seedSyncPortal } from '@/lib/hubspot/fake-portal';
import { asOwner, roles, workspaceWithMember } from './access-helpers';

/**
 * Sync HubSpot → CRM: quién entra a sus rutas (anónimo, otro workspace,
 * compañero y owner) y que ninguna respuesta lleve la clave ni datos de
 * registros (solo conteos y códigos).
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const conn = await import('@/app/api/crm/hubspot-sync/route');
const inbound = await import('@/app/api/crm/hubspot-sync/inbound/route');
const run = await import('@/app/api/crm/hubspot-sync/inbound/run/route');

const KEY = 'pat-na1-inbound-access-legacy';

beforeEach(() => {
  vi.stubEnv('CRM_IMPORT_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeHubspotPortal('crm', seedSyncPortal);
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

const post = (body: unknown) => inbound.POST(new NextRequest('http://localhost/api/crm/hubspot-sync/inbound', { method: 'POST', body: JSON.stringify(body) }));

describe('quién entra', () => {
  it('solo admins arrancan, pausan, ven el estado y empujan tramos; nada lleva la clave ni datos', async () => {
    const w = await workspaceWithMember('hsinacc');
    session.user = asOwner(w.owner);
    expect((await conn.POST(new NextRequest('http://localhost/api/crm/hubspot-sync', { method: 'POST', body: JSON.stringify({ token: KEY }) }))).status).toBe(200);
    // Antes de arrancar: apagado.
    expect(((await (await inbound.GET()).json()) as { inbound: { state: string } }).inbound.state).toBe('off');
    expect((await post({ action: 'pause' })).status).toBe(409);
    expect((await post({ action: 'start', objects: { emails: false } })).status).toBe(200);
    for (let i = 0; i < 30; i++) {
      const body = (await (await run.POST()).json()) as { inbound: { state: string } };
      if (body.inbound.state === 'live') break;
    }
    expect(await getDb().prepare('SELECT COUNT(*) AS n FROM crm_contacts WHERE user_id = ?').get(w.owner.id)).toEqual({ n: 3 });

    for (const r of roles(w)) {
      session.user = r.user;
      const calls = {
        get: await inbound.GET(),
        run: await run.POST(),
        pause: await post({ action: 'pause' }),
        resume: await post({ action: 'resume' }),
        objects: await post({ action: 'objects', objects: { notes: false } }),
      };
      const texts = await Promise.all(Object.values(calls).map((res) => res.clone().text()));
      for (const text of texts) {
        expect(text).not.toContain(KEY);
        expect(text).not.toContain('northwind');
        expect(text).not.toContain('Quiroga');
      }
      if (r.name === 'anonymous') for (const [k, res] of Object.entries(calls)) expect(res.status, k).toBe(401);
      else if (r.name === 'teammate') for (const [k, res] of Object.entries(calls)) expect(res.status, k).toBe(403);
      else if (r.name === 'other_workspace') {
        // Su workspace no está conectado ni arrancado: no ve ni toca el del otro.
        expect(((await calls.get.json()) as { inbound: { state: string; linked: { contacts: number } } }).inbound).toMatchObject({ state: 'off', linked: { contacts: 0 } });
        expect(calls.pause.status).toBe(409);
        expect(calls.objects.status).toBe(409);
      } else {
        expect(calls.get.status).toBe(200);
        expect(((await calls.objects.json()) as { inbound: { objects: { notes: boolean } } }).inbound.objects.notes).toBe(false);
      }
    }
    // El owner sigue con su sync prendido; nadie más lo pausó.
    expect(await getDb().prepare('SELECT enabled, paused FROM crm_hubspot_sync_settings WHERE user_id = ?').get(w.owner.id)).toEqual({ enabled: 1, paused: 0 });
  });

  it('valida el cuerpo y pide conexión', async () => {
    const w = await workspaceWithMember('hsinacc2');
    session.user = asOwner(w.owner);
    expect((await post({ action: 'start', objects: { tickets: true } })).status).toBe(400);
    expect((await post({ action: 'nope' })).status).toBe(400);
    const res = await post({ action: 'start' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_connected' });
  });
});
