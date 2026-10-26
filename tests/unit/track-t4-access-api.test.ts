import { describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createApiKey } from '@/lib/api-auth';
import { addMember, createTeam } from '@/lib/teams';
import { canAccessTrackProject, createIssue, createProject, listProjects, listAllIssues, updateIssue, listStatuses } from '@/lib/track-data';
import { addProjectAccess, runAsTrackViewer, setGuest, setProjectVisibility } from '@/lib/track-access';
import { searchApps } from '@/lib/app-search';
import { handleTrackEvent } from '@/lib/track-events';
import { auditCsvCell, auditToCsv, listAudit } from '@/lib/track-audit';
import { handleMcpMessage } from '@/lib/track-mcp';
import { validateApiKeyAuth } from '@/lib/api-auth';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const issuesRoute = await import('@/app/api/v1/track/issues/route');
const issueRoute = await import('@/lib/routes/v1/track/issues/[id]/route');
const commentsRoute = await import('@/lib/routes/v1/track/issues/[id]/comments/route');
const projectsRoute = await import('@/app/api/v1/track/projects/route');
const accessRoute = await import('@/app/api/track/access/route');

function req(url: string, key: string, init: { method?: string; body?: unknown } = {}) {
  return new Request(`http://x${url}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Team con dueño, un miembro, un invitado y dos proyectos (uno privado). */
async function setup() {
  const owner = await makeUser('own');
  const member = await makeUser('mem');
  const guest = await makeUser('gst');
  const team = await createTeam(owner.id, 'Acme');
  await addMember(team.id, member.id);
  await addMember(team.id, guest.id);
  const open = await createProject(owner.id, team.id, { name: 'Open', slug: `open-${crypto.randomUUID().slice(0, 6)}` });
  const secret = await createProject(owner.id, team.id, { name: 'Secret', slug: `sec-${crypto.randomUUID().slice(0, 6)}` });
  await setProjectVisibility(secret.id, 'private', owner.id);
  await setGuest(team.id, guest.email, [open.id], owner.id);
  const openIssue = await createIssue(open.id, owner.id, { title: 'open bug' }, { source: 'app' });
  const secretIssue = await createIssue(secret.id, owner.id, { title: 'secret plan' }, { source: 'app' });
  const projSecret = (await getDb().prepare('SELECT * FROM track_projects WHERE id = ?').get(secret.id)) as Parameters<typeof canAccessTrackProject>[0];
  return { owner, member, guest, team, open, secret, openIssue, secretIssue, projSecret };
}

describe('Track T4: proyectos privados e invitados', () => {
  it('un privado solo lo ven sus miembros y un invitado solo sus proyectos', async () => {
    const s = await setup();
    const as = (u: { id: string }) => <T,>(fn: () => Promise<T>) => runAsTrackViewer(u.id, fn, 'app');

    // Dueño: quedó como miembro al hacerlo privado.
    expect(await as(s.owner)(() => canAccessTrackProject(s.projSecret, s.team.id, s.owner.id))).toBe(true);
    // Miembro común: no lo ve ni en la lista, ni en issues, ni en ⌘K.
    expect(await as(s.member)(() => canAccessTrackProject(s.projSecret, s.team.id, s.owner.id))).toBe(false);
    const memberList = await as(s.member)(() => listProjects(s.team.id, s.owner.id));
    expect(memberList.rows.map((p) => p.id)).toEqual(expect.arrayContaining([s.open.id]));
    expect(memberList.rows.map((p) => p.id)).not.toContain(s.secret.id);
    const memberIssues = await as(s.member)(() => listAllIssues(s.team.id, s.owner.id));
    expect(memberIssues.rows.map((i) => i.id)).not.toContain(s.secretIssue.id);
    const found = await searchApps({ id: s.owner.id, team: { id: s.team.id }, actingUser: { id: s.member.id } }, 'secret');
    expect(found.map((f) => f.id)).not.toContain(s.secretIssue.id);

    // Sumado al privado, lo ve.
    await addProjectAccess(s.secret.id, s.member.id, s.owner.id);
    expect(await as(s.member)(() => canAccessTrackProject(s.projSecret, s.team.id, s.owner.id))).toBe(true);

    // Invitado: solo Open, aunque Secret no fuera privado.
    const guestList = await as(s.guest)(() => listProjects(s.team.id, s.owner.id));
    expect(guestList.rows.map((p) => p.id)).toEqual([s.open.id]);
    await setProjectVisibility(s.secret.id, 'workspace', s.owner.id);
    expect(await as(s.guest)(() => canAccessTrackProject({ ...s.projSecret, visibility: 'workspace' }, s.team.id, s.owner.id))).toBe(false);
  });

  it('la ruta de acceso: solo admins, y un admin no puede ser invitado', async () => {
    const s = await setup();
    session.user = { ...s.member, id: s.owner.id, actingUser: s.member, team: s.team, role: 'member' };
    expect((await accessRoute.GET()).status).toBe(403);
    session.user = { ...s.owner, team: s.team, role: 'owner' };
    const res = await accessRoute.GET();
    const body = (await res.json()) as { projects: Array<{ id: string; visibility: string }>; guests: Array<{ email: string }> };
    expect(body.projects.find((p) => p.id === s.secret.id)?.visibility).toBe('private');
    expect(body.guests.map((g) => g.email)).toContain(s.guest.email.toLowerCase());
    const bad = await accessRoute.POST(
      new Request('http://x/api/track/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'setGuest', email: s.owner.email, projectIds: [] }),
      }) as never,
    );
    expect(bad.status).toBe(400);
    session.user = null;
  });
});

describe('Track T4: API v1', () => {
  it('crea, lista, edita, comenta y borra issues con la API key', async () => {
    const s = await setup();
    const { key } = await createApiKey(s.owner.id, 'ci', s.owner.id, ['track:write']);

    const created = await issuesRoute.POST(
      req('/api/v1/track/issues', key, {
        method: 'POST',
        body: { projectId: s.open.slug.toUpperCase(), title: 'From CI', description: 'Build failed', priority: 'high', labels: ['ci'], links: ['https://acme.zendesk.com/agent/tickets/77'] },
      }),
    );
    expect(created.status).toBe(201);
    const issue = (await created.json()) as { id: string; identifier: string; priority: string; labels: Array<{ name: string }>; source: string; description: string };
    expect(issue.priority).toBe('high');
    expect(issue.labels.map((l) => l.name)).toEqual(['ci']);
    expect(issue.source).toBe('api');
    expect(issue.description).toBe('Build failed');
    const ref = await getDb().prepare("SELECT provider, external_id FROM track_external_refs WHERE issue_id = ?").get(issue.id);
    expect(ref).toEqual({ provider: 'zendesk', external_id: '77' });

    const list = (await (await issuesRoute.GET(req(`/api/v1/track/issues?projectId=${s.open.id}&q=CI`, key))).json()) as { data: Array<{ id: string }>; total: number };
    expect(list.data.map((i) => i.id)).toContain(issue.id);

    // PATCH por identificador y status por nombre.
    const patched = await issueRoute.PATCH(req(`/api/v1/track/issues/${issue.identifier}`, key, { method: 'PATCH', body: { status: 'done' } }), {
      params: Promise.resolve({ id: issue.identifier }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { status: { category: string } }).status.category).toBe('done');
    const bad = await issueRoute.PATCH(req(`/api/v1/track/issues/${issue.id}`, key, { method: 'PATCH', body: { status: 'Nope' } }), {
      params: Promise.resolve({ id: issue.id }),
    });
    expect(bad.status).toBe(400);

    const c = await commentsRoute.POST(req(`/api/v1/track/issues/${issue.id}/comments`, key, { method: 'POST', body: { body: 'Fixed in #12' } }), {
      params: Promise.resolve({ id: issue.id }),
    });
    expect(c.status).toBe(201);
    const comments = (await (await commentsRoute.GET(req(`/api/v1/track/issues/${issue.id}/comments`, key), { params: Promise.resolve({ id: issue.id }) })).json()) as {
      data: Array<{ body: string }>;
    };
    expect(comments.data.map((x) => x.body)).toEqual(['Fixed in #12']);

    const del = await issueRoute.DELETE(req(`/api/v1/track/issues/${issue.id}`, key, { method: 'DELETE' }), { params: Promise.resolve({ id: issue.id }) });
    expect(del.status).toBe(200);
    const gone = await issueRoute.GET(req(`/api/v1/track/issues/${issue.id}`, key), { params: Promise.resolve({ id: issue.id }) });
    expect(gone.status).toBe(404);
  });

  it('scopes, privados y aislamiento entre workspaces', async () => {
    const s = await setup();
    const readOnly = await createApiKey(s.owner.id, 'ro', s.owner.id, ['track:read']);
    const noTrack = await createApiKey(s.owner.id, 'crm', s.owner.id, ['crm:read']);
    const memberKey = await createApiKey(s.owner.id, 'mem', s.member.id, ['track:write']);
    const stranger = await makeUser('str');
    const strangerKey = await createApiKey(stranger.id, 'x', stranger.id, ['track:write']);

    expect((await issuesRoute.GET(req('/api/v1/track/issues', noTrack.key))).status).toBe(403);
    expect((await issuesRoute.POST(req('/api/v1/track/issues', readOnly.key, { method: 'POST', body: { projectId: s.open.id, title: 'x' } }))).status).toBe(403);

    // El miembro no ve el privado: ni en la lista ni por id.
    const projects = (await (await projectsRoute.GET(req('/api/v1/track/projects', memberKey.key))).json()) as { data: Array<{ id: string }> };
    expect(projects.data.map((p) => p.id)).toContain(s.open.id);
    expect(projects.data.map((p) => p.id)).not.toContain(s.secret.id);
    expect((await issueRoute.GET(req(`/api/v1/track/issues/${s.secretIssue.id}`, memberKey.key), { params: Promise.resolve({ id: s.secretIssue.id }) })).status).toBe(404);
    // Un miembro no crea proyectos.
    expect((await projectsRoute.POST(req('/api/v1/track/projects', memberKey.key, { method: 'POST', body: { name: 'Nope' } }))).status).toBe(403);

    // Otro workspace: nada.
    expect((await issueRoute.GET(req(`/api/v1/track/issues/${s.openIssue.id}`, strangerKey.key), { params: Promise.resolve({ id: s.openIssue.id }) })).status).toBe(404);
    const strangerList = (await (await issuesRoute.GET(req('/api/v1/track/issues', strangerKey.key))).json()) as { total: number };
    expect(strangerList.total).toBe(0);
  });
});

describe('Track T4: MCP', () => {
  it('initialize, tools/list (con y sin escritura) y tools/call', async () => {
    const s = await setup();
    const rw = await validateApiKeyAuth((await createApiKey(s.owner.id, 'mcp', s.owner.id, ['track:write'])).key);
    const ro = await validateApiKeyAuth((await createApiKey(s.owner.id, 'mcp-ro', s.owner.id, ['track:read'])).key);
    if (!rw || !ro) throw new Error('keys');

    const init = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, rw, false);
    expect((init?.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26');
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, rw, false)).toBeNull();

    const toolsRw = ((await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, rw, false))?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(toolsRw).toEqual(expect.arrayContaining(['search_issues', 'create_issue', 'update_issue', 'add_comment', 'list_projects', 'list_cycles']));
    const toolsRo = ((await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ro, false))?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(toolsRo).not.toContain('create_issue');
    const toolsReadonlyUrl = ((await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, rw, true))?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(toolsReadonlyUrl).not.toContain('update_issue');

    const created = await handleMcpMessage(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_issue', arguments: { projectId: s.open.id, title: 'From Claude', priority: 'urgent' } } },
      rw,
      false,
    );
    const result = created?.result as { isError: boolean; structuredContent: { identifier: string; source: string } };
    expect(result.isError).toBe(false);
    expect(result.structuredContent.source).toBe('mcp');

    const denied = await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'create_issue', arguments: { projectId: s.open.id, title: 'x' } } }, ro, false);
    expect((denied?.result as { isError: boolean }).isError).toBe(true);

    const search = await handleMcpMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search_issues', arguments: { query: 'Claude' } } }, ro, false);
    expect((search?.result as { structuredContent: { total: number } }).structuredContent.total).toBe(1);

    const got = await handleMcpMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_issue', arguments: { id: result.structuredContent.identifier } } }, ro, false);
    expect((got?.result as { structuredContent: { title: string; comments: unknown[] } }).structuredContent.title).toBe('From Claude');

    const unknown = await handleMcpMessage({ jsonrpc: '2.0', id: 9, method: 'nope' }, ro, false);
    expect(unknown?.error?.code).toBe(-32601);
  });
});

describe('Track T4: audit log y webhooks', () => {
  it('registra cambios con antes y después, y exporta CSV seguro', async () => {
    const s = await setup();
    const statuses = await listStatuses(s.open.id);
    const before = s.openIssue;
    // Por la API: el evento sale de updateIssue y queda con via = api.
    await runAsTrackViewer(
      s.owner.id,
      () => updateIssue(before.id, { title: '=cmd|calc', statusId: statuses.find((x) => x.category === 'done')!.id }, s.owner.id),
      'api',
    );
    let rows: Awaited<ReturnType<typeof listAudit>>['rows'] = [];
    for (let i = 0; i < 40 && !rows.some((r) => r.entityId === before.id); i++) {
      await new Promise((r) => setTimeout(r, 25));
      rows = (await listAudit(s.team.id, { action: 'issue.updated' })).rows;
    }
    const entry = rows.find((r) => r.entityId === before.id);
    expect(entry?.via).toBe('api');
    expect((entry?.data.title as { from: string; to: string }).to).toBe('=cmd|calc');
    expect((entry?.data.status as { to: string }).to).toBe(statuses.find((x) => x.category === 'done')!.name);
    const csv = auditToCsv(rows);
    expect(csv.split('\n')[0]).toBe('created_at,actor,via,action,entity_type,entity,project,details,ip');
    expect(csv).toContain(`${before.identifier} =cmd|calc`);
    expect(auditCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(auditCsvCell('a,"b"')).toBe('"a,""b"""');
  });

  it('issue.deleted y comment.created generan entregas para los webhooks suscriptos', async () => {
    const s = await setup();
    const hookId = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO webhooks (id, user_id, url, events, secret, active) VALUES (?, ?, 'https://hooks.invalid/x', ?, 'whsec_x', 1)")
      .run(hookId, s.owner.id, JSON.stringify(['issue.deleted', 'comment.created', 'project.updated']));
    await handleTrackEvent({ type: 'issue.deleted', issue: s.openIssue, actorId: s.owner.id, count: 1 }, { via: 'app' });
    await handleTrackEvent({ type: 'comment.created', issueId: s.secretIssue.id, commentId: 'c1', actorId: s.owner.id, body: 'hola' }, { via: 'app' });
    const rows = (await getDb().prepare('SELECT event, payload FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at').all(hookId)) as Array<{ event: string; payload: string }>;
    expect(rows.map((r) => r.event).sort()).toEqual(['comment.created', 'issue.deleted']);
    const del = JSON.parse(rows.find((r) => r.event === 'issue.deleted')!.payload) as { data: { issue: { identifier: string } } };
    expect(del.data.issue.identifier).toBe(s.openIssue.identifier);
  });

  it('los reintentos reclaman cada entrega (dos corridas no la mandan dos veces)', async () => {
    const s = await setup();
    const hookId = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO webhooks (id, user_id, url, events, secret, active) VALUES (?, ?, 'https://hooks.invalid/x', '[]', 'whsec_x', 1)")
      .run(hookId, s.owner.id);
    const id = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, attempts, next_attempt_at) VALUES (?, ?, 'issue.created', '{}', 'pending', 1, ?)")
      .run(id, hookId, new Date(Date.now() - 1000).toISOString());
    const { retryDueWebhooks } = await import('@/lib/webhooks');
    await Promise.all([retryDueWebhooks(), retryDueWebhooks()]);
    const row = (await getDb().prepare('SELECT attempts, status FROM webhook_deliveries WHERE id = ?').get(id)) as { attempts: number; status: string };
    expect(row.attempts).toBe(2);
    expect(row.status).toBe('pending');
  });
});
