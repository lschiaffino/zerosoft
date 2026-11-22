import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createContact } from '@/lib/crm';
import { setMemberVisibility } from '@/lib/crm-visibility';
import type { SessionUser } from '@/lib/session';
import { resetFakeHubspotPortal, seedSyncPortal, type FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { runInboundStep } from '@/lib/crm-hubspot-sync/inbound';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

/**
 * Sync zerosoft → HubSpot: quién ve y prende la escritura (anónimo, otro
 * workspace, compañero y owner), que ninguna respuesta lleve la clave ni datos
 * de registros, y que una persona del equipo no pueda hacer salir a HubSpot
 * un registro que no ve.
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const conn = await import('@/app/api/crm/hubspot-sync/route');
const inbound = await import('@/app/api/crm/hubspot-sync/inbound/route');
const outbound = await import('@/app/api/crm/hubspot-sync/outbound/route');
const contactRoute = await import('@/lib/routes/crm/contacts/[id]/route');

const KEY = 'pat-na1-outbound-access-legacy';
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

const post = (body: unknown) => outbound.POST(new NextRequest('http://localhost/api/crm/hubspot-sync/outbound', { method: 'POST', body: JSON.stringify(body) }));
type View = { outbound: { state: string; enabled: boolean; queued: number } };

/** Owner conectado, con la entrada al día. */
async function liveWorkspace(label: string) {
  const w = await workspaceWithMember(label);
  session.user = asOwner(w.owner);
  expect((await conn.POST(new NextRequest('http://localhost/api/crm/hubspot-sync', { method: 'POST', body: JSON.stringify({ token: KEY }) }))).status).toBe(200);
  expect((await inbound.POST(new NextRequest('http://localhost/api/crm/hubspot-sync/inbound', { method: 'POST', body: JSON.stringify({ action: 'start' }) }))).status).toBe(200);
  await getDb().prepare('UPDATE crm_hubspot_inbound SET next_run_at = NULL WHERE user_id = ?').run(w.owner.id);
  for (let i = 0; i < 50; i++) if ((await runInboundStep(w.owner.id, { budgetMs: 30_000 })) === 'idle') break;
  return w;
}

describe('quién entra', () => {
  it('solo admins ven, previsualizan, prenden, apagan y vacían la cola; nada lleva la clave ni datos', async () => {
    const w = await liveWorkspace('hsoutacc');
    expect(((await (await outbound.GET()).json()) as View).outbound.state).toBe('off');
    // Sin vista previa no se prende.
    expect((await post({ action: 'enable' })).status).toBe(409);

    for (const r of roles(w)) {
      session.user = r.user;
      const calls = {
        get: await outbound.GET(),
        preview: await post({ action: 'preview' }),
        enable: await post({ action: 'enable' }),
        run: await post({ action: 'run' }),
        disable: await post({ action: 'disable' }),
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
        // Su workspace no está conectado: no ve ni prende el del otro.
        expect(((await calls.get.json()) as View).outbound.state).toBe('unavailable');
        expect(calls.preview.status).toBe(409);
        expect(calls.enable.status).toBe(409);
      } else {
        expect(calls.preview.status).toBe(200);
        expect(calls.enable.status).toBe(200);
        expect(calls.run.status).toBe(200);
        expect(((await calls.disable.json()) as View).outbound.enabled).toBe(false);
      }
    }
    // Lo prendió y lo apagó el owner; nadie más lo cambió.
    expect(await getDb().prepare('SELECT mode, enabled_by FROM crm_hubspot_outbound WHERE user_id = ?').get(w.owner.id)).toEqual({ mode: 'off', enabled_by: w.owner.id });
  });

  it('valida el cuerpo', async () => {
    await liveWorkspace('hsoutacc2');
    expect((await post({ action: 'nope' })).status).toBe(400);
    expect((await post({ action: 'enable', force: true })).status).toBe(400);
  });
});

describe('una persona del equipo no hace salir lo que no ve', () => {
  it('editar un contacto que no ve falla y no encola; el suyo sí entra a la cola', async () => {
    const w = await liveWorkspace('hsoutvis');
    expect((await post({ action: 'preview' })).status).toBe(200);
    expect((await post({ action: 'enable' })).status).toBe(200);
    await setMemberVisibility(w.owner.id, 'mine');
    const hidden = await createContact(w.owner.id, { firstName: 'Hidden', email: 'hidden@client.test', ownerId: w.friend.id });
    const mine = await createContact(w.owner.id, { firstName: 'Mine', email: 'mine@client.test', ownerId: w.member.id });
    await getDb().prepare('DELETE FROM crm_hubspot_outbox WHERE user_id = ?').run(w.owner.id);

    session.user = asMember(w.owner, w.member);
    const patch = (id: string) =>
      contactRoute.PATCH(new NextRequest(`http://localhost/api/crm/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ jobTitle: 'Changed' }), headers: { 'content-type': 'application/json' } }), {
        params: Promise.resolve({ id }),
      });
    expect((await patch(hidden.id))!.status).toBe(404);
    const queued = () => getDb().prepare('SELECT record_id FROM crm_hubspot_outbox WHERE user_id = ?').all(w.owner.id) as Promise<Array<{ record_id: string }>>;
    expect(await queued()).toEqual([]);
    expect((await patch(mine.id))!.status).toBe(200);
    expect((await queued()).map((r) => r.record_id)).toEqual([mine.id]);
    // Y la persona del equipo no puede vaciar la cola ella misma.
    expect((await post({ action: 'run' })).status).toBe(403);
    expect(portal.calls.filter((c) => c.method === 'POST' && c.path === '/crm/v3/objects/contacts')).toEqual([]);
  });
});
