/**
 * Track — roles por team (lib/track-team-roles): el chequeo puro y, ruta por
 * ruta, qué puede un miembro común, el dueño de un team, el dueño de OTRO
 * team, un admin del workspace y alguien de otro workspace. Lo más importante:
 * ninguna ruta de ajustes de un team queda abierta a un miembro común, y un
 * dueño de team no toca ni teams ajenos ni lo del workspace.
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { realUserId, type SessionUser } from '@/lib/session';
import type { UserRow } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createProject, createStatus, getProject, listStatuses } from '@/lib/track-data';
import { createLabel, trackWorkspaceId } from '@/lib/track-labels';
import { createTemplate } from '@/lib/track-templates';
import { addProjectAccess, runAsTrackViewer, setGuest, setProjectVisibility } from '@/lib/track-access';
import { capabilitiesFor, DEFAULT_TEAM_PERMISSIONS, parseTeamPermissions, adminOnlyCapabilities } from '@/lib/track-team-areas';
import { isTeamOwner, setTeamRole, setTeamPermissions, teamCapabilities } from '@/lib/track-team-roles';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const projectRoute = await import('@/lib/routes/track/projects/[id]/route');
const projectsRoute = await import('@/app/api/track/projects/route');
const statusesRoute = await import('@/lib/routes/track/projects/[id]/statuses/route');
const reorderRoute = await import('@/lib/routes/track/projects/[id]/statuses/reorder/route');
const statusRoute = await import('@/lib/routes/track/statuses/[id]/route');
const templatesRoute = await import('@/lib/routes/track/projects/[id]/templates/route');
const templateRoute = await import('@/lib/routes/track/templates/[id]/route');
const labelsRoute = await import('@/app/api/track/labels/route');
const labelRoute = await import('@/lib/routes/track/labels/[id]/route');
const automationRoute = await import('@/lib/routes/track/projects/[id]/automation/route');
const triageSettingsRoute = await import('@/lib/routes/track/projects/[id]/triage-settings/route');
const triageRulesRoute = await import('@/lib/routes/track/projects/[id]/triage-rules/route');
const githubRulesRoute = await import('@/app/api/track/github/rules/route');
const githubRoute = await import('@/app/api/track/github/route');
const slackChannelsRoute = await import('@/app/api/track/integrations/slack/channels/route');
const providerRoute = await import('@/lib/routes/track/integrations/[provider]/route');
const agentAppsRoute = await import('@/app/api/track/agent-apps/route');
const workspaceAccessRoute = await import('@/app/api/track/access/route');
const teamAccessRoute = await import('@/lib/routes/track/projects/[id]/access/route');

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://x${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * Workspace con: owner (admin), `lead` (dueño del team A), `dev` (miembro
 * común), `rival` (dueño del team B), `guest` (invitado con acceso a A) y
 * `stranger` (otro workspace).
 */
async function setup() {
  const owner = await makeUser('ttr-owner');
  const lead = await makeUser('ttr-lead');
  const dev = await makeUser('ttr-dev');
  const rival = await makeUser('ttr-rival');
  const guest = await makeUser('ttr-guest');
  const stranger = await makeUser('ttr-stranger');
  const team = await createTeam(owner.id, 'Acme');
  for (const u of [lead, dev, rival, guest]) await addMember(team.id, u.id, 'member');
  const slug = () => `t${crypto.randomUUID().slice(0, 4)}`;
  const a = await createProject(owner.id, team.id, { name: 'Alpha', slug: slug() });
  const b = await createProject(owner.id, team.id, { name: 'Beta', slug: slug() });
  await setTeamRole(a.id, lead.id, 'owner', owner.id);
  await setTeamRole(b.id, rival.id, 'owner', owner.id);
  await setGuest(team.id, guest.email, [a.id], owner.id);
  const ws = trackWorkspaceId(team.id, owner.id);
  const as = (u: UserRow, role: SessionUser['role'] = 'member'): SessionUser =>
    (u.id === owner.id ? { ...owner, team, role: 'owner', apps: '*' } : { ...owner, actingUser: u, team, role, apps: '*' }) as unknown as SessionUser;
  const strangerTeam = await createTeam(stranger.id, 'Other');
  const users = {
    admin: as(owner),
    lead: as(lead),
    dev: as(dev),
    rival: as(rival),
    guest: as(guest),
    stranger: { ...stranger, team: strangerTeam, role: 'owner', apps: '*' } as unknown as SessionUser,
  };
  return { owner, lead, dev, rival, guest, team, a, b, ws, users };
}

type S = Awaited<ReturnType<typeof setup>>;
type Who = keyof S['users'];

/**
 * Llama a la ruta como `who`. En un request real la persona que mira Track
 * sale de la sesión (currentTrackViewer); acá se fija igual, para que los
 * teams privados se filtren como en producción.
 */
async function status(s: S, who: Who, call: () => Promise<Response>): Promise<number> {
  const user = s.users[who];
  session.user = user;
  return (await runAsTrackViewer(realUserId(user), call, 'app')).status;
}

describe('capabilitiesFor y parseTeamPermissions', () => {
  it('por defecto todo es de los dueños y de los admins', () => {
    expect(DEFAULT_TEAM_PERMISSIONS).toEqual({ settings: 'owners', labels: 'owners', templates: 'owners', members: 'owners' });
    const member = capabilitiesFor({ workspaceAdmin: false, teamOwner: false, permissions: DEFAULT_TEAM_PERMISSIONS });
    expect(member).toEqual({ owner: false, teamOwner: false, settings: false, labels: false, templates: false, members: false });
    const lead = capabilitiesFor({ workspaceAdmin: false, teamOwner: true, permissions: DEFAULT_TEAM_PERMISSIONS });
    expect(lead).toEqual({ owner: true, teamOwner: true, settings: true, labels: true, templates: true, members: true });
    expect(adminOnlyCapabilities(true)).toMatchObject({ owner: true, teamOwner: false, settings: true, members: true });
    expect(adminOnlyCapabilities(false)).toMatchObject({ owner: false, settings: false, labels: false });
  });

  it('un área abierta a miembros no da lo que es solo de dueños', () => {
    const perms = parseTeamPermissions(JSON.stringify({ labels: 'members' }));
    const member = capabilitiesFor({ workspaceAdmin: false, teamOwner: false, permissions: perms });
    expect(member).toMatchObject({ owner: false, labels: true, settings: false, templates: false, members: false });
  });

  it('lo guardado roto o con valores raros vuelve a los valores por defecto', () => {
    expect(parseTeamPermissions(null)).toEqual(DEFAULT_TEAM_PERMISSIONS);
    expect(parseTeamPermissions('{not json')).toEqual(DEFAULT_TEAM_PERMISSIONS);
    expect(parseTeamPermissions(JSON.stringify({ settings: 'everyone', members: 'members', owner: 'members' }))).toEqual({ ...DEFAULT_TEAM_PERMISSIONS, members: 'members' });
  });
});

describe('teamCapabilities', () => {
  it('un invitado nunca es dueño aunque tenga la fila', async () => {
    const s = await setup();
    await setTeamRole(s.a.id, s.guest.id, 'owner', s.owner.id);
    const a = (await getProject(s.a.id))!;
    expect((await teamCapabilities(a, s.guest.id, false)).owner).toBe(false);
    expect((await teamCapabilities(a, s.lead.id, false)).owner).toBe(true);
    // Ser dueño de A no da nada sobre B.
    const b = (await getProject(s.b.id))!;
    expect(await teamCapabilities(b, s.lead.id, false)).toMatchObject({ owner: false, settings: false });
  });
});

describe('rutas de ajustes del team', () => {
  it('nombre, identificador, borrar el team', async () => {
    const s = await setup();
    const rename = (id: string, name: string) => () => projectRoute.PATCH(req(`/api/track/projects/${id}`, 'PATCH', { name }), p(id));
    expect(await status(s, 'dev', rename(s.a.id, 'x'))).toBe(403);
    expect(await status(s, 'guest', rename(s.a.id, 'x'))).toBe(403);
    expect(await status(s, 'lead', rename(s.a.id, 'Alpha 2'))).toBe(200);
    expect(await status(s, 'lead', rename(s.b.id, 'mine now'))).toBe(403);
    expect(await status(s, 'admin', rename(s.b.id, 'Beta 2'))).toBe(200);
    expect(await status(s, 'stranger', rename(s.a.id, 'x'))).toBe(404);
    const slug = `k${crypto.randomUUID().slice(0, 3)}`;
    expect(await status(s, 'lead', () => projectRoute.PATCH(req('/x', 'PATCH', { slug }), p(s.a.id)))).toBe(200);
    expect(await status(s, 'lead', () => projectRoute.PATCH(req('/x', 'PATCH', { triageEnabled: true }), p(s.b.id)))).toBe(403);
    expect(await status(s, 'dev', () => projectRoute.DELETE(req('/x', 'DELETE'), p(s.a.id)))).toBe(403);
    expect(await status(s, 'lead', () => projectRoute.DELETE(req('/x', 'DELETE'), p(s.b.id)))).toBe(403);
    expect(await getProject(s.b.id)).toBeTruthy();
  });

  it('estados del workflow', async () => {
    const s = await setup();
    const add = (id: string) => () => statusesRoute.POST(req('/x', 'POST', { name: `S ${crypto.randomUUID().slice(0, 4)}` }), p(id));
    expect(await status(s, 'dev', add(s.a.id))).toBe(403);
    expect(await status(s, 'lead', add(s.b.id))).toBe(403);
    expect([200, 201]).toContain(await status(s, 'lead', add(s.a.id)));
    const [first, second] = await listStatuses(s.b.id);
    expect(await status(s, 'lead', () => statusRoute.PATCH(req('/x', 'PATCH', { name: 'hijacked' }), p(first.id)))).toBe(403);
    expect(await status(s, 'lead', () => statusRoute.DELETE(req('/x', 'DELETE', { reassignTo: second.id }), p(first.id)))).toBe(403);
    expect(await status(s, 'dev', () => reorderRoute.PATCH(req('/x', 'PATCH', { ids: [second.id, first.id] }), p(s.b.id)))).toBe(403);
    const mine = await createStatus(s.a.id, { name: 'Mine', category: 'todo' });
    expect(await status(s, 'dev', () => statusRoute.PATCH(req('/x', 'PATCH', { name: 'nope' }), p(mine.id)))).toBe(403);
    expect(await status(s, 'lead', () => statusRoute.PATCH(req('/x', 'PATCH', { name: 'Mine 2' }), p(mine.id)))).toBe(200);
  });

  it('plantillas', async () => {
    const s = await setup();
    const add = (id: string) => () => templatesRoute.POST(req('/x', 'POST', { name: 'Bug' }), p(id));
    expect(await status(s, 'dev', add(s.a.id))).toBe(403);
    expect(await status(s, 'lead', add(s.b.id))).toBe(403);
    expect(await status(s, 'lead', add(s.a.id))).toBe(201);
    const other = await createTemplate((await getProject(s.b.id))!, { name: 'Theirs' });
    expect(await status(s, 'lead', () => templateRoute.PATCH(req('/x', 'PATCH', { name: 'x' }), p(other.id)))).toBe(403);
    expect(await status(s, 'lead', () => templateRoute.DELETE(req('/x', 'DELETE'), p(other.id)))).toBe(403);
    expect(await status(s, 'rival', () => templateRoute.DELETE(req('/x', 'DELETE'), p(other.id)))).toBe(200);
  });

  it('labels del team y del workspace', async () => {
    const s = await setup();
    const add = (projectId: string | undefined, name: string, parentId?: string) => () => labelsRoute.POST(req('/x', 'POST', { name, projectId, parentId }));
    expect(await status(s, 'dev', add(s.a.id, 'dev-label'))).toBe(403);
    expect(await status(s, 'lead', add(s.b.id, 'other-team'))).toBe(403);
    expect(await status(s, 'lead', add(s.a.id, `a-${crypto.randomUUID().slice(0, 4)}`))).toBe(201);
    const wsLabel = await createLabel(s.ws, { name: `ws-${crypto.randomUUID().slice(0, 4)}` });
    const bGroup = await createLabel(s.ws, { name: `bg-${crypto.randomUUID().slice(0, 4)}`, projectId: s.b.id });
    const aLabel = await createLabel(s.ws, { name: `al-${crypto.randomUUID().slice(0, 4)}`, projectId: s.a.id });
    if (!wsLabel.ok || !bGroup.ok || !aLabel.ok) throw new Error('labels');
    // Un label del workspace o de otro team: no.
    expect(await status(s, 'lead', () => labelRoute.PATCH(req('/x', 'PATCH', { name: 'x' }), p(wsLabel.label.id)))).toBe(403);
    expect(await status(s, 'lead', () => labelRoute.DELETE(req('/x', 'DELETE'), p(bGroup.label.id)))).toBe(403);
    expect(await status(s, 'dev', () => labelRoute.PATCH(req('/x', 'PATCH', { color: '#123456' }), p(aLabel.label.id)))).toBe(403);
    // El suyo sí, pero no agrupado bajo un grupo de otro team.
    expect(await status(s, 'lead', () => labelRoute.PATCH(req('/x', 'PATCH', { parentId: bGroup.label.id }), p(aLabel.label.id)))).toBe(400);
    expect(await status(s, 'lead', add(s.a.id, `ac-${crypto.randomUUID().slice(0, 4)}`, bGroup.label.id))).toBe(400);
    expect(await status(s, 'lead', () => labelRoute.PATCH(req('/x', 'PATCH', { color: '#123456' }), p(aLabel.label.id)))).toBe(200);
    expect(await status(s, 'admin', () => labelRoute.PATCH(req('/x', 'PATCH', { color: '#654321' }), p(wsLabel.label.id)))).toBe(200);
  });

  it('automatizaciones, triage y reglas de GitHub', async () => {
    const s = await setup();
    const auto = (id: string) => () => automationRoute.PUT(req('/x', 'PUT', { autoArchiveMonths: 6 }), p(id));
    expect(await status(s, 'dev', auto(s.a.id))).toBe(403);
    expect(await status(s, 'lead', auto(s.b.id))).toBe(403);
    expect(await status(s, 'lead', auto(s.a.id))).toBe(200);
    const triage = (id: string) => () => triageSettingsRoute.PATCH(req('/x', 'PATCH', { slaEnabled: true }), p(id));
    expect(await status(s, 'dev', triage(s.a.id))).toBe(403);
    expect(await status(s, 'lead', triage(s.b.id))).toBe(403);
    expect(await status(s, 'lead', triage(s.a.id))).toBe(200);
    const rule = (id: string) => () => triageRulesRoute.POST(req('/x', 'POST', { name: 'r', actions: {} }), p(id));
    expect(await status(s, 'dev', rule(s.a.id))).toBe(403);
    expect(await status(s, 'lead', rule(s.b.id))).toBe(403);
    const gh = (projectId: string) => () => githubRulesRoute.PUT(req('/x', 'PUT', { projectId, reset: true }));
    expect(await status(s, 'dev', gh(s.a.id))).toBe(403);
    expect(await status(s, 'lead', gh(s.b.id))).toBe(403);
    expect(await status(s, 'lead', gh(s.a.id))).toBe(200);
  });

  it('avisos de Slack por team', async () => {
    const s = await setup();
    const list = (projectId?: string) => () => slackChannelsRoute.GET(req(`/api/track/integrations/slack/channels${projectId ? `?projectId=${projectId}` : ''}`));
    expect(await status(s, 'dev', list(s.a.id))).toBe(403);
    expect(await status(s, 'lead', list(s.b.id))).toBe(403);
    // Sin projectId son todos los canales del workspace: solo admins.
    expect(await status(s, 'lead', list())).toBe(403);
    expect(await status(s, 'lead', list(s.a.id))).toBe(200);
    const sub = (projectId: string) => () => slackChannelsRoute.POST(req('/x', 'POST', { projectId, channelId: 'C123', events: ['issue_created'] }));
    expect(await status(s, 'dev', sub(s.a.id))).toBe(403);
    expect(await status(s, 'lead', sub(s.b.id))).toBe(403);
    // Pasa el chequeo; Slack no está conectado en el test.
    expect(await status(s, 'lead', sub(s.a.id))).toBe(409);
  });

  it('miembros, dueños, visibilidad y permisos del team', async () => {
    const s = await setup();
    const act = (id: string, body: unknown) => () => teamAccessRoute.POST(req('/x', 'POST', body), p(id));
    expect(await status(s, 'dev', act(s.a.id, { action: 'setRole', userId: s.dev.id, role: 'owner' }))).toBe(403);
    expect(await isTeamOwner(s.a.id, s.dev.id)).toBe(false);
    expect(await status(s, 'dev', act(s.a.id, { action: 'permissions', permissions: { settings: 'members' } }))).toBe(403);
    expect(await status(s, 'dev', act(s.a.id, { action: 'visibility', visibility: 'private' }))).toBe(403);
    expect(await status(s, 'lead', act(s.b.id, { action: 'setRole', userId: s.lead.id, role: 'owner' }))).toBe(403);
    expect(await isTeamOwner(s.b.id, s.lead.id)).toBe(false);
    expect(await status(s, 'lead', act(s.b.id, { action: 'permissions', permissions: { settings: 'members' } }))).toBe(403);
    // Un invitado no puede ser dueño.
    expect(await status(s, 'lead', act(s.a.id, { action: 'setRole', userId: s.guest.id, role: 'owner' }))).toBe(400);
    // El dueño de A nombra a otro dueño de A.
    expect(await status(s, 'lead', act(s.a.id, { action: 'setRole', userId: s.dev.id, role: 'owner' }))).toBe(200);
    expect(await isTeamOwner(s.a.id, s.dev.id)).toBe(true);
    expect(await status(s, 'lead', act(s.a.id, { action: 'setRole', userId: s.dev.id, role: 'member' }))).toBe(200);
    // Privado: sumar a otro, solo con el permiso de miembros.
    expect(await status(s, 'lead', act(s.a.id, { action: 'visibility', visibility: 'private' }))).toBe(200);
    await addProjectAccess(s.a.id, s.dev.id, s.owner.id);
    expect(await status(s, 'dev', act(s.a.id, { action: 'addMember', userId: s.rival.id }))).toBe(403);
    expect(await status(s, 'dev', act(s.a.id, { action: 'removeMember', userId: s.lead.id }))).toBe(403);
    expect(await status(s, 'lead', act(s.a.id, { action: 'addMember', userId: s.rival.id }))).toBe(200);
    // Quien no está en el team privado ni lo ve (aunque sea dueño de otro).
    await setProjectVisibility(s.b.id, 'private', s.rival.id);
    expect(await status(s, 'lead', () => projectRoute.PATCH(req('/x', 'PATCH', { name: 'x' }), p(s.b.id)))).toBe(404);
    expect(await status(s, 'lead', () => teamAccessRoute.GET(req('/x'), p(s.b.id)))).toBe(404);
    expect(await status(s, 'stranger', () => teamAccessRoute.GET(req('/x'), p(s.a.id)))).toBe(404);
  });

  it('un área abierta a miembros deja tocarla, pero no lo que es solo de dueños', async () => {
    const s = await setup();
    await setTeamPermissions(s.a.id, { ...DEFAULT_TEAM_PERMISSIONS, settings: 'members' });
    expect(await status(s, 'dev', () => projectRoute.PATCH(req('/x', 'PATCH', { name: 'Opened' }), p(s.a.id)))).toBe(200);
    expect(await status(s, 'dev', () => projectRoute.PATCH(req('/x', 'PATCH', { slug: 'zzz' }), p(s.a.id)))).toBe(403);
    expect(await status(s, 'dev', () => projectRoute.PATCH(req('/x', 'PATCH', { name: 'Nope' }), p(s.b.id)))).toBe(403);
  });

  it('quien crea un team queda como su dueño', async () => {
    const s = await setup();
    const res = await (async () => {
      session.user = s.users.dev;
      return projectsRoute.POST(req('/api/track/projects', 'POST', { name: 'Gamma', slug: `g${crypto.randomUUID().slice(0, 4)}` }));
    })();
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    expect(await isTeamOwner(created.id, s.dev.id)).toBe(true);
  });
});

describe('lo del workspace sigue siendo de los admins', () => {
  it('un dueño de team no toca acceso, GitHub, integraciones ni agentes del workspace', async () => {
    const s = await setup();
    expect(await status(s, 'lead', () => workspaceAccessRoute.GET())).toBe(403);
    expect(await status(s, 'lead', () => workspaceAccessRoute.POST(req('/x', 'POST', { action: 'visibility', projectId: s.b.id, visibility: 'private' })))).toBe(403);
    expect(await status(s, 'lead', () => githubRoute.PUT(req('/x', 'PUT', { secret: 'x' })))).toBe(403);
    expect(await status(s, 'lead', () => githubRoute.DELETE())).toBe(403);
    expect(await status(s, 'lead', () => providerRoute.PUT(req('/x', 'PUT', {}), { params: Promise.resolve({ provider: 'sentry' }) }))).toBe(403);
    expect(await status(s, 'lead', () => providerRoute.DELETE(req('/x', 'DELETE'), { params: Promise.resolve({ provider: 'sentry' }) }))).toBe(403);
    expect(await status(s, 'lead', () => agentAppsRoute.POST(req('/x', 'POST', { name: 'bot' })))).toBe(403);
    expect(await status(s, 'admin', () => workspaceAccessRoute.GET())).toBe(200);
  });
});
