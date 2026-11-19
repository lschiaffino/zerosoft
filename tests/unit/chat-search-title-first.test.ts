/**
 * Buscar en la lista de chats (Inbox y Lines), como en WhatsApp: primero los
 * chats cuyo nombre coincide, por viejos que sean; después los que coinciden
 * solo por mensajes. Buscando, los fijados no van adelante, y las páginas
 * traen cada fila una sola vez. Sin búsqueda el orden no cambia.
 * Nombres, teléfonos y textos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatNameRank, isNameHit } from '@/lib/chat-search-rank';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, updateChat } from '@/lib/groups';
import { addMessage, applyThreadAction, createAccount, listThreadsPage, upsertThread } from '@/lib/inbox/core';
import { searchInbox } from '@/lib/inbox/search';
import type { InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const phone = () => `10${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const at = (min: number) => new Date(Date.UTC(2026, 10, 18, 10, min)).toISOString();

describe('rango de la búsqueda', () => {
  it('empieza con lo buscado, lo contiene o coincide solo por mensajes', async () => {
    const rank = chatNameRank('?', '?', 'ana_50%');
    // Comodines de LIKE escapados: se buscan como texto.
    expect(rank.args).toEqual(['ana\\_50\\%%', '% ana\\_50\\%%', '%ana\\_50\\%%', '%ana\\_50\\%%']);
    const r = chatNameRank('n', 'h', 'zor');
    const of = async (name: string, handle: string) =>
      ((await getDb().prepare(`SELECT ${r.sql} AS k FROM (SELECT ? AS n, ? AS h)`).get(...r.args, name, handle)) as { k: string }).k;
    expect(await of('Zorbak Demo', '')).toBe('2');
    expect(await of('Club zorbak', '')).toBe('2');
    expect(await of('Prezorbak', '')).toBe('1');
    expect(await of('', 'zor@example.test')).toBe('1');
    expect(await of('Otra persona', '100000')).toBe('0');
    expect(isNameHit('22026-11-18T10:00:00.000Z')).toBe(true);
    expect(isNameHit('02026-11-18T10:00:00.000Z')).toBe(false);
  });
});

describe('Inbox: buscar en la lista', () => {
  async function setup() {
    const owner = (await makeUser('ibq')).id;
    const acc = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const word = `zorbak${uniq()}`;
    const thread = async (title: string, body: string | null, min: number) => {
      const th = await upsertThread(acc, { externalId: `${phone()}@s.whatsapp.net`, kind: 'dm', title });
      if (body !== null) await addMessage(th, { externalId: `m-${uniq()}`, fromMe: false, senderName: title, body, sentAt: at(min) });
      return th.id;
    };
    // El que coincide por nombre es el más viejo; los que coinciden por mensajes son más nuevos.
    const byName = await thread(`${word} Viejo`, 'hola', 1);
    const inside = await thread(`Pre${word}`, 'hola', 2);
    const empty = await thread(`Club ${word}`, null, 0);
    const pinned = await thread('Fijado Demo', `te paso el ${word} mañana`, 5);
    const byMessage: string[] = [];
    for (let i = 0; i < 5; i++) byMessage.push(await thread(`Contacto ${i}`, `vimos el ${word} ayer`, 10 + i));
    await applyThreadAction(owner, [pinned], { action: 'pin' });
    return { owner, acc, word, byName, inside, empty, pinned, byMessage };
  }

  it('el nombre va primero aunque sea viejo, y un fijado que coincide por mensajes no se adelanta', async () => {
    const s = await setup();
    const page = await listThreadsPage(s.owner, { q: s.word, limit: 50 });
    // Nombre que empieza con lo buscado (con mensajes y sin), nombre que lo contiene, y después los mensajes por actividad.
    expect(page.threads.map((t) => t.id)).toEqual([s.byName, s.empty, s.inside, ...[...s.byMessage].reverse(), s.pinned]);
    expect(page.pinned).toBe(0);
    expect(page.threads.map((t) => t.nameHit)).toEqual([true, true, true, false, false, false, false, false, false]);
  });

  it('por páginas: cada fila una vez y en el mismo orden', async () => {
    const s = await setup();
    const all = (await listThreadsPage(s.owner, { q: s.word, limit: 50 })).threads.map((t) => t.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    let first: string[] = [];
    for (let i = 0; i < 20; i++) {
      const page = await listThreadsPage(s.owner, { q: s.word, limit: 2, cursor });
      if (i === 0) first = page.threads.map((t) => t.id);
      seen.push(...page.threads.map((t) => t.id));
      cursor = page.next;
      if (!cursor) break;
    }
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
    // Los que coinciden por nombre entran en la primera página, por viejos que sean.
    expect(first).toEqual([s.byName, s.empty]);
  });

  it('sin búsqueda el orden no cambia: fijados primero y después por actividad', async () => {
    const s = await setup();
    const page = await listThreadsPage(s.owner, { limit: 50 });
    expect(page.threads.map((t) => t.id)).toEqual([s.pinned, ...[...s.byMessage].reverse(), s.inside, s.byName, s.empty]);
    expect(page.pinned).toBe(1);
    expect(page.threads.every((t) => t.nameHit === undefined)).toBe(true);
  });

  it('Cmd+K: el chat que coincide por nombre va antes que el que coincide por la vista previa', async () => {
    const s = await setup();
    const hits = await searchInbox(s.owner, s.word, 3);
    const chats = hits.filter((h) => h.href.includes('?t=') && !h.href.includes('&m=')).map((h) => h.id);
    // Los tres lugares son para los que coinciden por nombre (los que empiezan con lo buscado, antes), no para los más nuevos.
    expect(chats).toHaveLength(3);
    expect(new Set(chats.slice(0, 2))).toEqual(new Set([s.byName, s.empty]));
    expect(chats[2]).toBe(s.inside);
  });
  it('el mismo chat en dos cuentas sigue siendo una fila al buscar, y va con los de nombre', async () => {
    const s = await setup();
    const acc = await createAccount(s.owner, { kind: 'whatsapp', provider: 'fake', label: 'Trabajo' });
    const jid = `${phone()}@s.whatsapp.net`;
    const ids: string[] = [];
    for (const [account, min] of [[s.acc, 3], [acc, 4]] as const) {
      const th = await upsertThread(account, { externalId: jid, kind: 'dm', title: `${s.word} Doble` });
      await addMessage(th, { externalId: `m-${uniq()}`, fromMe: false, senderName: 'Doble', body: 'hola', sentAt: at(min) });
      ids.push(th.id);
    }
    const page = await listThreadsPage(s.owner, { q: s.word, limit: 50 });
    const got = page.threads.map((t) => t.id);
    // Encabeza la cuenta con actividad más nueva; la otra no se repite.
    expect(got.slice(0, 2)).toEqual([ids[1], s.byName]);
    expect(got).not.toContain(ids[0]);
    expect(page.threads[0].lines).toHaveLength(2);
    // Por páginas tampoco se repite.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const pg = await listThreadsPage(s.owner, { q: s.word, limit: 1, cursor });
      seen.push(...pg.threads.map((t) => t.id));
      cursor = pg.next;
      if (!cursor) break;
    }
    expect(seen).toEqual(got);
  });
});

describe('Lines: buscar en la lista', () => {
  async function setup() {
    const ws = (await makeUser('lnq')).id;
    const n = await createNumber(ws, ws, { provider: 'fake', name: 'Ventas' });
    await connectNumber(ws, n.id);
    const state = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (state) state.connectedAt = Date.now() - 5000;
    const line = (await getNumberRowById(n.id))!;
    const word = `zorbak${uniq()}`;
    const chat = async (name: string, body: string, min: number, on = line, p = phone()) => {
      const event = {
        type: 'message',
        chatId: `${p}@c.us`,
        isGroup: false,
        fromMe: false,
        senderPhone: p,
        senderName: name,
        providerMessageId: `m-${uniq()}`,
        body,
        timestamp: at(min),
      } as InboundEvent;
      await ingestEvents(on, [event]);
      const row = (await getDb().prepare('SELECT id, name FROM groups_chats WHERE user_id = ? AND phone = ? AND number_id = ?').get(ws, p, on.id)) as { id: string; name: string };
      expect(row.name).toBe(name);
      return { id: row.id, phone: p };
    };
    const byName = await chat(`${word} Viejo`, 'hola', 1);
    const inside = await chat(`Pre${word}`, 'hola', 2);
    const pinned = await chat('Fijado Demo', `te paso el ${word} mañana`, 5);
    const byMessage: string[] = [];
    for (let i = 0; i < 5; i++) byMessage.push((await chat(`Contacto ${i}`, `vimos el ${word} ayer`, 10 + i)).id);
    await updateChat(ws, pinned.id, { pinned: true });
    return { ws, word, byName, inside, pinned, byMessage, chat };
  }

  it('el nombre va primero aunque sea viejo, y un fijado que coincide por mensajes no se adelanta', async () => {
    const s = await setup();
    const want = [s.byName.id, s.inside.id, ...[...s.byMessage].reverse(), s.pinned.id];
    const page = await listChats(s.ws, s.ws, { q: s.word, cursor: '', limit: 50 });
    expect(page.rows.map((r) => r.id)).toEqual(want);
    expect(page.pinned).toBe(0);
    // Los que coinciden por mensajes traen el fragmento; los de nombre, no.
    expect(page.rows.map((r) => Boolean(r.match))).toEqual([false, false, true, true, true, true, true, true]);
    // La lista sin cursor (API pública, MCP) ordena igual.
    expect((await listChats(s.ws, s.ws, { q: s.word, limit: 50 })).rows.map((r) => r.id)).toEqual(want);
    const offsetPages = [
      ...(await listChats(s.ws, s.ws, { q: s.word, limit: 3 })).rows,
      ...(await listChats(s.ws, s.ws, { q: s.word, limit: 3, offset: 3 })).rows,
      ...(await listChats(s.ws, s.ws, { q: s.word, limit: 3, offset: 6 })).rows,
    ];
    expect(offsetPages.map((r) => r.id)).toEqual(want);
  });

  it('por páginas: cada fila una vez y en el mismo orden', async () => {
    const s = await setup();
    const all = (await listChats(s.ws, s.ws, { q: s.word, cursor: '', limit: 50 })).rows.map((r) => r.id);
    const seen: string[] = [];
    let cursor: string | null = '';
    let first: string[] = [];
    for (let i = 0; i < 20; i++) {
      const page = await listChats(s.ws, s.ws, { q: s.word, cursor, limit: 2 });
      if (i === 0) first = page.rows.map((r) => r.id);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.next ?? null;
      if (!cursor) break;
    }
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
    expect(first).toEqual([s.byName.id, s.inside.id]);
  });

  it('el mismo chat en dos líneas sigue siendo una fila al buscar, y va con los de nombre', async () => {
    const s = await setup();
    const n = await createNumber(s.ws, s.ws, { provider: 'fake', name: 'Soporte' });
    await connectNumber(s.ws, n.id);
    const state = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (state) state.connectedAt = Date.now() - 5000;
    const other = (await getNumberRowById(n.id))!;
    const p = phone();
    const a = await s.chat(`${s.word} Doble`, 'hola', 3, undefined, p);
    const b = await s.chat(`${s.word} Doble`, 'hola', 4, other, p);
    const page = await listChats(s.ws, s.ws, { q: s.word, cursor: '', limit: 50 });
    const got = page.rows.map((r) => r.id);
    expect(got.slice(0, 2)).toEqual([b.id, s.byName.id]);
    expect(got).not.toContain(a.id);
    expect(page.rows[0].lines).toHaveLength(2);
    const seen: string[] = [];
    let cursor: string | null = '';
    for (let i = 0; i < 20; i++) {
      const pg = await listChats(s.ws, s.ws, { q: s.word, cursor, limit: 1 });
      seen.push(...pg.rows.map((r) => r.id));
      cursor = pg.next ?? null;
      if (!cursor) break;
    }
    expect(seen).toEqual(got);
  });

  it('el teléfono cuenta como el nombre', async () => {
    const s = await setup();
    const rows = (await listChats(s.ws, s.ws, { q: s.inside.phone, cursor: '', limit: 50 })).rows;
    expect(rows.map((r) => r.id)).toEqual([s.inside.id]);
    expect(rows[0].match).toBeUndefined();
  });

  it('sin búsqueda el orden no cambia: fijados primero y después por actividad', async () => {
    const s = await setup();
    const want = [s.pinned.id, ...[...s.byMessage].reverse(), s.inside.id, s.byName.id];
    const page = await listChats(s.ws, s.ws, { cursor: '', limit: 50 });
    expect(page.rows.map((r) => r.id)).toEqual(want);
    expect(page.pinned).toBe(1);
    expect((await listChats(s.ws, s.ws, { limit: 50 })).rows.map((r) => r.id)).toEqual(want);
  });
});
