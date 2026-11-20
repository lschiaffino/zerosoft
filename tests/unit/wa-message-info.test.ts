/**
 * Info del mensaje (Lines e Inbox): las confirmaciones por persona
 * (lib/wa-receipts.ts, lib/wa-receipts-store.ts), lo que da el gateway con el
 * parche 0014 (pedido a demanda, con el proveedor falso) y lo que ve cada
 * quien (acceso por línea y teléfonos ocultos). Números y nombres inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { collapseReceipts, gatewayInputs, infoSections, mergeReceipt, receiptTime, shownTimes, type WaReceiptPerson } from '@/lib/wa-receipts';
import { fetchLiveReceipts, receiptRows, resetReceiptFetchState, storeReceipts } from '@/lib/wa-receipts-store';
import { evolutionProvider, parseEvolutionReceipts } from '@/lib/groups-provider-bridge';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages } from '@/lib/groups';
import { linesMessageInfo } from '@/lib/groups-receipts';
import { DEFAULT_PLATFORM, systemViewer, viewerFrom } from '@/lib/groups-access';
import { fakeReceiptRequests, resetFakeProvider } from '@/lib/groups-provider-fake';
import type { GatewayReceipt } from '@/lib/wa-receipts';
import type { InboundEvent } from '@/lib/groups-provider';
import { rememberContacts } from '@/lib/wa-contacts';
import { addMessage, createAccount, getAccountById, upsertThread } from '@/lib/inbox/core';
import { ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { inboxMessageInfo } from '@/lib/inbox/wa-receipts';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetReceiptFetchState();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ME = '15550000001';
const ANA = '5491177730011';
const BETO = '5491177730022';
const CARLA_LID = '210987654321098';
const T1 = '2026-11-18T10:00:00.000Z';
const T2 = '2026-11-18T10:05:00.000Z';
const T3 = '2026-11-18T10:09:00.000Z';

type FakeStateLike = { connectedAt: number | null; receipts?: Map<string, GatewayReceipt[]>; receiptsUnsupported?: boolean };
const fakeState = (key: string) => (globalThis as unknown as { __groupsFake: Map<string, FakeStateLike> }).__groupsFake.get(key)!;

describe('confirmaciones (puro)', () => {
  it('entregado y después leído: quedan las dos horas', () => {
    const a = mergeReceipt(undefined, { deliveredAt: T1 });
    const b = mergeReceipt(a.times, { readAt: T2 });
    expect(b).toEqual({ times: { deliveredAt: T1, readAt: T2, playedAt: null }, changed: true });
  });

  it('fuera de orden: leído antes que entregado, cada una en su lugar', () => {
    const a = mergeReceipt(undefined, { readAt: T2 });
    const b = mergeReceipt(a.times, { deliveredAt: T1 });
    expect(b.times).toEqual({ deliveredAt: T1, readAt: T2, playedAt: null });
  });

  it('repetidas: la primera hora gana y no cambia nada', () => {
    const a = mergeReceipt(undefined, { deliveredAt: T1, readAt: T2 });
    expect(mergeReceipt(a.times, { deliveredAt: T1, readAt: T2 }).changed).toBe(false);
    // Una más nueva del mismo estado (reintento del webhook) no pisa la primera.
    expect(mergeReceipt(a.times, { readAt: T3 })).toEqual({ times: a.times, changed: false });
    // Una más vieja sí (llegó tarde la primera).
    expect(mergeReceipt(a.times, { deliveredAt: '2026-11-18T09:59:00.000Z' }).times.deliveredAt).toBe('2026-11-18T09:59:00.000Z');
  });

  it('una tanda con la misma persona repetida queda en una fila', () => {
    const m = collapseReceipts([
      { participant: ANA, deliveredAt: T2 },
      { participant: ANA, deliveredAt: T1 },
      { participant: ANA, readAt: T3 },
      { participant: BETO, deliveredAt: T1 },
    ]);
    expect(m.size).toBe(2);
    expect(m.get(ANA)).toEqual({ deliveredAt: T1, readAt: T3, playedAt: null });
  });

  it('quien leyó también recibió, y quien escuchó también leyó', () => {
    expect(shownTimes({ deliveredAt: null, readAt: T2, playedAt: null })).toEqual({ deliveredAt: T2, readAt: T2, playedAt: null });
    expect(shownTimes({ deliveredAt: T1, readAt: null, playedAt: T3 })).toEqual({ deliveredAt: T1, readAt: T3, playedAt: T3 });
  });

  it('horas: segundos Unix, ISO y la forma de la base; basura y fechas imposibles no', () => {
    expect(receiptTime(1763460000)).toBe(new Date(1763460000 * 1000).toISOString());
    expect(receiptTime('2026-11-18 10:00:00')).toBe(T1);
    expect(receiptTime('nada')).toBeNull();
    expect(receiptTime(0)).toBeNull();
    expect(receiptTime(new Date(Date.now() + 3 * 86_400_000).toISOString())).toBeNull();
  });

  it('secciones: cada persona en la más avanzada, lo más nuevo arriba; escuchado solo en un audio', () => {
    const p = (key: string, t: Partial<WaReceiptPerson>): WaReceiptPerson => ({ key, name: key, pushName: false, phone: '', picture: '', deliveredAt: null, readAt: null, playedAt: null, ...t });
    const people = [p('a', { deliveredAt: T1 }), p('b', { deliveredAt: T1, readAt: T2 }), p('c', { readAt: T3 }), p('d', { playedAt: T3 })];
    const s = infoSections(people, false);
    expect(s.read.map((x) => x.key)).toEqual(['c', 'd', 'b']);
    expect(s.delivered.map((x) => x.key)).toEqual(['a']);
    expect(s.played).toEqual([]);
    const v = infoSections(people, true);
    expect(v.played.map((x) => x.key)).toEqual(['d']);
    expect(v.read.map((x) => x.key)).toEqual(['c', 'b']);
  });

  it('del gateway: teléfono si lo sabe, si no el lid; sin la propia línea ni filas vacías', () => {
    const list = gatewayInputs(
      [
        { phone: ANA, deliveredAt: T1 },
        { lid: CARLA_LID, readAt: T2 },
        { phone: ME, readAt: T2 },
        { phone: BETO },
        { phone: '12', readAt: T2 },
      ],
      `+${ME}`,
    );
    expect(list).toEqual([
      { participant: ANA, deliveredAt: T1, readAt: null, playedAt: null },
      { participant: `lid:${CARLA_LID}`, deliveredAt: null, readAt: T2, playedAt: null },
    ]);
  });
});

describe('gateway: /chat/messageReceipts (parche 0014)', () => {
  it('lee la respuesta: jid de teléfono o lid (con el teléfono si el gateway lo sabe), horas en segundos', () => {
    const out = parseEvolutionReceipts({
      receipts: [
        { userJid: `${ANA}@s.whatsapp.net`, deliveredAt: 1763460000, readAt: 1763460300 },
        { userJid: `${CARLA_LID}@lid`, phone: `${BETO}@s.whatsapp.net`, playedAt: 1763460540 },
        { userJid: `${CARLA_LID}:3@lid`, readAt: 1763460300 },
        { userJid: 'roto' },
      ],
    });
    expect(out).toEqual([
      { phone: ANA, deliveredAt: new Date(1763460000_000).toISOString(), readAt: new Date(1763460300_000).toISOString() },
      { phone: BETO, lid: CARLA_LID, playedAt: new Date(1763460540_000).toISOString() },
      { lid: CARLA_LID, readAt: new Date(1763460300_000).toISOString() },
    ]);
    expect(parseEvolutionReceipts(null)).toEqual([]);
  });

  it('un gateway sin el parche responde 404: null (la app muestra lo guardado)', async () => {
    const calls: string[] = [];
    const fetch404 = async (url: string) => {
      calls.push(url);
      return new Response('{"status":404,"error":"Not Found"}', { status: 404, headers: { 'content-type': 'application/json' } });
    };
    const p = evolutionProvider({ baseUrl: 'https://gw.example.test', apiKey: 'k', session: 'linea' }, { fetch: fetch404 });
    expect(await p.messageReceipts!('120363000000000903@g.us', 'ABC')).toBeNull();
    expect(calls[0]).toContain('/chat/messageReceipts/linea');

    const fetchOk = async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ id: 'ABC', remoteJid: '120363000000000903@g.us' });
      return new Response(JSON.stringify({ receipts: [{ userJid: `${ANA}@s.whatsapp.net`, readAt: 1763460300 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const ok = evolutionProvider({ baseUrl: 'https://gw.example.test', apiKey: 'k', session: 'linea' }, { fetch: fetchOk });
    expect(await ok.messageReceipts!('120363000000000903@g.us', 'ABC')).toEqual([{ phone: ANA, readAt: new Date(1763460300_000).toISOString() }]);
  });

  it('a demanda con freno: un pedido por mensaje cada 15 s, y una línea sin soporte no se vuelve a probar', async () => {
    let n = 0;
    let answer: GatewayReceipt[] | null = [{ phone: ANA, readAt: T2 }];
    const provider = { messageReceipts: async () => (n++, answer) } as unknown as Parameters<typeof fetchLiveReceipts>[0];
    const now = Date.now();
    expect(await fetchLiveReceipts(provider, 'l1', 'g@g.us', 'm1', now)).toEqual({ kind: 'ok', list: [{ phone: ANA, readAt: T2 }] });
    expect(await fetchLiveReceipts(provider, 'l1', 'g@g.us', 'm1', now + 1000)).toEqual({ kind: 'recent' });
    expect(n).toBe(1);
    expect((await fetchLiveReceipts(provider, 'l1', 'g@g.us', 'm1', now + 16_000)).kind).toBe('ok');
    expect(n).toBe(2);
    answer = null;
    expect(await fetchLiveReceipts(provider, 'l2', 'g@g.us', 'm2', now)).toEqual({ kind: 'unsupported' });
    expect(await fetchLiveReceipts(provider, 'l2', 'g@g.us', 'm3', now + 1000)).toEqual({ kind: 'unsupported' });
    expect(n).toBe(3);
    // Apagado sin deploy del gateway.
    vi.stubEnv('WA_GROUP_RECEIPTS_FETCH', '0');
    expect(await fetchLiveReceipts(provider, 'l3', 'g@g.us', 'm4', now)).toEqual({ kind: 'skipped' });
    expect(n).toBe(3);
  });
});

describe('guardado', () => {
  it('escribe solo lo que cambia y se queda con la primera hora', async () => {
    const id = `msg-${Math.random().toString(36).slice(2)}`;
    expect(await storeReceipts('lines', 'ws-x', id, [{ participant: ANA, deliveredAt: T2 }, { participant: BETO, readAt: T2 }])).toBe(2);
    expect(await storeReceipts('lines', 'ws-x', id, [{ participant: ANA, deliveredAt: T2 }, { participant: BETO, readAt: T3 }])).toBe(0);
    expect(await storeReceipts('lines', 'ws-x', id, [{ participant: ANA, deliveredAt: T1, readAt: T3 }])).toBe(1);
    const rows = await receiptRows('lines', id);
    expect(rows.find((r) => r.participant === ANA)).toMatchObject({ deliveredAt: T1, readAt: T3 });
    expect(rows.find((r) => r.participant === BETO)).toMatchObject({ readAt: T2, deliveredAt: null });
    // Otra app con el mismo id de mensaje no se mezcla.
    expect(await receiptRows('inbox', id)).toEqual([]);
  });
});

describe('Lines: Info del mensaje', () => {
  const GROUP = '120363000000000904@g.us';
  function ev(over: Record<string, unknown>): InboundEvent {
    return {
      type: 'message',
      chatId: GROUP,
      isGroup: true,
      chatName: 'Compras',
      fromMe: true,
      senderPhone: ME,
      senderName: '',
      providerMessageId: `m-${Math.random().toString(36).slice(2)}`,
      body: 'hola',
      timestamp: new Date().toISOString(),
      ...over,
    } as InboundEvent;
  }

  async function setup(tag: string) {
    const user = await makeUser(`wainfo-${tag}`);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    fakeState(n.id).connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected', phone = ? WHERE id = ?").run(ME, n.id);
    const row = (await getNumberRowById(n.id))!;
    return { user, n, row };
  }

  it('grupo: pide al gateway, guarda y muestra cada persona con nombre y horas; con teléfonos ocultos no salen los dígitos', async () => {
    const { user, n, row } = await setup('g');
    await ingestEvents(row, [ev({ providerMessageId: 'out-1', body: 'pedido listo' })]);
    await ingestEvents(row, [ev({ fromMe: false, senderPhone: BETO, senderName: 'Beto Perfil', body: 'gracias' })]);
    await rememberContacts({ app: 'lines', accountId: n.id, userId: user.id }, [{ phone: ANA, saved: 'Ana Libreta' }]);
    fakeState(n.id).receipts = new Map([
      [
        'out-1',
        [
          { phone: ANA, deliveredAt: T1, readAt: T2 },
          { phone: BETO, deliveredAt: T1 },
          { phone: ME, readAt: T2 },
        ],
      ],
    ]);
    const chat = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Compras')!;
    const m = (await listMessages(user.id, chat.id)).find((x) => x.body === 'pedido listo')!;

    const info = await linesMessageInfo(systemViewer(user.id), chat.id, m.id);
    expect(info).toMatchObject({ group: true, live: true, unavailable: false });
    expect(info.people).toHaveLength(2);
    expect(info.people.find((p) => p.phone === ANA)).toMatchObject({ name: 'Ana Libreta', readAt: T2, deliveredAt: T1 });
    expect(info.people.find((p) => p.phone === BETO)).toMatchObject({ name: 'Beto Perfil', pushName: true, deliveredAt: T1, readAt: null });
    expect(fakeReceiptRequests(n.id)).toBe(1);
    expect((await receiptRows('lines', m.id)).length).toBe(2);

    // Quien no ve teléfonos: enmascarado, sin los dígitos en ningún campo (tampoco en la clave).
    const masked = { ...viewerFrom(user.id, user.id, 'member', { ...DEFAULT_PLATFORM, maskRoles: ['member'] }), linesScoped: false };
    const hidden = await linesMessageInfo(masked, chat.id, m.id);
    expect(hidden.people.every((p) => p.masked || !p.phone)).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain('77730011');
    expect(JSON.stringify(hidden)).not.toContain('77730022');
    // Abrirla otra vez enseguida no le vuelve a pedir al gateway.
    expect(fakeReceiptRequests(n.id)).toBe(1);
  });

  it('un miembro sin la línea, otro workspace o un mensaje recibido: 404', async () => {
    const { user, n, row } = await setup('a');
    const other = await makeUser('wainfo-a2');
    await ingestEvents(row, [ev({ providerMessageId: 'out-2', body: 'reservado' })]);
    await ingestEvents(row, [ev({ providerMessageId: 'in-2', fromMe: false, senderPhone: ANA, body: 'ok' })]);
    const chat = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Compras')!;
    const list = await listMessages(user.id, chat.id);
    const out = list.find((x) => x.body === 'reservado')!;
    const inbound = list.find((x) => x.body === 'ok')!;
    await getDb().prepare("UPDATE groups_numbers SET visibility = 'restricted' WHERE id = ?").run(n.id);
    const member = viewerFrom(user.id, `member-${Math.random().toString(36).slice(2)}`, 'member', DEFAULT_PLATFORM);
    await expect(linesMessageInfo(member, chat.id, out.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(linesMessageInfo(systemViewer(other.id), chat.id, out.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(linesMessageInfo(systemViewer(user.id), chat.id, inbound.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(fakeReceiptRequests(n.id)).toBe(0);
  });

  it('gateway sin el parche: lo guardado y, si no hay nada, el aviso', async () => {
    const { user, n, row } = await setup('u');
    fakeState(n.id).receiptsUnsupported = true;
    await ingestEvents(row, [ev({ providerMessageId: 'out-3', body: 'sin datos' }), ev({ providerMessageId: 'out-4', body: 'con datos' })]);
    const chat = (await listChats(user.id, user.id, { kind: 'group' })).rows.find((c) => c.name === 'Compras')!;
    const list = await listMessages(user.id, chat.id);
    const none = list.find((x) => x.body === 'sin datos')!;
    const some = list.find((x) => x.body === 'con datos')!;
    await storeReceipts('lines', user.id, some.id, [{ participant: ANA, readAt: T2 }]);
    expect(await linesMessageInfo(systemViewer(user.id), chat.id, none.id)).toMatchObject({ live: false, unavailable: true, people: [] });
    const withData = await linesMessageInfo(systemViewer(user.id), chat.id, some.id);
    expect(withData).toMatchObject({ live: false, unavailable: false });
    expect(withData.people[0]).toMatchObject({ phone: ANA, readAt: T2, deliveredAt: T2 });
    // La línea queda marcada: el segundo mensaje no volvió a probar.
    expect(fakeReceiptRequests(n.id)).toBe(1);
  });

  it('1:1: las tildes del webhook dejan entregado y leído con su hora; una repetida no escribe', async () => {
    const { user, row } = await setup('d');
    const DM = `${ANA}@s.whatsapp.net`;
    await ingestEvents(row, [ev({ chatId: DM, isGroup: false, chatName: undefined, providerMessageId: 'dm-1', body: 'te llamo' })]);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(T1));
      await ingestEvents(row, [{ type: 'status', providerMessageId: 'dm-1', status: 'delivered' }]);
      vi.setSystemTime(new Date(T2));
      await ingestEvents(row, [{ type: 'status', providerMessageId: 'dm-1', status: 'read' }]);
      vi.setSystemTime(new Date(T3));
      await ingestEvents(row, [{ type: 'status', providerMessageId: 'dm-1', status: 'delivered' }, { type: 'status', providerMessageId: 'dm-1', status: 'read' }]);
    } finally {
      vi.useRealTimers();
    }
    const chat = (await listChats(user.id, user.id, {})).rows.find((c) => c.phone === ANA)!;
    const m = (await listMessages(user.id, chat.id)).find((x) => x.body === 'te llamo')!;
    const info = await linesMessageInfo(systemViewer(user.id), chat.id, m.id);
    expect(info).toMatchObject({ group: false, deliveredAt: T1, readAt: T2, people: [] });
  });
});

describe('Inbox: Info del mensaje', () => {
  async function setup(tag: string) {
    const u = await makeUser(`wainfo-i${tag}`);
    const a = await createAccount(u.id, { kind: 'whatsapp', provider: 'fake', label: 'WhatsApp' });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected', address = ? WHERE id = ?").run(ME, a.id);
    const acc = (await getAccountById(a.id))!;
    return { u, acc };
  }

  it('grupo: pide al gateway (falso) y lista a cada persona; otra persona no la ve', async () => {
    const { u, acc } = await setup('g');
    const other = await makeUser('wainfo-ig2');
    const group = await upsertThread(acc, { externalId: '120363000000000905@g.us', kind: 'group', title: 'Vecinos' });
    await addMessage(group, { externalId: 'iout-1', fromMe: true, body: 'mañana corte de luz', status: 'sent' });
    await rememberContacts({ app: 'inbox', accountId: acc.id, userId: u.id }, [{ phone: ANA, saved: 'Ana Libreta' }]);
    const key = `inbox-${acc.id}`;
    // El falso de Inbox se crea al primer uso.
    const { fakeProvider } = await import('@/lib/groups-provider-fake');
    fakeProvider(key);
    fakeState(key).connectedAt = Date.now() - 5000;
    fakeState(key).receipts = new Map([['iout-1', [{ phone: ANA, deliveredAt: T1, readAt: T2 }, { lid: CARLA_LID, deliveredAt: T2 }]]]);
    const id = String(((await getDb().prepare("SELECT id FROM inbox_messages WHERE thread_id = ? AND external_id = 'iout-1'").get(group.id)) as { id: string }).id);

    const info = await inboxMessageInfo(u.id, group.id, id);
    expect(info).toMatchObject({ group: true, live: true, unavailable: false });
    expect(info.people).toHaveLength(2);
    expect(info.people.find((p) => p.name === 'Ana Libreta')).toMatchObject({ phone: ANA, readAt: T2 });
    // Un lid sin teléfono conocido no se muestra como teléfono.
    expect(info.people.find((p) => p.deliveredAt === T2 && !p.readAt)).toMatchObject({ phone: '' });

    await expect(inboxMessageInfo(other.id, group.id, id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('1:1: entregado y leído con su hora desde el webhook', async () => {
    const { u, acc } = await setup('d');
    const dm = await upsertThread(acc, { externalId: `${BETO}@s.whatsapp.net`, kind: 'dm', handle: BETO });
    await addMessage(dm, { externalId: 'idm-1', fromMe: true, body: 'llego 10 min tarde', status: 'sent' });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(T2));
      await ingestWhatsappEvents(acc, [{ type: 'status', providerMessageId: 'idm-1', status: 'read' }]);
      vi.setSystemTime(new Date(T3));
      await ingestWhatsappEvents(acc, [{ type: 'status', providerMessageId: 'idm-1', status: 'delivered' }]);
    } finally {
      vi.useRealTimers();
    }
    const id = String(((await getDb().prepare("SELECT id FROM inbox_messages WHERE thread_id = ? AND external_id = 'idm-1'").get(dm.id)) as { id: string }).id);
    const info = await inboxMessageInfo(u.id, dm.id, id);
    // "Entregado" que llega después de "leído" no mueve las tildes: queda la hora de leído para los dos.
    expect(info).toMatchObject({ group: false, readAt: T2, deliveredAt: T2, status: 'read' });
  });
});
