import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { groupsViewer, visibleChatIds } from '@/lib/groups-access';
import { createGroupTask } from '@/lib/groups-tasks';
import { createSavedList } from '@/lib/groups-org';
import { createNote } from '@/lib/notes';
import { exportAccountData } from '@/lib/privacy';
import { bufferSource, listZipEntries, readZipEntry } from '@/lib/zip-reader';
import { emitEvent } from '@/lib/events';
import { createFlow, updateFlow } from '@/lib/flow';
import { createIssue, createIssueRelation, createProject, listIssueRelations } from '@/lib/track-data';
import { runAsTrackViewer, setProjectVisibility } from '@/lib/track-access';
import { resolveIssueRefs } from '@/lib/track-ux';
import { listAudit } from '@/lib/track-audit';
import { exportIssuesCsv } from '@/lib/track-export';
import { listBroadcasts, createBroadcast } from '@/lib/groups-broadcasts';
import { linkTargetExists } from '@/lib/tasks';
import { createFolder } from '@/lib/link-folders';
import { createLink } from '@/lib/links';
import { createApiKey } from '@/lib/api-auth';
import { makeUser } from './helpers';

/**
 * Privacidad entre personas del mismo workspace: cada una ve lo suyo y lo que
 * le compartieron, por cualquier camino (rutas, API, export, eventos).
 */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const groupRoute = await import('@/lib/routes/groups/chats/[id]/group/route');
const membersRoute = await import('@/app/api/groups/members/route');
const tasksRoute = await import('@/app/api/groups/tasks/route');
const taskRoute = await import('@/lib/routes/groups/tasks/[id]/route');
const listRoute = await import('@/lib/routes/groups/lists/[id]/route');
const createRoute = await import('@/app/api/groups/create/route');
const v1Links = await import('@/app/api/v1/links/route');
const v1Link = await import('@/lib/routes/v1/links/[id]/route');

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

const post = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (owner: UserRow, person: UserRow, role: 'member' | 'admin' = 'member') => {
  session.user = { ...owner, actingUser: person, role, apps: '*' };
};
const asOwner = (owner: UserRow) => {
  session.user = { ...owner, role: 'owner', apps: '*' };
};

async function workspace(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const ana = await makeUser(`${label}-ana`);
  const beto = await makeUser(`${label}-beto`);
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, ana.id, 'member');
  await addMember(team.id, beto.id, 'member');
  return { owner, ana, beto, team };
}

describe('Lines: una línea restringida no se alcanza por rutas laterales', () => {
  async function lines(label: string) {
    const w = await workspace(label);
    const n = await createNumber(w.owner.id, w.owner.id, { provider: 'fake', name: 'Línea de Ana' });
    await connectNumber(w.owner.id, n.id);
    const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (fake) fake.connectedAt = Date.now() - 5000;
    const priv = (await getNumberRowById(n.id))!;
    await ingestEvents(priv, [
      { type: 'message', chatId: '120363000000000001@g.us', isGroup: true, fromMe: false, senderPhone: '5490000000001', senderName: 'Grupo Ana', providerMessageId: 'g-1', body: 'texto de prueba' },
    ]);
    await setLineAccess(w.owner.id, priv.id, { ownerId: w.ana.id, visibility: 'restricted', personIds: [], teamIds: [] });
    const chat = (await listChats(w.owner.id, w.owner.id)).rows[0];
    return { ...w, priv, chat };
  }

  it('ajustes del grupo, miembros y creación de grupos: 404 para quien no ve la línea', async () => {
    const w = await lines('pv-lines-a');
    as(w.owner, w.beto);
    expect((await groupRoute.POST(post('http://x', { action: 'settings' }), ctx(w.chat.id))).status).toBe(404);
    expect((await groupRoute.POST(post('http://x', { action: 'leave' }), ctx(w.chat.id))).status).toBe(404);
    expect((await membersRoute.POST(post('http://x', { chatIds: [w.chat.id], action: 'add', phones: ['5490000000099'] }))).status).toBe(404);
    expect((await createRoute.POST(post('http://x', { numberId: w.priv.id, name: 'Nuevo', phones: ['5490000000098'] }))).status).toBe(404);
    // Quien tiene la línea sí pasa el control (la respuesta depende del proveedor falso).
    as(w.owner, w.ana);
    expect((await groupRoute.POST(post('http://x', { action: 'other' }), ctx(w.chat.id))).status).toBe(400);
  });

  it('tareas y listas guardadas solo muestran chats que la persona ve', async () => {
    const w = await lines('pv-lines-b');
    const task = await createGroupTask(w.owner.id, w.ana.id, { chatId: w.chat.id, title: 'Llamar al grupo' });
    const list = await createSavedList(w.owner.id, w.ana.id, { name: 'Todos', shared: true, filters: {} });

    as(w.owner, w.beto);
    const listed = (await (await tasksRoute.GET(new NextRequest('http://x/api/groups/tasks?status=all'))).json()) as { tasks: Array<{ id: string }> };
    expect(listed.tasks.map((t) => t.id)).not.toContain(task.id);
    expect((await taskRoute.GET(new Request('http://x'), ctx(task.id))).status).toBe(404);
    expect((await taskRoute.DELETE(new Request('http://x', { method: 'DELETE' }), ctx(task.id))).status).toBe(404);
    const created = await tasksRoute.POST(new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ chatId: w.chat.id, title: 'x' }) }));
    expect(created.status).toBe(404);
    const viaList = (await (await listRoute.GET(new Request('http://x?chats=1'), ctx(list.id))).json()) as { chats: Array<{ id: string }> };
    expect(viaList.chats.map((c) => c.id)).not.toContain(w.chat.id);

    as(w.owner, w.ana);
    const mine = (await (await tasksRoute.GET(new NextRequest('http://x/api/groups/tasks?status=all'))).json()) as { tasks: Array<{ id: string }> };
    expect(mine.tasks.map((t) => t.id)).toContain(task.id);
    expect((await taskRoute.GET(new Request('http://x'), ctx(task.id))).status).toBe(200);
    const anaList = (await (await listRoute.GET(new Request('http://x?chats=1'), ctx(list.id))).json()) as { chats: Array<{ id: string }> };
    expect(anaList.chats.map((c) => c.id)).toContain(w.chat.id);
  });

  it('los envíos programados a una línea restringida no aparecen en la lista de quien no la ve', async () => {
    const w = await lines('pv-lines-c');
    const b = await createBroadcast(w.owner.id, w.ana.id, { chatIds: [w.chat.id], body: 'aviso inventado', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
    const visibleFor = async (u: UserRow) => visibleChatIds(await groupsViewer(w.owner.id, u.id, 'member'));
    expect((await listBroadcasts(w.owner.id, { visible: await visibleFor(w.beto) })).map((x) => x.id)).not.toContain(b.id);
    expect((await listBroadcasts(w.owner.id, { visible: await visibleFor(w.ana) })).map((x) => x.id)).toContain(b.id);
  });
});

describe('Export de datos: el dueño del workspace no se lleva lo personal de los demás', () => {
  it('las notas de otra persona del workspace no salen en el export del dueño', async () => {
    const w = await workspace('pv-export');
    await createNote({ workspaceId: w.owner.id, personId: w.owner.id }, { title: 'Nota del dueño' });
    await createNote({ workspaceId: w.owner.id, personId: w.ana.id }, { title: 'Diario de Ana' });
    const exp = await exportAccountData(w.owner);
    const entries = await listZipEntries(bufferSource(exp.zip));
    const entry = entries.find((e) => e.name === 'tables/notes.json');
    expect(entry).toBeTruthy();
    const rows = JSON.parse((await readZipEntry(bufferSource(exp.zip), entry!, 5e6)).toString('utf8')) as Array<{ title: string; person_id: string }>;
    expect(rows.map((r) => r.title)).toContain('Nota del dueño');
    expect(rows.map((r) => r.title)).not.toContain('Diario de Ana');
    expect(rows.every((r) => r.person_id === w.owner.id)).toBe(true);
  });

  it('tampoco los issues ni comentarios de un equipo privado del que no es parte', async () => {
    const w = await workspace('pv-export-track');
    const open = await createProject(w.owner.id, w.team.id, { name: 'Abierto' });
    const priv = await createProject(w.owner.id, w.team.id, { name: 'Reservado' });
    await setProjectVisibility(priv.id, 'private', w.ana.id);
    await createIssue(open.id, w.ana.id, { title: 'Tarea abierta', priority: 'low', description: [] });
    const hidden = await createIssue(priv.id, w.ana.id, { title: 'Tema reservado', priority: 'low', description: [] });
    await getDb()
      .prepare('INSERT INTO track_issue_comments (id, issue_id, user_id, body) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), hidden.id, w.ana.id, 'comentario reservado');
    const exp = await exportAccountData(w.owner);
    const all = await Promise.all((await listZipEntries(bufferSource(exp.zip))).map(async (e) => (await readZipEntry(bufferSource(exp.zip), e, 5e6)).toString('utf8')));
    const text = all.join('\n');
    expect(text).toContain('Tarea abierta');
    expect(text).not.toContain('Tema reservado');
    expect(text).not.toContain('comentario reservado');
  });
});

describe('Flow: los eventos de Notes solo llegan a los flows de la misma persona', () => {
  it('un flow de otra persona no recibe note.created', async () => {
    const w = await workspace('pv-flow');
    const graph = {
      nodes: [
        { id: 't', type: 'trigger.event', position: { x: 0, y: 0 }, config: { event: 'note.created' } },
        { id: 'd', type: 'data.set', position: { x: 0, y: 0 }, config: { fields: [{ key: 'k', value: '1' }] } },
      ],
      edges: [{ id: 't-out-d', source: 't', target: 'd', sourceHandle: null }],
    };
    const mk = async (createdBy: string) => {
      const res = await createFlow(w.owner.id, createdBy, { name: 'F', graph: graph as never });
      if (!res.ok) throw new Error(res.error);
      const up = await updateFlow(w.owner.id, res.flow.id, { enabled: true });
      if (!up.ok) throw new Error(up.error);
      return up.flow.id;
    };
    const anaFlow = await mk(w.ana.id);
    const ownerFlow = await mk(w.owner.id);
    await emitEvent(w.owner.id, 'note.created', { note: { id: 'n-1', title: 'Diario de Ana', tags: [], notebookId: null, sourceUrl: null, createdAt: '' }, personId: w.ana.id });
    const runs = async (id: string) => ((await getDb().prepare('SELECT COUNT(*) AS c FROM flow_runs WHERE flow_id = ?').get(id)) as { c: number }).c;
    expect(Number(await runs(anaFlow))).toBe(1);
    expect(Number(await runs(ownerFlow))).toBe(0);
  });
});

describe('Track: un equipo privado no se ve por referencias, relaciones, vínculos ni el audit log', () => {
  async function track(label: string) {
    const w = await workspace(label);
    const pub = await createProject(w.owner.id, w.team.id, { name: 'Abierto' });
    const priv = await createProject(w.owner.id, w.team.id, { name: 'Reservado' });
    await setProjectVisibility(priv.id, 'private', w.ana.id);
    const open = await createIssue(pub.id, w.ana.id, { title: 'Tarea abierta', priority: 'low', description: [] });
    const hidden = await createIssue(priv.id, w.ana.id, { title: 'Tema reservado', priority: 'low', description: [] });
    return { ...w, pub, priv, open, hidden };
  }

  it('referencias por identificador y relaciones', async () => {
    const w = await track('pv-track-a');
    const refs = [w.open.identifier, w.hidden.identifier, w.hidden.id];
    expect((await resolveIssueRefs(refs, w.team.id, w.owner.id, w.beto.id)).map((r) => r.id)).toEqual([w.open.id]);
    expect((await resolveIssueRefs(refs, w.team.id, w.owner.id, w.ana.id)).map((r) => r.id).sort()).toEqual([w.open.id, w.hidden.id].sort());

    await createIssueRelation(w.open.id, w.ana.id, w.hidden.id, 'related');
    expect(await runAsTrackViewer(w.beto.id, () => listIssueRelations(w.open.id))).toHaveLength(0);
    expect(await runAsTrackViewer(w.ana.id, () => listIssueRelations(w.open.id))).toHaveLength(1);
  });

  it('el CSV de issues de un workspace sin equipo heredado deja afuera los equipos privados', async () => {
    const w = await workspace('pv-track-csv');
    const open = await createProject(w.owner.id, null, { name: 'Abierto' });
    const priv = await createProject(w.owner.id, null, { name: 'Reservado' });
    await setProjectVisibility(priv.id, 'private', w.ana.id);
    await createIssue(open.id, w.ana.id, { title: 'Tarea abierta', priority: 'low', description: [] });
    await createIssue(priv.id, w.ana.id, { title: 'Tema reservado', priority: 'low', description: [] });
    const forBeto = await runAsTrackViewer(w.beto.id, () => exportIssuesCsv(null, w.owner.id));
    expect(forBeto).toContain('Tarea abierta');
    expect(forBeto).not.toContain('Tema reservado');
    expect(await runAsTrackViewer(w.ana.id, () => exportIssuesCsv(null, w.owner.id))).toContain('Tema reservado');
  });

  it('vínculos de tareas y audit log', async () => {
    const w = await track('pv-track-b');
    expect(await linkTargetExists(w.owner.id, 'track_issue', w.hidden.id, { personId: w.beto.id, role: 'member' })).toBe(false);
    expect(await linkTargetExists(w.owner.id, 'track_issue', w.hidden.id, { personId: w.ana.id, role: 'member' })).toBe(true);
    // Un issue de otro workspace nunca.
    const other = await makeUser('pv-track-other');
    expect(await linkTargetExists(other.id, 'track_issue', w.open.id, { personId: other.id, role: 'owner' })).toBe(false);

    const ws = w.team.id;
    await getDb()
      .prepare(
        "INSERT INTO track_audit_log (id, workspace_id, actor_id, via, action, entity_type, entity_id, entity_label, project_id, data) VALUES (?, ?, ?, 'app', 'issue.created', 'issue', ?, ?, ?, '{}')",
      )
      .run(crypto.randomUUID(), ws, w.ana.id, w.hidden.id, `${w.hidden.identifier} Tema reservado`, w.priv.id);
    const forBeto = await listAudit(ws, { viewerId: w.beto.id, limit: 100 });
    expect(forBeto.rows.map((r) => r.entityLabel)).not.toContain(`${w.hidden.identifier} Tema reservado`);
    const forAna = await listAudit(ws, { viewerId: w.ana.id, limit: 100 });
    expect(forAna.rows.map((r) => r.entityLabel)).toContain(`${w.hidden.identifier} Tema reservado`);
  });
});

describe('Links: la API respeta el acceso por carpeta de quien creó la key', () => {
  it('una carpeta sin acceso no aparece ni se lee por la API', async () => {
    const w = await workspace('pv-links');
    const folder = await createFolder(w.owner.id, { name: 'Dirección', defaultAccess: 'none' });
    if (!folder.ok) throw new Error(folder.code);
    const made = await createLink(w.owner.id, { url: 'https://example.com/reservado', folderId: folder.folder.id, createdBy: w.owner.id });
    if (!made.ok) throw new Error(made.code);
    const memberKey = (await createApiKey(w.owner.id, 'ana', w.ana.id)).key;
    const ownerKey = (await createApiKey(w.owner.id, 'owner', w.owner.id)).key;
    const get = (url: string, key: string) => new NextRequest(url, { headers: { authorization: `Bearer ${key}` } });
    const listed = (await (await v1Links.GET(get('http://x/api/v1/links', memberKey))).json()) as { links: Array<{ id: string }> };
    expect(listed.links.map((l) => l.id)).not.toContain(made.link.id);
    expect((await v1Link.GET(get(`http://x/api/v1/links/${made.link.id}`, memberKey), ctx(made.link.id))).status).toBe(404);
    const patched = await v1Link.PATCH(
      new NextRequest(`http://x/api/v1/links/${made.link.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${memberKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'cambio' }) }),
      ctx(made.link.id),
    );
    expect(patched.status).toBe(404);
    const ownerList = (await (await v1Links.GET(get('http://x/api/v1/links', ownerKey))).json()) as { links: Array<{ id: string }> };
    expect(ownerList.links.map((l) => l.id)).toContain(made.link.id);
  });
});
