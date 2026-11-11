/**
 * Inbox y Lines: el stream del aviso en vivo (lib/wa-live.ts). Lo que llega,
 * a quién, en qué orden, qué pasa al reconectar y cuándo se corta. Con el
 * proveedor falso; nombres y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listMessages, sendMessage, type NumberRow } from '@/lib/groups';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import type { AccountRow } from '@/lib/inbox/core';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { LIVE_MAX_PER_PERSON, fetchLive, latestLiveId, liveHubCount, liveStream, pokeLive, subscribeLive, wantsLiveStream, type LiveViewer } from '@/lib/wa-live';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

async function linesSetup(label: string): Promise<{ ws: string; number: NumberRow }> {
  const u = await makeUser(label);
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  const s = fakeState(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  return { ws: u.id, number: (await getNumberRowById(n.id))! };
}

async function inboxSetup(label: string): Promise<{ owner: string; account: AccountRow }> {
  const u = await makeUser(label);
  const { account } = await connectWhatsapp(u.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  const s = fakeState(`inbox-${account.id}`);
  if (s) s.connectedAt = Date.now() - 5000;
  return { owner: u.id, account: { ...account, status: 'connected' } };
}

let seq = 0;
function message(chatId: string, over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    type: 'message' as const,
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: 'Vera Prueba',
    providerMessageId: `live-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    body: 'un texto que no tiene que viajar por el stream',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

interface Frame {
  event: string;
  data: Record<string, unknown>;
  id?: number;
}

/** Lee frames SSE de una respuesta; `next(event)` espera el próximo de ese tipo (ping aparte). */
function reader(res: Response) {
  const r = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const queue: Frame[] = [];
  let done = false;
  const pump = async () => {
    const chunk = await r.read();
    if (chunk.done) {
      done = true;
      return;
    }
    buf += dec.decode(chunk.value, { stream: true });
    let cut = buf.indexOf('\n\n');
    while (cut >= 0) {
      const raw = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const f: Frame = { event: '', data: {} };
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) f.event = line.slice(7);
        else if (line.startsWith('data: ')) f.data = JSON.parse(line.slice(6));
        else if (line.startsWith('id: ')) f.id = Number(line.slice(4));
      }
      if (f.event) queue.push(f);
      cut = buf.indexOf('\n\n');
    }
  };
  return {
    async next(event?: string, timeoutMs = 4000): Promise<Frame> {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const i = queue.findIndex((f) => f.event !== 'ping' && (!event || f.event === event));
        if (i >= 0) return queue.splice(i, 1)[0];
        if (done) throw new Error(`stream cerrado sin ${event ?? 'frame'}`);
        if (Date.now() > until) throw new Error(`sin ${event ?? 'frame'} en ${timeoutMs} ms`);
        await Promise.race([pump(), new Promise((res2) => setTimeout(res2, 50))]);
      }
    },
    /** Los frames de eventos que llegaron en `ms` (para afirmar que NO llegó algo). */
    async drain(ms: number): Promise<Frame[]> {
      const until = Date.now() + ms;
      while (Date.now() < until && !done) await Promise.race([pump(), new Promise((res2) => setTimeout(res2, 40))]);
      return queue.splice(0).filter((f) => f.event !== 'ping');
    },
    async close() {
      await r.cancel().catch(() => undefined);
    },
    get closed() {
      return done;
    },
  };
}

function open(viewer: LiveViewer, opts: Partial<Parameters<typeof liveStream>[0]> = {}) {
  const abort = new AbortController();
  const res = liveStream({ key: `test:${Math.random()}`, cursor: 0, viewer, check: async () => viewer, signal: abort.signal, ...opts });
  if (!res) throw new Error('sin lugar');
  return { rd: reader(res), abort, res };
}

describe('el lector de cada dueño', () => {
  it('un aviso con poke llega en el acto, y solo al dueño de ese chat', async () => {
    const a = await linesSetup('hub-a');
    const b = await linesSetup('hub-b');
    // Un primer mensaje antes de medir: carga lo que el webhook importa la primera vez.
    await ingestEvents(a.number, [message('5491100095001@s.whatsapp.net')]);
    const gotA: string[] = [];
    const gotB: string[] = [];
    let at = 0;
    const subA = subscribeLive('lines', a.ws, (rows) => {
      at ||= Date.now();
      gotA.push(...rows.map((r) => r.chat_id));
    });
    const subB = subscribeLive('lines', b.ws, (rows) => gotB.push(...rows.map((r) => r.chat_id)));
    await subA.cursor();
    await subB.cursor();
    // Que el lector quede esperando su próxima vuelta (400 ms): lo que llegue antes es por el poke.
    await new Promise((r) => setTimeout(r, 60));
    const t0 = Date.now();
    // ingestEvents hace pokeLive al guardar: no se espera la vuelta del lector.
    await ingestEvents(a.number, [message('5491100095001@s.whatsapp.net')]);
    await vi.waitFor(() => expect(gotA.length).toBeGreaterThan(0), { timeout: 2000, interval: 5 });
    expect(at - t0).toBeLessThan(150);
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ?').get(a.number.id)) as { id: string };
    expect(new Set(gotA)).toEqual(new Set([chat.id]));
    // Al otro workspace no le llega nada, ni con su propio poke.
    pokeLive('lines', b.ws);
    await new Promise((r) => setTimeout(r, 150));
    expect(gotB).toEqual([]);
    subA.off();
    subB.off();
    // Sin nadie escuchando, el lector se cierra solo (no queda consultando).
    await vi.waitFor(() => expect(liveHubCount()).toBe(0), { timeout: 3000, interval: 50 });
  });

  it('sin poke (otra instancia escribió) llega igual en la vuelta siguiente', async () => {
    const { owner, account } = await inboxSetup('hub-cross');
    await ingestWhatsappEvents(account, [message('5491100095011@s.whatsapp.net')] as never);
    const got: number[] = [];
    const sub = subscribeLive('inbox', owner, (rows) => got.push(...rows.map((r) => r.id)));
    await sub.cursor();
    // Una escritura directa a la base: como si viniera de otra instancia del servidor.
    await getDb().prepare("UPDATE inbox_threads SET pinned_at = '2026-01-01T00:00:00.000Z' WHERE account_id = ?").run(account.id);
    await vi.waitFor(() => expect(got.length).toBe(1), { timeout: 2500, interval: 20 });
    sub.off();
  });

  it('pokeLive sin conexiones no consulta la base', async () => {
    const before = liveHubCount();
    pokeLive('inbox', 'nadie-escucha');
    expect(liveHubCount()).toBe(before);
  });
});

describe('el stream', () => {
  it('Lines: ready, y el aviso de un mensaje nuevo con solo ids', async () => {
    const { ws, number } = await linesSetup('stream-lines');
    const { rd, abort } = open({ app: 'lines', ws, numbers: null });
    const ready = await rd.next('ready');
    expect(typeof ready.data.cursor).toBe('number');
    await ingestEvents(number, [message('5491100095101@s.whatsapp.net')]);
    const ev = await rd.next('events');
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ?').get(number.id)) as { id: string };
    const events = ev.data.events as Array<Record<string, unknown>>;
    expect(events.map((e) => e.chatId)).toEqual([chat.id]);
    // Solo ids: nada del texto, el nombre ni el teléfono viaja por el stream.
    for (const e of events) expect(Object.keys(e).sort()).toEqual(['chatId', 'id']);
    expect(JSON.stringify(ev.data)).not.toMatch(/texto|Vera|5491100095101/);
    expect(ev.id).toBe(ev.data.cursor);
    abort.abort();
    await rd.close();
  });

  it('Inbox: solo a su dueño; otra persona no recibe nada', async () => {
    const mine = await inboxSetup('stream-inbox-mine');
    const other = await inboxSetup('stream-inbox-other');
    const a = open({ app: 'inbox', owner: mine.owner });
    const b = open({ app: 'inbox', owner: other.owner });
    await a.rd.next('ready');
    await b.rd.next('ready');
    await ingestWhatsappEvents(mine.account, [message('5491100095201@s.whatsapp.net')] as never);
    const ev = await a.rd.next('events');
    expect((ev.data.events as unknown[]).length).toBe(1);
    expect(await b.rd.drain(700)).toEqual([]);
    a.abort.abort();
    b.abort.abort();
    await a.rd.close();
    await b.rd.close();
  });

  it('Lines: quien no ve una línea no recibe sus avisos; al cambiar el acceso, sí', async () => {
    const { ws, number } = await linesSetup('stream-restricted');
    let numbers: Set<string> = new Set(['otra-linea']);
    const viewer = (): LiveViewer => ({ app: 'lines', ws, numbers });
    const { rd, abort } = open(viewer(), { check: async () => viewer(), checkMs: 1000 });
    await rd.next('ready');
    await ingestEvents(number, [message('5491100095301@s.whatsapp.net')]);
    expect(await rd.drain(700)).toEqual([]);
    // Le dan la línea: desde la próxima revalidación recibe lo nuevo (lo anterior no se repite).
    numbers = new Set([number.id]);
    await new Promise((r) => setTimeout(r, 1200));
    await ingestEvents(number, [message('5491100095301@s.whatsapp.net')]);
    const ev = await rd.next('events');
    expect((ev.data.events as unknown[]).length).toBe(1);
    abort.abort();
    await rd.close();
  });

  it('al reconectar con su cursor recibe lo que pasó mientras tanto, sin repetir', async () => {
    const { ws, number } = await linesSetup('stream-reconnect');
    const viewer: LiveViewer = { app: 'lines', ws, numbers: null };
    const first = open(viewer);
    await first.rd.next('ready');
    await ingestEvents(number, [message('5491100095401@s.whatsapp.net')]);
    const ev = await first.rd.next('events');
    const cursor = Number(ev.data.cursor);
    first.abort.abort();
    await first.rd.close();
    // Desconectado: llegan dos mensajes a dos chats.
    await ingestEvents(number, [message('5491100095402@s.whatsapp.net')]);
    await ingestEvents(number, [message('5491100095403@s.whatsapp.net')]);
    const again = open(viewer, { cursor });
    const ready = await again.rd.next('ready');
    expect(Number(ready.data.cursor)).toBeGreaterThan(cursor);
    const back = await again.rd.next('events');
    const chats = (await getDb().prepare('SELECT id, provider_chat_id FROM groups_chats WHERE number_id = ?').all(number.id)) as Array<{ id: string; provider_chat_id: string }>;
    const missed = chats.filter((c) => /9540[23]@/.test(c.provider_chat_id)).map((c) => c.id);
    expect(new Set((back.data.events as Array<{ chatId: string }>).map((e) => e.chatId))).toEqual(new Set(missed));
    // Todo lo del atraso es posterior al cursor: nada repetido.
    for (const e of back.data.events as Array<{ id: number }>) expect(e.id).toBeGreaterThan(cursor);
    expect(await again.rd.drain(600)).toEqual([]);
    again.abort.abort();
    await again.rd.close();
  });

  it('un atraso muy grande pide releer todo (reset) en vez de mandar miles de avisos', async () => {
    const { owner, account } = await inboxSetup('stream-gap');
    await ingestWhatsappEvents(account, [message('5491100095501@s.whatsapp.net')] as never);
    const viewer: LiveViewer = { app: 'inbox', owner };
    const cursor = await latestLiveId(viewer);
    const t = (await getDb().prepare('SELECT id FROM inbox_threads WHERE account_id = ?').get(account.id)) as { id: string };
    for (let i = 0; i < 205; i++) await getDb().prepare("INSERT INTO wa_live_events (app, scope_id, chat_id) VALUES ('inbox', ?, ?)").run(owner, t.id);
    const { rd, abort } = open(viewer, { cursor });
    await rd.next('ready');
    const reset = await rd.next('reset');
    expect(Number(reset.data.cursor)).toBeGreaterThan(cursor);
    abort.abort();
    await rd.close();
  });

  it('si la revalidación dice que perdió el acceso, corta con revoked; si falla, corta para reconectar', async () => {
    const { owner } = await inboxSetup('stream-revoke');
    const viewer: LiveViewer = { app: 'inbox', owner };
    let allowed = true;
    const a = open(viewer, { check: async () => (allowed ? viewer : null), checkMs: 1000 });
    await a.rd.next('ready');
    allowed = false;
    const bye = await a.rd.next('bye', 4000);
    expect(bye.data.reason).toBe('revoked');
    await vi.waitFor(async () => {
      await a.rd.drain(50);
      expect(a.rd.closed).toBe(true);
    });

    let fail = false;
    const b = open(viewer, {
      check: async () => {
        if (fail) throw new Error('la base no responde');
        return viewer;
      },
      checkMs: 1000,
    });
    await b.rd.next('ready');
    fail = true;
    const bye2 = await b.rd.next('bye', 4000);
    // Sin "revoked": el navegador reconecta y vuelve a pasar por la sesión.
    expect(bye2.data.reason).toBe('error');
    await vi.waitFor(async () => {
      await b.rd.drain(50);
      expect(b.rd.closed).toBe(true);
    });
  });

  it('sin acceso desde el arranque no manda ni ready', async () => {
    const { owner } = await inboxSetup('stream-denied');
    const { rd } = open({ app: 'inbox', owner }, { check: async () => null });
    const first = await rd.next();
    expect(first.event).toBe('bye');
    expect(first.data.reason).toBe('revoked');
  });

  it('una revalidación que devuelve a otro dueño corta (nunca se cambia de cuenta en una conexión abierta)', async () => {
    const mine = await inboxSetup('stream-swap-a');
    const other = await inboxSetup('stream-swap-b');
    const { rd } = open({ app: 'inbox', owner: mine.owner }, { check: async () => ({ app: 'inbox', owner: other.owner }) });
    const first = await rd.next();
    expect(first.event).toBe('bye');
    expect(first.data.reason).toBe('revoked');
  });

  it('tope de conexiones por persona, y cada una que se cierra libera su lugar', async () => {
    const { owner } = await inboxSetup('stream-slots');
    const viewer: LiveViewer = { app: 'inbox', owner };
    const key = `inbox:${owner}`;
    const opened = Array.from({ length: LIVE_MAX_PER_PERSON }, () => open(viewer, { key }));
    for (const o of opened) await o.rd.next('ready');
    expect(liveStream({ key, cursor: 0, viewer, check: async () => viewer })).toBeNull();
    opened[0].abort.abort();
    await opened[0].rd.close();
    await vi.waitFor(() => {
      const res = liveStream({ key, cursor: 0, viewer, check: async () => viewer });
      expect(res).not.toBeNull();
      void res!.body!.cancel();
    });
    for (const o of opened.slice(1)) {
      o.abort.abort();
      await o.rd.close();
    }
  });
});

describe('qué avisa (migración 394_wa_live_messages)', () => {
  it('Lines: las tildes, una edición y una nota avisan al chat; un mensaje nuevo no avisa dos veces', async () => {
    const { ws, number } = await linesSetup('trig-lines');
    const viewer: LiveViewer = { app: 'lines', ws, numbers: null };
    const jid = '5491100095601@s.whatsapp.net';
    await ingestEvents(number, [message(jid)]);
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ?').get(number.id)) as { id: string };
    let from = await latestLiveId(viewer);
    // Otro mensaje entrante: un solo aviso (el del chat), no uno más por el mensaje.
    await ingestEvents(number, [message(jid)]);
    expect(await fetchLive(viewer, from)).toHaveLength(1);
    // Mando uno y llegan sus tildes: cada cambio de estado avisa.
    const sent = await sendMessage(ws, ws, chat.id, { body: 'va' });
    const row = (await getDb().prepare('SELECT provider_message_id FROM groups_messages WHERE id = ?').get(sent.id)) as { provider_message_id: string };
    from = await latestLiveId(viewer);
    await ingestEvents(number, [{ type: 'status', providerMessageId: row.provider_message_id, status: 'delivered' }]);
    expect((await fetchLive(viewer, from)).map((e) => e.chat_id)).toEqual([chat.id]);
    from = await latestLiveId(viewer);
    await ingestEvents(number, [{ type: 'status', providerMessageId: row.provider_message_id, status: 'read' }]);
    expect(await fetchLive(viewer, from)).toHaveLength(1);
    // El mismo estado otra vez no cambia nada: no avisa.
    from = await latestLiveId(viewer);
    await ingestEvents(number, [{ type: 'status', providerMessageId: row.provider_message_id, status: 'read' }]);
    expect(await fetchLive(viewer, from)).toHaveLength(0);
    // Una nota interna (no mueve la lista) también avisa al chat abierto.
    from = await latestLiveId(viewer);
    await sendMessage(ws, ws, chat.id, { body: 'nota para el equipo', note: true });
    expect((await fetchLive(viewer, from)).length).toBeGreaterThan(0);
    // Un ticket abierto sobre un mensaje (la marca en la burbuja) avisa al chat, y cerrarlo también.
    from = await latestLiveId(viewer);
    const { createTicket, updateTicket } = await import('@/lib/groups-tickets');
    const { ticket } = await createTicket(ws, ws, { chatId: chat.id, messageId: sent.id, source: 'manual' });
    expect((await fetchLive(viewer, from)).some((e) => e.chat_id === chat.id)).toBe(true);
    from = await latestLiveId(viewer);
    await updateTicket(ws, ticket.id, { status: 'resolved' });
    expect((await fetchLive(viewer, from)).some((e) => e.chat_id === chat.id)).toBe(true);
    // Los datos de un archivo que terminó de procesarse (meta) también.
    from = await latestLiveId(viewer);
    await getDb().prepare("UPDATE groups_messages SET meta = json_set(meta, '$.media', json('{\"width\":10}')) WHERE id = ?").run(sent.id);
    expect(await fetchLive(viewer, from)).toHaveLength(1);
    // Una nota vieja (historial importado) no anota nada.
    from = await latestLiveId(viewer);
    await getDb()
      .prepare("INSERT INTO groups_messages (id, user_id, chat_id, number_id, direction, body, status, created_at) VALUES (?, ?, ?, ?, 'system', 'viejo', 'sent', '2020-01-01T00:00:00.000Z')")
      .run(`old-${Date.now()}`, ws, chat.id, number.id);
    expect(await fetchLive(viewer, from)).toHaveLength(0);
    expect((await listMessages(ws, chat.id, { limit: 10 })).length).toBeGreaterThan(2);
  });

  it('Inbox: las tildes de un mensaje que no es el último avisan al chat', async () => {
    const { owner, account } = await inboxSetup('trig-inbox');
    const viewer: LiveViewer = { app: 'inbox', owner };
    const jid = '5491100095701@s.whatsapp.net';
    await ingestWhatsappEvents(account, [message(jid, { fromMe: true, providerMessageId: 'mine-1', status: 'sent' }), message(jid, { fromMe: true, providerMessageId: 'mine-2', status: 'sent' })] as never);
    const t = (await getDb().prepare('SELECT id FROM inbox_threads WHERE account_id = ?').get(account.id)) as { id: string };
    const from = await latestLiveId(viewer);
    // mine-1 no es el último: la fila de la lista no cambia, pero el chat abierto tiene que enterarse.
    await ingestWhatsappEvents(account, [{ type: 'status', providerMessageId: 'mine-1', status: 'read' }] as never);
    expect(new Set((await fetchLive(viewer, from)).map((e) => e.chat_id))).toEqual(new Set([t.id]));
  });
});

describe('WA_LIVE', () => {
  const req = (accept: string, cookie = '') => new Request('http://zerosoft.test/api/inbox/live', { headers: { accept, ...(cookie ? { cookie } : {}) } });
  it('sin Accept de stream es el aviso por pedido; con él, stream salvo que esté apagado', () => {
    expect(wantsLiveStream(req('application/json'))).toBe('poll');
    expect(wantsLiveStream(req('text/event-stream'))).toBe('stream');
    vi.stubEnv('WA_LIVE', 'poll');
    expect(wantsLiveStream(req('text/event-stream'))).toBe('off');
    expect(wantsLiveStream(req('*/*'))).toBe('poll');
    // La cookie solo cuenta en modo demo (pruebas): en producción el apagado no se saltea.
    expect(wantsLiveStream(req('text/event-stream', 'a=1; wa_live=sse'))).toBe('off');
    vi.stubEnv('DEMO_MODE', 'true');
    expect(wantsLiveStream(req('text/event-stream', 'a=1; wa_live=sse'))).toBe('stream');
    expect(wantsLiveStream(req('text/event-stream', 'wa_live=sse2'))).toBe('off');
  });
});
