import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import {
  chatHubspot,
  connectHubspot,
  getHubspot,
  getHubspotSyncStatus,
  linkHubspot,
  logChatToHubspot,
  recheckHubspotScopes,
  syncHubspotNotes,
  updateHubspotSettings,
} from '@/lib/groups-hubspot';
import { resyncHubspot, syncHubspotCompanies } from '@/lib/groups-hubspot-sync';
import { hubspotScopeForRequest } from '@/lib/hubspot/scopes';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const syncRoute = await import('@/app/api/groups/hubspot/sync/route');
const connRoute = await import('@/app/api/groups/hubspot/route');

const TOKEN = 'pat-na1-fake-token-for-hardening';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});
afterEach(() => {
  session.user = null;
});

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

let seq = 0;
/** Un grupo con un mensaje; devuelve su chat. */
async function group(ws: string, row: Awaited<ReturnType<typeof line>>, name: string) {
  seq += 1;
  await ingestEvents(row, [
    {
      type: 'message' as const,
      chatId: `12036388${String(seq).padStart(6, '0')}@g.us`,
      isGroup: true,
      chatName: name,
      fromMe: false,
      senderPhone: '5491100000009',
      senderName: 'Cliente',
      providerMessageId: `hard-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      body: 'Hola equipo',
    },
  ]);
  const c = (await listChats(ws, ws, { limit: 500 })).rows.find((r) => r.name === name);
  if (!c) throw new Error(`chat ${name}`);
  return c;
}

async function world(label: string, token = TOKEN) {
  const owner = await makeUser(`${label}-ws`);
  const row = await line(owner.id, 'Clientes');
  const acme = await group(owner.id, row, `Acme ${label}`);
  await connectHubspot(owner.id, owner.id, token);
  await linkHubspot(owner.id, owner.id, acme.id, 'company', '9001');
  return { owner, row, acme };
}

const notePosts = () => fakeHubspot().calls.filter((c) => c.method === 'POST' && c.path === '/crm/v3/objects/notes');

describe('HubSpot Lines: límite de llamadas al dejar notas', () => {
  it('un 429 espera y reintenta: la nota sale una sola vez', async () => {
    const w = await world('hard-429');
    fakeHubspot().rateLimit = 1;
    expect(await logChatToHubspot(w.owner.id, w.acme.id)).toEqual({ notes: 1, days: 1 });
    // El primer pedido recibió el 429 y el segundo creó la nota.
    expect(notePosts()).toHaveLength(2);
    expect(fakeHubspot().notes.size).toBe(1);
    expect((await getHubspot(w.owner.id)).lastError).toBe('');
  });

  it('si el límite sigue dice que HubSpot está limitando, anota la nota fallida y no crea ninguna', async () => {
    const w = await world('hard-429b');
    fakeHubspot().rateLimit = 10;
    await expect(logChatToHubspot(w.owner.id, w.acme.id)).rejects.toMatchObject({ code: 'hubspot_rate_limited' });
    expect(fakeHubspot().notes.size).toBe(0);
    const status = await getHubspotSyncStatus(w.owner.id);
    expect(status.noteErrors).toBe(1);
    expect(status.problems).toEqual([expect.objectContaining({ kind: 'note', chatId: w.acme.id, code: 'hubspot_rate_limited' })]);
  });
});

describe('HubSpot Lines: permisos', () => {
  it('el permiso que falta sale del pedido', () => {
    expect(hubspotScopeForRequest('GET', '/crm/v3/objects/companies/9001?properties=name')).toBe('crm.objects.companies.read');
    expect(hubspotScopeForRequest('POST', '/crm/v3/objects/contacts/search')).toBe('crm.objects.contacts.read');
    expect(hubspotScopeForRequest('PATCH', '/crm/v3/objects/deals/8001')).toBe('crm.objects.deals.write');
    expect(hubspotScopeForRequest('GET', '/crm/v3/properties/companies/groups')).toBe('crm.schemas.companies.read');
    expect(hubspotScopeForRequest('GET', '/crm/v3/owners?limit=100')).toBe('crm.objects.owners.read');
    expect(hubspotScopeForRequest('POST', '/crm/v3/objects/notes', ['crm.objects.contacts.write'])).toBe('crm.objects.companies.write');
    expect(hubspotScopeForRequest('GET', '/crm/v3/pipelines/deals')).toBeNull();
  });

  it('si en HubSpot le sacaron un permiso a la clave, "Sincronizar ahora" lo detecta, apaga el registro y dice cuál falta', async () => {
    const w = await world('hard-scopes', 'pat-na1-readonly-hardening');
    // Lines tenía guardados todos los permisos (la clave los tuvo al conectar) y el registro prendido.
    await getDb()
      .prepare('UPDATE groups_hubspot SET scopes = ?, log_notes = 1 WHERE user_id = ?')
      .run(JSON.stringify(['crm.objects.contacts.write', 'crm.objects.companies.write', 'crm.objects.deals.write', 'crm.objects.companies.read']), w.owner.id);
    await expect(logChatToHubspot(w.owner.id, w.acme.id)).rejects.toMatchObject({ code: 'hubspot_missing_scopes' });
    const scopes = await recheckHubspotScopes(w.owner.id);
    expect(scopes).not.toContain('crm.objects.contacts.write');
    const dto = await getHubspot(w.owner.id);
    expect(dto.logNotes).toBe(false);
    expect(dto.missingLogScopes).toContain('crm.objects.contacts.write');
    await expect(updateHubspotSettings(w.owner.id, { logNotes: true })).rejects.toMatchObject({ code: 'hubspot_missing_scopes:crm.objects.contacts.write' });
  });
});

describe('HubSpot Lines: cambiar de cuenta de HubSpot', () => {
  it('lo de la cuenta anterior (propiedades de contacto y negocio, lo que cada persona fijó) no queda', async () => {
    const w = await world('hard-portal');
    const db = getDb();
    await db.prepare("INSERT OR REPLACE INTO hubspot_object_schema (ws, object_type, props, pinned, synced_at) VALUES (?, 'contact', '[]', '[\"old_prop\"]', ?)").run(w.owner.id, new Date().toISOString());
    await db.prepare("INSERT OR REPLACE INTO hubspot_view_props (ws, user_id, props, updated_at) VALUES (?, ?, '[\"old_prop\"]', ?)").run(w.owner.id, w.owner.id, new Date().toISOString());
    await db.prepare("UPDATE groups_hubspot SET portal_id = '111' WHERE user_id = ?").run(w.owner.id);
    await connectHubspot(w.owner.id, w.owner.id, TOKEN);
    const count = async (table: string) => Number(((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ws = ?`).get(w.owner.id)) as { n: number }).n);
    expect(await count('hubspot_object_schema')).toBe(0);
    expect(await count('hubspot_view_props')).toBe(0);
    const links = (await db.prepare('SELECT COUNT(*) AS n FROM groups_hubspot_links WHERE user_id = ?').get(w.owner.id)) as { n: number };
    expect(links.n).toBe(0);
  });
});

describe('HubSpot Lines: notas con muchos chats', () => {
  it('los chats nuevos no quedan afuera cuando los primeros ya están al día', async () => {
    const owner = await makeUser('hard-scan-ws');
    const row = await line(owner.id, 'Clientes');
    const chats = [await group(owner.id, row, 'Scan uno'), await group(owner.id, row, 'Scan dos')];
    await connectHubspot(owner.id, owner.id, TOKEN);
    for (const c of chats) await linkHubspot(owner.id, owner.id, c.id, 'company', '9001');
    await updateHubspotSettings(owner.id, { logNotes: true });
    expect(await syncHubspotNotes({ workspaceId: owner.id })).toBe(2);
    // Llega un chat más: la consulta mira solo 2 filas, pero las 2 ya al día no la ocupan.
    const late = await group(owner.id, row, 'Scan tres');
    await linkHubspot(owner.id, owner.id, late.id, 'company', '9001');
    expect(await syncHubspotNotes({ workspaceId: owner.id, scan: 2 })).toBe(1);
    expect(fakeHubspot().notes.size).toBe(3);
  });
});

describe('HubSpot Lines: estado y "Sincronizar ahora"', () => {
  it('vuelve a leer las empresas, marca las borradas, olvida la espera y reintenta las notas que fallaron', async () => {
    const w = await world('hard-resync');
    const second = await group(w.owner.id, w.row, 'Globex hard-resync');
    await linkHubspot(w.owner.id, w.owner.id, second.id, 'company', '9002');
    await updateHubspotSettings(w.owner.id, { logNotes: true });
    // Una nota que falla y un sync que viene fallando.
    fakeHubspot().rateLimit = 10;
    expect(await syncHubspotNotes({ workspaceId: w.owner.id })).toBe(0);
    fakeHubspot().rateLimit = 0;
    await getDb().prepare('UPDATE groups_hubspot SET sync_fails = 3, sync_backoff_until = ? WHERE user_id = ?').run(new Date(Date.now() + 600_000).toISOString(), w.owner.id);
    expect((await getHubspotSyncStatus(w.owner.id)).failures).toBe(3);
    fakeHubspot().companies.delete('9002');

    const res = await resyncHubspot(w.owner.id);
    expect(res).toMatchObject({ companies: 1, missing: 1, partial: false });
    expect(res.notes).toBeGreaterThanOrEqual(1);
    expect(fakeHubspot().notes.size).toBeGreaterThanOrEqual(1);
    const status = await getHubspotSyncStatus(w.owner.id);
    expect(status).toMatchObject({ linkedCompanies: 2, brokenLinks: 1, failures: 0, retryAt: null, noteErrors: 0 });
    expect(status.problems).toEqual([expect.objectContaining({ kind: 'link', chatId: second.id, code: 'deleted' })]);
    expect((await getHubspot(w.owner.id)).syncedAt).not.toBeNull();
    // El cron no estaba esperando más.
    expect(await syncHubspotCompanies({ workspaceId: w.owner.id, now: new Date(Date.now() + 120_000) })).toMatchObject({ workspaces: 1 });
  });

  it('si el cron está sincronizando ahora no se hace dos veces', async () => {
    const w = await world('hard-busy');
    await getDb().prepare('UPDATE groups_hubspot SET sync_locked_until = ? WHERE user_id = ?').run(new Date(Date.now() + 60_000).toISOString(), w.owner.id);
    await expect(resyncHubspot(w.owner.id)).rejects.toMatchObject({ code: 'hubspot_sync_busy', status: 409 });
  });

  it('la ruta: solo admins; el estado de otro workspace no se ve ni se toca', async () => {
    const a = await world('hard-route-a');
    const b = await world('hard-route-b');
    const member = await makeUser('hard-route-m');
    session.user = { ...a.owner, role: 'member', actingUser: { id: member.id } };
    expect((await syncRoute.POST()).status).toBe(403);
    session.user = { ...a.owner, role: 'owner' };
    const ok = await syncRoute.POST();
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { result: { companies: number }; hubspot: { sync: { linkedCompanies: number }; connected: boolean } };
    expect(body.result.companies).toBe(1);
    expect(body.hubspot.sync.linkedCompanies).toBe(1);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    // El estado que ve un admin no menciona los chats de otro workspace.
    const status = await (await connRoute.GET(new Request('http://localhost/api/groups/hubspot'))).text();
    expect(status).not.toContain(b.acme.id);
    expect(JSON.parse(status).sync).toMatchObject({ linkedCompanies: 1, brokenLinks: 0, failures: 0 });
    // Un miembro solo ve si está conectado.
    session.user = { ...a.owner, role: 'member', actingUser: { id: member.id } };
    expect(await (await connRoute.GET(new Request('http://localhost/api/groups/hubspot'))).json()).toEqual({ connected: true });
  });

  it('el panel del chat sigue mostrando los vínculos aunque HubSpot limite', async () => {
    const w = await world('hard-panel');
    fakeHubspot().rateLimit = 10;
    const dto = await chatHubspot(w.owner.id, w.acme.id);
    expect(dto.links.map((l) => l.id)).toEqual(['9001']);
  });
});
