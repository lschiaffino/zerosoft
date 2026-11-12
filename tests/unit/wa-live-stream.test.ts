/**
 * Inbox y Lines: el stream del aviso en vivo (lib/wa-live.ts). Lo que llega,
 * a quién, en qué orden, qué pasa al reconectar y cuándo se corta. Con el
 * proveedor falso; nombres y números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createLabel, createNumber, getNumberRowById, ingestEvents, listMessages, sendMessage, type NumberRow } from '@/lib/groups';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import type { AccountRow } from '@/lib/inbox/core';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { LIVE_MAX_PER_PERSON, fetchLive, latestLiveId, liveHubCount, livePoll, liveStream, liveStreamAllowed, pokeLive, subscribeLive, wantsLiveStream, type LiveViewer } from '@/lib/wa-live';
import { liveSessionValid, linesViewerNow } from '@/lib/wa-live-auth';
import { canSeeChat, chatFilterFor, groupsViewer, setLabelAccess, updatePlatformSettings } from '@/lib/groups-access';
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
    const { rd, abort, res } = open({ app: 'lines', ws, visible: null });
    const ready = await rd.next('ready');
    expect(typeof ready.data.cursor).toBe('number');
    await ingestEvents(number, [message('5491100095101@s.whatsapp.net')]);
    const ev = await rd.next('events');
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ?').get(number.id)) as { id: string };
    const events = ev.data.events as Array<Record<string, unknown>>;
    expect(events.map((e) => e.chatId)).toEqual([chat.id]);
    // Solo ids: nada del texto, el nombre ni el teléfono viaja por el stream.
    for (const e of events) expect(Object.keys(e).sort()).toEqual(['chatId', 'id', 'kind']);
    expect(events[0].kind).toBe('chat');
    // Nada de esto se guarda en un caché intermedio.
    expect(res.headers.get('cache-control')).toBe('private, no-store, no-transform');
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

  it('M4: un miembro con acceso restringido no recibe ni el id de un chat que no puede abrir; del que sí puede, sí', async () => {
    const { ws, number } = await linesSetup('stream-restricted');
    const member = await makeUser('stream-member');
    // Acceso por etiqueta prendido: un miembro ve solo los chats con alguna de sus etiquetas (o asignados a él).
    await updatePlatformSettings(ws, { labelAccess: true });
    const label = await createLabel(ws, { name: 'Soporte' });
    await setLabelAccess(ws, label.id, []);
    const jidMine = '5491100095301@s.whatsapp.net';
    const jidOther = '5491100095302@s.whatsapp.net';
    await ingestEvents(number, [message(jidMine), message(jidOther)]);
    const chats = (await getDb().prepare('SELECT id, provider_chat_id FROM groups_chats WHERE number_id = ?').all(number.id)) as Array<{ id: string; provider_chat_id: string }>;
    const mine = chats.find((c) => c.provider_chat_id === jidMine)!.id;
    const other = chats.find((c) => c.provider_chat_id === jidOther)!.id;
    // Un chat asignado al miembro; el otro, de nadie.
    await getDb().prepare('UPDATE groups_chats SET assigned_to = ? WHERE id = ?').run(member.id, mine);
    // El viewer de verdad, con el mismo criterio que las rutas del chat (chatAccessSql).
    const gv = await groupsViewer(ws, member.id, 'member');
    expect(gv.restricted).toBe(true);
    expect(await canSeeChat(gv, mine)).toBe(true);
    expect(await canSeeChat(gv, other)).toBe(false);
    const viewer: LiveViewer = { app: 'lines', ws, visible: chatFilterFor(gv) };
    const restricted = open(viewer);
    const admin = open({ app: 'lines', ws, visible: chatFilterFor(await groupsViewer(ws, ws, 'owner')) });
    await restricted.rd.next('ready');
    await admin.rd.next('ready');
    // Actividad en el chat que NO puede abrir: mensaje, tildes de adentro, escribiendo. Al admin le llega; al miembro, nada.
    await ingestEvents(number, [message(jidOther)]);
    await ingestEvents(number, [{ type: 'presence', chatId: jidOther, state: 'composing', who: '5491100095302' }]);
    const forAdmin = await admin.rd.next('events');
    expect((forAdmin.data.events as Array<{ chatId: string }>).map((e) => e.chatId)).toEqual([other]);
    expect(await restricted.rd.drain(900)).toEqual([]);
    // Actividad en el que sí puede abrir: le llega, y solo ese id.
    await ingestEvents(number, [message(jidMine)]);
    const forMember = await restricted.rd.next('events');
    expect((forMember.data.events as Array<{ chatId: string }>).map((e) => e.chatId)).toEqual([mine]);
    // Por consulta, lo mismo (es a lo que cae la pantalla sin stream).
    const from = Number(forMember.data.cursor) - 1;
    await ingestEvents(number, [message(jidOther), message(jidMine)]);
    expect((await livePoll(viewer, from)).events.map((e) => e.chatId)).toEqual([mine]);
    // Dueño y admins no pagan nada: sin filtro que consultar.
    expect(chatFilterFor(await groupsViewer(ws, ws, 'owner'))).toBeNull();
    // Le sacan el chat: desde la próxima revalidación tampoco le llega ese.
    await getDb().prepare('UPDATE groups_chats SET assigned_to = NULL WHERE id = ?').run(mine);
    await ingestEvents(number, [message(jidMine)]);
    expect(await restricted.rd.drain(900)).toEqual([]);
    for (const o of [restricted, admin]) {
      o.abort.abort();
      await o.rd.close();
    }
    await updatePlatformSettings(ws, { labelAccess: false });
  });

  it('M4: si no se puede consultar el acceso, no sale nada sin filtrar: la conexión se corta para reconectar', async () => {
    const { ws, number } = await linesSetup('stream-filter-fails');
    const { rd } = open({
      app: 'lines',
      ws,
      visible: async () => {
        throw new Error('la base no responde');
      },
    });
    await rd.next('ready');
    await ingestEvents(number, [message('5491100095311@s.whatsapp.net')]);
    const first = await rd.next();
    expect(first.event).toBe('bye');
    expect(first.data.reason).toBe('error');
  });

  it('M5: la misma pestaña que reconecta reemplaza su conexión anterior (una colgada no le ocupa el lugar)', async () => {
    const { owner } = await inboxSetup('stream-tab');
    const viewer: LiveViewer = { app: 'inbox', owner };
    const key = `inbox:${owner}`;
    const first = open(viewer, { key, tab: 'pestaña-1' });
    await first.rd.next('ready');
    // El navegador recargó y el servidor no se enteró: la conexión vieja sigue "abierta". Llega la nueva de la misma pestaña.
    const second = open(viewer, { key, tab: 'pestaña-1' });
    const bye = await first.rd.next('bye');
    expect(bye.data.reason).toBe('replaced');
    await second.rd.next('ready');
    // Seis recargas seguidas de la misma pestaña no agotan el tope (antes: la séptima caía a la consulta por 4 minutos).
    let last = second;
    for (let i = 0; i < LIVE_MAX_PER_PERSON + 2; i++) {
      last = open(viewer, { key, tab: 'pestaña-1' });
      await last.rd.next('ready');
    }
    last.abort.abort();
    await last.rd.close();
  });

  it('al reconectar con su cursor recibe lo que pasó mientras tanto, sin repetir', async () => {
    const { ws, number } = await linesSetup('stream-reconnect');
    const viewer: LiveViewer = { app: 'lines', ws, visible: null };
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
    let checks = 0;
    const a = open(viewer, {
      check: async () => {
        checks++;
        return allowed ? viewer : null;
      },
      checkMs: 1000,
    });
    await a.rd.next('ready');
    // Al conectar no se revalida (quien llama acaba de resolver la sesión): la primera es al minuto.
    expect(checks).toBe(0);
    allowed = false;
    const bye = await a.rd.next('bye', 4000);
    expect(bye.data.reason).toBe('revoked');
    expect(typeof bye.data.cursor).toBe('number');
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

  it('una revalidación que devuelve a otro dueño corta (nunca se cambia de cuenta en una conexión abierta)', async () => {
    const mine = await inboxSetup('stream-swap-a');
    const other = await inboxSetup('stream-swap-b');
    const { rd } = open({ app: 'inbox', owner: mine.owner }, { check: async () => ({ app: 'inbox', owner: other.owner }), checkMs: 1000 });
    await rd.next('ready');
    const bye = await rd.next('bye', 4000);
    expect(bye.data.reason).toBe('revoked');
  });

  it('el cierre ordenado avisa hasta dónde mandó (para seguir desde ahí sin releer todo)', async () => {
    const { ws, number } = await linesSetup('stream-bye');
    const { rd } = open({ app: 'lines', ws, visible: null }, { maxMs: 5000 });
    await rd.next('ready');
    await ingestEvents(number, [message('5491100095321@s.whatsapp.net')]);
    const ev = await rd.next('events');
    const bye = await rd.next('bye', 7000);
    expect(bye.data.reason).toBeUndefined();
    expect(bye.data.cursor).toBe(ev.data.cursor);
  }, 15_000);

  it('tope de conexiones por persona, y cada una que se cierra libera su lugar', async () => {
    const { owner } = await inboxSetup('stream-slots');
    const viewer: LiveViewer = { app: 'inbox', owner };
    const key = `inbox:${owner}`;
    const opened = Array.from({ length: LIVE_MAX_PER_PERSON }, (_, i) => open(viewer, { key, tab: `t${i}` }));
    for (const o of opened) await o.rd.next('ready');
    // Otra pestaña más (no una de las que ya están): no entra.
    expect(liveStream({ key, tab: 'otra', cursor: 0, viewer, check: async () => viewer })).toBeNull();
    opened[0].abort.abort();
    await opened[0].rd.close();
    await vi.waitFor(() => {
      const res = liveStream({ key, tab: 'otra', cursor: 0, viewer, check: async () => viewer });
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
    const viewer: LiveViewer = { app: 'lines', ws, visible: null };
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

describe('qué avisa y de qué tipo', () => {
  it('lo que mueve la lista es "chat"; lo de adentro del chat (tildes, reacciones) es "msg"', async () => {
    const { ws, number } = await linesSetup('kind-lines');
    const viewer: LiveViewer = { app: 'lines', ws, visible: null };
    const jid = '5491100095801@s.whatsapp.net';
    let from = await latestLiveId(viewer);
    await ingestEvents(number, [message(jid)]);
    expect((await fetchLive(viewer, from)).map((e) => e.kind)).toEqual(['chat', 'chat']);
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ?').get(number.id)) as { id: string };
    const sent = await sendMessage(ws, ws, chat.id, { body: 'va' });
    const row = (await getDb().prepare('SELECT provider_message_id FROM groups_messages WHERE id = ?').get(sent.id)) as { provider_message_id: string };
    from = await latestLiveId(viewer);
    await ingestEvents(number, [{ type: 'status', providerMessageId: row.provider_message_id, status: 'read' }]);
    expect((await fetchLive(viewer, from)).map((e) => e.kind)).toEqual(['msg']);
    // En un lote, un chat con cambios de los dos tipos cuenta como "chat"; la lista solo mira esos.
    from = await latestLiveId(viewer);
    await ingestEvents(number, [message(jid)]);
    await getDb().prepare("UPDATE groups_messages SET reactions = '[{\"emoji\":\"👍\",\"by\":\"x\",\"fromMe\":false}]' WHERE id = ?").run(sent.id);
    expect((await livePoll(viewer, from)).events.map((e) => e.kind)).toEqual(['chat']);
  });

  it('M10: los estados y reacciones de mensajes viejos (el historial al vincular) no anotan un aviso por cada uno', async () => {
    const { ws, number } = await linesSetup('recency-lines');
    const lines: LiveViewer = { app: 'lines', ws, visible: null };
    const jid = '5491100095811@s.whatsapp.net';
    await ingestEvents(number, [message(jid)]);
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ?').get(number.id)) as { id: string };
    const old = '2026-01-05T10:00:00.000Z';
    for (let i = 0; i < 5; i++) {
      await getDb()
        .prepare("INSERT INTO groups_messages (id, user_id, chat_id, number_id, provider_message_id, direction, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'out', 'viejo', 'sent', ?)")
        .run(`old-${ws}-${i}`, ws, chat.id, number.id, `old-prov-${ws}-${i}`, old);
    }
    let from = await latestLiveId(lines);
    // Cinco estados de mensajes de enero: se aplican, y no anotan nada.
    await ingestEvents(number, Array.from({ length: 5 }, (_, i) => ({ type: 'status' as const, providerMessageId: `old-prov-${ws}-${i}`, status: 'read' as const })));
    const rows = (await getDb().prepare("SELECT status FROM groups_messages WHERE chat_id = ? AND body = 'viejo'").all(chat.id)) as Array<{ status: string }>;
    expect(rows.every((r) => r.status === 'read')).toBe(true);
    expect(await fetchLive(lines, from)).toHaveLength(0);

    // Inbox: lo mismo, por la hora del mensaje (no por cuándo se importó).
    const { owner, account } = await inboxSetup('recency-inbox');
    const inbox: LiveViewer = { app: 'inbox', owner };
    await ingestWhatsappEvents(account, [message(jid, { fromMe: true, providerMessageId: 'viejo-1', status: 'sent', timestamp: old }), message(jid, { fromMe: true, providerMessageId: 'viejo-2', status: 'sent', timestamp: '2026-01-06T10:00:00.000Z' })] as never, { history: true });
    from = await latestLiveId(inbox);
    await ingestWhatsappEvents(account, [{ type: 'status', providerMessageId: 'viejo-1', status: 'read' }] as never);
    expect(await fetchLive(inbox, from)).toHaveLength(0);
  });

  it('M9: "escribiendo" que sigue vuelve a avisar cuando pasaron más de 10 s, no por cada tecla', async () => {
    const { ws, number } = await linesSetup('presence-lines');
    const viewer: LiveViewer = { app: 'lines', ws, visible: null };
    const jid = '5491100095821@s.whatsapp.net';
    await ingestEvents(number, [message(jid)]);
    const typing = { type: 'presence' as const, chatId: jid, state: 'composing' as const, who: '5491100095821' };
    let from = await latestLiveId(viewer);
    await ingestEvents(number, [typing]);
    expect(await fetchLive(viewer, from)).toHaveLength(1);
    // Sigue escribiendo: tres avisos del teléfono en el mismo segundo no anotan nada.
    from = await latestLiveId(viewer);
    await ingestEvents(number, [typing, typing, typing]);
    expect(await fetchLive(viewer, from)).toHaveLength(0);
    // Pasaron 11 s desde el último que se anotó: avisa de nuevo (la pantalla sabe que sigue).
    await getDb().prepare('UPDATE groups_chats SET presence_at = ? WHERE number_id = ?').run(new Date(Date.now() - 11_000).toISOString(), number.id);
    await ingestEvents(number, [typing]);
    expect(await fetchLive(viewer, from)).toHaveLength(1);
    // Dejó de escribir: cambia el estado y avisa (por el trigger de siempre).
    from = await latestLiveId(viewer);
    await ingestEvents(number, [{ ...typing, state: 'paused' as const }]);
    expect(await fetchLive(viewer, from)).toHaveLength(1);

    // Inbox, igual.
    const { owner, account } = await inboxSetup('presence-inbox');
    const inbox: LiveViewer = { app: 'inbox', owner };
    await ingestWhatsappEvents(account, [message(jid)] as never);
    await ingestWhatsappEvents(account, [typing] as never);
    from = await latestLiveId(inbox);
    await ingestWhatsappEvents(account, [typing, typing] as never);
    expect(await fetchLive(inbox, from)).toHaveLength(0);
    await getDb().prepare('UPDATE inbox_threads SET presence_at = ? WHERE account_id = ?').run(new Date(Date.now() - 11_000).toISOString(), account.id);
    await ingestWhatsappEvents(account, [typing] as never);
    expect(await fetchLive(inbox, from)).toHaveLength(1);
  });
});

describe('WA_LIVE_WORKSPACES: el stream está apagado si no se lo prende', () => {
  const req = (accept: string, cookie = '') => new Request('http://zerosoft.test/api/inbox/live', { headers: { accept, ...(cookie ? { cookie } : {}) } });
  it('sin la variable nadie tiene stream; con ids, solo esos; con all, todos', () => {
    vi.stubEnv('WA_LIVE_WORKSPACES', '');
    expect(wantsLiveStream(req('application/json'), ['ws-1'])).toBe('poll');
    expect(wantsLiveStream(req('text/event-stream'), ['ws-1'])).toBe('off');
    expect(liveStreamAllowed(req('*/*'), ['ws-1'])).toBe(false);
    vi.stubEnv('WA_LIVE_WORKSPACES', 'ws-9, ws-1');
    expect(wantsLiveStream(req('text/event-stream'), ['ws-1'])).toBe('stream');
    expect(wantsLiveStream(req('text/event-stream'), ['ws-2'])).toBe('off');
    expect(liveStreamAllowed(req('*/*'), ['ws-2'])).toBe(false);
    // Un id que contiene a otro no cuenta.
    expect(liveStreamAllowed(req('*/*'), ['ws-11'])).toBe(false);
    vi.stubEnv('WA_LIVE_WORKSPACES', 'all');
    expect(wantsLiveStream(req('text/event-stream'), ['cualquiera'])).toBe('stream');
    expect(wantsLiveStream(req('*/*'), ['cualquiera'])).toBe('poll');
  });
  it('la cookie de las pruebas solo cuenta en modo demo', () => {
    vi.stubEnv('WA_LIVE_WORKSPACES', '');
    expect(wantsLiveStream(req('text/event-stream', 'a=1; wa_live=sse'), ['ws-1'])).toBe('off');
    vi.stubEnv('DEMO_MODE', 'true');
    expect(wantsLiveStream(req('text/event-stream', 'a=1; wa_live=sse'), ['ws-1'])).toBe('stream');
    expect(wantsLiveStream(req('text/event-stream', 'wa_live=sse2'), ['ws-1'])).toBe('off');
  });
});

describe('revalidar una conexión abierta sin cookies ni headers (lib/wa-live-auth.ts)', () => {
  async function sessionFor(userId: string, over: Record<string, unknown> = {}): Promise<string> {
    const sid = `sid-${Math.random().toString(36).slice(2, 12)}`;
    const cols = (await getDb().prepare("SELECT name FROM pragma_table_info('user_sessions')").all()) as Array<{ name: string }>;
    const now = new Date().toISOString();
    const base: Record<string, unknown> = { id: sid, user_id: userId, created_at: now, last_seen_at: now, expires_at: new Date(Date.now() + 3_600_000).toISOString(), ...over };
    const use = cols.map((c) => c.name).filter((n) => n in base);
    await getDb()
      .prepare(`INSERT INTO user_sessions (${use.join(', ')}) VALUES (${use.map(() => '?').join(', ')})`)
      .run(...use.map((n) => base[n] as string));
    return sid;
  }

  it('la sesión: vale mientras exista, no esté cerrada ni vencida; sin fila de sesión vale salvo que se hayan cerrado todas', async () => {
    const u = await makeUser('reval-session');
    const sid = await sessionFor(u.id);
    expect(await liveSessionValid({ userId: u.id, sid })).toBe(true);
    // La sesión de otra persona con mi id no vale.
    const other = await makeUser('reval-other');
    expect(await liveSessionValid({ userId: other.id, sid })).toBe(false);
    // Cerrar la sesión (desde otro dispositivo) la corta.
    await getDb().prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), sid);
    expect(await liveSessionValid({ userId: u.id, sid })).toBe(false);
    // Vencida.
    const old = await sessionFor(u.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await liveSessionValid({ userId: u.id, sid: old })).toBe(false);
    // Una sesión que no existe, o una persona que ya no existe.
    expect(await liveSessionValid({ userId: u.id, sid: 'no-existe' })).toBe(false);
    expect(await liveSessionValid({ userId: 'nadie', sid: null })).toBe(false);
    // Sin fila de sesión (modo demo, o de antes): vale hasta que la persona cierra todas.
    expect(await liveSessionValid({ userId: u.id, sid: null })).toBe(true);
    await getDb().prepare('UPDATE users SET sessions_revoked_at = ? WHERE id = ?').run(new Date().toISOString(), u.id);
    expect(await liveSessionValid({ userId: u.id, sid: null })).toBe(false);
  });

  it('Lines: quien sale del workspace pierde la conexión; a quien le bajan el rol se le achica; nunca se agranda', async () => {
    const { ws } = await linesSetup('reval-lines');
    const person = await makeUser('reval-member');
    // No es del workspace.
    expect(await linesViewerNow(ws, person.id, 'admin')).toBeNull();
    const { createTeam, addMember } = await import('@/lib/teams');
    const team = await createTeam(ws, 'Equipo de prueba');
    await addMember(team.id, person.id, 'admin');
    const asAdmin = await linesViewerNow(ws, person.id, 'admin');
    expect(asAdmin).toMatchObject({ role: 'admin', linesScoped: false });
    expect(chatFilterFor(asAdmin!)).toBeNull();
    // Conectó como miembro y después lo hicieron admin: la conexión abierta sigue viendo como miembro.
    expect(await linesViewerNow(ws, person.id, 'member')).toMatchObject({ role: 'member', linesScoped: true });
    // Conectó como admin y lo bajaron a miembro: desde la próxima revalidación ve como miembro (se filtra por chat).
    await getDb().prepare("UPDATE team_members SET role = 'member' WHERE team_id = ? AND user_id = ?").run(team.id, person.id);
    const demoted = await linesViewerNow(ws, person.id, 'admin');
    expect(demoted).toMatchObject({ role: 'member', linesScoped: true });
    expect(chatFilterFor(demoted!)).not.toBeNull();
    // Lo sacan del workspace: se corta.
    await getDb().prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(team.id, person.id);
    expect(await linesViewerNow(ws, person.id, 'admin')).toBeNull();
    // El dueño siempre.
    expect(await linesViewerNow(ws, ws, 'owner')).toMatchObject({ role: 'owner' });
  });
});
