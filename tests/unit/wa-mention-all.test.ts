/**
 * "@all" en grupos de WhatsApp (Lines e Inbox): menciona a todo el grupo. En
 * el texto queda "@all" (o "@todos"), y al servidor va la marca aparte
 * (Evolution: mentionsEveryOne; WAHA: mentions ['all']). La Cloud API no tiene
 * grupos: ahí no se ofrece ni se manda. Números y nombres inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyWaMentionPicks, allFirst, cleanWaMentionPicks, serializeWaMentions, waMentionables, waMentionHits, waMentionPicks } from '@/lib/wa-compose-mentions';
import { MENTION_ALL, hasMentionAllToken, keepMentionAll, mentionAllWord, mentionSendOpts, splitMentionAll } from '@/lib/wa-mention-all';
import { mentionSuggestions } from '@/lib/crm-mentions';
import { PROVIDER_CAPS, type FetchLike } from '@/lib/groups-provider';
import { evolutionProvider, wahaProvider } from '@/lib/groups-provider-bridge';
import { fakeProvider, fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { cleanMentions, connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, retryMessage, sendMessage } from '@/lib/groups';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const A = '5490000000101';
const B = '5490000000102';
const members = [
  { phone: A, name: 'Persona Uno' },
  { phone: B, name: 'Persona Dos' },
];

describe('@all: el campo', () => {
  it('la palabra según el idioma: all en inglés, todos en español y portugués', () => {
    expect(mentionAllWord('en')).toBe('all');
    expect(mentionAllWord('es-AR')).toBe('todos');
    expect(mentionAllWord('pt-BR')).toBe('todos');
    expect(mentionAllWord(null)).toBe('all');
  });

  it('"todos" va primero en la lista y solo si se ofrece', () => {
    const without = waMentionables(members);
    expect(without.some((p) => p.id === MENTION_ALL)).toBe(false);
    const people = waMentionables(members, undefined, 'todos');
    expect(allFirst(mentionSuggestions('', people, 50)).map((p) => p.id)).toEqual([MENTION_ALL, B, A]);
    // Filtra por las dos palabras.
    expect(mentionSuggestions('to', people, 50).map((p) => p.id)).toContain(MENTION_ALL);
    expect(mentionSuggestions('al', people, 50).map((p) => p.id)).toContain(MENTION_ALL);
    expect(mentionSuggestions('uno', people, 50).map((p) => p.id)).toEqual([A]);
  });

  it('"@all" y "@todos" quedan como se escribieron, con "all" primero en la lista', () => {
    const people = waMentionables(members, undefined, 'todos');
    expect(serializeWaMentions('Hola @Persona Uno y @todos, mañana', people)).toEqual({ body: `Hola @${A} y @todos, mañana`, mentions: [MENTION_ALL, A] });
    expect(serializeWaMentions('@ALL atención', people)).toEqual({ body: '@ALL atención', mentions: [MENTION_ALL] });
    // Dentro de otra palabra o de un email no menciona.
    expect(serializeWaMentions('info@all.com y @allanamos y @todosmal', people)).toEqual({ body: 'info@all.com y @allanamos y @todosmal', mentions: [] });
    // En inglés, solo "@all".
    const en = waMentionables(members, undefined, 'all');
    expect(serializeWaMentions('@todos no, @all sí', en)).toEqual({ body: '@todos no, @all sí', mentions: [MENTION_ALL] });
    expect(waMentionHits('ping @all', en).map((h) => h.id)).toEqual([MENTION_ALL]);
  });

  it('un programado guarda "todos" y vuelve a mencionar a todos al salir', () => {
    const people = waMentionables(members, undefined, 'todos');
    const picks = waMentionPicks('@todos y @Persona Dos', people);
    expect(picks).toEqual([
      { phone: MENTION_ALL, label: 'todos' },
      { phone: B, label: 'Persona Dos' },
    ]);
    expect(cleanWaMentionPicks(JSON.stringify(picks))).toEqual(picks);
    // "all" sin etiqueta o cualquier otro texto no pasa.
    expect(cleanWaMentionPicks([{ phone: 'all', label: '' }, { phone: 'todos', label: 'x' }])).toEqual([]);
    expect(applyWaMentionPicks('@todos y @Persona Dos', picks)).toEqual({ body: `@todos y @${B}`, mentions: [MENTION_ALL, B] });
    expect(applyWaMentionPicks('@all mañana', [{ phone: MENTION_ALL, label: 'all' }])).toEqual({ body: '@all mañana', mentions: [MENTION_ALL] });
    // Si el texto ya no dice "@all", no menciona a todos.
    expect(applyWaMentionPicks('mañana', [{ phone: MENTION_ALL, label: 'all' }])).toEqual({ body: 'mañana', mentions: [] });
  });
});

describe('@all: el servidor', () => {
  it('solo con la palabra en el texto, y solo en grupos', () => {
    expect(hasMentionAllToken('hola @all')).toBe(true);
    expect(hasMentionAllToken('@Todos!')).toBe(true);
    expect(hasMentionAllToken('a@all.com')).toBe(false);
    expect(hasMentionAllToken('@allá')).toBe(false);
    expect(keepMentionAll(['all'], 'hola @all', true)).toBe(true);
    expect(keepMentionAll(['all'], 'hola @all', false)).toBe(false);
    expect(keepMentionAll(['all'], 'hola', true)).toBe(false);
    expect(keepMentionAll('all', 'hola @all', true)).toBe(false);
    expect(cleanMentions(['all', A], `@all y @${A}`, 'group')).toEqual([MENTION_ALL, A]);
    expect(cleanMentions([A, 'all'], `@${A} y @todos`, 'group')).toEqual([MENTION_ALL, A]);
    expect(cleanMentions(['all'], 'sin la palabra', 'group')).toEqual([]);
    expect(cleanMentions(['all'], '@all', 'dm')).toEqual([]);
  });

  it('la marca va solo si el proveedor la manda (la Cloud API no)', () => {
    expect(splitMentionAll([MENTION_ALL, A])).toEqual({ all: true, ids: [A] });
    expect(mentionSendOpts([MENTION_ALL, A], PROVIDER_CAPS.evolution)).toEqual({ mentions: [A], mentionAll: true });
    expect(mentionSendOpts([MENTION_ALL], PROVIDER_CAPS.cloud)).toEqual({});
    expect(mentionSendOpts([A], PROVIDER_CAPS.waha)).toEqual({ mentions: [A] });
    expect(PROVIDER_CAPS.cloud.mentionAll).toBe(false);
    for (const k of ['waha', 'evolution', 'managed', 'fake'] as const) expect(PROVIDER_CAPS[k].mentionAll).toBe(true);
  });
});

function mockFetch() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const f: FetchLike = async (url, init = {}) => {
    calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ id: 'X', key: { id: 'X' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

describe('@all: lo que sale a WhatsApp', () => {
  it('Evolution: mentionsEveryOne (texto y pie); WAHA: mentions ["all"]; en un 1:1 nunca', async () => {
    const evo = mockFetch();
    const p = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'acme' }, { fetch: evo.f });
    await p.sendText('123@g.us', 'hola @all', { mentionAll: true });
    expect(evo.calls.at(-1)!.body).toMatchObject({ number: '123@g.us', text: 'hola @all', mentionsEveryOne: true });
    await p.sendText(`${A}@s.whatsapp.net`, 'hola @all', { mentionAll: true });
    expect(evo.calls.at(-1)!.body).not.toHaveProperty('mentionsEveryOne');
    await p.sendMedia('123@g.us', { url: 'https://files.example.com/a.jpg', mimetype: 'image/jpeg', filename: 'a.jpg', caption: '@all mirá', mentionAll: true });
    expect(evo.calls.at(-1)!.body).toMatchObject({ caption: '@all mirá', mentionsEveryOne: true });

    const waha = mockFetch();
    const w = wahaProvider({ baseUrl: 'https://waha.example.com', apiKey: 'k', session: 'acme' }, { fetch: waha.f });
    await w.sendText('123@g.us', `@all y @${A}`, { mentionAll: true, mentions: [A] });
    expect(waha.calls.at(-1)!.body).toMatchObject({ chatId: '123@g.us', mentions: ['all'] });
    await w.sendText('123@g.us', `@${A}`, { mentions: [A] });
    expect(waha.calls.at(-1)!.body).toMatchObject({ mentions: [`${A}@c.us`] });
  });

  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetFakeProvider();
  });

  it('Lines: manda la marca, avisa a cada participante, la guarda y la repite al reintentar', async () => {
    const user = await makeUser('wa-mention-all');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const st = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (st) st.connectedAt = Date.now() - 5000;
    const gid = '120363000000000301@g.us';
    fakeProvider(n.id).parseWebhook({ events: [{ type: 'fake_contacts', contacts: members.map((m) => ({ ...m, groups: [gid] })) }] });
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, [{ type: 'message', chatId: gid, isGroup: true, fromMe: false, senderPhone: A, senderName: 'Persona Uno', providerMessageId: 'ALL-1', body: 'hola' }]);
    const chat = (await listChats(user.id, user.id)).rows.find((c) => c.kind === 'group')!;

    const sent = await sendMessage(user.id, user.id, chat.id, { body: 'Mañana a las 9 @todos', mentions: ['all'] });
    expect(sent.status).toBe('sent');
    const out = fakeSent(n.id).filter((s) => s.kind === 'text').at(-1)!;
    expect(out).toMatchObject({ text: 'Mañana a las 9 @todos', mentionAll: true });
    expect(out.mentioned).toEqual(expect.arrayContaining([`${A}@s.whatsapp.net`, `${B}@s.whatsapp.net`]));
    const saved = (await listMessages(user.id, chat.id)).find((m) => m.id === sent.id)!;
    expect(saved.body).toBe('Mañana a las 9 @todos');
    expect(saved.meta).toMatchObject({ mentions: [MENTION_ALL] });

    await getDb().prepare("UPDATE groups_messages SET status = 'failed' WHERE id = ?").run(sent.id);
    await retryMessage(user.id, user.id, sent.id);
    expect(fakeSent(n.id).filter((s) => s.kind === 'text').at(-1)).toMatchObject({ mentionAll: true });

    // Sin la palabra en el texto, "all" no pasa: nadie recibe la marca.
    await sendMessage(user.id, user.id, chat.id, { body: 'sin marca', mentions: ['all'] });
    expect(fakeSent(n.id).filter((s) => s.kind === 'text').at(-1)).not.toHaveProperty('mentionAll');
  });
});
