import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getClient, getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { setAiModelOverride } from '@/lib/ai';
import { createAgent, createConversation, getAgentRow, listConversations } from '@/lib/agents';
import type { AgentRow } from '@/lib/db';
import { getAgentAnalytics } from '@/lib/agents-analytics';
import { listSuggestions } from '@/lib/agents-knowledge';
import { listReplayCandidates } from '@/lib/agents-sim';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, deleteChat, getNumberRowById, ingestEvents, updateChat } from '@/lib/groups';
import { replyWithAgent } from '@/lib/groups-agent';
import { agentLinesCounts, canSeeLinesAgentConversation, groupsViewer, linkAgentConversation, systemViewer } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { createGroupTask, getGroupTask } from '@/lib/groups-tasks';
import { connectHubspot } from '@/lib/groups-hubspot';
import { resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { linkContactHubspot, listLinesContacts, unlinkContactHubspot } from '@/lib/groups-contacts';
import { getActivity, listTimeline } from '@/lib/crm';
import { taskLinksFor, taskLinksForKey } from '@/lib/tasks';
import linkMigration from '@/lib/schema/migration-files/20261119_1340_lines_agent_conversations';
import notesMigration, { isCopiedTaskNote } from '@/lib/schema/migration-files/20261119_1341_lines_task_notes';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { scriptedModel } from './ai-mock';

/**
 * Lines: lo que sale de un chat por otras apps sigue el acceso a ese chat.
 * Dos personas del mismo workspace: `friend` tiene la línea A; `member`, ninguna.
 * La línea B es solo de admins. Nombres, teléfonos y textos inventados.
 */

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const channelsRoute = await import('@/lib/routes/agents/[id]/channels/route');

const TOKEN = 'pat-na1-fake-token-for-visibility-tests';
// El teléfono coincide con un contacto del HubSpot falso.
const PERSON = '5491155550142';
const TEXT_A = 'consulta reservada alfa sobre el envio';
const TEXT_B = 'consulta reservada beta sobre el cobro';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});
afterEach(() => {
  session.user = null;
  setAiModelOverride(null);
  vi.unstubAllEnvs();
});

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

const inbound = (id: string, body: string, senderName: string) => ({
  type: 'message' as const,
  chatId: `${PERSON}@c.us`,
  isGroup: false,
  fromMe: false,
  senderPhone: PERSON,
  senderName,
  providerMessageId: id,
  body,
});

/** La misma persona escribe a las dos líneas: un chat 1:1 en cada una. */
async function world(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const a = await line(ws, 'Linea A');
  const b = await line(ws, 'Linea B');
  await ingestEvents(a, [inbound(`${label}-a1`, TEXT_A, 'Cliente Alfa')]);
  await ingestEvents(b, [inbound(`${label}-b1`, TEXT_B, 'Cliente Alfa')]);
  await setLineAccess(ws, a.id, { ownerId: ws, visibility: 'restricted', personIds: [w.friend.id], teamIds: [] });
  await setLineAccess(ws, b.id, { ownerId: ws, visibility: 'restricted', personIds: [], teamIds: [] });
  const chatOf = async (numberId: string) => (await getDb().prepare('SELECT id FROM groups_chats WHERE user_id = ? AND number_id = ?').get(ws, numberId)) as { id: string };
  const chatA = await chatOf(a.id);
  const chatB = await chatOf(b.id);
  const messageOf = async (chatId: string) => ((await getDb().prepare('SELECT id FROM groups_messages WHERE chat_id = ? LIMIT 1').get(chatId)) as { id: string }).id;
  const created = await createAgent(ws, ws, { name: `${label} agent` });
  const agent = (await getAgentRow(ws, created.id)) as AgentRow;
  return {
    ...w,
    ws,
    a,
    b,
    chatA,
    chatB,
    msgA: await messageOf(chatA.id),
    msgB: await messageOf(chatB.id),
    agent,
    friendView: await groupsViewer(ws, w.friend.id, 'member'),
    memberView: await groupsViewer(ws, w.member.id, 'member'),
    ownerView: await groupsViewer(ws, ws, 'owner'),
  };
}

/** Una conversación del agente nacida de un chat de Lines, con una corrida sin respuesta. */
async function linesConversation(w: Awaited<ReturnType<typeof world>>, chatId: string, question: string) {
  const conv = await createConversation(w.agent, 'api', { title: question });
  const now = new Date().toISOString();
  const db = getDb();
  await db.prepare("INSERT INTO agent_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)").run(crypto.randomUUID(), conv.id, question, now);
  const runId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO agent_runs (id, agent_id, user_id, conversation_id, channel, status, steps, question, unanswered, handoff_reason, created_at) VALUES (?, ?, ?, ?, 'api', 'handoff', 1, ?, 1, ?, ?)",
    )
    .run(runId, w.agent.id, w.ws, conv.id, question, `motivo ${question}`, now);
  await linkAgentConversation(w.ws, chatId, conv.id);
  await db.prepare('UPDATE groups_chats SET agent_id = ?, agent_conversation_id = ? WHERE id = ?').run(w.agent.id, conv.id, chatId);
  return { id: conv.id, runId };
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

describe('Agents: lo que viene de un chat de Lines', () => {
  it('sugerencias, analítica y conversaciones para repetir: solo de los chats que la persona ve', async () => {
    const w = await world('vp-agents');
    const fromA = await linesConversation(w, w.chatA.id, TEXT_A);
    await linesConversation(w, w.chatB.id, TEXT_B);

    // Quien tiene la línea A: lo de A, nada de B.
    const friendSuggestions = await listSuggestions(w.ws, w.agent.id, 30, new Date(), w.friend.id);
    expect(friendSuggestions.map((s) => s.question)).toEqual([TEXT_A]);
    expect(friendSuggestions[0].runIds).toEqual([fromA.runId]);
    const friendStats = await getAgentAnalytics(w.ws, w.agent.id, 30, new Date(), w.friend.id);
    expect([friendStats.conversations, friendStats.runs, friendStats.handedOff]).toEqual([1, 1, 0]);
    expect(JSON.stringify(friendStats)).not.toContain('beta');
    expect(friendStats.handoffReasons.map((r) => r.reason)).toEqual([`motivo ${TEXT_A}`]);
    expect((await listReplayCandidates(w.ws, w.agent.id, 10, w.friend.id)).map((c) => c.title)).toEqual([TEXT_A]);

    // Quien no tiene ninguna línea: nada, ni textos ni cuentas.
    expect(await listSuggestions(w.ws, w.agent.id, 30, new Date(), w.member.id)).toEqual([]);
    const memberStats = await getAgentAnalytics(w.ws, w.agent.id, 30, new Date(), w.member.id);
    expect([memberStats.conversations, memberStats.runs, memberStats.channels.length, memberStats.handoffReasons.length]).toEqual([0, 0, 0, 0]);
    expect(JSON.stringify(memberStats)).not.toMatch(/alfa|beta/);
    expect(await listReplayCandidates(w.ws, w.agent.id, 10, w.member.id)).toEqual([]);

    // Dueño y admins (sin viewer): todo.
    expect((await listSuggestions(w.ws, w.agent.id)).map((s) => s.question).sort()).toEqual([TEXT_A, TEXT_B].sort());
    expect((await getAgentAnalytics(w.ws, w.agent.id)).conversations).toBe(2);
    expect(await listReplayCandidates(w.ws, w.agent.id)).toHaveLength(2);

    // Una conversación que no viene de Lines (la API) la ven los dos como antes.
    const plain = await createConversation(w.agent, 'api', { title: 'pregunta general', createdBy: w.ws });
    await getDb().prepare("INSERT INTO agent_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', 'pregunta general', ?)").run(crypto.randomUUID(), plain.id, new Date().toISOString());
    expect((await getAgentAnalytics(w.ws, w.agent.id, 30, new Date(), w.member.id)).conversations).toBe(1);
    expect((await getAgentAnalytics(w.ws, w.agent.id, 30, new Date(), w.friend.id)).conversations).toBe(2);
    expect((await listReplayCandidates(w.ws, w.agent.id, 10, w.member.id)).map((c) => c.title)).toEqual(['pregunta general']);
  });

  it('canales del agente: las cuentas de líneas y chats son las de quien mira', async () => {
    const w = await world('vp-channels');
    await linesConversation(w, w.chatA.id, TEXT_A);
    await linesConversation(w, w.chatB.id, TEXT_B);
    expect(await agentLinesCounts(w.memberView, w.agent.id)).toEqual({ numbers: 0, assignedChats: 0 });
    expect(await agentLinesCounts(w.friendView, w.agent.id)).toEqual({ numbers: 1, assignedChats: 1 });
    expect(await agentLinesCounts(w.ownerView, w.agent.id)).toEqual({ numbers: 2, assignedChats: 2 });

    const whatsapp = async (user: SessionUser | null) => {
      session.user = user;
      const res = await channelsRoute.GET(new NextRequest(`http://x/api/agents/${w.agent.id}/channels`), ctx({ id: w.agent.id }));
      return res.status === 200 ? ((await res.json()) as { channels: { whatsapp: { numbers: number; assignedChats: number } } }).channels.whatsapp : null;
    };
    expect(await whatsapp(asMember(w.owner, w.member))).toMatchObject({ numbers: 0, assignedChats: 0 });
    expect(await whatsapp(asMember(w.owner, w.friend))).toMatchObject({ numbers: 1, assignedChats: 1 });
    expect(await whatsapp(asOwner(w.owner))).toMatchObject({ numbers: 2, assignedChats: 2 });
    expect(await whatsapp(null)).toBeNull();
  });

  it('al cambiar o sacar el agente del chat, la conversación anterior sigue el acceso de ese chat', async () => {
    const w = await world('vp-reset');
    // El agente contesta en el chat de la línea A: la conversación nace de ese chat.
    setAiModelOverride(scriptedModel([{ text: 'respuesta del agente' }]));
    await getDb().prepare('UPDATE groups_chats SET agent_id = ? WHERE id = ?').run(w.agent.id, w.chatA.id);
    expect(await replyWithAgent(w.ws, w.chatA.id, w.msgA)).toBe('replied');
    const convId = ((await getDb().prepare('SELECT agent_conversation_id AS id FROM groups_chats WHERE id = ?').get(w.chatA.id)) as { id: string }).id;
    expect(convId).toBeTruthy();

    const sees = async (person: { id: string }) => ({
      open: await canSeeLinesAgentConversation(w.ws, person.id, 'member', convId),
      listed: (await listConversations(w.ws, w.agent.id, { viewer: { personId: person.id, isAdmin: false, role: 'member' } })).some((c) => c.id === convId),
    });
    expect(await sees(w.friend)).toEqual({ open: true, listed: true });
    expect(await sees(w.member)).toEqual({ open: false, listed: false });

    // Se le saca el agente al chat: el chat ya no apunta a la conversación, que guarda los mensajes.
    await updateChat(w.ws, w.chatA.id, { agentId: null });
    expect(((await getDb().prepare('SELECT agent_conversation_id AS id FROM groups_chats WHERE id = ?').get(w.chatA.id)) as { id: string | null }).id).toBeNull();
    expect(await sees(w.friend)).toEqual({ open: true, listed: true });
    expect(await sees(w.member)).toEqual({ open: false, listed: false });
    expect(await listSuggestions(w.ws, w.agent.id, 30, new Date(), w.member.id)).toEqual([]);
    expect((await getAgentAnalytics(w.ws, w.agent.id, 30, new Date(), w.member.id)).conversations).toBe(0);
    expect((await getAgentAnalytics(w.ws, w.agent.id, 30, new Date(), w.friend.id)).conversations).toBe(1);

    // Le sacan la línea a quien la tenía: deja de verla también.
    await setLineAccess(w.ws, w.a.id, { ownerId: w.ws, visibility: 'restricted', personIds: [], teamIds: [] });
    expect(await sees(w.friend)).toEqual({ open: false, listed: false });
    await setLineAccess(w.ws, w.a.id, { ownerId: w.ws, visibility: 'restricted', personIds: [w.friend.id], teamIds: [] });

    // Se borra el chat: la conversación queda solo para dueño y admins.
    await deleteChat(w.ws, w.chatA.id);
    expect(await sees(w.friend)).toEqual({ open: false, listed: false });
    expect(await canSeeLinesAgentConversation(w.ws, w.ws, 'owner', convId)).toBe(true);
    expect((await listConversations(w.ws, w.agent.id)).some((c) => c.id === convId)).toBe(true);
  });

  it('las conversaciones que ya habían quedado sueltas se anotan sin chat: solo dueño y admins', async () => {
    const w = await world('vp-orphan');
    // Como las dejaba Lines antes: canal api, sin autor ni origen, y ningún chat que apunte a ella.
    const orphan = await createConversation(w.agent, 'api', { title: TEXT_B });
    const byPerson = await createConversation(w.agent, 'api', { title: 'pregunta por la api', createdBy: w.friend.id });
    await linkMigration.up(getClient());
    await linkMigration.up(getClient());
    for (const p of [w.friend, w.member]) {
      expect(await canSeeLinesAgentConversation(w.ws, p.id, 'member', orphan.id)).toBe(false);
      expect(await canSeeLinesAgentConversation(w.ws, p.id, 'member', byPerson.id)).toBe(true);
    }
    expect(await canSeeLinesAgentConversation(w.ws, w.ws, 'owner', orphan.id)).toBe(true);
  });
});

describe('Lines: tareas desde un mensaje', () => {
  it('la tarea del CRM no lleva el nombre del chat ni el texto del mensaje; el origen se muestra solo a quien ve el chat', async () => {
    const w = await world('vp-task');
    const task = await createGroupTask(w.ws, w.friend.id, { chatId: w.chatA.id, messageId: w.msgA, locale: 'es' }, new Date(), w.friendView);
    const noted = await createGroupTask(w.ws, w.friend.id, { chatId: w.chatA.id, messageId: w.msgA, title: 'Llamar', notes: 'nota escrita a mano' }, new Date(), w.friendView);

    // Lo guardado en el CRM (lo que leen su timeline, la API, el MCP, la búsqueda y el asistente).
    const stored = JSON.stringify([await getActivity(w.ws, task.id), await getActivity(w.ws, noted.id), await listTimeline(w.ws, { type: 'task', limit: 50 })]);
    expect(stored).not.toContain(TEXT_A);
    expect(stored).not.toContain('Cliente Alfa');
    expect(stored).not.toContain(PERSON);
    expect(await getActivity(w.ws, task.id)).toMatchObject({ subject: 'Tarea de un mensaje', body: '' });
    expect(await getActivity(w.ws, noted.id)).toMatchObject({ subject: 'Llamar', body: 'nota escrita a mano' });

    // En Lines, quien ve el chat ve de qué mensaje salió; quien no, no llega a la tarea.
    expect(await getGroupTask(w.ws, task.id, undefined, w.friendView)).toMatchObject({ title: TEXT_A, messageBody: TEXT_A, chatName: 'Cliente Alfa', notes: '' });
    expect(await getGroupTask(w.ws, task.id, undefined, w.memberView)).toBeNull();

    // El origen en el CRM: con nombre y texto para quien ve el chat; vacío para quien no.
    const friendLinks = (await taskLinksFor(asMember(w.owner, w.friend), [task.id])).get(task.id) ?? [];
    expect(friendLinks.find((l) => l.kind === 'lines_message')).toMatchObject({ label: 'Cliente Alfa', detail: TEXT_A });
    const memberLinks = (await taskLinksFor(asMember(w.owner, w.member), [task.id])).get(task.id) ?? [];
    expect(memberLinks.map((l) => [l.label, l.detail, l.href])).toEqual(memberLinks.map(() => ['', '', '']));
    expect(JSON.stringify(memberLinks)).not.toMatch(/alfa|Alfa/);

    // La API pública: los vínculos de un chat que la persona de la key no ve no salen (ni su id).
    const key = (person: { id: string }, role: 'member' | 'owner' = 'member') => ({ user: { id: w.ws }, personId: person.id, role });
    expect(((await taskLinksForKey(key(w.friend), [task.id])).get(task.id) ?? []).map((l) => l.kind).sort()).toEqual(['lines_chat', 'lines_message']);
    const forMember = (await taskLinksForKey(key(w.member), [task.id])).get(task.id) ?? [];
    expect(forMember).toEqual([]);
    expect(JSON.stringify(forMember)).not.toContain(w.chatA.id);
    expect((await taskLinksForKey(key(w.owner, 'owner'), [task.id])).get(task.id)).toHaveLength(2);
  });

  it('las notas que eran la copia automática se vacían; las escritas a mano quedan', async () => {
    const chat = { chat_name: 'Cliente Alfa', chat_phone: PERSON, chat_pid: `${PERSON}@c.us` };
    expect(isCopiedTaskNote({ ...chat, body: `Cliente Alfa: ${TEXT_A}`, message_body: TEXT_A })).toBe(true);
    expect(isCopiedTaskNote({ ...chat, body: 'Cliente Alfa', message_body: null })).toBe(true);
    expect(isCopiedTaskNote({ ...chat, body: `+${PERSON}`, message_body: null })).toBe(true);
    // El chat cambió de nombre después: igual se reconoce por el mensaje.
    expect(isCopiedTaskNote({ ...chat, body: `Nombre viejo: ${TEXT_A}`, message_body: TEXT_A })).toBe(true);
    // Un mensaje largo se copiaba hasta 1000 caracteres; uno con menciones, con el nombre en lugar del número.
    const long = 'x'.repeat(1500);
    expect(isCopiedTaskNote({ ...chat, body: `Cliente Alfa: ${long.slice(0, 1000)}`, message_body: long })).toBe(true);
    expect(isCopiedTaskNote({ ...chat, body: 'Cliente Alfa: gracias por avisar @Persona Mencionada', message_body: 'gracias por avisar @5491100000000' })).toBe(true);
    expect(isCopiedTaskNote({ ...chat, body: 'nota escrita a mano', message_body: TEXT_A })).toBe(false);
    expect(isCopiedTaskNote({ ...chat, body: 'Recordar: llamar el lunes', message_body: TEXT_A })).toBe(false);
    expect(isCopiedTaskNote({ ...chat, body: '', message_body: TEXT_A })).toBe(false);

    const w = await world('vp-task-mig');
    const old = await createGroupTask(w.ws, w.friend.id, { chatId: w.chatA.id, messageId: w.msgA, title: 'Vieja' });
    const bare = await createGroupTask(w.ws, w.friend.id, { chatId: w.chatA.id, title: 'Sin mensaje' });
    const manual = await createGroupTask(w.ws, w.friend.id, { chatId: w.chatA.id, messageId: w.msgA, title: 'Con nota', notes: 'nota escrita a mano' });
    // Como quedaban antes.
    await getDb().prepare('UPDATE crm_activities SET body = ? WHERE id = ?').run(`Cliente Alfa: ${TEXT_A}`, old.id);
    await getDb().prepare('UPDATE crm_activities SET body = ? WHERE id = ?').run('Cliente Alfa', bare.id);
    await notesMigration.up(getClient());
    await notesMigration.up(getClient());
    expect((await getActivity(w.ws, old.id))?.body).toBe('');
    expect((await getActivity(w.ws, bare.id))?.body).toBe('');
    expect((await getActivity(w.ws, manual.id))?.body).toBe('nota escrita a mano');
  });
});

describe('Lines: vincular una persona con HubSpot', () => {
  it('escribe solo en los chats que ve quien vincula; dueño y admins, en todos', async () => {
    const w = await world('vp-hubspot');
    await connectHubspot(w.ws, w.ws, TOKEN);
    const linkedChats = async () =>
      ((await getDb().prepare("SELECT chat_id FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'contact' ORDER BY chat_id").all(w.ws)) as Array<{ chat_id: string }>).map((r) => r.chat_id);
    const dismissed = async (chatId: string) => ((await getDb().prepare('SELECT COALESCE(MAX(dismissed), 0) AS n FROM groups_hubspot_matches WHERE chat_id = ?').get(chatId)) as { n: number }).n;
    const personOf = async (viewer: typeof w.friendView) => (await listLinesContacts(viewer)).rows.find((r) => r.phone === PERSON)!;
    expect(await linkedChats()).toEqual([]);

    // Quien tiene solo la línea A vincula a la persona: el chat de la línea B queda como estaba.
    const person = await personOf(w.friendView);
    const row = await linkContactHubspot(w.friendView, w.friend.id, person.id, '7001');
    expect(row.hubspot?.contact?.id).toBe('7001');
    expect(await linkedChats()).toEqual([w.chatA.id]);

    // Un admin (o lo automático) vincula: los dos chats.
    await linkContactHubspot(systemViewer(w.ws), w.ws, (await personOf(w.ownerView)).id, '7001');
    expect(await linkedChats()).toEqual([w.chatA.id, w.chatB.id].sort());

    // Quien tiene solo la línea A quita el vínculo: del chat de la línea B no se toca nada.
    await unlinkContactHubspot(w.friendView, person.id);
    expect(await linkedChats()).toEqual([w.chatB.id]);
    expect([await dismissed(w.chatA.id), await dismissed(w.chatB.id)]).toEqual([1, 0]);

    // El dueño lo quita: de todos.
    await linkContactHubspot(w.ownerView, w.ws, (await personOf(w.ownerView)).id, '7001');
    await unlinkContactHubspot(w.ownerView, (await personOf(w.ownerView)).id);
    expect(await linkedChats()).toEqual([]);
  });
});
