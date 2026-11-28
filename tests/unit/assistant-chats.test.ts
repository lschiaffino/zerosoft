import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { addMessage as addInboxMessage, createAccount, getThreadRow, upsertThread } from '@/lib/inbox/core';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { setAssistantModelOverride } from '@/lib/assistant/config';
import { runAssistantTurn, type AssistantEvent } from '@/lib/assistant/engine';
import { fakeAssistantStep } from '@/lib/assistant/fake';
import { fakeModel } from '@/lib/crm-ai-fake';
import { decideAction } from '@/lib/assistant/actions';
import { hasChatGrant, listAlwaysGrants, revokeChatAccess } from '@/lib/assistant/chat-access';
import { addMessage, createConversation, listMessages } from '@/lib/assistant/store';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

/**
 * El asistente y los chats de la persona: ve qué espera respuesta sin leer
 * mensajes; para leerlos pide permiso (esta vez / siempre / no); respeta el
 * acceso de Inbox (personal) y de Lines (por línea); no guarda el texto leído;
 * propone acciones en una tarjeta; contesta en el idioma de la persona.
 */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => {
  setAssistantModelOverride(null);
  vi.unstubAllEnvs();
});

const owner = (u: { id: string }) => ({ ...u, role: 'owner', apps: '*' }) as unknown as SessionUser;
// Centinela con letras fuera del hexadecimal: no puede aparecer por casualidad en un uuid ni en un id al azar.
const SENTINEL = 'zorzal-4471';
const SECRET = `el pedido ${SENTINEL} llega el martes`;

async function inboxWorld(label: string) {
  const u = await makeUser(label);
  const acc = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
  const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
  const ana = await upsertThread(acc, { externalId: '5491155510001@s.whatsapp.net', kind: 'dm', title: 'Ana', handle: '5491155510001' });
  await addInboxMessage(ana, { externalId: `a-${label}`, fromMe: false, senderName: 'Ana', body: `¿Me confirmás si ${SECRET}?`, sentAt: old });
  const beto = await upsertThread(acc, { externalId: '5491155510002@s.whatsapp.net', kind: 'dm', title: 'Beto', handle: '5491155510002' });
  await addInboxMessage(beto, { externalId: `b-${label}`, fromMe: false, senderName: 'Beto', body: 'Hola, ¿novedades?', sentAt: new Date(Date.now() - 5 * 3_600_000).toISOString() });
  return { u, ana, beto };
}

async function turn(user: SessionUser, message: string, opts: { conversationId?: string; locale?: string } = {}) {
  const who = { workspaceId: user.id, personId: user.actingUser?.id ?? user.id };
  const conversationId = opts.conversationId ?? (await createConversation(who, 'chats')).id;
  await addMessage(conversationId, 'user', message);
  const events: AssistantEvent[] = [];
  for await (const e of runAssistantTurn({ user, conversationId, message, page: null, locale: opts.locale ?? 'en' })) events.push(e);
  const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
  const actions = events.filter((e): e is Extract<AssistantEvent, { type: 'action' }> => e.type === 'action').map((e) => e.action);
  const results = events.filter((e): e is Extract<AssistantEvent, { type: 'tool-result' }> => e.type === 'tool-result');
  return { conversationId, who, events, text, actions, results };
}

describe('qué tengo atrasado (Inbox)', () => {
  it('la lista de lo que espera no lee mensajes ni pide permiso; contesta en el idioma de la persona aunque la app esté en inglés', async () => {
    const w = await inboxWorld('chats-list');
    setAssistantModelOverride(fakeModel(fakeAssistantStep));
    const r = await turn(owner(w.u), '¿qué tengo atrasado?', { locale: 'en' });
    const out = r.results.find((x) => x.tool === 'inbox_attention')!.output as { waitingForReply: Array<{ name: string; waitingHours: number }> };
    // El más viejo primero, con las horas que lleva esperando.
    expect(out.waitingForReply.map((c) => c.name)).toEqual(['Ana', 'Beto']);
    expect(out.waitingForReply[0].waitingHours).toBeGreaterThanOrEqual(29);
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
    expect(r.actions).toEqual([]);
    expect(r.text).toContain('Esto es lo que tenés atrasado');
  });

  it('alguien interno del workspace (en cualquiera de las formas de su número) no cuenta como "esperando respuesta"', async () => {
    const w = await inboxWorld('chats-internal');
    // Beto es del equipo, marcado sin el 9: su chat llega con el 9 (como lo manda WhatsApp).
    const { setInternalContact } = await import('@/lib/internal-contacts');
    await setInternalContact(w.u.id, w.u.id, '541155510002', true);
    setAssistantModelOverride(fakeModel(fakeAssistantStep));
    const r = await turn(owner(w.u), '¿qué tengo atrasado?', { locale: 'en' });
    const out = r.results.find((x) => x.tool === 'inbox_attention')!.output as { totals: { waitingForReply: number }; waitingForReply: Array<{ name: string }> };
    expect(out.waitingForReply.map((c) => c.name)).toEqual(['Ana']);
    expect(out.totals.waitingForReply).toBe(1);
  });

  it('las instrucciones piden contestar en el idioma en que escribe la persona', async () => {
    const u = await makeUser('chats-lang');
    let system = '';
    setAssistantModelOverride(
      new MockLanguageModelV4({
        modelId: 'capture',
        doStream: async (options) => {
          system = JSON.stringify(options.prompt.filter((m) => m.role === 'system'));
          return {
            stream: new ReadableStream({
              start(c) {
                c.enqueue({ type: 'text-start', id: '1' });
                c.enqueue({ type: 'text-delta', id: '1', delta: 'Hola.' });
                c.enqueue({ type: 'text-end', id: '1' });
                c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } });
                c.close();
              },
            }),
          };
        },
      }),
    );
    await turn(owner(u), '¿podés leer mi WhatsApp en Inbox y darme recomendaciones?', { locale: 'en' });
    expect(system).toMatch(/ALWAYS reply in the language the person writes in/);
    expect(system).toMatch(/Never say you cannot read chats/);
  });

  it('leer chats pide permiso; "no" no lee nada; "esta vez" vale solo para esa charla; "siempre" hasta revocarlo', async () => {
    const w = await inboxWorld('chats-consent');
    const user = owner(w.u);
    setAssistantModelOverride(fakeModel(fakeAssistantStep));
    // Sin permiso: tarjeta de permiso, nada leído, queda en el registro.
    const first = await turn(user, 'sí, leelos');
    const ask = first.results.find((x) => x.tool === 'inbox_read_chats')!.output as { status: string };
    expect(ask.status).toBe('awaiting_permission');
    expect(JSON.stringify(first.events)).not.toContain(SENTINEL);
    expect(first.actions.map((a) => a.tool)).toEqual(['grant_chat_access']);
    expect(first.text).toContain('necesito leer esos chats');
    const denied = (await getDb().prepare("SELECT outcome FROM assistant_audit WHERE person_id = ? AND tool = 'inbox_read_chats'").all(w.u.id)) as Array<{ outcome: string }>;
    expect(denied.map((d) => d.outcome)).toContain('needs_permission');

    // "No permitir": sigue sin permiso.
    await decideAction({ user, locale: 'es', id: first.actions[0].id, decision: 'cancel' });
    expect(await hasChatGrant(first.who, 'inbox', first.conversationId)).toBe(false);

    // "Esta vez": lee en esta charla; en otra vuelve a pedir.
    const again = await turn(user, 'sí, leelos', { conversationId: first.conversationId });
    const done = await decideAction({ user, locale: 'es', id: again.actions[0].id, decision: 'confirm', option: 'once' });
    expect(done.action?.status).toBe('done');
    const read = await turn(user, 'Permitido. Seguí.', { conversationId: first.conversationId });
    const readOut = read.results.find((x) => x.tool === 'inbox_read_chats')!;
    // El texto llega al modelo en el turno, pero ni la pantalla ni la charla guardada lo tienen.
    expect(readOut.output).toEqual({ read: 2, withheld: true });
    const saved = JSON.stringify(await listMessages(first.conversationId, 50));
    expect(saved).not.toContain(SENTINEL);
    expect(read.actions.map((a) => a.tool)).toEqual(['propose_inbox_actions']);
    const other = await turn(user, 'sí, leelos');
    expect((other.results[0].output as { status: string }).status).toBe('awaiting_permission');

    // "Siempre": vale en cualquier charla, se lista en Ajustes y se revoca.
    await decideAction({ user, locale: 'es', id: other.actions[0].id, decision: 'confirm', option: 'always' });
    expect(await listAlwaysGrants(first.who)).toEqual([{ app: 'inbox', createdAt: expect.any(String) }]);
    const fresh = await turn(user, 'sí, leelos');
    expect(fresh.results.find((x) => x.tool === 'inbox_read_chats')!.output).toEqual({ read: 2, withheld: true });
    await revokeChatAccess(first.who, 'inbox');
    expect(await hasChatGrant(first.who, 'inbox', first.conversationId)).toBe(false);
  });

  it('el modelo recibe el texto marcado como datos de terceros', async () => {
    const w = await inboxWorld('chats-wrap');
    const user = owner(w.u);
    await (await import('@/lib/assistant/chat-access')).grantChatAccess({ workspaceId: w.u.id, personId: w.u.id }, 'inbox', 'always', null);
    let seen = '';
    setAssistantModelOverride(
      scriptedModel((call) => {
        if (call === 0) return { tool: 'inbox_read_chats', input: { chats: ['Ana'] } };
        return { text: 'ok' };
      }),
    );
    // El resultado que ve el modelo: lo leemos del registro del SDK a través del prompt del segundo paso.
    const spy = vi.spyOn(await import('@/lib/mcp/untrusted'), 'wrapUntrusted');
    await turn(user, 'resumí el chat con Ana');
    expect(spy).toHaveBeenCalled();
    seen = String(spy.mock.results[0].value);
    expect(seen).toMatch(/^<untrusted_data source="inbox.chats" nonce="[0-9a-f]+">/);
    expect(seen).toContain(SENTINEL);
    spy.mockRestore();
  });

  it('privacidad: un member con permiso solo lee su propio Inbox, nunca el del dueño', async () => {
    const w = await inboxWorld('chats-priv');
    const member = await makeUser('chats-priv-m');
    const as = { ...w.u, actingUser: member, role: 'member', apps: '*' } as unknown as SessionUser;
    await (await import('@/lib/assistant/chat-access')).grantChatAccess({ workspaceId: w.u.id, personId: member.id }, 'inbox', 'always', null);
    setAssistantModelOverride(scriptedModel([{ tool: 'inbox_read_chats', input: { chats: [w.ana.id, 'Ana'] } }, { text: 'ok' }]));
    const spy = vi.spyOn(await import('@/lib/mcp/untrusted'), 'wrapUntrusted');
    const r = await turn(as, 'leé el chat de Ana');
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);
    expect((r.results[0].output as { read: number }).read).toBe(0);
    spy.mockRestore();
    // El permiso del dueño tampoco existe para el member (es por persona).
    expect(await hasChatGrant({ workspaceId: w.u.id, personId: w.u.id }, 'inbox', null)).toBe(false);
  });

  it('acciones propuestas en una tarjeta: borrador sin enviar y posponer; al confirmar quedan en Inbox', async () => {
    const w = await inboxWorld('chats-act');
    const user = owner(w.u);
    const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
    setAssistantModelOverride(
      scriptedModel([
        {
          tool: 'propose_inbox_actions',
          input: { actions: [{ chat: w.ana.id, do: 'draft', text: 'Sí, llega el martes.' }, { chat: 'Beto', do: 'snooze', until }, { chat: 'Nadie', do: 'archive' }] },
        },
        { text: 'Listo para confirmar.' },
      ]),
    );
    const r = await turn(user, 'hacelo', { locale: 'es' });
    expect(r.actions).toHaveLength(1);
    const card = r.actions[0];
    expect(card.summary).toBe('Aplicar 2 cambios en Inbox');
    // El borrador va en su propia fila, con el chat y dónde está (canal y número) y el texto entero.
    expect(card.details.map((d) => d.label)).toEqual(['Borrador de respuesta para Ana (whatsapp · 5491155510001), queda en el chat y no se manda', 'Posponer hasta (1)']);
    expect(card.details[0]).toMatchObject({ after: 'Sí, llega el martes.', full: true });
    const done = await decideAction({ user, locale: 'es', id: card.id, decision: 'confirm' });
    expect(done.action?.status).toBe('done');
    expect((await getThreadRow(w.u.id, w.ana.id)).draft).toBe('Sí, llega el martes.');
    expect((await getThreadRow(w.u.id, w.beto.id)).snoozed_until).toBe(until);
    // Nada se mandó: el chat de Ana no tiene mensajes míos.
    const mine = (await getDb().prepare('SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ? AND from_me = 1').get(w.ana.id)) as { n: number };
    expect(Number(mine.n)).toBe(0);
  });
});

describe('Lines: solo los chats que la persona ve', () => {
  it('con permiso, una línea restringida no se lee', async () => {
    const ws = await makeUser('chats-lines');
    const n = await createNumber(ws.id, ws.id, { provider: 'fake', name: 'Ventas' });
    await connectNumber(ws.id, n.id);
    const fakeState = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (fakeState) fakeState.connectedAt = Date.now() - 5000;
    const line = (await getNumberRowById(n.id))!;
    await ingestEvents(line, [{ type: 'message', chatId: '5491100000301@c.us', isGroup: false, fromMe: false, senderPhone: '5491100000301', senderName: 'Cliente', providerMessageId: 'cl-1', body: `Hola, ${SECRET}` }]);
    const chat = (await listChats(ws.id, ws.id)).rows[0];
    const { createTeam, addMember } = await import('@/lib/teams');
    const team = (await createTeam(ws.id, 'WS')).id;
    const outsider = await makeUser('chats-lines-out');
    await addMember(team, outsider.id, 'member');
    const { setLineAccess } = await import('@/lib/groups-lines');
    await setLineAccess(ws.id, line.id, { visibility: 'restricted', personIds: [] });
    const grant = (await import('@/lib/assistant/chat-access')).grantChatAccess;
    await grant({ workspaceId: ws.id, personId: outsider.id }, 'lines', 'always', null);
    await grant({ workspaceId: ws.id, personId: ws.id }, 'lines', 'always', null);
    const spy = vi.spyOn(await import('@/lib/mcp/untrusted'), 'wrapUntrusted');

    const as = { ...ws, actingUser: outsider, role: 'member', apps: '*' } as unknown as SessionUser;
    setAssistantModelOverride(scriptedModel([{ tool: 'lines_read_chats', input: { chats: [chat.id] } }, { text: 'ok' }]));
    const r = await turn(as, 'leé ese chat');
    expect((r.results[0].output as { read: number }).read).toBe(0);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);

    // El dueño (que ve la línea) sí.
    setAssistantModelOverride(scriptedModel([{ tool: 'lines_read_chats', input: { chats: [chat.id] } }, { text: 'ok' }]));
    const mine = await turn(owner(ws), 'leé ese chat');
    expect((mine.results[0].output as { read: number }).read).toBe(1);
    expect(JSON.stringify(spy.mock.calls)).toContain(SENTINEL);
    spy.mockRestore();
  });
});
