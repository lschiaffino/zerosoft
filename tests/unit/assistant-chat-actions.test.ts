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
    expect('action' in cancelled && cancelled.action.status).toBe('cancelled');
    expect(await notes(clara.id)).toEqual([]);
    // Otra tarjeta, confirmada.
    const again = await turn(member, `lines note ${clara.name}: Llamar el lunes`);
    const done = await decide(member, again.actions[0].id, 'confirm');
    expect('action' in done && done.action.status).toBe('done');
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
    expect('action' in res && res.action.status).toBe('failed');
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
    expect('action' in done && done.action.status).toBe('done');
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
    expect('action' in res && res.action.status).toBe('failed');
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
    expect('action' in res && res.action.result?.drafts).toEqual([{ app: 'lines', chatId: clara.id, text: 'Hola Clara, sale hoy' }]);
    expect(await outgoing(clara.id)).toBe(0);
  });

  it('buscar chats: solo los que ve, sin texto de mensajes; sin la app Lines o como invitado no hay herramientas', async () => {
    const { w, clara, hidden } = await linesWorld('act-find');
    const member = asMember(w.owner, w.member);
    const r = await turn(member, 'find lines chat act-find');
    const found = r.results.find((x) => x.tool === 'lines_find_chats')!.output as { chats: Array<{ id: string; name: string }> };
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
    expect('action' in cancel && cancel.action.status).toBe('cancelled');
    expect(await getDb().prepare('SELECT 1 FROM inbox_scheduled WHERE thread_id = ?').get(t.id)).toBeUndefined();
    const s2 = await turn(member, `inbox schedule ${name}: Te escribo mañana`);
    await decide(member, s2.actions[0].id, 'confirm');
    const row = (await getDb().prepare('SELECT status, send_at FROM inbox_scheduled WHERE thread_id = ?').get(t.id)) as { status: string; send_at: string };
    expect(row.status).toBe('pending');
    expect(Date.parse(row.send_at)).toBeGreaterThan(Date.now() + 60_000);
  });

  it('el chat de otra persona no existe para el asistente (ni para el dueño del workspace)', async () => {
    const { w, t, name } = await inbox('act-inbox-other');
    for (const u of [asOwner(w.owner), asMember(w.owner, w.friend, 'admin')]) {
      const r = await turn(u, `inbox note ${name}: hola`);
      expect(r.actions).toEqual([]);
      const f = await turn(u, `find inbox chat ${name}`);
      expect((f.results.find((x) => x.tool === 'inbox_find_chats')!.output as { chats: unknown[] }).chats).toEqual([]);
    }
    expect((await getThreadRow(w.member.id, t.id)).notes).toBe('Nota de antes');
  });
});
