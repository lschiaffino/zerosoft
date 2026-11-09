import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { addMember } from '@/lib/teams';
import { ensureWorkspace, userCanUseApp, type AppAccess } from '@/lib/workspace';
import { appDenial, blockedApps, parseRule, type WorkspaceAppRules } from '@/lib/app-access';
import { blockedAppsFor, loadWorkspaceAppRules, saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { createGroup } from '@/lib/workspace-groups';
import { createApiKey, validateApiKeyAuth, requireApiUser } from '@/lib/api-auth';
import { personCanUseApp } from '@/lib/mcp/caller';
import { AVAILABLE_PRODUCT_KEYS, COMING_SOON_APPS, isComingSoon, isWorkspaceGatedApp, PRODUCT_CONFIG } from '@/lib/products';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));

const appsRoute = await import('@/app/api/teams/apps/route');
const gate = await import('@/app/api/apps/blocked/route');

const STAFF = 'staff-app-access@zerosoft.test';
let prevAdmins: string | undefined;
beforeEach(() => {
  session.user = null;
  prevAdmins = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = STAFF;
});
afterEach(() => {
  process.env.ADMIN_EMAILS = prevAdmins;
});

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

async function actAs(owner: UserRow, person: UserRow, role: string, apps: AppAccess = '*') {
  const workspace = await ensureWorkspace(owner.id);
  session.user =
    person.id === owner.id
      ? { ...(await load(owner.id)), role: 'owner', apps: '*', team: null, workspace }
      : { ...(await load(owner.id)), actingUser: await load(person.id), role, apps, team: null, workspace };
}

const put = (body: unknown) =>
  appsRoute.PUT(new NextRequest('http://localhost/api/teams/apps', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);

describe('lib/products: Próximamente en una sola config', () => {
  it('las ocho apps pedidas son Próximamente y no cuentan como disponibles', () => {
    expect([...COMING_SOON_APPS].sort()).toEqual(['agents', 'books', 'chat', 'design', 'hiring', 'robots', 'shop', 'social']);
    for (const k of COMING_SOON_APPS) expect(AVAILABLE_PRODUCT_KEYS).not.toContain(k);
    expect(AVAILABLE_PRODUCT_KEYS).toContain('crm');
  });
  it('todas se pueden apagar por workspace salvo Inbox, que siempre está', () => {
    expect(isWorkspaceGatedApp('inbox')).toBe(false);
    for (const k of ['notes', 'docs', 'cal', 'board', 'voice', 'crm', 'groups', 'pulse', 'rec'] as const) expect(isWorkspaceGatedApp(k), k).toBe(true);
  });
});

describe('appDenial: la regla única (rol × modo de la app × toggles)', () => {
  const rules = (mode: 'all' | 'some' | 'admins' | 'off', people: string[] = [], teams: string[] = [], denied: string[] = []): WorkspaceAppRules => ({ crm: { mode, people, teams, denied } });
  const subject = (role: string, extra: Partial<{ personId: string; teamIds: string[]; apps: '*' | string[]; staff: boolean }> = {}) => ({
    role,
    personId: extra.personId ?? `p-${role}`,
    teamIds: extra.teamIds ?? [],
    apps: extra.apps ?? ('*' as const),
    staff: extra.staff ?? false,
  });

  const matrix: Array<[string, 'all' | 'some' | 'admins' | 'off', boolean]> = [
    ['owner', 'all', true],
    ['admin', 'all', true],
    ['member', 'all', true],
    ['guest', 'all', false],
    ['owner', 'admins', true],
    ['admin', 'admins', true],
    ['member', 'admins', false],
    ['owner', 'some', true],
    ['admin', 'some', true],
    ['member', 'some', false],
    ['owner', 'off', false],
    ['admin', 'off', false],
    ['member', 'off', false],
    ['guest', 'off', false],
  ];
  it.each(matrix)('%s con CRM en "%s" → %s', (role, mode, ok) => {
    expect(appDenial(subject(role), 'crm', rules(mode)) === null).toBe(ok);
  });

  it('"algunos": la persona elegida o alguien de un equipo elegido', () => {
    expect(appDenial(subject('member', { personId: 'ana' }), 'crm', rules('some', ['ana']))).toBeNull();
    expect(appDenial(subject('member', { personId: 'beto', teamIds: ['ventas'] }), 'crm', rules('some', [], ['ventas']))).toBeNull();
    expect(appDenial(subject('member', { personId: 'caro', teamIds: ['soporte'] }), 'crm', rules('some', ['ana'], ['ventas']))).toBe('workspace_restricted');
  });

  it('se compone con los toggles de Miembros: el workspace solo restringe', () => {
    // Abierta para todos pero la persona no la tiene habilitada: no entra.
    expect(appDenial(subject('member', { apps: ['docs'] }), 'crm', rules('all'))).toBe('member');
    // Elegida en "algunos" pero sin el toggle: tampoco.
    expect(appDenial(subject('member', { personId: 'ana', apps: ['docs'] }), 'crm', rules('some', ['ana']))).toBe('member');
  });

  it('apagada para el workspace corta también al owner', () => {
    expect(appDenial(subject('owner'), 'crm', rules('off'))).toBe('workspace_off');
  });

  it('una app personal también se apaga; Inbox no', () => {
    expect(appDenial(subject('member'), 'notes', { notes: { mode: 'off', people: [], teams: [], denied: [] } })).toBe('workspace_off');
    expect(appDenial(subject('owner'), 'inbox', { inbox: { mode: 'off', people: [], teams: [], denied: [] } } as WorkspaceAppRules)).toBeNull();
  });

  it('excepción por persona: excluida en cualquier modo, salvo owner y admins', () => {
    expect(appDenial(subject('member', { personId: 'ana' }), 'crm', rules('all', [], [], ['ana']))).toBe('workspace_restricted');
    expect(appDenial(subject('member', { personId: 'beto' }), 'crm', rules('all', [], [], ['ana']))).toBeNull();
    expect(appDenial(subject('member', { personId: 'ana', teamIds: ['ventas'] }), 'crm', rules('some', [], ['ventas'], ['ana']))).toBe('workspace_restricted');
    expect(appDenial(subject('admin', { personId: 'ana' }), 'crm', rules('all', [], [], ['ana']))).toBeNull();
  });

  it('parseRule: denied pasa por todos los modos menos off y gana sobre people', () => {
    expect(parseRule({ mode: 'some', people: ['a', 'b'], denied: ['b'] })).toEqual({ mode: 'some', people: ['a'], teams: [], denied: ['b'] });
    expect(parseRule({ mode: 'off', denied: ['b'] })?.denied).toEqual([]);
    expect(parseRule({ mode: 'all', denied: ['b', 5, ''] })?.denied).toEqual(['b']);
  });

  it('Próximamente: nadie la abre salvo el staff, sea cual sea el rol', () => {
    for (const role of ['owner', 'admin', 'member']) expect(appDenial(subject(role), 'chat')).toBe('coming_soon');
    expect(appDenial(subject('owner', { staff: true }), 'chat')).toBeNull();
    // El staff no saltea al workspace: una app apagada sigue apagada.
    expect(appDenial(subject('owner', { staff: true }), 'crm', rules('off'))).toBe('workspace_off');
  });

  it('blockedApps lista Próximamente + lo que corta el workspace, sin mirar los toggles', () => {
    const b = blockedApps({ role: 'member', personId: 'x' }, rules('admins'));
    expect(b).toContain('crm');
    for (const k of COMING_SOON_APPS) expect(b).toContain(k);
    expect(b).not.toContain('docs');
    expect(userCanUseApp({ role: 'owner', apps: '*', blockedApps: b }, 'crm')).toBe(false);
    expect(userCanUseApp({ role: 'owner', apps: '*', blockedApps: b }, 'docs')).toBe(true);
  });
});

describe('Apps del workspace en la base', () => {
  it('guarda, carga y resuelve "algunos" con equipos', async () => {
    const owner = await makeUser('aa1o');
    const team = await ensureWorkspace(owner.id);
    const ana = await makeUser('aa1a');
    const beto = await makeUser('aa1b');
    await addMember(team.id, ana.id, 'member');
    await addMember(team.id, beto.id, 'member');
    const ventas = await createGroup(owner.id, { name: 'Ventas', memberIds: [beto.id] });
    await saveWorkspaceAppRule(owner.id, 'crm', { mode: 'some', people: [], teams: [ventas.id], denied: [] }, owner.id);
    expect((await loadWorkspaceAppRules(owner.id)).crm).toEqual({ mode: 'some', people: [], teams: [ventas.id], denied: [] });
    expect(await blockedAppsFor({ ownerId: owner.id, personId: ana.id, role: 'member', email: ana.email })).toContain('crm');
    expect(await blockedAppsFor({ ownerId: owner.id, personId: beto.id, role: 'member', email: beto.email })).not.toContain('crm');
    // "Todos" borra la fila: vuelve a lo de siempre.
    await saveWorkspaceAppRule(owner.id, 'crm', { mode: 'all', people: [], teams: [], denied: [] }, owner.id);
    expect(await loadWorkspaceAppRules(owner.id)).toEqual({});
    // Una excepción por persona sí se guarda aunque el modo sea "todos".
    await saveWorkspaceAppRule(owner.id, 'crm', { mode: 'all', people: [], teams: [], denied: [ana.id] }, owner.id);
    expect(await blockedAppsFor({ ownerId: owner.id, personId: ana.id, role: 'member', email: ana.email })).toContain('crm');
    expect(await blockedAppsFor({ ownerId: owner.id, personId: beto.id, role: 'member', email: beto.email })).not.toContain('crm');
  });

  it('el staff abre Próximamente; el resto no', async () => {
    const owner = await makeUser('aa2o');
    await ensureWorkspace(owner.id);
    expect(await blockedAppsFor({ ownerId: owner.id, personId: owner.id, role: 'owner', email: owner.email })).toEqual(expect.arrayContaining([...COMING_SOON_APPS]));
    expect(await blockedAppsFor({ ownerId: owner.id, personId: owner.id, role: 'owner', email: STAFF })).toEqual([]);
  });
});

describe('PUT /api/teams/apps', () => {
  it('owner y admin cambian; member y guest no', async () => {
    const owner = await makeUser('aa3o');
    const team = await ensureWorkspace(owner.id);
    const admin = await makeUser('aa3a');
    const member = await makeUser('aa3m');
    await addMember(team.id, admin.id, 'admin');
    await addMember(team.id, member.id, 'member');

    await actAs(owner, member, 'member');
    expect((await put({ app: 'crm', mode: 'off' })).status).toBe(403);
    await actAs(owner, admin, 'admin');
    const res = await put({ app: 'crm', mode: 'admins' });
    expect(res.status).toBe(200);
    expect((await loadWorkspaceAppRules(owner.id)).crm?.mode).toBe('admins');
    await actAs(owner, owner, 'owner');
    expect((await put({ app: 'track', mode: 'off' })).status).toBe(200);
    // El cambio queda en el registro del workspace.
    const log = (await getDb().prepare("SELECT action, target_label FROM workspace_audit WHERE team_id = ? AND action = 'workspace.app'").all(team.id)) as Array<{ target_label: string }>;
    expect(log.map((l) => l.target_label).sort()).toEqual(['CRM', 'Track']);
  });

  it('acepta apps personales (menos Inbox), no Próximamente ni modos raros; filtra personas de otro workspace', async () => {
    const owner = await makeUser('aa4o');
    const team = await ensureWorkspace(owner.id);
    const ana = await makeUser('aa4a');
    const outsider = await makeUser('aa4x');
    await addMember(team.id, ana.id, 'member');
    await actAs(owner, owner, 'owner');
    expect((await put({ app: 'inbox', mode: 'off' })).status).toBe(400);
    expect((await put({ app: 'notes', mode: 'off' })).status).toBe(200);
    expect((await put({ app: 'chat', mode: 'off' })).status).toBe(400);
    expect((await put({ app: 'crm', mode: 'everyone' })).status).toBe(400);
    expect((await put({ app: 'crm', mode: 'some', people: [ana.id, outsider.id], teams: ['nope'] })).status).toBe(200);
    expect((await loadWorkspaceAppRules(owner.id)).crm).toEqual({ mode: 'some', people: [ana.id], teams: [], denied: [] });
    expect((await put({ app: 'crm', mode: 'all', denied: [ana.id, outsider.id] })).status).toBe(200);
    expect((await loadWorkspaceAppRules(owner.id)).crm).toEqual({ mode: 'all', people: [], teams: [], denied: [ana.id] });
  });
});

describe('API keys y MCP: misma regla', () => {
  it('una key pierde los scopes de las apps Próximamente y de las apagadas; la API responde 403', async () => {
    const owner = await makeUser('aa5o');
    await ensureWorkspace(owner.id);
    const { key } = await createApiKey(owner.id, 'k');
    const auth = await validateApiKeyAuth(key);
    expect(auth?.scopes).toContain('crm:read');
    expect(auth?.scopes).not.toContain('chat:read');
    expect(auth?.scopes).not.toContain('shop:read');
    const req = new Request('http://localhost/api/v1/chat/conversations', { headers: { authorization: `Bearer ${key}` } });
    const res = await requireApiUser(req, 'chat:read');
    expect('res' in res && res.res.status).toBe(403);
    expect('res' in res && (await res.res.json()).error.code).toBe('coming_soon');

    await saveWorkspaceAppRule(owner.id, 'crm', { mode: 'off', people: [], teams: [], denied: [] }, owner.id);
    expect((await validateApiKeyAuth(key))?.scopes).not.toContain('crm:read');
  });

  it('el MCP responde app_disabled (apagada) o coming_soon al invocar una herramienta de una app cortada', async () => {
    const { invokeOperation } = await import('@/lib/mcp/invoke');
    const { OPERATIONS } = await import('@/lib/mcp/catalog');
    const op = OPERATIONS.find((o) => o.app === 'crm' && o.access === 'read');
    expect(op).toBeTruthy();
    const owner = await makeUser('aa6o');
    await ensureWorkspace(owner.id);
    await saveWorkspaceAppRule(owner.id, 'crm', { mode: 'off', people: [], teams: [], denied: [] }, owner.id);
    const caller = { kind: 'oauth', personId: owner.id, teamId: null, canWrite: true, clientId: null, clientName: 't', grantId: null, apiKeyId: null, rateKey: 'aa6o' } as never;
    await expect(invokeOperation(new Request('http://localhost/mcp'), caller, op!, {})).rejects.toMatchObject({ code: 'app_disabled' });
  });

  it('el MCP no ofrece ni corre herramientas de apps cortadas', () => {
    const person = { role: 'owner' as const, apps: '*' as const, blockedApps: ['chat' as const, 'crm' as const] };
    expect(personCanUseApp(person, 'chat')).toBe(false);
    expect(personCanUseApp(person, 'crm')).toBe(false);
    expect(personCanUseApp(person, 'docs')).toBe(true);
    expect(personCanUseApp(person, 'workspace')).toBe(true);
  });
});

describe('/api/apps/blocked', () => {
  it('responde 403 con el motivo', async () => {
    const res = await gate.POST(new NextRequest('http://localhost/api/apps/blocked?app=chat') as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'coming_soon', app: 'chat' });
    const off = await gate.GET(new NextRequest('http://localhost/api/apps/blocked?app=crm') as never);
    expect(await off.json()).toEqual({ error: 'app_disabled', app: 'crm' });
  });
  it('cada app Próximamente tiene nombre', () => {
    for (const k of COMING_SOON_APPS) expect(isComingSoon(k) && PRODUCT_CONFIG[k].name).toBeTruthy();
  });
});
