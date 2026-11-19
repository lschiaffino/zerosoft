import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { createContact } from '@/lib/crm';
import { resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { resetFakeHubspotPortal, seedSyncPortal, type FakeHubspotPortal } from '@/lib/hubspot/fake-portal';
import { NEVER_QUEUE, shouldQueue } from '@/lib/offline-queue';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

/**
 * Sync CRM ↔ HubSpot: quién entra a cada ruta (anónimo, otro workspace,
 * compañero, admin y owner), que la clave no vuelva nunca por una respuesta ni
 * quede en claro en la base, el camino "usar la clave de Lines" y que conectar
 * no escribe nada en HubSpot.
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const conn = await import('@/app/api/crm/hubspot-sync/route');
const preview = await import('@/app/api/crm/hubspot-sync/preview/route');
const run = await import('@/app/api/crm/hubspot-sync/preview/run/route');
const lines = await import('@/app/api/groups/hubspot/route');

const SERVICE_KEY = 'pat-na1-svc-sync-access-key';
const LEGACY = 'pat-na1-sync-access-legacy';
const READ_ONLY = 'pat-na1-svc-readonly-sync';
const LINES_KEY = 'pat-na1-lines-shared-legacy';
let portal: FakeHubspotPortal;

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('CRM_IMPORT_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeHubspot();
  portal = resetFakeHubspotPortal('crm', seedSyncPortal);
});
afterEach(() => {
  session.user = null;
});

const URL_ = 'http://localhost/api/crm/hubspot-sync';
const post = (body: unknown) => conn.POST(new NextRequest(URL_, { method: 'POST', body: JSON.stringify(body) }));
const stored = async (ws: string) =>
  ((await getDb().prepare('SELECT token, portal_id, token_kind, key_source, scopes FROM crm_hubspot_sync WHERE user_id = ?').get(ws)) as
    | { token: string; portal_id: string; token_kind: string; key_source: string; scopes: string }
    | undefined) ?? null;

async function finish(): Promise<{ status: string; report: unknown }> {
  for (let i = 0; i < 50; i++) {
    const res = await run.POST();
    const body = (await res.json()) as { preview: { status: string; report: unknown } };
    if (body.preview.status !== 'running' && body.preview.status !== 'queued') return body.preview;
  }
  throw new Error('preview did not finish');
}

describe('quién entra', () => {
  it('anónimo, otro workspace, compañero y owner, en todas las rutas', async () => {
    const w = await workspaceWithMember('hssync');
    // Registros de alguien que el compañero no ve: no pueden llegarle por la muestra.
    await createContact(w.owner.id, { firstName: 'Hidden', lastName: 'FromMember', email: 'hidden-from-member@access.example', ownerId: w.owner.id });
    session.user = asOwner(w.owner);
    expect((await post({ token: LEGACY })).status).toBe(200);
    expect((await preview.POST()).status).toBe(201);
    const done = await finish();
    expect(done.status).toBe('done');
    expect(JSON.stringify(done.report)).toContain('Hidden FromMember');

    for (const r of roles(w)) {
      session.user = r.user;
      const calls = {
        status: await conn.GET(),
        connect: await post({ token: SERVICE_KEY }),
        lines: await post({ useLinesKey: true }),
        recheck: await post({ recheck: true }),
        previewGet: await preview.GET(),
        run: await run.POST(),
      };
      const texts = Object.fromEntries(await Promise.all(Object.entries(calls).map(async ([k, res]) => [k, await res.clone().text()] as const)));
      for (const text of Object.values(texts)) {
        expect(text, r.name).not.toContain(LEGACY);
        expect(text, r.name).not.toContain(SERVICE_KEY);
      }
      if (r.name === 'anonymous') {
        for (const [k, res] of Object.entries(calls)) expect(res.status, k).toBe(401);
        expect((await preview.POST()).status).toBe(401);
        expect((await preview.DELETE()).status).toBe(401);
        expect((await conn.DELETE()).status).toBe(401);
      } else if (r.name === 'teammate') {
        // Ni el estado ni la vista previa: el informe muestra registros de todo el workspace.
        for (const [k, res] of Object.entries(calls)) expect(res.status, k).toBe(403);
        expect((await preview.POST()).status).toBe(403);
        expect((await preview.DELETE()).status).toBe(403);
        expect((await conn.DELETE()).status).toBe(403);
        for (const text of Object.values(texts)) {
          expect(text).not.toContain('Hidden');
          expect(text).not.toContain('515151');
        }
      } else if (r.name === 'other_workspace') {
        // Conectó su propio workspace con su clave; del otro no ve ni la cuenta ni la vista previa.
        expect(calls.status.status).toBe(200);
        expect(JSON.parse(texts.status)).toMatchObject({ connected: false, portalId: '', scopes: [], linesKeyAvailable: false });
        expect(calls.connect.status).toBe(200);
        expect(calls.lines.status).toBe(409);
        expect(JSON.parse(texts.previewGet)).toEqual({ preview: null });
        expect(texts.previewGet + texts.run).not.toContain('Hidden');
        expect((await conn.DELETE()).status).toBe(200);
        expect((await conn.DELETE()).status).toBe(404);
      } else {
        expect(calls.status.status).toBe(200);
        expect(JSON.parse(texts.status)).toMatchObject({ connected: true, portalId: '515151', tokenKind: 'private_app', keySource: 'pasted' });
        expect(JSON.parse(texts.previewGet).preview.report.objects.contacts.zerosoft).toBe(1);
      }
    }
    // Pase lo que pase con los demás, la conexión del workspace quedó como la dejó su owner (que al final la cambió él mismo).
    const row = (await stored(w.owner.id))!;
    expect(row.token_kind).toBe('service_key');
    expect(row.token.startsWith('enc:')).toBe(true);
  });

  it('un admin del equipo conecta y corre la vista previa; si deja de ser admin, su vista previa se corta', async () => {
    const w = await workspaceWithMember('hssync-admin');
    await getDb().prepare(`UPDATE team_members SET role = 'admin' WHERE team_id = ? AND user_id = ?`).run(w.team.id, w.member.id);
    session.user = asMember(w.owner, w.member, 'admin');
    expect((await post({ token: LEGACY })).status).toBe(200);
    expect((await preview.POST()).status).toBe(201);
    expect((await finish()).status).toBe('done');
    // Otra, y a mitad lo bajan a member.
    expect((await preview.POST()).status).toBe(201);
    await getDb().prepare(`UPDATE team_members SET role = 'member' WHERE team_id = ? AND user_id = ?`).run(w.team.id, w.member.id);
    session.user = asOwner(w.owner);
    const cut = await finish();
    expect(cut).toMatchObject({ status: 'failed', report: null });
    session.user = asMember(w.owner, w.member);
    expect((await preview.GET()).status).toBe(403);
  });
});

describe('la clave', () => {
  it('no vuelve por ninguna respuesta, queda cifrada y desconectar la borra', async () => {
    const w = await workspaceWithMember('hssync-key');
    session.user = asOwner(w.owner);
    const res = await post({ token: `  ${SERVICE_KEY} ` });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SERVICE_KEY);
    const dto = JSON.parse(text) as { scopes: string[]; missingWrite: string[]; checkedAt: string };
    expect(dto).toMatchObject({ connected: true, portalId: '515151', uiDomain: 'app.hubspot.com', tokenKind: 'service_key', keySource: 'pasted', missingWrite: [], lastError: '' });
    expect(dto.scopes).toEqual(expect.arrayContaining(['crm.objects.contacts.read', 'crm.objects.owners.read', 'crm.schemas.deals.read', 'crm.objects.deals.write']));
    expect(Date.parse(dto.checkedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(Object.keys(dto)).not.toContain('token');
    const row = (await stored(w.owner.id))!;
    expect(row.token.startsWith('enc:')).toBe(true);
    expect(JSON.stringify(row)).not.toContain(SERVICE_KEY);
    // Ni en el registro de llamadas del HubSpot falso (la consulta de info del token la lleva en el cuerpo).
    expect(JSON.stringify(portal.calls)).not.toContain(SERVICE_KEY);
    for (const r of [await conn.GET(), await post({ recheck: true }), await preview.POST(), await run.POST(), await preview.GET()]) expect(await r.text()).not.toContain(SERVICE_KEY);
    expect((await conn.DELETE()).status).toBe(200);
    expect(await stored(w.owner.id)).toBeNull();
    expect(await (await preview.GET()).json()).toEqual({ preview: null });
    expect(await (await conn.GET()).json()).toMatchObject({ connected: false, scopes: [], portalId: '' });
  });

  it('conectar no escribe nada en HubSpot: las pruebas de permisos de escritura no cambian ningún registro', async () => {
    const w = await workspaceWithMember('hssync-ro');
    session.user = asOwner(w.owner);
    const before = JSON.stringify([...portal.contacts.values(), ...portal.companies.values(), ...portal.deals.values()]);
    const sizes = [portal.contacts.size, portal.companies.size, portal.deals.size];
    expect((await post({ token: SERVICE_KEY })).status).toBe(200);
    expect(JSON.stringify([...portal.contacts.values(), ...portal.companies.values(), ...portal.deals.values()])).toBe(before);
    expect([portal.contacts.size, portal.companies.size, portal.deals.size]).toEqual(sizes);
    // Lo único que no es lectura: el PATCH sin propiedades sobre el id 0 que prueba cada permiso de escritura.
    const writes = portal.calls.filter((c) => c.method !== 'GET' && !c.path.includes('access-token-info') && !c.path.endsWith('/search'));
    expect(writes.map((c) => `${c.method} ${c.path}`).sort()).toEqual(['PATCH /crm/v3/objects/companies/0', 'PATCH /crm/v3/objects/contacts/0', 'PATCH /crm/v3/objects/deals/0']);
    expect(writes.every((c) => JSON.stringify(c.body) === '{"properties":{}}')).toBe(true);
    // Una private app heredada informa sus permisos: no hace falta probar nada.
    portal.calls.length = 0;
    expect((await post({ token: LEGACY })).status).toBe(200);
    expect(portal.calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('sin permisos de escritura conecta igual y dice cuáles faltan para después; sin los de lectura no se guarda', async () => {
    const w = await workspaceWithMember('hssync-scopes');
    session.user = asOwner(w.owner);
    const ro = await post({ token: READ_ONLY });
    expect(ro.status).toBe(200);
    expect(await ro.json()).toMatchObject({ connected: true, missingWrite: ['crm.objects.contacts.write', 'crm.objects.companies.write', 'crm.objects.deals.write'] });
    expect((await preview.POST()).status).toBe(201);
    expect((await finish()).status).toBe('done');
    expect((await conn.DELETE()).status).toBe(200);

    for (const token of ['pat-na1-noscope-legacy', 'pat-na1-svc-noscope-key']) {
      const res = await post({ token });
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(text).not.toContain(token);
      expect(JSON.parse(text)).toEqual({
        error: 'missing_scope',
        missing: ['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.owners.read', 'crm.schemas.contacts.read', 'crm.schemas.companies.read', 'crm.schemas.deals.read'],
      });
    }
    expect(await stored(w.owner.id)).toBeNull();
    const bad = await post({ token: 'definitely-not-a-key' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_token' });
    expect((await post({ token: 'x' })).status).toBe(400);
    expect((await post({ token: LEGACY, base: 'https://evil.example' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(await stored(w.owner.id)).toBeNull();
    expect((await preview.POST()).status).toBe(409);
  });

  it('HubSpot no responde: error sin detalles y nada guardado', async () => {
    const w = await workspaceWithMember('hssync-down');
    session.user = asOwner(w.owner);
    portal.fail(500, 50);
    const res = await post({ token: LEGACY });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'provider_error' });
    expect(await stored(w.owner.id)).toBeNull();
  });

  it('revisar de nuevo: si HubSpot dejó de aceptar la clave lo dice y no la borra', async () => {
    const w = await workspaceWithMember('hssync-recheck');
    session.user = asOwner(w.owner);
    await post({ token: LEGACY });
    portal.grant = () => null;
    const res = await post({ recheck: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, lastError: 'invalid_token' });
    expect((await stored(w.owner.id))!.token.startsWith('enc:')).toBe(true);
  });
});

describe('usar la clave ya conectada en Lines', () => {
  const linesPost = (body: unknown) => lines.POST(new Request('http://localhost/api/groups/hubspot', { method: 'POST', body: JSON.stringify(body) }));

  it('un admin la usa sin pegarla: se valida, se copia cifrada y nunca pasa por una respuesta', async () => {
    const w = await workspaceWithMember('hssync-lines');
    session.user = asOwner(w.owner);
    expect(await (await conn.GET()).json()).toMatchObject({ connected: false, linesKeyAvailable: false });
    expect((await post({ useLinesKey: true })).status).toBe(409);
    expect((await linesPost({ token: LINES_KEY })).status).toBe(200);
    const status = await conn.GET();
    const statusText = await status.text();
    expect(JSON.parse(statusText)).toMatchObject({ connected: false, linesKeyAvailable: true });
    expect(statusText).not.toContain(LINES_KEY);

    // El compañero no puede usarla ni saber que existe.
    session.user = asMember(w.owner, w.member);
    expect((await post({ useLinesKey: true })).status).toBe(403);
    expect(await stored(w.owner.id)).toBeNull();
    // Otro workspace no tiene esa clave.
    session.user = asOwner(w.stranger);
    expect((await post({ useLinesKey: true })).status).toBe(409);
    expect(await stored(w.stranger.id)).toBeNull();

    session.user = asMember(w.owner, w.member, 'admin');
    const res = await post({ useLinesKey: true });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(LINES_KEY);
    expect(JSON.parse(text)).toMatchObject({ connected: true, keySource: 'lines', tokenKind: 'private_app', missingWrite: [] });
    const row = (await stored(w.owner.id))!;
    expect(row).toMatchObject({ key_source: 'lines', token_kind: 'private_app' });
    expect(row.token.startsWith('enc:')).toBe(true);
    expect(row.token).not.toContain(LINES_KEY);

    // Son dos conexiones: desconectar la del CRM no toca la de Lines, y al revés.
    expect((await conn.DELETE()).status).toBe(200);
    const linesRow = (await getDb().prepare('SELECT token FROM groups_hubspot WHERE user_id = ?').get(w.owner.id)) as { token: string };
    expect(linesRow.token.startsWith('enc:')).toBe(true);
    expect((await post({ useLinesKey: true })).status).toBe(200);
    expect((await lines.DELETE()).status).toBe(200);
    expect(await (await conn.GET()).json()).toMatchObject({ connected: true, keySource: 'lines', linesKeyAvailable: false });
  });

  it('si a la clave de Lines le faltan permisos de lectura del sync, lo dice y no conecta', async () => {
    const w = await workspaceWithMember('hssync-lines2');
    session.user = asOwner(w.owner);
    // Lines no pide leer dueños: una clave puede servirle a Lines y no al sync.
    await getDb()
      .prepare(`INSERT INTO groups_hubspot (user_id, token, portal_id, ui_domain, scopes, created_by, created_at, updated_at) VALUES (?, ?, '424242', 'app.hubspot.com', '[]', ?, ?, ?)`)
      .run(w.owner.id, (await import('@/lib/hubspot/token')).sealHubspotToken('pat-na1-noscope-lines'), w.owner.id, new Date().toISOString(), new Date().toISOString());
    const res = await post({ useLinesKey: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; missing: string[] };
    expect(body.error).toBe('missing_scope');
    expect(body.missing).toContain('crm.objects.owners.read');
    expect(await stored(w.owner.id)).toBeNull();
  });
});

describe('alrededor', () => {
  it('el modo offline nunca encola un pedido de estas rutas (llevan la clave)', () => {
    expect(NEVER_QUEUE).toContain('/api/crm/hubspot-sync');
    expect(shouldQueue('/api/crm/hubspot-sync', 'POST', 'application/json')).toBe(false);
    expect(shouldQueue('/api/crm/hubspot-sync/preview', 'POST', 'application/json')).toBe(false);
    expect(shouldQueue('/api/crm/hubspot-sync', 'DELETE', null)).toBe(false);
  });
});
