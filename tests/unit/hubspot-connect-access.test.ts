import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

/**
 * Acceso a las dos pantallas que conectan HubSpot: Lines › Integraciones
 * (/api/groups/hubspot) y el importador del CRM (/api/crm/import/jobs). Quién
 * puede conectar y desconectar, que nada cruce de un workspace a otro y que
 * la clave no vuelva nunca por una respuesta ni quede en claro en la base.
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const lines = await import('@/app/api/groups/hubspot/route');
const jobs = await import('@/app/api/crm/import/jobs/route');
const job = await import('@/lib/routes/crm/import/jobs/[id]/route');

const SERVICE_KEY = 'pat-na1-svc-access-test-key';
const LEGACY = 'pat-na1-access-test-legacy';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('CRM_IMPORT_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeHubspot();
});
afterEach(() => {
  session.user = null;
});

const linesUrl = 'http://localhost/api/groups/hubspot';
const linesPost = (body: unknown) => lines.POST(new Request(linesUrl, { method: 'POST', body: JSON.stringify(body) }));
const linesGet = () => lines.GET(new Request(linesUrl));
const jobsPost = (body: unknown) => jobs.POST(new NextRequest('http://localhost/api/crm/import/jobs', { method: 'POST', body: JSON.stringify(body) }));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jobReq = (method = 'GET') => new NextRequest('http://localhost/api/crm/import/jobs/x', { method });

const stored = async (ws: string) => ((await getDb().prepare('SELECT token, portal_id, token_kind FROM groups_hubspot WHERE user_id = ?').get(ws)) as { token: string; portal_id: string; token_kind: string } | undefined) ?? null;

describe('Lines › HubSpot: quién conecta y desconecta', () => {
  it('anónimo, otro workspace, compañero y owner', async () => {
    const w = await workspaceWithMember('hsacc');
    session.user = asOwner(w.owner);
    expect((await linesPost({ token: LEGACY })).status).toBe(200);

    for (const r of roles(w)) {
      session.user = r.user;
      const get = await linesGet();
      const body = await get.text();
      expect(body, r.name).not.toContain(LEGACY);
      if (r.name === 'anonymous') {
        expect(get.status).toBe(401);
        expect((await linesPost({ token: SERVICE_KEY })).status).toBe(401);
        expect((await lines.DELETE()).status).toBe(401);
      } else if (r.name === 'other_workspace') {
        // Ve su propio workspace: sin conexión y sin rastro de la cuenta del otro.
        expect(JSON.parse(body)).toMatchObject({ connected: false, portalId: '', scopes: [] });
        expect((await lines.DELETE()).status).toBe(404);
      } else if (r.name === 'teammate') {
        expect(JSON.parse(body)).toEqual({ connected: true });
        expect((await linesPost({ token: SERVICE_KEY })).status).toBe(403);
        expect((await linesPost({ autoLink: true })).status).toBe(403);
        expect((await lines.DELETE()).status).toBe(403);
      } else {
        expect(JSON.parse(body)).toMatchObject({ connected: true, portalId: '424242', tokenKind: 'private_app' });
      }
      // Pase lo que pase, la conexión del workspace sigue igual.
      expect((await stored(w.owner.id))?.token_kind, r.name).toBe('private_app');
    }
  });

  it('otro workspace conecta su propia clave y no toca la del primero', async () => {
    const w = await workspaceWithMember('hsacc2');
    session.user = asOwner(w.owner);
    await linesPost({ token: LEGACY });
    session.user = asOwner(w.stranger);
    const res = await linesPost({ token: SERVICE_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, tokenKind: 'service_key' });
    expect((await stored(w.owner.id))?.token_kind).toBe('private_app');
    expect((await stored(w.stranger.id))?.token_kind).toBe('service_key');
    expect((await lines.DELETE()).status).toBe(200);
    expect((await stored(w.owner.id))?.token).not.toBe('');
    expect((await stored(w.stranger.id))?.token).toBe('');
  });

  it('un admin conecta con una service key: cuenta, tipo y permisos, y la clave no vuelve ni queda en claro', async () => {
    const w = await workspaceWithMember('hsacc3');
    session.user = asMember(w.owner, w.member, 'admin');
    const res = await linesPost({ token: SERVICE_KEY });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SERVICE_KEY);
    const dto = JSON.parse(text) as { scopes: string[] };
    expect(dto).toMatchObject({ connected: true, portalId: '424242', tokenKind: 'service_key', missingLogScopes: [], missingSyncScopes: [] });
    expect(dto.scopes).toEqual(expect.arrayContaining(['crm.objects.companies.read', 'crm.objects.companies.write', 'crm.objects.contacts.write']));
    const row = (await stored(w.owner.id))!;
    expect(row.token.startsWith('enc:')).toBe(true);
    expect(row.token).not.toContain(SERVICE_KEY);
    expect(JSON.stringify(fakeHubspot().calls)).not.toContain(SERVICE_KEY);
    expect(await (await linesGet()).text()).not.toContain(SERVICE_KEY);
    // Desconectar borra la clave y el tipo.
    expect((await lines.DELETE()).status).toBe(200);
    expect(await stored(w.owner.id)).toMatchObject({ token: '', token_kind: '' });
  });

  it('una clave a la que le faltan permisos obligatorios no se guarda y el error dice cuáles', async () => {
    const w = await workspaceWithMember('hsacc4');
    session.user = asOwner(w.owner);
    for (const token of ['pat-na1-noscope-legacy', 'pat-na1-svc-noscope-key']) {
      const res = await linesPost({ token });
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(text).not.toContain(token);
      expect((JSON.parse(text) as { error: string }).error).toBe('hubspot_missing_scopes:crm.objects.companies.read crm.objects.deals.read crm.schemas.companies.read');
    }
    expect(await stored(w.owner.id)).toBeNull();
    const bad = await linesPost({ token: 'definitely-not-a-key' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain('definitely-not-a-key');
  });
});

describe('Importador del CRM › HubSpot: quién conecta', () => {
  it('anónimo, otro workspace, compañero y owner', async () => {
    const w = await workspaceWithMember('hsimp');
    session.user = asOwner(w.owner);
    const created = await jobsPost({ provider: 'hubspot', token: 'fake-svc' });
    const text = await created.text();
    expect(created.status).toBe(201);
    const view = JSON.parse(text) as { id: string; preview: { connection: { portalId: string; kind: string; scopes: string[]; missing: string[] } } };
    expect(view.preview.connection).toMatchObject({ portalId: '434343', kind: 'service_key', missing: [] });
    expect(view.preview.connection.scopes).toContain('crm.objects.contacts.read');
    expect(text).not.toMatch(/"token"|fake-svc/);

    for (const r of roles(w)) {
      session.user = r.user;
      const list = await jobs.GET();
      const one = await job.GET(jobReq(), params(view.id));
      if (r.name === 'anonymous') {
        expect([list.status, one!.status]).toEqual([401, 401]);
        expect((await jobsPost({ provider: 'hubspot', token: 'fake' })).status).toBe(401);
        expect((await job.DELETE(jobReq('DELETE'), params(view.id)))!.status).toBe(401);
      } else if (r.name === 'teammate') {
        expect([list.status, one!.status]).toEqual([403, 403]);
        expect((await jobsPost({ provider: 'hubspot', token: 'fake' })).status).toBe(403);
        expect((await job.DELETE(jobReq('DELETE'), params(view.id)))!.status).toBe(403);
      } else if (r.name === 'other_workspace') {
        // Su lista está vacía y el job del otro workspace no existe para él.
        expect(await list.json()).toMatchObject({ active: null, jobs: [] });
        expect(one!.status).toBe(404);
        expect((await job.DELETE(jobReq('DELETE'), params(view.id)))!.status).toBe(404);
      } else {
        expect(((await list.json()) as { active: { id: string } }).active.id).toBe(view.id);
        expect(one!.status).toBe(200);
      }
    }
    // La clave quedó cifrada en el job.
    const row = async () => (await getDb().prepare('SELECT token, status FROM crm_import_jobs WHERE id = ?').get(view.id)) as { token: string; status: string };
    expect((await row()).token.startsWith('enc:')).toBe(true);
    session.user = asOwner(w.owner);
    expect((await job.DELETE(jobReq('DELETE'), params(view.id)))!.status).toBe(200);
    // Una vista previa cancelada se borra entera, con su clave.
    expect(await row()).toBeUndefined();
  });

  it('una clave sin un permiso obligatorio: el error nombra el permiso y no se guarda nada', async () => {
    const w = await workspaceWithMember('hsimp2');
    session.user = asOwner(w.owner);
    for (const token of ['fake-noowners', 'fake-svc-noowners']) {
      const res = await jobsPost({ provider: 'hubspot', token });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'missing_scope', missing: ['crm.objects.owners.read'] });
    }
    const wrong = await jobsPost({ provider: 'hubspot', token: 'wrong-token' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'invalid_token' });
    const n = (await getDb().prepare('SELECT COUNT(*) AS c FROM crm_import_jobs WHERE user_id = ?').get(w.owner.id)) as { c: number };
    expect(n.c).toBe(0);
  });

  it('una clave cuya lista de permisos no nombra uno obligatorio, pero que puede leerlo, conecta igual', async () => {
    const w = await workspaceWithMember('hsimp4');
    session.user = asOwner(w.owner);
    const res = await jobsPost({ provider: 'hubspot', token: 'fake-oldnames' });
    expect(res.status).toBe(201);
    const view = (await res.json()) as { preview: { connection: { kind: string; scopes: string[]; missing: string[] }; owners: unknown[] } };
    expect(view.preview.connection).toMatchObject({ kind: 'private_app', missing: [] });
    expect(view.preview.connection.scopes).toContain('crm.objects.owners.read');
    expect(view.preview.owners).toHaveLength(2);
  });

  it('sin el permiso de emails la vista previa arranca igual y lo dice', async () => {
    const w = await workspaceWithMember('hsimp3');
    session.user = asOwner(w.owner);
    const res = await jobsPost({ provider: 'hubspot', token: 'fake-noemail' });
    expect(res.status).toBe(201);
    const view = (await res.json()) as { preview: { unavailable: string[]; connection: { kind: string; missing: string[] } } };
    expect(view.preview.connection).toMatchObject({ kind: 'private_app', missing: ['sales-email-read'] });
    expect(view.preview.unavailable).toEqual(['emails']);
  });
});
