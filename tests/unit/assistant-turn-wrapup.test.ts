import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { createAccount, upsertThread } from '@/lib/inbox/core';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { setAssistantModelOverride } from '@/lib/assistant/config';
import { ASSISTANT_MAX_STEPS, fallbackWrapUp, runAssistantTurn, type AssistantEvent } from '@/lib/assistant/engine';
import { fakeAssistantStep } from '@/lib/assistant/fake';
import { fakeModel } from '@/lib/crm-ai-fake';
import { decideAction } from '@/lib/assistant/actions';
import { addMessage, createConversation, listMessages } from '@/lib/assistant/store';
import { normalizeFoldersJson } from '@/lib/assistant/folders-json';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

/**
 * El asistente siempre contesta y hace el trabajo de una:
 * - un turno que se queda sin pasos (el modelo busca y busca) termina con un
 *   mensaje que cuenta qué hizo y qué falta;
 * - uno que termina callado después de una herramienta pide el cierre;
 * - si ni así hay texto, el servidor lo escribe;
 * - un JSON exportado (inbox-zero o etiquetas y reglas de un correo) arma UNA
 *   tarjeta con todas las carpetas, en Inbox, en Lines o en los dos.
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'assistant');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

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

async function turn(user: SessionUser, message: string, locale = 'en') {
  const who = { workspaceId: user.id, personId: user.actingUser?.id ?? user.id };
  const conv = await createConversation(who, 'turno');
  await addMessage(conv.id, 'user', message);
  const events: AssistantEvent[] = [];
  for await (const e of runAssistantTurn({ user, conversationId: conv.id, message, page: null, locale })) events.push(e);
  const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
  const saved = (await listMessages(conv.id, 10)).filter((m) => m.role === 'assistant').pop();
  return { events, text, saved, tools: events.filter((e) => e.type === 'tool').length };
}

describe('el turno nunca termina callado', () => {
  it('sin pasos (busca sin parar): el último paso va sin herramientas y cuenta qué hizo', async () => {
    const u = await makeUser('wrap-dig');
    setAssistantModelOverride(fakeModel(fakeAssistantStep));
    const r = await turn(owner(u), 'dig through the catalog for folder operations');
    // Usó todos los pasos menos el de cierre, y el cierre es texto.
    expect(r.tools).toBe(ASSISTANT_MAX_STEPS - 1);
    expect(r.text).toMatch(/I used \d+ steps and stopped there/);
    expect(r.events.some((e) => e.type === 'error')).toBe(false);
    expect(r.saved?.content).toMatch(/Tell me if I should keep going/);
    expect(r.events[r.events.length - 1].type).toBe('done');
  });

  it('termina callado después de una herramienta: pide el cierre al modelo', async () => {
    const u = await makeUser('wrap-silent');
    setAssistantModelOverride(fakeModel(fakeAssistantStep));
    const r = await turn(owner(u), 'show my inbox folders silently');
    expect(r.tools).toBe(1);
    expect(r.text).toMatch(/I used 1 steps and stopped there/);
    expect(r.saved?.content.trim().length).toBeGreaterThan(0);
  });

  it('un modelo que no deja de pedir herramientas: el cierre lo escribe el servidor, en el idioma de la persona', async () => {
    const u = await makeUser('wrap-stubborn');
    setAssistantModelOverride(scriptedModel(() => ({ tool: 'find_operations', input: { query: 'carpetas' } })));
    const r = await turn(owner(u), 'configurá mis carpetas', 'es');
    expect(r.text.trim().length).toBeGreaterThan(0);
    expect(r.text).toMatch(/Decime si sigo o qué querés ajustar\./);
    expect(r.saved?.content).toBe(r.text.trim());
    expect(r.events.some((e) => e.type === 'error')).toBe(false);
  });

  it('el modelo responde vacío (el razonamiento se comió los tokens): igual hay un mensaje', async () => {
    const u = await makeUser('wrap-empty');
    setAssistantModelOverride(scriptedModel([{ text: '' }]));
    const r = await turn(owner(u), 'hola', 'es');
    expect(r.text).toMatch(/Decime si sigo o qué querés ajustar\./);
    expect(r.saved?.content.trim().length).toBeGreaterThan(0);
  });

  it('el proveedor falla sin hacer nada: mensaje y el error', async () => {
    const u = await makeUser('wrap-fail');
    const { MockLanguageModelV4 } = await import('ai/test');
    setAssistantModelOverride(
      new MockLanguageModelV4({
        modelId: 'broken',
        doStream: async () => {
          throw new Error('empty response');
        },
      }),
    );
    const r = await turn(owner(u), 'hola', 'en');
    expect(r.text).toMatch(/^The model stopped responding/);
    expect(r.events.some((e) => e.type === 'error')).toBe(true);
    expect(r.saved?.content.trim().length).toBeGreaterThan(0);
  });

  it('el cierre del servidor dice qué espera confirmación', () => {
    expect(fallbackWrapUp('es', { steps: 9, pending: 1, failed: false })).toBe(
      'Me detuve después de 9 pasos sin terminar la respuesta. Hay un cambio esperando tu confirmación en la tarjeta de arriba. Decime si sigo o qué querés ajustar.',
    );
    expect(fallbackWrapUp('en', { steps: 2, pending: 0, failed: true })).toMatch(/^The model stopped responding/);
    expect(fallbackWrapUp('pt', { steps: 3, pending: 2, failed: false })).toContain('Há 2 mudanças');
  });

  it('find_operations trae el esquema de los primeros y avisa que las carpetas van de una', async () => {
    const u = await makeUser('wrap-find');
    setAssistantModelOverride(scriptedModel([{ tool: 'find_operations', input: { query: 'groups folders create' } }, { text: 'ok' }]));
    const r = await turn(owner(u), 'x');
    const out = r.events.find((e): e is Extract<AssistantEvent, { type: 'tool-result' }> => e.type === 'tool-result')!.output as {
      operations: Array<{ inputSchema?: unknown }>;
      hint?: string;
    };
    expect(out.operations[0].inputSchema).toBeDefined();
    expect(out.hint).toContain('propose_folders_from_json');
  });
});

describe('carpetas desde los JSON de ejemplo', () => {
  it('la exportación de inbox-zero (tests/fixtures/assistant/inboxzero.json): todas las carpetas con su árbol', () => {
    const n = normalizeFoldersJson(JSON.parse(fixture('inboxzero.json')));
    expect(n.shapes).toEqual(['inbox-zero']);
    expect(n.folders).toHaveLength(23);
    expect(n.folders.map((f) => f.path.join('/'))).toEqual(expect.arrayContaining(['Clientes/VIP', 'Trámites/Banco', 'Amigos/Fútbol', 'Grupos']));
    expect(n.folders.reduce((s, f) => s + f.chats.length, 0)).toBe(58);
  });

  it('etiquetas y reglas de un correo: carpetas por etiqueta, remitentes como chats, sin las del sistema ni reglas apagadas', () => {
    const n = normalizeFoldersJson(JSON.parse(fixture('mail-labels.json')));
    expect(n.shapes).toEqual(['rules']);
    const byPath = Object.fromEntries(n.folders.map((f) => [f.path.join('/'), f.chats.map((c) => c.email)]));
    expect(Object.keys(byPath).sort()).toEqual(['Clientes', 'Clientes/VIP', 'Facturas', 'Newsletters', 'Proveedores', 'Proveedores/Insumos']);
    expect(byPath['Clientes/VIP']).toEqual(['ana@example.com', 'beto@example.com']);
    expect(byPath.Facturas).toEqual(['facturas@example.org']);
    // Un dominio suelto no es un chat.
    expect(byPath['Proveedores/Insumos']).toEqual([]);
  });

  it('"configurá mis carpetas de inbox y lines": una sola tarjeta para los dos; al confirmar quedan en Inbox y en Lines', async () => {
    const u = await makeUser('wrap-both');
    // Inbox: dos chats del JSON (n=1 en "Clientes", n=4 en "VIP").
    const acc = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await upsertThread(acc, { externalId: '5491155500001@s.whatsapp.net', kind: 'dm', title: 'Uno', handle: '5491155500001' });
    await upsertThread(acc, { externalId: '5491155500004@s.whatsapp.net', kind: 'dm', title: 'Cuatro', handle: '5491155500004' });
    // Lines: una línea con el chat n=1.
    const num = await createNumber(u.id, u.id, { provider: 'fake', name: 'Ventas' });
    await connectNumber(u.id, num.id);
    const fakeState = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(num.id);
    if (fakeState) fakeState.connectedAt = Date.now() - 5000;
    const line = (await getNumberRowById(num.id))!;
    await ingestEvents(line, [
      { type: 'message', chatId: '5491155500001@c.us', isGroup: false, fromMe: false, senderPhone: '5491155500001', senderName: 'Uno', providerMessageId: 'm-wrap-1', body: 'hola' },
    ]);

    setAssistantModelOverride(fakeModel(fakeAssistantStep));
    const user = owner(u);
    const who = { workspaceId: u.id, personId: u.id };
    const conv = await createConversation(who, 'carpetas');
    await addMessage(conv.id, 'user', `configurá mis carpetas de inbox y lines en función de esto\n${fixture('inboxzero.json')}`);
    const events: AssistantEvent[] = [];
    for await (const e of runAssistantTurn({ user, conversationId: conv.id, message: 'x', page: null, locale: 'es' })) events.push(e);
    const actions = events.filter((e): e is Extract<AssistantEvent, { type: 'action' }> => e.type === 'action');
    // Un solo paso de herramienta y una sola tarjeta para las 23 carpetas de cada app.
    expect(events.filter((e) => e.type === 'tool')).toHaveLength(1);
    expect(actions).toHaveLength(1);
    const card = actions[0].action;
    expect(card.summary).toBe('Crear 23 carpetas y poner 2 chats en Inbox · Crear 23 carpetas y poner 1 chat en Lines');
    expect(card.details.map((d) => d.label)).toEqual(expect.arrayContaining(['Inbox · Carpetas nuevas (23)', 'Lines · Carpetas nuevas (23)']));
    expect(events.some((e) => e.type === 'text')).toBe(true);

    const done = await decideAction({ user, locale: 'es', id: card.id, decision: 'confirm' });
    expect(done.action?.status).toBe('done');
    expect(done.action?.result?.message).toMatch(/^Inbox: Creé 23 carpetas|^Inbox: /);
    expect(done.action?.result?.message).toContain('Lines: ');
    const inboxFolders = (await getDb().prepare('SELECT COUNT(*) AS n FROM inbox_folders WHERE owner_id = ?').get(u.id)) as { n: number };
    const lineFolders = (await getDb().prepare('SELECT COUNT(*) AS n FROM groups_folders WHERE user_id = ?').get(u.id)) as { n: number };
    expect(Number(inboxFolders.n)).toBe(23);
    expect(Number(lineFolders.n)).toBe(23);
    const vip = (await getDb()
      .prepare("SELECT t.title FROM inbox_thread_folders tf JOIN inbox_folders f ON f.id = tf.folder_id JOIN inbox_threads t ON t.id = tf.thread_id WHERE f.owner_id = ? AND f.name = 'VIP'")
      .all(u.id)) as Array<{ title: string }>;
    expect(vip.map((r) => r.title)).toEqual(['Cuatro']);
  });
});
