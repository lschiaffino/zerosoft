import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteMentionToken, mentionAlreadyDone, serializeWaMentions, waMentionables, waMentionHits, waMentionLabel } from '@/lib/wa-compose-mentions';
import { mentionQueryAt, mentionSuggestions } from '@/lib/crm-mentions';
import { type FetchLike } from '@/lib/groups-provider';
import { evolutionProvider, wahaProvider } from '@/lib/groups-provider-bridge';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { cleanMentions, connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, retryMessage, sendMessage } from '@/lib/groups';
import { getDb } from '@/lib/db';
import { mentionYou } from '@/lib/wa-mentions';
import { mentionSelf, rememberContacts, resolveTextMentions } from '@/lib/wa-contacts';
import { createAccount } from '@/lib/inbox/core';
import { makeUser } from './helpers';

const members = [
  { phone: '5491155550001', name: 'Ezequiel Sculli' },
  { phone: '5491155550002', name: 'Ana' },
  { phone: '5491155550003', name: 'Ana María' },
  { phone: '5491155550004', name: '' },
];

describe('menciones al escribir', () => {
  it('etiqueta: el nombre en un renglón o, sin nombre, el teléfono', () => {
    expect(waMentionLabel({ phone: '549', name: '  Ezequiel \n Sculli ' })).toBe('Ezequiel Sculli');
    expect(waMentionLabel({ phone: '5491155550004', name: '' })).toBe('5491155550004');
  });

  it('serializa "@Nombre" como "@<teléfono>" con la lista de mencionados', () => {
    const people = waMentionables(members);
    expect(serializeWaMentions('Hola @Ezequiel Sculli, ¿viste?', people)).toEqual({ body: 'Hola @5491155550001, ¿viste?', mentions: ['5491155550001'] });
    // El nombre más largo gana; sin repetir; sin importar mayúsculas.
    expect(serializeWaMentions('@ana maría y @Ana y @Ana', people)).toEqual({ body: '@5491155550003 y @5491155550002 y @5491155550002', mentions: ['5491155550003', '5491155550002'] });
    // Sin nombre: se escribe el teléfono, que ya es la mención.
    expect(serializeWaMentions('cc @5491155550004', people)).toEqual({ body: 'cc @5491155550004', mentions: ['5491155550004'] });
    // Un email o un nombre a medias no menciona.
    expect(serializeWaMentions('ana@Ana.com y @Ezequiel Scu', people)).toEqual({ body: 'ana@Ana.com y @Ezequiel Scu', mentions: [] });
  });

  it('lo elegido de la lista gana entre dos personas con el mismo nombre', () => {
    const twins = [
      { phone: '5491100000001', name: 'Juan' },
      { phone: '5491100000002', name: 'Juan' },
    ];
    expect(serializeWaMentions('@Juan', waMentionables(twins)).mentions).toEqual(['5491100000001']);
    expect(serializeWaMentions('@Juan', waMentionables(twins, new Map([['Juan', '5491100000002']]))).mentions).toEqual(['5491100000002']);
  });

  it('tramos para pintar en el campo', () => {
    const text = 'Hola @Ana y @Ezequiel Sculli';
    expect(waMentionHits(text, waMentionables(members)).map((h) => text.slice(h.start, h.end))).toEqual(['@Ana', '@Ezequiel Sculli']);
  });

  it('borrar contra una mención la saca entera', () => {
    const text = 'Hola @Ana chau';
    const hits = waMentionHits(text, waMentionables(members));
    // Backspace al final de la mención y dentro.
    expect(deleteMentionToken(text, 9, 9, 'Backspace', hits)).toEqual({ text: 'Hola  chau', caret: 5 });
    expect(deleteMentionToken(text, 7, 7, 'Backspace', hits)).toEqual({ text: 'Hola  chau', caret: 5 });
    // Backspace justo antes del "@": borra lo de antes como siempre.
    expect(deleteMentionToken(text, 5, 5, 'Backspace', hits)).toBeNull();
    // Supr al principio.
    expect(deleteMentionToken(text, 5, 5, 'Delete', hits)).toEqual({ text: 'Hola  chau', caret: 5 });
    expect(deleteMentionToken(text, 9, 9, 'Delete', hits)).toBeNull();
    // Selección que toca la mención: se va la mención completa.
    expect(deleteMentionToken(text, 2, 7, 'Backspace', hits)).toEqual({ text: 'Ho chau', caret: 2 });
  });

  it('la lista: se filtra al escribir (nombre o teléfono) y no vuelve a abrirse después de elegir', () => {
    const people = waMentionables(members);
    expect(mentionSuggestions('ezeq', people, 50).map((p) => p.id)).toEqual(['5491155550001']);
    expect(mentionSuggestions('sculli', people, 50).map((p) => p.id)).toEqual(['5491155550001']);
    expect(mentionSuggestions('54911555500', people, 50)).toHaveLength(4);
    const text = 'Hola @Ezequiel Sculli ';
    const q = mentionQueryAt(text, text.length)!;
    expect(q.start).toBe(5);
    expect(mentionAlreadyDone(q.start, text.length, waMentionHits(text, people))).toBe(true);
    expect(mentionAlreadyDone(q.start, text.length - 1, waMentionHits(text, people))).toBe(false);
  });

  it('el servidor solo manda los teléfonos que están en el texto, y solo en grupos', () => {
    expect(cleanMentions(['5491155550001', '5491155550002', 'x', '5491155550001'], 'hola @5491155550001', 'group')).toEqual(['5491155550001']);
    expect(cleanMentions(['5491155550001'], 'hola @54911555500012', 'group')).toEqual([]);
    expect(cleanMentions(['5491155550001'], 'hola @5491155550001', 'dm')).toEqual([]);
    expect(cleanMentions('5491155550001', 'hola @5491155550001', 'group')).toEqual([]);
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

describe('menciones: lo que sale a WhatsApp', () => {
  it('Evolution: "mentioned" con los teléfonos; WAHA: "mentions" con ids', async () => {
    const evo = mockFetch();
    await evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'acme' }, { fetch: evo.f }).sendText('123@g.us', 'hola @5491155550001', { mentions: ['5491155550001'] });
    expect(evo.calls[0].body).toMatchObject({ number: '123@g.us', text: 'hola @5491155550001', mentioned: ['5491155550001'] });
    const waha = mockFetch();
    await wahaProvider({ baseUrl: 'https://waha.example.com', apiKey: 'k', session: 'acme' }, { fetch: waha.f }).sendText('123@g.us', 'hola @5491155550001', { mentions: ['5491155550001'] });
    expect(waha.calls[0].body).toMatchObject({ chatId: '123@g.us', mentions: ['5491155550001@c.us'] });
  });

  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetFakeProvider();
  });

  it('Lines manda la mención, la guarda y la vuelve a mandar al reintentar', async () => {
    const user = await makeUser('wa-mention-send');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const st = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (st) st.connectedAt = Date.now() - 5000;
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, [
      { type: 'message', chatId: '120363000000000001@g.us', isGroup: true, fromMe: false, senderPhone: '5491155550001', senderName: 'Ezequiel Sculli', providerMessageId: 'G-1', body: 'hola' },
    ]);
    const chat = (await listChats(user.id, user.id)).rows.find((c) => c.kind === 'group')!;
    const sent = await sendMessage(user.id, user.id, chat.id, { body: 'Dale @5491155550001', mentions: ['5491155550001', '5491100000009'] });
    expect(sent.status).toBe('sent');
    const out = fakeSent(n.id).filter((s) => s.kind === 'text');
    expect(out.at(-1)).toMatchObject({ text: 'Dale @5491155550001', mentions: ['5491155550001'] });
    // Guardada como las que llegan: el hilo la muestra con el nombre.
    const saved = (await listMessages(user.id, chat.id)).find((m) => m.id === sent.id)!;
    expect(saved.meta).toMatchObject({ mentions: ['5491155550001'] });
    expect(saved.mentionNames?.['5491155550001']?.name).toBe('Ezequiel Sculli');

    // Reintento de un envío que falló: sale otra vez con la mención.
    await getDb().prepare("UPDATE groups_messages SET status = 'failed' WHERE id = ?").run(sent.id);
    await retryMessage(user.id, user.id, sent.id);
    expect(fakeSent(n.id).filter((s) => s.kind === 'text').at(-1)).toMatchObject({ mentions: ['5491155550001'] });
  });
});

describe('vista previa de la lista: una mención a la cuenta misma', () => {
  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetFakeProvider();
  });

  it('"Vos" en el idioma de la persona', () => {
    expect(mentionYou('es-AR')).toBe('Vos');
    expect(mentionYou('pt-BR')).toBe('Você');
    expect(mentionYou(null)).toBe('You');
  });

  it('Inbox: "@Vos" para el teléfono de la cuenta y para un lid de ese teléfono, como la burbuja', async () => {
    const user = await makeUser('wa-self-inbox');
    await getDb().prepare("UPDATE users SET locale = 'es' WHERE id = ?").run(user.id);
    const acc = await createAccount(user.id, { kind: 'whatsapp', provider: 'fake', address: '+54 9 11 4928-7832' });
    const lid = '700000000000777';
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: user.id }, [{ phone: '5491149287832', lid }, { phone: '5491155550001', push: 'Mari' }]);
    const [own, viaLid, other] = await resolveTextMentions(
      'inbox',
      [
        { accountId: acc.id, text: 'Mari: @5491149287832 quiero hablar' },
        { accountId: acc.id, text: `@${lid} mirá` },
        { accountId: acc.id, text: '@5491155550001 dale' },
      ],
      { self: mentionSelf('inbox', user.id) },
    );
    expect(own).toBe('Mari: @Vos quiero hablar');
    expect(viaLid).toBe('@Vos mirá');
    expect(other).toBe('@Mari dale');
  });

  it('Lines: la lista muestra el nombre de la línea (como la burbuja), no el teléfono', async () => {
    const user = await makeUser('wa-self-lines');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    await getDb().prepare("UPDATE groups_numbers SET phone = '5491149287832', name = 'Soporte' WHERE id = ?").run(n.id);
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, [
      {
        type: 'message',
        chatId: '120363000000000777@g.us',
        isGroup: true,
        fromMe: false,
        senderPhone: '5491155550001',
        senderName: 'Mari',
        providerMessageId: 'S-1',
        body: '@5491149287832 quiero hablar',
        mentions: ['5491149287832'],
      },
    ]);
    const preview = async () => (await listChats(user.id, user.id)).rows.find((c) => c.kind === 'group')!.lastMessagePreview;
    expect(await preview()).toContain('@Soporte quiero hablar');
    expect(await preview()).not.toContain('5491149287832');
    // Sin nombre de línea: "@Vos" en el idioma de la persona (acá, inglés).
    await getDb().prepare("UPDATE groups_numbers SET name = '' WHERE id = ?").run(n.id);
    expect(await preview()).toContain('@You quiero hablar');
  });
});
