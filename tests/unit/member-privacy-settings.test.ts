import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createActivity } from '@/lib/crm';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createLabel as createLinesLabel, createNumber, getNumberRowById, ingestEvents, listChats, listLabels as listLinesLabels, setChatLabels } from '@/lib/groups';
import { groupsViewer, viewerFrom } from '@/lib/groups-access';
import { createFolder, deleteFolder, listFolders, moveChatsToFolder, setLineAccess } from '@/lib/groups-lines';
import { summarizeChat } from '@/lib/groups-ai';
import { searchApps } from '@/lib/app-search';
import { linkTask, promoteTaskToTrack } from '@/lib/tasks';
import { createIssue, createIssueView, createProject } from '@/lib/track-data';
import { addProjectAccess, removeProjectAccess, runAsTrackViewer, setGuest, setProjectVisibility } from '@/lib/track-access';
import { createLabel, listLabels } from '@/lib/track-labels';
import { listChannelSubs, saveChannelSub } from '@/lib/track-slack';
import { listGithubRules, saveGithubRules } from '@/lib/track-github';
import { listFavoriteViews, setViewFavorite, setViewShared } from '@/lib/track-ux';
import { createPlan, createPlanMilestone, getAccessiblePlan, listPlans } from '@/lib/track-plans';
import { createInitiative, getAccessibleInitiative, listInitiatives } from '@/lib/track-initiatives';
import { searchPlanning } from '@/lib/track-planning-search';
import { makeUser } from './helpers';

/**
 * Privacidad entre personas del mismo workspace, tercera parte: lo que rodea
 * a los equipos de Track y a las líneas (labels, ajustes de integraciones,
 * tareas vinculadas, carpetas, conteos, favoritas, plans y el resumen AI).
 */

// El resumen AI devuelve el prompt tal cual: alcanza para ver qué recibe el modelo.
vi.mock('@/lib/ai', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai')>()),
  aiGenerateText: vi.fn(async (o: { prompt: string }) => ({ text: o.prompt, inputTokens: 0, outputTokens: 0, model: 'fake' })),
}));

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Un team con dos equipos de Track: "Abierto" y "Reservado" (privado, solo Ana). Beto es miembro sin acceso. */
async function track(label: string) {
  const owner = await makeUser(`${label}-owner`);
  const ana = await makeUser(`${label}-ana`);
  const beto = await makeUser(`${label}-beto`);
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, ana.id, 'member');
  await addMember(team.id, beto.id, 'member');
  const pub = await createProject(owner.id, team.id, { name: 'Abierto' });
  const priv = await createProject(owner.id, team.id, { name: 'Reservado' });
  await setProjectVisibility(priv.id, 'private', ana.id);
  const open = await createIssue(pub.id, ana.id, { title: 'Tarea abierta', priority: 'low', description: [] });
  const hidden = await createIssue(priv.id, ana.id, { title: 'Tema reservado', priority: 'low', description: [] });
  const as = <T>(u: { id: string }, fn: () => Promise<T>) => runAsTrackViewer(u.id, fn, 'app');
  return { owner, ana, beto, team, ws: team.id, scope: { teamId: team.id, ownerId: owner.id }, pub, priv, open, hidden, as };
}

describe('Track: labels según los equipos que ve cada persona', () => {
  it('los labels de un equipo privado y sus issues no cuentan para quien no lo ve', async () => {
    const t = await track('mps-labels');
    const word = `pera${crypto.randomUUID().slice(0, 6)}`;
    const general = await createLabel(t.ws, { name: `${word} general` });
    const own = await createLabel(t.ws, { name: `${word} interno`, projectId: t.priv.id });
    if (!general.ok || !own.ok) throw new Error('seed');
    const copy = (l: { id: string; name: string; color: string }) => ({ id: l.id, name: l.name, color: l.color });
    const db = getDb();
    await db.prepare('UPDATE track_issues SET labels = ? WHERE id = ?').run(JSON.stringify([copy(general.label)]), t.open.id);
    await db.prepare('UPDATE track_issues SET labels = ? WHERE id = ?').run(JSON.stringify([copy(general.label), copy(own.label)]), t.hidden.id);

    const forAna = await t.as(t.ana, () => listLabels(t.ws, true));
    expect(forAna.map((l) => [l.name, l.issue_count])).toEqual([
      [`${word} general`, 2],
      [`${word} interno`, 1],
    ]);
    const forBeto = await t.as(t.beto, () => listLabels(t.ws, true));
    expect(forBeto.map((l) => [l.name, l.issue_count])).toEqual([[`${word} general`, 1]]);
    // Sin persona (cron, import) van todos, como siempre.
    expect((await listLabels(t.ws)).map((l) => l.name)).toEqual([`${word} general`, `${word} interno`]);

    // Cmd+K sigue la misma regla.
    const session = (u: { id: string }) => ({ id: t.owner.id, team: { id: t.team.id }, actingUser: { id: u.id }, role: 'member' as const });
    const found = async (u: { id: string }) => (await searchApps(session(u), word)).filter((i) => i.group === 'trackLabels').map((i) => i.label);
    expect(await found(t.ana)).toEqual([`${word} general`, `${word} interno`]);
    expect(await found(t.beto)).toEqual([`${word} general`]);
  });
});

describe('Track: ajustes de integraciones según los equipos que ve cada persona', () => {
  it('los avisos a Slack y las reglas de GitHub de un equipo privado no salen para quien no lo ve', async () => {
    const t = await track('mps-integ');
    for (const p of [t.pub, t.priv]) {
      await saveChannelSub(t.ws, { projectId: p.id, channelId: `C${p.id.slice(0, 6).toUpperCase()}`, channelName: 'avisos', events: ['issue_created'] });
      expect(await saveGithubRules(p.id, { onDraft: null, onOpen: null, onReview: null, onMerge: null, syncRepo: 'acme/app' })).toBe('ok');
    }
    const subs = (u: { id: string }) => t.as(u, async () => (await listChannelSubs(t.ws, { forViewer: true })).map((s) => s.projectName).sort());
    expect(await subs(t.ana)).toEqual(['Abierto', 'Reservado']);
    expect(await subs(t.beto)).toEqual(['Abierto']);
    // El envío de avisos usa todos, mire quien mire.
    expect(await t.as(t.beto, () => listChannelSubs(t.ws))).toHaveLength(2);

    const rules = (u: { id: string }) => t.as(u, async () => (await listGithubRules(t.ws)).map((r) => r.projectId).sort());
    expect(await rules(t.ana)).toEqual([t.pub.id, t.priv.id].sort());
    expect(await rules(t.beto)).toEqual([t.pub.id]);
  });
});

describe('Tareas: pasar a Track una tarea que ya tiene issue', () => {
  it('devuelve el issue solo a quien ve su equipo', async () => {
    const t = await track('mps-task');
    const task = await createActivity(t.owner.id, { type: 'task', subject: 'Llamar al proveedor' });
    await linkTask(t.owner.id, task.id, 'track_issue', t.hidden.id, t.ana.id);
    const session = (u: { id: string }) => ({ id: t.owner.id, team: { id: t.team.id }, actingUser: { id: u.id } });
    expect(await t.as(t.ana, () => promoteTaskToTrack(t.owner.id, session(t.ana), task.id, t.pub.id))).toEqual({
      issueId: t.hidden.id,
      identifier: t.hidden.identifier,
      created: false,
    });
    expect(await t.as(t.beto, () => promoteTaskToTrack(t.owner.id, session(t.beto), task.id, t.pub.id))).toEqual({ error: 'not_found' });
    // No se creó un segundo issue ni cambió el vínculo.
    const links = (await getDb().prepare("SELECT ref_id FROM task_links WHERE task_id = ? AND kind = 'track_issue'").all(task.id)) as Array<{ ref_id: string }>;
    expect(links.map((l) => l.ref_id)).toEqual([t.hidden.id]);
  });
});

describe('Track: vistas favoritas', () => {
  it('una vista favorita deja de salir cuando la persona pierde el acceso al equipo', async () => {
    const t = await track('mps-fav');
    const view = await createIssueView(t.priv.id, t.ana.id, { name: 'Pendientes del trimestre', viewType: 'list', filters: {}, sort: 'newest' });
    await setViewShared(view.id, true);
    await addProjectAccess(t.priv.id, t.beto.id, t.ana.id);
    await setViewFavorite(view.id, t.beto.id, true);
    const favs = async () => (await listFavoriteViews(t.team.id, t.owner.id, t.beto.id)).map((v) => v.name);
    expect(await favs()).toEqual(['Pendientes del trimestre']);
    await removeProjectAccess(t.priv.id, t.beto.id);
    expect(await favs()).toEqual([]);
    // Si vuelve a tener acceso, la favorita sigue ahí.
    await addProjectAccess(t.priv.id, t.beto.id, t.ana.id);
    expect(await favs()).toEqual(['Pendientes del trimestre']);
  });
});

describe('Track: invitados', () => {
  it('un invitado no llega a plans ni iniciativas; un miembro sí', async () => {
    const t = await track('mps-guest');
    const word = `higo${crypto.randomUUID().slice(0, 6)}`;
    const created = await createPlan(t.scope, t.owner.id, { name: `${word} plan`, teamIds: [t.pub.id] });
    if (!created.ok) throw new Error('seed');
    const plan = created.plan;
    await createPlanMilestone(plan.id, t.owner.id, { name: `${word} hito` });
    const initiative = await createInitiative(t.scope, t.owner.id, { name: `${word} iniciativa`, planIds: [plan.id] });
    await setGuest(t.ws, t.beto.email, [t.pub.id], t.owner.id);

    const session = (u: { id: string }) => ({ id: t.owner.id, team: { id: t.team.id }, actingUser: { id: u.id }, role: 'member' as const });
    const see = (u: { id: string }) =>
      t.as(u, async () => ({
        plans: (await listPlans(t.scope)).map((p) => p.id),
        plan: (await getAccessiblePlan(plan.id, t.scope))?.id,
        initiatives: (await listInitiatives(t.scope)).map((i) => i.id),
        initiative: (await getAccessibleInitiative(initiative.id, t.scope))?.id,
        search: (await searchPlanning(t.scope, u.id, word)).map((i) => i.group).sort(),
        milestones: (await searchApps(session(u), word)).filter((i) => i.group === 'trackMilestones').length,
      }));
    expect(await see(t.ana)).toEqual({
      plans: [plan.id],
      plan: plan.id,
      initiatives: [initiative.id],
      initiative: initiative.id,
      search: ['trackInitiatives', 'trackPlans'],
      milestones: 1,
    });
    expect(await see(t.beto)).toEqual({ plans: [], plan: undefined, initiatives: [], initiative: undefined, search: [], milestones: 0 });
    // Sin persona (recordatorios del cron) no se filtra.
    expect((await listPlans(t.scope)).map((p) => p.id)).toEqual([plan.id]);
  });
});

// ---------- Lines ----------

const msg = (chatId: string, id: string, body: string, senderName: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: false,
  fromMe: false,
  senderPhone: chatId.split('@')[0],
  senderName,
  providerMessageId: id,
  body,
});

async function line(ws: string, label: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name: label });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

/** Dos líneas: "Pública" (todo el workspace) y "Privada" (restringida a Pablo). Ruth es miembro y solo ve la pública. */
async function lines(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const pablo = await makeUser(`${label}-pablo`);
  const ruth = await makeUser(`${label}-ruth`);
  const team = await createTeam(owner.id, 'Workspace');
  for (const u of [pablo, ruth]) await addMember(team.id, u.id, 'member');
  const pub = await line(owner.id, 'Pública');
  const priv = await line(owner.id, 'Privada');
  await ingestEvents(pub, [msg('5491100000011@c.us', 'P-1', 'hola', 'Cliente Pub')]);
  await ingestEvents(priv, [msg('5491100000012@c.us', 'S-1', 'consulta', 'Cliente Priv')]);
  await setLineAccess(owner.id, priv.id, { ownerId: pablo.id, visibility: 'restricted', personIds: [], teamIds: [] });
  const chats = (await listChats(owner.id, owner.id)).rows;
  return {
    owner,
    pablo,
    ruth,
    pubChat: chats.find((c) => c.name === 'Cliente Pub')!,
    privChat: chats.find((c) => c.name === 'Cliente Priv')!,
    vPablo: await groupsViewer(owner.id, pablo.id, 'member'),
    vRuth: await groupsViewer(owner.id, ruth.id, 'member'),
    vAdmin: await groupsViewer(owner.id, owner.id, 'owner'),
  };
}

describe('Lines: carpetas y etiquetas según los chats que ve cada persona', () => {
  it('una carpeta con chats que la persona no ve no se puede borrar; sin ellos sí', async () => {
    const w = await lines('mps-folder');
    const clientes = await createFolder(w.owner.id, w.pablo.id, { name: 'Clientes' });
    const sub = await createFolder(w.owner.id, w.pablo.id, { name: 'Activos', parentId: clientes.id });
    await moveChatsToFolder(w.owner.id, w.vPablo, [w.pubChat.id], clientes.id);
    await moveChatsToFolder(w.owner.id, w.vPablo, [w.privChat.id], sub.id);
    const filed = async () =>
      ((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_chats WHERE user_id = ? AND folder_id IS NOT NULL').get(w.owner.id)) as { n: number }).n;

    // Ruth no ve el chat de la subcarpeta: no borra ni la subcarpeta ni la que la contiene, y nada cambia.
    await expect(deleteFolder(w.owner.id, sub.id, w.vRuth)).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    await expect(deleteFolder(w.owner.id, clientes.id, w.vRuth)).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(await filed()).toBe(2);
    expect((await listFolders(w.owner.id, w.vPablo)).folders).toHaveLength(2);

    // Una carpeta vacía o con chats que ve la borra como siempre.
    const vacia = await createFolder(w.owner.id, w.ruth.id, { name: 'Vacía' });
    expect(await deleteFolder(w.owner.id, vacia.id, w.vRuth)).toBe(true);
    // Quien ve todos los chats de adentro (Pablo) o un admin la borra.
    expect(await deleteFolder(w.owner.id, sub.id, w.vPablo)).toBe(true);
    expect(await deleteFolder(w.owner.id, clientes.id, w.vAdmin)).toBe(true);
    expect(await filed()).toBe(0);
  });

  it('el conteo de cada etiqueta es de los chats que ve quien mira', async () => {
    const w = await lines('mps-count');
    const vip = await createLinesLabel(w.owner.id, { name: 'VIP' });
    await setChatLabels(w.owner.id, w.pubChat.id, [vip.id]);
    await setChatLabels(w.owner.id, w.privChat.id, [vip.id]);
    const count = async (viewer?: Parameters<typeof listLinesLabels>[1]) => (await listLinesLabels(w.owner.id, viewer)).map((l) => [l.name, l.count]);
    expect(await count(w.vRuth)).toEqual([['VIP', 1]]);
    expect(await count(w.vPablo)).toEqual([['VIP', 2]]);
    expect(await count(w.vAdmin)).toEqual([['VIP', 2]]);
    expect(await count()).toEqual([['VIP', 2]]);
  });
});

describe('Lines: resumen AI con teléfonos ocultos', () => {
  it('el modelo no recibe los teléfonos cuando quien pide los ve ocultos', async () => {
    const owner = await makeUser('mps-sum');
    const row = await line(owner.id, 'Soporte');
    // Sin nombre: el chat y quien escribe se identifican por el número.
    await ingestEvents(row, [msg('5491100000013@c.us', 'R-1', 'mi otro número es +54 9 11 0000-0014', '')]);
    const chat = (await listChats(owner.id, owner.id)).rows[0];
    const masked = viewerFrom(owner.id, 'alguien', 'member', { labelAccess: false, maskRoles: ['member'] });
    expect(masked.mask).toBe(true);

    const open = await summarizeChat(owner.id, chat.id);
    expect(open.summary).toContain('5491100000013');
    const hidden = await summarizeChat(owner.id, chat.id, { maskPhones: masked.mask });
    expect(hidden.summary).not.toContain('5491100000013');
    expect(hidden.summary.replace(/\D/g, '')).not.toContain('91100000014');
    expect(hidden.summary).toContain('mi otro número es');
  });
});
