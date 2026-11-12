/**
 * Velocidad de WhatsApp en Lines e Inbox, del lado del servidor: cuánto tarda
 * un webhook entrante (hasta que el mensaje queda guardado y el chat avisado, y
 * hasta responder), cuántas idas a la base hace, y cuánto pasa entre el pedido
 * de envío y la llamada al proveedor. Con el proveedor falso; nombres y
 * números inventados.
 *
 *   npx vitest run -c vitest.perf.config.ts
 *   BENCH_RT_MS=10 npx vitest run -c vitest.perf.config.ts   (10 ms por ida a la base, como una base remota)
 *
 * Imprime una tabla; BENCH_OUT=<archivo> la guarda como JSON.
 */
import fs from 'fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureMigrated, getClient, getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, type NumberRow } from '@/lib/groups';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import type { AccountRow } from '@/lib/inbox/core';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { makeUser } from '../unit/helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({
  ...(await orig<typeof import('@/lib/session')>()),
  getCurrentUser: async () => session.user,
}));
// after(): como en un request de verdad, lo que se deja para después corre cuando la respuesta ya salió (drain()),
// y no cuenta en el tiempo ni en las idas a la base de la respuesta.
const deferred: Array<() => Promise<unknown>> = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (job: (() => unknown) | Promise<unknown>) => {
    deferred.push(() => Promise.resolve(typeof job === 'function' ? job() : job).catch(() => null));
  },
}));

const RT = Number(process.env.BENCH_RT_MS ?? 0);
const N = Number(process.env.BENCH_N ?? 200);
const BURST = Number(process.env.BENCH_BURST ?? 50);
/** Envíos medidos: menos que el tope por número (40 por minuto). */
const SENDS = 30;
const traces: Record<string, string[]> = {};

interface Trace {
  t0: number;
  /** Idas a la base (una tanda cuenta una). */
  trips: number;
  statements: number;
  marks: Record<string, number>;
  /** Cada ida, con el momento en que salió (BENCH_TRACE=1 las imprime). */
  log: string[];
}
let current: Trace | null = null;
const MARKS: Array<[string, RegExp]> = [
  ['lines.msg', /INTO groups_messages/],
  ['lines.chat', /UPDATE groups_chats SET last_message_at/],
  ['inbox.msg', /INTO inbox_messages/],
  ['inbox.chat', /UPDATE inbox_threads SET\s+preview/],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Espera a que termine todo lo que quedó para después de responder (y lo que eso, a su vez, dejó para después). */
async function drain() {
  while (deferred.length) for (const job of deferred.splice(0)) await job();
}
let restore: (() => void) | null = null;

/** Cuenta cada ida a la base, le suma RT ms y anota cuándo quedó guardado el mensaje y avisado el chat. */
function instrument() {
  const client = getClient() as unknown as Record<string, (...a: unknown[]) => unknown>;
  const sqlOf = (s: unknown) => (typeof s === 'string' ? s : String((s as { sql?: string })?.sql ?? ''));
  const done = (tr: Trace | null, sqls: string[]) => {
    if (!tr) return;
    tr.log.push(`${Math.round(performance.now() - tr.t0)} ms  ${sqls.length > 1 ? `[tanda de ${sqls.length}] ` : ''}${sqls.map((q) => q.replace(/\s+/g, ' ').slice(0, 110)).join(' ;; ')}`);
    for (const sql of sqls) for (const [name, re] of MARKS) if (re.test(sql)) tr.marks[name] = performance.now() - tr.t0;
  };
  const execute = client.execute;
  const batch = client.batch;
  const transaction = client.transaction;
  client.execute = async (stmt: unknown, args?: unknown) => {
    const tr = current;
    if (tr) (tr.trips++, tr.statements++);
    if (RT) await sleep(RT);
    const res = await execute.call(client, stmt, args);
    done(tr, [sqlOf(stmt)]);
    return res;
  };
  client.batch = async (stmts: unknown, mode: unknown) => {
    const tr = current;
    const list = stmts as unknown[];
    if (tr) (tr.trips++, (tr.statements += list.length));
    if (RT) await sleep(RT);
    const res = await batch.call(client, stmts, mode);
    done(tr, list.map(sqlOf));
    return res;
  };
  client.transaction = async (mode: unknown) => {
    const tr = current;
    if (tr) tr.trips++;
    if (RT) await sleep(RT);
    const tx = (await transaction.call(client, mode)) as Record<string, (...a: unknown[]) => unknown>;
    const inner = tx.execute;
    tx.execute = async (stmt: unknown) => {
      if (tr) (tr.trips++, tr.statements++);
      if (RT) await sleep(RT);
      const res = await inner.call(tx, stmt);
      done(tr, [sqlOf(stmt)]);
      return res;
    };
    return tx;
  };
  restore = () => {
    client.execute = execute;
    client.batch = batch;
    client.transaction = transaction;
  };
}

/** Corre `fn` midiendo. Secuencial: `current` es de esta medición. */
async function traced(fn: () => Promise<unknown>): Promise<Trace & { total: number }> {
  const tr: Trace = { t0: performance.now(), trips: 0, statements: 0, marks: {}, log: [] };
  current = tr;
  await fn();
  const total = performance.now() - tr.t0;
  current = null;
  // Lo que quedó para después de responder termina antes de la próxima medición (no se mezcla).
  await drain();
  return { ...tr, total };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const results: Record<string, Record<string, number>> = {};
function report(name: string, rows: Record<string, number[]>) {
  const out: Record<string, number> = {};
  for (const [k, xs] of Object.entries(rows)) {
    out[`${k} p50`] = r1(pct(xs, 50));
    out[`${k} p95`] = r1(pct(xs, 95));
  }
  results[name] = out;
}

const fakeState = (id: string) => (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(id);

function message(chatId: string, id: string, body = 'hola') {
  return { type: 'message' as const, chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: 'Vera Prueba', providerMessageId: id, body, timestamp: new Date().toISOString() };
}
const dm = (i: number) => `54911000940${String(10 + (i % 20)).padStart(2, '0')}@s.whatsapp.net`;

let lines: { ws: string; number: NumberRow };
let inbox: { owner: string; account: AccountRow };

beforeAll(async () => {
  process.env.GROUPS_FAKE = '1';
  process.env.INBOX_FAKE = '1';
  // Con los límites de pedidos prendidos, como en producción (cada uno es una ida a la base).
  delete process.env.RATE_LIMIT_DISABLED;
  resetFakeProvider();
  await ensureMigrated();
  const u = await makeUser('perf-lines');
  const n = await createNumber(u.id, u.id, { provider: 'fake' });
  await connectNumber(u.id, n.id);
  fakeState(n.id)!.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
  lines = { ws: u.id, number: (await getNumberRowById(n.id))! };
  const v = await makeUser('perf-inbox');
  const { account } = await connectWhatsapp(v.id);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  fakeState(`inbox-${account.id}`)!.connectedAt = Date.now() - 5000;
  inbox = { owner: v.id, account: { ...account, status: 'connected' } };
  instrument();
}, 120_000);

afterAll(() => {
  restore?.();
  // eslint-disable-next-line no-console
  console.log(`\n[wa-speed] RT=${RT} ms por ida a la base, N=${N}, ráfaga=${BURST}`);
  // eslint-disable-next-line no-console
  console.table(results);
  if (process.env.BENCH_OUT) fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify({ rt: RT, n: N, burst: BURST, results, traces }, null, 2));
});

async function linesWebhook(events: unknown[]) {
  const { POST } = await import('@/app/api/groups/webhook/[id]/[secret]/route');
  const res = await POST(new Request('http://zerosoft.test/api/groups/webhook/x/y', { method: 'POST', body: JSON.stringify({ events }) }), {
    params: Promise.resolve({ id: lines.number.id, secret: lines.number.webhook_secret }),
  });
  expect(res.status).toBe(200);
}
async function inboxWebhook(events: unknown[]) {
  const { POST } = await import('@/app/api/inbox/webhook/[id]/[secret]/route');
  const res = await POST(new Request('http://zerosoft.test/api/inbox/webhook/x/y', { method: 'POST', body: JSON.stringify({ events }) }), {
    params: Promise.resolve({ id: inbox.account.id, secret: inbox.account.webhook_secret }),
  });
  expect(res.status).toBe(200);
}

describe.each([
  ['lines', () => linesWebhook, 'lines.msg', 'lines.chat'],
  ['inbox', () => inboxWebhook, 'inbox.msg', 'inbox.chat'],
] as const)('%s: webhook entrante', (app, hook, msgMark, chatMark) => {
  it('un mensaje por webhook, de a uno', async () => {
    // Los 20 chats ya existen: lo que se mide es el mensaje de todos los días, no el primero de un chat.
    for (let i = 0; i < 20; i++) await hook()([message(dm(i), `${app}-seed-${i}`)]);
    await drain();
    const total: number[] = [];
    const saved: number[] = [];
    const visible: number[] = [];
    const trips: number[] = [];
    const statements: number[] = [];
    for (let i = 0; i < N; i++) {
      const tr = await traced(() => hook()([message(dm(i), `${app}-one-${i}`, `mensaje ${i}`)]));
      if (i === 0) traces[`${app} entrante`] = tr.log;
      total.push(tr.total);
      saved.push(tr.marks[msgMark] ?? NaN);
      visible.push(tr.marks[chatMark] ?? NaN);
      trips.push(tr.trips);
      statements.push(tr.statements);
    }
    report(`${app} entrante`, { 'guardado ms': saved, 'avisado ms': visible, 'respuesta ms': total, 'idas a la base': trips, sentencias: statements });
  });

  it(`una ráfaga de ${BURST} webhooks a la vez`, async () => {
    const each: number[] = [];
    const t0 = performance.now();
    await Promise.all(
      Array.from({ length: BURST }, async (_, i) => {
        const s = performance.now();
        await hook()([message(dm(i), `${app}-burst-${i}`, `ráfaga ${i}`)]);
        each.push(performance.now() - s);
      }),
    );
    const wall = performance.now() - t0;
    await drain();
    report(`${app} ráfaga`, { 'respuesta ms': each, 'total ms': [wall] });
  });

  it('una tanda de historial de 100 mensajes en un solo webhook', async () => {
    const old = Date.now() - 30 * 86_400_000;
    const batch = Array.from({ length: 100 }, (_, i) => ({ ...message(dm(i), `${app}-hist-${i}`, `historia ${i}`), timestamp: new Date(old + i * 1000).toISOString(), history: true }));
    const tr = await traced(() => hook()(batch));
    report(`${app} historial x100`, { 'respuesta ms': [tr.total], 'idas a la base': [tr.trips] });
  });

  it('estado de un mensaje (tildes) y escribiendo', async () => {
    const st = await traced(() => hook()([{ type: 'presence', chatId: dm(1), state: 'composing', who: dm(1).replace(/@.*/, '') }]));
    report(`${app} escribiendo`, { 'respuesta ms': [st.total], 'idas a la base': [st.trips] });
  });
});

describe('envío', () => {
  it('Lines: del pedido a la llamada al proveedor', async () => {
    session.user = { id: lines.ws, email: 'perf-lines@test.local', name: 'perf', team: null, role: 'owner' };
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? LIMIT 1').get(lines.number.id)) as { id: string };
    const { POST } = await import('@/lib/routes/groups/chats/[id]/messages/route');
    const toProvider: number[] = [];
    const total: number[] = [];
    const trips: number[] = [];
    for (let i = 0; i < SENDS; i++) {
      const before = fakeSent(lines.number.id).length;
      const start = Date.now();
      const tr = await traced(async () => {
        const res = await POST(new Request(`http://zerosoft.test/api/groups/chats/${chat.id}/messages`, { method: 'POST', body: JSON.stringify({ body: `respuesta ${i}` }) }), {
          params: Promise.resolve({ id: chat.id }),
        });
        expect(res.status).toBe(201);
      });
      const sent = fakeSent(lines.number.id)[before];
      if (i === 0) traces['lines envío'] = [`(proveedor a los ${sent ? sent.at - start : '?'} ms)`, ...tr.log];
      toProvider.push(sent ? sent.at - start : NaN);
      total.push(tr.total);
      trips.push(tr.trips);
    }
    report('lines envío', { 'hasta el proveedor ms': toProvider, 'respuesta ms': total, 'idas a la base': trips });
  });

  it('Inbox: del pedido a la llamada al proveedor', async () => {
    session.user = { id: inbox.owner, email: 'perf-inbox@test.local', name: 'perf', team: null, role: 'owner' };
    const thread = (await getDb().prepare('SELECT id FROM inbox_threads WHERE account_id = ? LIMIT 1').get(inbox.account.id)) as { id: string };
    const { POST } = await import('@/lib/routes/inbox/threads/[id]/messages/route');
    const key = `inbox-${inbox.account.id}`;
    const toProvider: number[] = [];
    const total: number[] = [];
    const trips: number[] = [];
    for (let i = 0; i < SENDS; i++) {
      const before = fakeSent(key).length;
      const start = Date.now();
      const tr = await traced(async () => {
        const res = await POST(new Request(`http://zerosoft.test/api/inbox/threads/${thread.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: `respuesta ${i}` }) }), {
          params: Promise.resolve({ id: thread.id }),
        });
        expect(res.status).toBe(201);
      });
      const sent = fakeSent(key)[before];
      if (i === 0) traces['inbox envío'] = [`(proveedor a los ${sent ? sent.at - start : '?'} ms)`, ...tr.log];
      toProvider.push(sent ? sent.at - start : NaN);
      total.push(tr.total);
      trips.push(tr.trips);
    }
    report('inbox envío', { 'hasta el proveedor ms': toProvider, 'respuesta ms': total, 'idas a la base': trips });
  });
});
