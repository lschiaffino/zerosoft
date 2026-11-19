/**
 * Buscar un chat por nombre, como en WhatsApp: el nombre coincide si tiene
 * todas las palabras buscadas, en cualquier orden y sin importar comas ni
 * otros signos. Un teléfono se encuentra aunque se escriba con +, espacios o
 * guiones. Nombres y teléfonos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatNameHit, chatNameRank, matchesChatName, searchDigits, searchWords } from '@/lib/chat-search-rank';
import { getDb } from '@/lib/db';
import { addMessage, createAccount, listThreadsPage, upsertThread } from '@/lib/inbox/core';
import { searchInbox } from '@/lib/inbox/search';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function sqlHit(name: string, handle: string, q: string): Promise<{ hit: boolean; rank: string }> {
  const h = chatNameHit('n', 'h', q);
  const r = chatNameRank('n', 'h', q);
  const row = (await getDb()
    .prepare(`SELECT ${h.sql} AS hit, ${r.sql} AS rank FROM (SELECT ? AS n, ? AS h)`)
    .get(...h.args, ...r.args, name, handle)) as { hit: number; rank: string };
  return { hit: row.hit === 1, rank: row.rank };
}

describe('palabras de la búsqueda', () => {
  it('saca la puntuación y los repetidos', () => {
    expect(searchWords('Pol eze  lauta')).toEqual(['pol', 'eze', 'lauta']);
    expect(searchWords('pol, eze; (LAUTA) pol')).toEqual(['pol', 'eze', 'lauta']);
    expect(searchWords('Mari <> Demo')).toEqual(['mari', 'demo']);
    expect(searchWords('  ')).toEqual([]);
  });

  it('un teléfono con signos queda en dígitos; un texto no es un teléfono', () => {
    expect(searchDigits('+10 (555) 010-2030')).toBe('105550102030');
    expect(searchDigits('555 01')).toBe('55501');
    expect(searchDigits('12')).toBe('');
    expect(searchDigits('casa 555')).toBe('');
  });
});

describe('el nombre coincide por palabras, en cualquier orden', () => {
  it('con comas en el nombre y otro orden', async () => {
    for (const name of ['Pol, Eze, Lauta', 'Eze, Pol, Lauta']) {
      expect(await sqlHit(name, '', 'Pol eze lauta')).toEqual({ hit: true, rank: '2' });
      expect(await sqlHit(name, '', 'lauta pol')).toEqual({ hit: true, rank: '2' });
      expect(matchesChatName(name, '', 'Pol eze lauta')).toBe(true);
    }
  });

  it('todas las palabras tienen que estar', async () => {
    expect(await sqlHit('Pol, Eze, Lauta', '', 'pol marta')).toEqual({ hit: false, rank: '0' });
    expect(matchesChatName('Pol, Eze, Lauta', '', 'pol marta')).toBe(false);
  });

  it('una palabra en medio de otra coincide, pero después de las que empiezan palabra', async () => {
    expect(await sqlHit('Apolo y Ezequiel', '', 'pol eze')).toEqual({ hit: true, rank: '1' });
    expect(await sqlHit('Pol, Ezequiel', '', 'pol eze')).toEqual({ hit: true, rank: '2' });
  });

  it('el teléfono coincide escrito con +, espacios y guiones', async () => {
    expect(await sqlHit('Sin nombre', '105550102030@s.whatsapp.net', '+10 555 010-2030')).toEqual({ hit: true, rank: '1' });
    expect(matchesChatName('Sin nombre', '105550102030', '+10 (555) 010 2030')).toBe(true);
    expect(await sqlHit('Sin nombre', '105550102030@s.whatsapp.net', '+10 999')).toEqual({ hit: false, rank: '0' });
  });
});

describe('Inbox: lista y Cmd+K', () => {
  it('"pol eze lauta" encuentra el grupo "Pol, Eze, Lauta" antes que el chat que solo lo dice en un mensaje', async () => {
    const owner = (await makeUser('ibw')).id;
    const acc = await createAccount(owner, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    const tag = `zq${uniq()}`;
    const group = await upsertThread(acc, { externalId: `1203630000${Math.floor(1e8 + Math.random() * 8e8)}@g.us`, kind: 'group', title: `${tag}pol, Eze, Lauta` });
    await addMessage(group, { externalId: `m-${uniq()}`, fromMe: false, senderName: 'Eze', body: 'buen finde', sentAt: '2026-11-10T10:00:00.000Z' });
    const other = await upsertThread(acc, { externalId: `10${Math.floor(1e8 + Math.random() * 8e8)}@s.whatsapp.net`, kind: 'dm', title: 'Marta Demo' });
    await addMessage(other, { externalId: `m-${uniq()}`, fromMe: false, senderName: 'Marta', body: `experiencia lauta y eze, reforzar ${tag}pol`, sentAt: '2026-11-18T10:00:00.000Z' });
    const q = `${tag}pol eze lauta`;
    const page = await listThreadsPage(owner, { q });
    expect(page.threads[0]?.id).toBe(group.id);
    expect(page.threads[0]?.nameHit).toBe(true);
    const hits = await searchInbox(owner, q);
    expect(hits.find((h) => h.href.includes(encodeURIComponent(group.id)))?.label).toContain('Eze, Lauta');
  });
});
