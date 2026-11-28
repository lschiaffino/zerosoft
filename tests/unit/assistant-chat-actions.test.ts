/**
 * El asistente actúa sobre Lines e Inbox con tarjeta de aprobación (lib/assistant/tools-chat-actions.ts y
 * propose_inbox_actions): nada cambia ni sale antes de Confirmar, Cancelar no hace nada, cada fila dice qué, dónde
 * y el texto, y el asistente solo ve y toca lo que la persona puede (al proponer y otra vez al confirmar). Un
 * programado se confirma con el botón rojo y, si su hora ya pasó, no se programa. Modelo y WhatsApp falsos;
 * nombres, teléfonos y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { addMessage as addInboxMessage, createAccount, getThreadRow, upsertThread } from '@/lib/inbox/core';
import { setAssistantModelOverride } from '@/lib/assistant/config';
import { runAssistantTurn, type AssistantEvent } from '@/lib/assistant/engine';
import { fakeAssistantStep } from '@/lib/assistant/fake';
import { fakeModel } from '@/lib/crm-ai-fake';
import { decideAction } from '@/lib/assistant/actions';
import { addMessage, createConversation } from '@/lib/assistant/store';
import { toolsFor } from '@/lib/assistant/tools';
import { chatActionTools } from '@/lib/assistant/tools-chat-actions';
import { toolCtx, type WriteTool } from '@/lib/assistant/registry';
import { updatePlatformSettings } from '@/lib/groups-access';
import type { InboundEvent } from '@/lib/groups-provider';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  setAssistantModelOverride(fakeModel(fakeAssistantStep));
});
afterEach(() => {
  setAssistantModelOverride(null);
  vi.unstubAllEnvs();
});

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function turn(user: SessionUser, message: string) {
  const who = { workspaceId: user.id, personId: user.actingUser?.id ?? user.id };
  const conversationId = (await createConversation(who, 'acciones')).id;
  await addMessage(conversationId, 'user', message);
  const events: AssistantEvent[] = [];
  for await (const e of runAssistantTurn({ user, conversationId, message, page: null, locale: 'en' })) events.push(e);
  const actions = events.filter((e): e is Extract<AssistantEvent, { type: 'action' }> => e.type === 'action').map((e) => e.action);
  const results = events.filter((e): e is Extract<AssistantEvent, { type: 'tool-result' }> => e.type === 'tool-result');
  return { actions, results, text: events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('') };
}

const decide = (user: SessionUser, id: string, decision: 'confirm' | 'cancel') => decideAction({ user, locale: 'en', id, decision });

/** La lista de una búsqueda viene marcada como datos de terceros (<untrusted_data>). */
function unwrapChats(output: unknown): Array<{ id: string; name: string; line?: string; phone?: string }> {
  const v = (output as { chats?: unknown }).chats;
  expect(typeof v).toBe('string');
  const str = v as string;
  return JSON.parse(str.slice(str.indexOf('\n') + 1, str.lastIndexOf('\n</untrusted_data')));
}

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  // Como después de que la pantalla lee el estado: la línea queda conectada.
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return (await getNumberRowById(n.id))!;
}

function ev(chatId: string, name: string, body: string): InboundEvent {
  return { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.split('@')[0], senderName: name, providerMessageId: `m-${uniq()}`, body } as InboundEvent;
}

async function linesWorld(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const pub = await line(ws, 'Ventas demo');
  const priv = await line(ws, 'Privada demo');
  const a = phone();
  const b = phone();
  await ingestEvents(pub, [ev(`${a}@c.us`, `Clara ${label}`, '¿Me mandan el presupuesto?')]);
  await ingestEvents(priv, [ev(`${b}@c.us`, `Oculto ${label}`, 'Algo privado')]);
  await setLineAccess(ws, priv.id, { visibility: 'restricted' });
  const id = async (p: string) => ((await getDb().prepare('SELECT id FROM groups_chats WHERE user_id = ? AND phone = ?').get(ws, p)) as { id: string }).id;
  return { w, ws, pub, priv, clara: { id: await id(a), name: `Clara ${label}` }, hidden: { id: await id(b), name: `Oculto ${label}` } };
}

const notes = async (chatId: string) => (await getDb().prepare("SELECT body, author_id FROM groups_messages WHERE chat_id = ? AND direction = 'note'").all(chatId)) as Array<{ body: string; author_id: string }>;
const outgoing = async (chatId: string) => ((await getDb().prepare("SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ? AND direction = 'out'").get(chatId)) as { n: number }).n;

describe('Lines: acciones con tarjeta', () => {
  it('una nota: la tarjeta dice qué, dónde y el texto; Cancelar no hace nada; Confirmar la escribe (sin mandar nada)', async () => {
    const { w, clara } = await linesWorld('act-note');
    const member = asMember(w.owner, w.member);
    const r = await turn(member, `lines note ${clara.name}: Llamar el lunes`);
    expect(r.actions).toHaveLength(1);
    const card = r.actions[0];
    expect(card.tool).toBe('propose_lines_actions');
    expect(card.destructive).toBe(false);
    expect(card.details[0].label).toContain(clara.name);
    expect(card.details[0].label).toMatch(/Internal note/);
    expect(card.details[0].after).toBe('Llamar el lunes');
    // Antes de confirmar no hay nada.
    expect(await notes(clara.id)).toEqual([]);
    const cancelled = await decide(member, card.id, 'cancel');
    expect(cancelled.action?.status).toBe('cancelled');
    expect(await notes(clara.id)).toEqual([]);
    // Otra tarjeta, confirmada.
    const again = await turn(member, `lines note ${clara.name}: Llamar el lunes`);
    const done = await decide(member, again.actions[0].id, 'confirm');
    expect(done.action?.status).toBe('done');
    expect(await notes(clara.id)).toEqual([{ body: 'Llamar el lunes', author_id: w.member.id }]);
    expect(await outgoing(clara.id)).toBe(0);
  });

  it('un chat de una línea que la persona no ve: ni tarjeta ni nada; otro workspace tampoco', async () => {
    const { w, hidden, clara } = await linesWorld('act-hidden');
    const member = asMember(w.owner, w.member);
    for (const ref of [hidden.name, hidden.id]) {
      const r = await turn(member, `lines note ${ref}: hola`);
      expect(r.actions).toEqual([]);
      expect(JSON.stringify(r.results)).not.toContain('Algo privado');
    }
    const stranger = await turn(asOwner(w.stranger), `lines note ${clara.id}: hola`);
    expect(stranger.actions).toEqual([]);
    expect(await notes(clara.id)).toEqual([]);
    expect(await notes(hidden.id)).toEqual([]);
  });

  it('si le sacan el acceso entre la tarjeta y el clic, no se hace', async () => {
    const { w, ws, pub, clara } = await linesWorld('act-revoked');
    const member = asMember(w.owner, w.member);
    const r = await turn(member, `lines note ${clara.name}: tarde`);
    await setLineAccess(ws, pub.id, { visibility: 'restricted' });
    const res = await decide(member, r.actions[0].id, 'confirm');
    expect(res.action?.status).toBe('failed');
    expect(await notes(clara.id)).toEqual([]);
  });

  it('programar: botón rojo sin tipear, queda programado para mañana y no sale nada; con la hora vencida no se programa', async () => {
    const { w, ws, clara } = await linesWorld('act-schedule');
    const member = asMember(w.owner, w.member);
    const r = await turn(member, `lines schedule ${clara.name}: Te escribo mañana`);
    const card = r.actions[0];
    expect(card.destructive).toBe(true);
    expect(card.confirmText).toBeNull();
    expect(card.details[0].label).toMatch(/WhatsApp message to .* at .* UTC, from Ventas demo/);
    expect(card.details.at(-1)!.after).toMatch(/sent on WhatsApp at their time/);
    const done = await decide(member, card.id, 'confirm');
    expect(done.action?.status).toBe('done');
    const rows = (await getDb().prepare("SELECT kind, status, scheduled_at, body FROM groups_broadcasts WHERE user_id = ? AND body = 'Te escribo mañana'").all(ws)) as Array<{ kind: string; status: string; scheduled_at: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'scheduled', status: 'scheduled' });
    expect(Date.parse(rows[0].scheduled_at)).toBeGreaterThan(Date.now() + 60_000);
    expect(await outgoing(clara.id)).toBe(0);

    // La hora pasó mientras la tarjeta esperaba: no se programa (nunca sale en el acto).
    const late = await turn(member, `lines schedule ${clara.name}: Esto no sale`);
    const row = (await getDb().prepare('SELECT input FROM assistant_actions WHERE id = ?').get(late.actions[0].id)) as { input: string };
    const input = JSON.parse(row.input) as { planned: Array<{ at: string }> };
    input.planned[0].at = new Date(Date.now() - 60_000).toISOString();
    await getDb().prepare('UPDATE assistant_actions SET input = ? WHERE id = ?').run(JSON.stringify(input), late.actions[0].id);
    const res = await decide(member, late.actions[0].id, 'confirm');
    expect(res.action?.status).toBe('failed');
    expect(await getDb().prepare("SELECT 1 FROM groups_broadcasts WHERE body = 'Esto no sale'").get()).toBeUndefined();
  });

  it('asignar, tarea y borrador', async () => {
    const { w, ws, clara } = await linesWorld('act-more');
    const member = asMember(w.owner, w.member);
    const friendName = (await getDb().prepare('SELECT name FROM users WHERE id = ?').get(w.friend.id)) as { name: string };
    const assign = await turn(member, `lines assign ${clara.name} to ${w.friend.email}`);
    expect(assign.actions[0].details[0].before).toBe('Nobody');
    expect(assign.actions[0].details[0].after).toBe(friendName.name);
    await decide(member, assign.actions[0].id, 'confirm');
    expect(((await getDb().prepare('SELECT assigned_to FROM groups_chats WHERE id = ?').get(clara.id)) as { assigned_to: string }).assigned_to).toBe(w.friend.id);
    // A alguien que no existe: sin tarjeta.
    expect((await turn(member, `lines assign ${clara.name} to nadie-que-exista@x.test`)).actions).toEqual([]);

    const task = await turn(member, `lines task ${clara.name}: Mandar el presupuesto`);
    await decide(member, task.actions[0].id, 'confirm');
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_tasks WHERE chat_id = ? AND user_id = ?').get(clara.id, ws)) as { n: number }).n).toBe(1);

    const draft = await turn(member, `lines draft ${clara.name}: Hola Clara, sale hoy`);
    expect(draft.actions[0].details[0].label).toMatch(/not sent/);
    const res = await decide(member, draft.actions[0].id, 'confirm');
    // El borrador vuelve para el campo del chat; no se guarda como mensaje ni sale.
    expect(res.action?.result?.drafts).toEqual([{ app: 'lines', chatId: clara.id, text: 'Hola Clara, sale hoy' }]);
    expect(await outgoing(clara.id)).toBe(0);
  });

  it('buscar chats: solo los que ve, sin texto de mensajes; sin la app Lines o como invitado no hay herramientas', async () => {
    const { w, clara, hidden } = await linesWorld('act-find');
    const member = asMember(w.owner, w.member);
    const r = await turn(member, 'find lines chat act-find');
    const found = { chats: unwrapChats(r.results.find((x) => x.tool === 'lines_find_chats')!.output) };
    expect(found.chats.map((c) => c.id)).toContain(clara.id);
    expect(found.chats.map((c) => c.id)).not.toContain(hidden.id);
    expect(JSON.stringify(found)).not.toContain('presupuesto');
    const names = (u: Pick<SessionUser, 'role' | 'apps'>) => toolsFor(u).map((t) => t.name);
    expect(names({ role: 'member', apps: ['inbox'] })).not.toContain('propose_lines_actions');
    expect(names({ role: 'member', apps: ['inbox'] })).toContain('inbox_find_chats');
    expect(names({ role: 'guest', apps: '*' })).toEqual([]);
    expect(names({ role: 'member', apps: '*' })).toEqual(expect.arrayContaining(['lines_find_chats', 'inbox_find_chats', 'propose_lines_actions', 'propose_inbox_actions']));
  });
});

const linesTool = chatActionTools.find((t) => t.name === 'propose_lines_actions') as WriteTool;
const prepare = (user: SessionUser, actions: unknown[], timeZone?: string) =>
  linesTool.prepare({ ...toolCtx(user, 'en'), ...(timeZone ? { timeZone } : {}) }, { actions }) as Promise<Record<string, unknown>>;

describe('Lines: lo que la tarjeta no deja pasar', () => {
  it('buscar no mira el texto de los mensajes, y un nombre repetido no se adivina', async () => {
    const { w, ws, pub, clara } = await linesWorld('act-strict');
    const member = asMember(w.owner, w.member);
    // "presupuesto" está solo en un mensaje: buscar no lo encuentra.
    const r = await turn(member, 'find lines chat presupuesto');
    expect(unwrapChats(r.results.find((x) => x.tool === 'lines_find_chats')!.output)).toEqual([]);
    // Otro chat con el mismo nombre en la misma línea: la nota no elige uno, devuelve los candidatos.
    await ingestEvents(pub, [ev(`${phone()}@c.us`, clara.name, 'Otro chat con el mismo nombre')]);
    const same = await prepare(member, [{ chat: clara.name, do: 'note', text: 'hola' }]);
    expect(same.error).toBe('nothing_to_do');
    expect(JSON.stringify(same.hint)).toMatch(/ambiguous/);
    // Con el id, sí.
    expect((await prepare(member, [{ chat: clara.id, do: 'note', text: 'hola' }])).summary).toBeTruthy();
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM groups_chats WHERE user_id = ? AND name = ?').get(ws, clara.name)) as { n: number }).n).toBe(2);
  });

  it('con los teléfonos ocultos, ni la búsqueda ni la tarjeta los muestran, y no se busca por número', async () => {
    const { w, ws, clara } = await linesWorld('act-mask');
    await updatePlatformSettings(ws, { labelAccess: false, maskRoles: ['member'] });
    const member = asMember(w.owner, w.member);
    const phoneOf = ((await getDb().prepare('SELECT phone FROM groups_chats WHERE id = ?').get(clara.id)) as { phone: string }).phone;
    const found = await turn(member, 'find lines chat act-mask');
    const rows = unwrapChats(found.results.find((x) => x.tool === 'lines_find_chats')!.output);
    expect(rows.map((x) => x.id)).toContain(clara.id);
    expect(JSON.stringify(rows)).not.toContain(phoneOf.slice(-6));
    const byNumber = await turn(member, `find lines chat ${phoneOf.slice(-6)}`);
    expect(unwrapChats(byNumber.results.find((x) => x.tool === 'lines_find_chats')!.output)).toEqual([]);
    const card = await prepare(member, [{ chat: clara.id, do: 'note', text: 'hola' }]);
    expect(JSON.stringify(card.details)).not.toContain(phoneOf.slice(-6));
    // El dueño ve el número en la tarjeta (dónde está el chat).
    const ownerCard = await prepare(asOwner(w.owner), [{ chat: clara.id, do: 'note', text: 'hola' }]);
    expect(JSON.stringify(ownerCard.details)).toContain(phoneOf.slice(-6));
  });

  it('la hora de un programado: vencida, en menos de un minuto, a más de un año o inválida no arma tarjeta; con zona horaria se muestra local', async () => {
    const { w, clara } = await linesWorld('act-at');
    const member = asMember(w.owner, w.member);
    for (const at of [new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 20_000).toISOString(), new Date(Date.now() + 400 * 86_400_000).toISOString(), 'mañana', undefined]) {
      expect((await prepare(member, [{ chat: clara.id, do: 'schedule', text: 'hola', ...(at ? { at } : {}) }])).error).toBe('nothing_to_do');
    }
    const d = new Date(Date.now() + 30 * 86_400_000);
    d.setUTCHours(12, 0, 0, 0);
    const at = d.toISOString();
    const card = (await prepare(member, [{ chat: clara.id, do: 'schedule', text: 'hola', at }], 'America/Argentina/Buenos_Aires')) as { details: Array<{ label: string }> };
    expect(card.details[0].label).toContain('09:00');
    expect(card.details[0].label).toContain(`${at.slice(0, 10)} 12:00 UTC`);
  });

  it('un programado confirmado no sale cuando corre el envío: queda para su hora', async () => {
    const { w, ws, clara } = await linesWorld('act-process');
    const member = asMember(w.owner, w.member);
    const r = await turn(member, `lines schedule ${clara.name}: Para mañana`);
    await decide(member, r.actions[0].id, 'confirm');
    const { processBroadcasts } = await import('@/lib/groups-broadcasts');
    await processBroadcasts({ budgetMs: 5_000 });
    const row = (await getDb().prepare("SELECT status FROM groups_broadcasts WHERE user_id = ? AND body = 'Para mañana'").get(ws)) as { status: string };
    expect(row.status).toBe('scheduled');
    expect(await outgoing(clara.id)).toBe(0);
  });

  it('sin acceso al confirmar, un programado tampoco se programa', async () => {
    const { w, ws, pub, clara } = await linesWorld('act-sched-revoked');
    const member = asMember(w.owner, w.member);
    const r = await turn(member, `lines schedule ${clara.name}: No tiene que salir`);
    await setLineAccess(ws, pub.id, { visibility: 'restricted' });
    const res = await decide(member, r.actions[0].id, 'confirm');
    expect(res.action?.status).toBe('failed');
    expect(await getDb().prepare("SELECT 1 FROM groups_broadcasts WHERE body = 'No tiene que salir'").get()).toBeUndefined();
  });

  it('asignar a un equipo (con el equipo de antes en la tarjeta) y una tarea con vencimiento y responsable', async () => {
    const { w, ws, clara } = await linesWorld('act-team');
    const { createTeam } = await import('@/lib/groups-inbox');
    const team = await createTeam(ws, { name: 'Soporte demo', memberIds: [w.member.id] });
    const member = asMember(w.owner, w.member);
    const card = (await prepare(member, [{ chat: clara.id, do: 'assign', to: 'Soporte demo' }])) as { details: Array<{ before: string; after: string }>; input: Record<string, unknown> };
    expect(card.details[0]).toMatchObject({ before: 'Nobody', after: 'Soporte demo' });
    await linesTool.execute(toolCtx(member, 'en'), card.input);
    expect(((await getDb().prepare('SELECT assigned_team_id FROM groups_chats WHERE id = ?').get(clara.id)) as { assigned_team_id: string }).assigned_team_id).toBe(team.id);
    const again = (await prepare(member, [{ chat: clara.id, do: 'assign', to: 'me' }])) as { details: Array<{ before: string }> };
    expect(again.details[0].before).toBe('Soporte demo');
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const task = (await prepare(member, [{ chat: clara.id, do: 'task', text: 'Llamar', at: due, to: w.friend.email }])) as { input: Record<string, unknown> };
    const res = await linesTool.execute(toolCtx(member, 'en'), task.input);
    expect(res.ok).toBe(true);
    const row = (await getDb().prepare('SELECT a.owner_id, a.due_at FROM groups_tasks g JOIN crm_activities a ON a.id = g.activity_id WHERE g.chat_id = ?').get(clara.id)) as { owner_id: string; due_at: string };
    expect(row.owner_id).toBe(w.friend.id);
    expect(row.due_at).toBeTruthy();
    // Dos borradores para el mismo chat en una tarjeta: el segundo no entra. Un "a" vacío no elige a nadie.
    const two = (await prepare(member, [{ chat: clara.id, do: 'draft', text: 'uno' }, { chat: clara.id, do: 'draft', text: 'dos' }])) as { details: unknown[] };
    expect(two.details).toHaveLength(1);
  });

  it('etiquetar (suma a las que tiene), cerrar, archivar y ticket: nada cambia hasta Confirmar', async () => {
    const { w, ws, clara } = await linesWorld('act-label');
    const { createLabel, setChatLabels } = await import('@/lib/groups');
    const vip = await createLabel(ws, { name: 'VIP demo', color: 'blue' });
    const urgent = await createLabel(ws, { name: 'Urgente demo', color: 'red' });
    await setChatLabels(ws, clara.id, [vip.id]);
    const member = asMember(w.owner, w.member);
    const labels = async () => ((await getDb().prepare('SELECT label_id FROM groups_chat_labels WHERE chat_id = ? ORDER BY label_id').all(clara.id)) as Array<{ label_id: string }>).map((r) => r.label_id);
    const chatRow = async () => (await getDb().prepare('SELECT status, archived_at FROM groups_chats WHERE id = ?').get(clara.id)) as { status: string; archived_at: string | null };
    const tickets = async () => ((await getDb().prepare('SELECT title, assignee_id FROM groups_tickets WHERE chat_id = ?').all(clara.id)) as Array<{ title: string; assignee_id: string | null }>);

    // Etiqueta: la tarjeta dice las que tiene y cómo quedan (no se saca ninguna); una que no existe no arma tarjeta;
    // una que ya tiene, tampoco (y se dice por qué).
    const label = await turn(member, `lines label ${clara.name}: urgente DEMO`);
    expect(label.actions[0].details[0]).toMatchObject({ before: 'VIP demo', after: 'VIP demo, Urgente demo' });
    expect(await labels()).toEqual([vip.id]);
    await decide(member, label.actions[0].id, 'cancel');
    expect(await labels()).toEqual([vip.id]);
    const label2 = await turn(member, `lines label ${clara.name}: Urgente demo`);
    await decide(member, label2.actions[0].id, 'confirm');
    expect(await labels()).toEqual([vip.id, urgent.id].sort());
    expect((await turn(member, `lines label ${clara.name}: No existe demo`)).actions).toEqual([]);
    expect((await turn(member, `lines label ${clara.name}: VIP demo`)).actions).toEqual([]);
    const has = (await prepare(member, [{ chat: clara.id, do: 'label', label: 'VIP demo' }])) as { error: string; hint: string[] };
    expect(has.error).toBe('nothing_to_do');
    expect(has.hint.join(' ')).toMatch(/already has the label/);
    // Una etiqueta borrada entre la tarjeta y el clic: no se cuenta como hecha.
    const gone = await createLabel(ws, { name: 'Se borra demo', color: 'red' });
    const goneCard = (await prepare(member, [{ chat: clara.id, do: 'label', label: 'Se borra demo' }])) as { input: Record<string, unknown> };
    await getDb().prepare('DELETE FROM groups_labels WHERE id = ?').run(gone.id);
    const goneRes = (await linesTool.execute(toolCtx(member, 'en'), goneCard.input)) as { ok: boolean; message: string };
    expect(goneRes.ok).toBe(false);
    expect(goneRes.message).toMatch(/label_not_found/);

    // Ticket con título y sin título (lo toma del chat); sin "to" va a quien tiene el chat, y la tarjeta lo dice.
    expect(await tickets()).toEqual([]);
    const ticket = await turn(member, `lines ticket ${clara.name}: Presupuesto sin respuesta`);
    expect(ticket.actions[0].details[0].after).toContain('Presupuesto sin respuesta');
    expect(ticket.actions[0].details[0].after).toContain('Owner: Nobody');
    expect(await tickets()).toEqual([]);
    await decide(member, ticket.actions[0].id, 'confirm');
    expect((await tickets()).map((t) => t.title)).toEqual(['Presupuesto sin respuesta']);
    await getDb().prepare('UPDATE groups_chats SET assigned_to = ? WHERE id = ?').run(w.friend.id, clara.id);
    const auto = (await prepare(member, [{ chat: clara.id, do: 'ticket' }])) as { details: Array<{ after: string }>; input: Record<string, unknown> };
    expect(auto.details[0].after).toContain('Title taken from the chat');
    expect(auto.details[0].after).toContain(`Owner: ${w.friend.name || w.friend.email}`);
    await linesTool.execute(toolCtx(member, 'en'), auto.input);
    const autoRow = (await tickets()).find((t) => t.title !== 'Presupuesto sin respuesta')!;
    expect(autoRow.title).toBeTruthy();
    expect(autoRow.assignee_id).toBe(w.friend.id);
    await getDb().prepare('UPDATE groups_chats SET assigned_to = NULL WHERE id = ?').run(clara.id);
    const audit = (await getDb().prepare("SELECT actor_id FROM groups_audit WHERE chat_id = ? AND action = 'ticket_created'").all(clara.id)) as Array<{ actor_id: string }>;
    // Los dos tickets (con título y el automático), a nombre de quien confirmó.
    expect(audit.map((a) => a.actor_id)).toEqual([w.member.id, w.member.id]);

    // Cerrar y archivar.
    const close = await turn(member, `lines close ${clara.name}`);
    expect(close.actions[0].details[0]).toMatchObject({ before: 'Open' });
    expect((await chatRow()).status).toBe('open');
    await decide(member, close.actions[0].id, 'confirm');
    expect((await chatRow()).status).toBe('closed');
    expect((await turn(member, `lines close ${clara.name}`)).actions).toEqual([]);
    const archive = await turn(member, `lines archive ${clara.name}`);
    expect((await chatRow()).archived_at).toBeNull();
    await decide(member, archive.actions[0].id, 'confirm');
    expect((await chatRow()).archived_at).toBeTruthy();
    expect(await outgoing(clara.id)).toBe(0);
  });

  it('cerrar y archivar tocan el mismo chat en las otras líneas que ve (y la tarjeta las nombra), nunca en una que no ve', async () => {
    const { w, ws, pub, priv } = await linesWorld('act-same-chat');
    const other = await line(ws, 'Soporte demo');
    const p = phone();
    for (const n of [pub, other, priv]) await ingestEvents(n, [ev(`${p}@c.us`, 'Dora demo', 'Hola de nuevo')]);
    const rows = (await getDb().prepare('SELECT id, number_id FROM groups_chats WHERE user_id = ? AND phone = ?').all(ws, p)) as Array<{ id: string; number_id: string }>;
    const onPub = rows.find((r) => r.number_id === pub.id)!.id;
    const onOther = rows.find((r) => r.number_id === other.id)!.id;
    const onPriv = rows.find((r) => r.number_id === priv.id)!.id;
    const member = asMember(w.owner, w.member);
    const state = async (id: string) => (await getDb().prepare('SELECT status, archived_at FROM groups_chats WHERE id = ?').get(id)) as { status: string; archived_at: string | null };
    const close = (await prepare(member, [{ chat: onPub, do: 'close' }])) as { details: Array<{ after: string }>; input: Record<string, unknown> };
    expect(close.details[0].after).toContain('Also on Soporte demo');
    expect(close.details[0].after).not.toContain('Privada demo');
    await linesTool.execute(toolCtx(member, 'en'), close.input);
    expect((await state(onPub)).status).toBe('closed');
    expect((await state(onOther)).status).toBe('closed');
    expect((await state(onPriv)).status).toBe('open');
    const archive = (await prepare(member, [{ chat: onPub, do: 'archive' }])) as { input: Record<string, unknown> };
    await linesTool.execute(toolCtx(member, 'en'), archive.input);
    expect((await state(onPub)).archived_at).toBeTruthy();
    expect((await state(onOther)).archived_at).toBeTruthy();
    expect((await state(onPriv)).archived_at).toBeNull();
  });

  it('etiquetar, cerrar, archivar o abrir un ticket en un chat que no ve: nada', async () => {
    const { w, ws, hidden } = await linesWorld('act-label-hidden');
    const { createLabel } = await import('@/lib/groups');
    await createLabel(ws, { name: 'VIP oculto', color: 'blue' });
    const member = asMember(w.owner, w.member);
    for (const ask of [`lines label ${hidden.id}: VIP oculto`, `lines close ${hidden.id}`, `lines archive ${hidden.id}`, `lines ticket ${hidden.id}: algo`]) {
      expect((await turn(member, ask)).actions).toEqual([]);
    }
    expect(await getDb().prepare('SELECT 1 FROM groups_chat_labels WHERE chat_id = ?').get(hidden.id)).toBeUndefined();
    expect(await getDb().prepare('SELECT 1 FROM groups_tickets WHERE chat_id = ?').get(hidden.id)).toBeUndefined();
    expect((await getDb().prepare('SELECT status, archived_at FROM groups_chats WHERE id = ?').get(hidden.id)) as object).toMatchObject({ status: 'open', archived_at: null });
  });
});

describe('Inbox: nota y programado con tarjeta', () => {
  async function inbox(label: string) {
    const w = await workspaceWithMember(label);
    const acc = await createAccount(w.member.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const p = phone();
    const t = await upsertThread(acc, { externalId: `${p}@s.whatsapp.net`, kind: 'dm', title: `Ana ${label}`, handle: p });
    await addInboxMessage(t, { externalId: `a-${uniq()}`, fromMe: false, senderName: 'Ana', body: 'Hola', sentAt: new Date().toISOString() });
    await getDb().prepare('UPDATE inbox_threads SET notes = ? WHERE id = ?').run('Nota de antes', t.id);
    return { w, t, name: `Ana ${label}` };
  }

  it('la nota se suma a las de antes; el programado queda pendiente para mañana con el botón rojo', async () => {
    const { w, t, name } = await inbox('act-inbox');
    const member = asMember(w.owner, w.member);
    const n = await turn(member, `inbox note ${name}: Prefiere la tarde`);
    expect(n.actions[0].details[0].after).toContain('Prefiere la tarde');
    expect((await getThreadRow(w.member.id, t.id)).notes).toBe('Nota de antes');
    await decide(member, n.actions[0].id, 'confirm');
    expect((await getThreadRow(w.member.id, t.id)).notes).toBe('Nota de antes\n\nPrefiere la tarde');

    const s = await turn(member, `inbox schedule ${name}: Te escribo mañana`);
    expect(s.actions[0].destructive).toBe(true);
    expect(s.actions[0].confirmText).toBeNull();
    const cancel = await decide(member, s.actions[0].id, 'cancel');
    expect(cancel.action?.status).toBe('cancelled');
    expect(await getDb().prepare('SELECT 1 FROM inbox_scheduled WHERE thread_id = ?').get(t.id)).toBeUndefined();
    const s2 = await turn(member, `inbox schedule ${name}: Te escribo mañana`);
    await decide(member, s2.actions[0].id, 'confirm');
    const row = (await getDb().prepare('SELECT status, send_at FROM inbox_scheduled WHERE thread_id = ?').get(t.id)) as { status: string; send_at: string };
    expect(row.status).toBe('pending');
    expect(Date.parse(row.send_at)).toBeGreaterThan(Date.now() + 60_000);
  });

  it('un programado de Inbox con la hora vencida al confirmar no se programa', async () => {
    const { w, t, name } = await inbox('act-inbox-late');
    const member = asMember(w.owner, w.member);
    const late = await turn(member, `inbox schedule ${name}: Esto no sale`);
    const row = (await getDb().prepare('SELECT input FROM assistant_actions WHERE id = ?').get(late.actions[0].id)) as { input: string };
    const input = JSON.parse(row.input) as { planned: Array<{ until: string }> };
    input.planned[0].until = new Date(Date.now() - 60_000).toISOString();
    await getDb().prepare('UPDATE assistant_actions SET input = ? WHERE id = ?').run(JSON.stringify(input), late.actions[0].id);
    const res = await decide(member, late.actions[0].id, 'confirm');
    expect(res.action?.status).toBe('failed');
    expect(await getDb().prepare('SELECT 1 FROM inbox_scheduled WHERE thread_id = ?').get(t.id)).toBeUndefined();
  });

  it('el chat de otra persona no existe para el asistente (ni para el dueño del workspace)', async () => {
    const { w, t, name } = await inbox('act-inbox-other');
    for (const u of [asOwner(w.owner), asMember(w.owner, w.friend, 'admin')]) {
      const r = await turn(u, `inbox note ${name}: hola`);
      expect(r.actions).toEqual([]);
      const f = await turn(u, `find inbox chat ${name}`);
      expect(unwrapChats(f.results.find((x) => x.tool === 'inbox_find_chats')!.output)).toEqual([]);
    }
    expect((await getThreadRow(w.member.id, t.id)).notes).toBe('Nota de antes');
  });
});
