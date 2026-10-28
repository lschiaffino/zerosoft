import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createFlow, getFlow, getRunWithSteps, setFlowPin } from '@/lib/flow';
import { approvalRecipients, parseWaitUntil, testFlowStep } from '@/lib/flow-engine';
import { runFlowNow } from '@/lib/flow-http';
import {
  EVENT_SAMPLES,
  FLOW_EVENT_TYPES,
  isStepTestable,
  PIN_LIMIT,
  validateGraph,
  type FlowGraph,
} from '@/lib/flow-schema';
import {
  createTable,
  deleteTable,
  deleteTableRowsWhere,
  findTableRows,
  insertTableRow,
  listTableRows,
  listTables,
  TableError,
  updateTable,
  updateTableRow,
  upsertTableRow,
} from '@/lib/flow-tables';
import { coerceCell, tableCreateSchema } from '@/lib/flow-tables-schema';
import {
  approvalToken,
  buildApprovalEmail,
  decideApproval,
  getApprovalView,
  parseApprovalToken,
  parseResumeToken,
  resumeFromCall,
  resumeToken,
} from '@/lib/flow-waits';
import { processFlowQueue } from '@/lib/flow-worker';
import { createActivity, updateActivity } from '@/lib/crm';
import { createChatConversation, createChatWidget, getOrCreateChatVisitor, submitConversationCsat, updateChatConversation } from '@/lib/chat-data';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const testStepRoute = await import('@/app/api/flow/flows/[id]/test-step/route');
const pinsRoute = await import('@/lib/routes/flow/flows/[id]/pins/route');
const resumeRoute = await import('@/app/api/flow/resume/[token]/route');
const approvalRoute = await import('@/app/api/flow/approvals/[token]/route');
const tablesRoute = await import('@/app/api/flow/tables/route');
const rowsRoute = await import('@/lib/routes/flow/tables/[id]/rows/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  session.user = null;
});

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, config } as FlowGraph['nodes'][number];
}

function edge(source: string, target: string, sourceHandle?: string) {
  return { id: `${source}-${sourceHandle ?? 'out'}-${target}`, source, target, sourceHandle: sourceHandle ?? null };
}

function manual(nodes: FlowGraph['nodes'], edges: FlowGraph['edges']): FlowGraph {
  return { nodes: [node('t', 'trigger.manual', { sample: '{}' }), ...nodes], edges };
}

async function newFlow(ws: string, graph: FlowGraph) {
  const res = await createFlow(ws, ws, { name: 'F', graph });
  if (!res.ok) throw new Error(`${res.error} ${res.nodeId ?? ''}`);
  return res.flow;
}

async function run(ws: string, flowId: string, input: Record<string, unknown> = {}) {
  const res = await runFlowNow(ws, flowId, input);
  if (!res.ok || !res.run) throw new Error('run failed');
  return res.run;
}

async function expireJobs(runId: string) {
  await getDb().prepare("UPDATE flow_jobs SET run_at = '2000-01-01T00:00:00.000Z' WHERE run_id = ?").run(runId);
}

const admin = (id: string) => ({ id, email: `${id}@x.test`, name: 'A', role: 'owner' });
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ---------- Esperar ----------

describe('Esperar: hasta una fecha', () => {
  it('lee ISO, fechas locales en una zona y epochs', () => {
    expect(parseWaitUntil('2026-03-01T09:00:00Z')?.toISOString()).toBe('2026-03-01T09:00:00.000Z');
    expect(parseWaitUntil('2026-03-01 09:00', 'America/Argentina/Buenos_Aires')?.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(parseWaitUntil('2026-03-01')?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(parseWaitUntil('1767225600')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    // Horario de verano: 1 de julio en Madrid es UTC+2.
    expect(parseWaitUntil('2026-07-01 10:00', 'Europe/Madrid')?.toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(parseWaitUntil('mañana')).toBeNull();
    expect(parseWaitUntil('')).toBeNull();
  });

  it('una fecha futura deja la corrida esperando; una pasada sigue sin esperar', async () => {
    const ws = (await makeUser('wu')).id;
    const flow = await newFlow(
      ws,
      manual(
        [node('wait', 'logic.delay', { mode: 'until', until: '{{trigger.at}}' }), node('after', 'data.set', { fields: [{ key: 'ok', value: 'yes' }] })],
        [edge('t', 'wait'), edge('wait', 'after')],
      ),
    );
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const r1 = await run(ws, flow.id, { at: future });
    expect(r1.status).toBe('waiting');
    const job = (await getDb().prepare('SELECT run_at FROM flow_jobs WHERE run_id = ?').get(r1.id)) as { run_at: string };
    expect(job.run_at).toBe(new Date(future).toISOString());

    const r2 = await run(ws, flow.id, { at: '2001-01-01T00:00:00Z' });
    expect(r2.status).toBe('success');
    expect(r2.steps.find((s) => s.nodeId === 'after')?.status).toBe('success');

    const r3 = await run(ws, flow.id, { at: 'not a date' });
    expect(r3.status).toBe('failed');
    expect(r3.error).toBe('wait: invalid_date');
  });
});

describe('Esperar: hasta una llamada (resume URL)', () => {
  const graph = (onTimeout = 'continue') =>
    manual(
      [
        node('url', 'data.set', { fields: [{ key: 'link', value: '{{run.resumeUrl}}' }] }),
        node('wait', 'logic.delay', { mode: 'resume', timeoutAmount: 1, timeoutUnit: 'hours', onTimeout }),
        node('after', 'data.set', { fields: [{ key: 'got', value: '{{nodes.wait.output.body.answer}}' }] }),
      ],
      [edge('t', 'url'), edge('url', 'wait'), edge('wait', 'after')],
    );

  it('la URL firmada retoma la corrida con el body; después ya no sirve', async () => {
    const ws = (await makeUser('rs')).id;
    const flow = await newFlow(ws, graph());
    const r = await run(ws, flow.id);
    expect(r.status).toBe('waiting');
    const link = String((r.steps.find((s) => s.nodeId === 'url')?.output as { link: string }).link);
    const token = link.split('/api/flow/resume/')[1];
    expect(token).toBe(resumeToken(r.id));
    expect(parseResumeToken(token)).toBe(r.id);
    expect(parseResumeToken(`${r.id}.forged`)).toBeNull();
    expect((await resumeFromCall(`${r.id}.forged`, { method: 'POST', body: {}, query: {} })).ok).toBe(false);

    const res = await resumeFromCall(token, { method: 'POST', body: { answer: 'yes' }, query: { a: '1' } });
    expect(res).toMatchObject({ ok: true, status: 'success' });
    const done = await getRunWithSteps(ws, r.id);
    expect(done?.steps.find((s) => s.nodeId === 'after')?.output).toEqual({ got: 'yes' });
    expect(done?.steps.find((s) => s.nodeId === 'wait')).toMatchObject({ status: 'success' });
    expect(await getDb().prepare('SELECT 1 FROM flow_jobs WHERE run_id = ?').get(r.id)).toBeUndefined();

    expect(await resumeFromCall(token, { method: 'POST', body: {}, query: {} })).toEqual({ ok: false, error: 'not_waiting' });
  });

  it('la ruta pública acepta GET/POST y responde 202, 404 o 410', async () => {
    const ws = (await makeUser('rr')).id;
    const flow = await newFlow(ws, graph());
    const r = await run(ws, flow.id);
    const token = resumeToken(r.id);
    const bad = await resumeRoute.POST(new NextRequest('http://x/api/flow/resume/x', json({})), { params: Promise.resolve({ token: 'nope' }) });
    expect(bad.status).toBe(404);
    const ok = await resumeRoute.POST(new NextRequest(`http://x/api/flow/resume/${token}`, json({ answer: 'ok' })), {
      params: Promise.resolve({ token }),
    });
    expect(ok.status).toBe(202);
    // El resto del flow corre fuera del request (en el test, enseguida).
    await vi.waitFor(async () => expect((await getRunWithSteps(ws, r.id))?.status).toBe('success'));
    const again = await resumeRoute.GET(new NextRequest(`http://x/api/flow/resume/${token}`), { params: Promise.resolve({ token }) });
    expect(again.status).toBe(410);
  });

  it('si nadie llama a tiempo: sigue con timedOut o falla, según el nodo', async () => {
    const ws = (await makeUser('rt')).id;
    const cont = await newFlow(ws, graph('continue'));
    const r1 = await run(ws, cont.id);
    await expireJobs(r1.id);
    await processFlowQueue();
    const d1 = await getRunWithSteps(ws, r1.id);
    expect(d1?.status).toBe('success');
    expect(d1?.steps.find((s) => s.nodeId === 'wait')?.output).toMatchObject({ resumed: false, timedOut: true });

    const fail = await newFlow(ws, graph('fail'));
    const r2 = await run(ws, fail.id);
    await expireJobs(r2.id);
    await processFlowQueue();
    const d2 = await getRunWithSteps(ws, r2.id);
    expect(d2?.status).toBe('failed');
    expect(d2?.error).toBe('wait: resume_timeout');
    // Ya venció: la URL no la retoma.
    expect((await resumeFromCall(resumeToken(r2.id), { method: 'GET', body: {}, query: {} })).ok).toBe(false);
  });
});

// ---------- Aprobación ----------

describe('Aprobación por email', () => {
  const graph = (onTimeout = 'reject') =>
    manual(
      [
        node('ok', 'logic.approval', {
          to: 'boss@example.com, ops@example.com',
          subject: 'Refund {{trigger.amount}}',
          message: 'Customer asked for a refund.',
          timeoutAmount: 2,
          timeoutUnit: 'hours',
          onTimeout,
        }),
        node('yes', 'data.set', { fields: [{ key: 'branch', value: 'approved' }, { key: 'note', value: '{{nodes.ok.output.comment}}' }] }),
        node('no', 'data.set', { fields: [{ key: 'branch', value: 'rejected' }] }),
      ],
      [edge('t', 'ok'), edge('ok', 'yes', 'approved'), edge('ok', 'no', 'rejected')],
    );

  it('separa destinatarios y arma el email con los dos links', () => {
    expect(approvalRecipients('A@x.com, b@x.com; a@x.com  c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    const mail = buildApprovalEmail({
      locale: 'es',
      flowName: 'Reembolsos',
      subject: '',
      message: 'Hola',
      approveUrl: 'https://z/a',
      rejectUrl: 'https://z/r',
      expiresAt: '2026-01-01T10:00:00.000Z',
    });
    expect(mail.subject).toBe('Aprobación pendiente: Reembolsos');
    expect(mail.text).toContain('Aprobar: https://z/a');
    expect(mail.text).toContain('Rechazar: https://z/r');
    expect(mail.html).toContain('https://z/a');
  });

  it('pausa la corrida, manda un email por persona y sigue por Aprobado con el comentario', async () => {
    const ws = (await makeUser('ap')).id;
    const flow = await newFlow(ws, graph());
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const r = await run(ws, flow.id, { amount: 40 });
    expect(r.status).toBe('waiting');
    expect(logs.filter((l) => l.includes('subject="Refund 40"'))).toHaveLength(2);
    const token = approvalToken(r.id, 'ok');
    expect(logs.some((l) => l.includes(`/flow/approve/${token}?decision=approve`))).toBe(true);
    expect(parseApprovalToken(token)).toEqual({ runId: r.id, nodeId: 'ok' });
    expect(parseApprovalToken(`${r.id}.ok.bad`)).toBeNull();
    expect(parseApprovalToken(approvalToken(r.id, 'other'))).toEqual({ runId: r.id, nodeId: 'other' });

    const view = await getApprovalView(token);
    expect(view).toMatchObject({ state: 'pending', subject: 'Refund 40', message: 'Customer asked for a refund.', flowName: 'F' });
    // Un token de otro nodo de la corrida no decide nada.
    expect((await decideApproval(approvalToken(r.id, 'other'), 'approve', '')).ok).toBe(false);

    expect(await decideApproval(token, 'approve', '  Go ahead  ')).toMatchObject({ ok: true, status: 'success' });
    const done = await getRunWithSteps(ws, r.id);
    expect(done?.steps.find((s) => s.nodeId === 'yes')?.output).toEqual({ branch: 'approved', note: 'Go ahead' });
    expect(done?.steps.some((s) => s.nodeId === 'no')).toBe(false);
    expect(await getApprovalView(token)).toMatchObject({ state: 'approved', comment: 'Go ahead', timedOut: false });
    // La primera decisión gana.
    expect(await decideApproval(token, 'reject', '')).toEqual({ ok: false, error: 'not_waiting' });
  });

  it('la ruta pública rechaza y valida el body', async () => {
    const ws = (await makeUser('apr')).id;
    const flow = await newFlow(ws, graph());
    const r = await run(ws, flow.id, { amount: 1 });
    const token = approvalToken(r.id, 'ok');
    const params = { params: Promise.resolve({ token }) };
    expect((await approvalRoute.POST(new NextRequest('http://x', json({ decision: 'maybe' })), params)).status).toBe(400);
    expect((await approvalRoute.POST(new NextRequest('http://x', json({ decision: 'reject', comment: 'No' })), params)).status).toBe(200);
    await vi.waitFor(async () => expect((await getRunWithSteps(ws, r.id))?.status).toBe('success'));
    const done = await getRunWithSteps(ws, r.id);
    expect(done?.steps.find((s) => s.nodeId === 'no')?.output).toEqual({ branch: 'rejected' });
    expect((await approvalRoute.POST(new NextRequest('http://x', json({ decision: 'approve' })), params)).status).toBe(410);
  });

  it('sin respuesta: rechaza, aprueba o falla según el nodo', async () => {
    const ws = (await makeUser('apt')).id;
    for (const [onTimeout, expected] of [
      ['reject', 'no'],
      ['approve', 'yes'],
    ] as const) {
      const flow = await newFlow(ws, graph(onTimeout));
      const r = await run(ws, flow.id, { amount: 1 });
      await expireJobs(r.id);
      await processFlowQueue();
      const d = await getRunWithSteps(ws, r.id);
      expect(d?.status, onTimeout).toBe('success');
      expect(d?.steps.some((s) => s.nodeId === expected), onTimeout).toBe(true);
      expect(await getApprovalView(approvalToken(r.id, 'ok'))).toMatchObject({ timedOut: true });
    }
    const flow = await newFlow(ws, graph('fail'));
    const r = await run(ws, flow.id, { amount: 1 });
    await expireJobs(r.id);
    await processFlowQueue();
    const d = await getRunWithSteps(ws, r.id);
    expect(d?.error).toBe('ok: approval_timeout');
    expect(await getApprovalView(approvalToken(r.id, 'ok'))).toMatchObject({ state: 'expired' });
  });

  it('sin destinatarios válidos falla; no se puede usar dentro de un Loop', async () => {
    const ws = (await makeUser('ape')).id;
    const flow = await newFlow(ws, manual([node('ok', 'logic.approval', { to: 'not-an-email' })], [edge('t', 'ok')]));
    expect((await run(ws, flow.id)).error).toBe('ok: invalid_email');
    const loop = validateGraph(
      manual([node('l', 'logic.loop', { items: '[1]' }), node('ok', 'logic.approval', { to: 'a@x.com' })], [edge('t', 'l'), edge('l', 'ok', 'item')]),
    );
    expect(loop).toMatchObject({ ok: false, error: 'approval_in_loop' });
  });
});

// ---------- Tablas de datos ----------

describe('Tablas de datos', () => {
  it('valida columnas y convierte los valores según el tipo', () => {
    expect(tableCreateSchema.safeParse({ name: 'T', columns: [{ name: 'id', type: 'text' }] }).success).toBe(false);
    expect(tableCreateSchema.safeParse({ name: 'T', columns: [{ name: 'a b', type: 'text' }] }).success).toBe(false);
    expect(
      tableCreateSchema.safeParse({ name: 'T', columns: [{ name: 'Email', type: 'text' }, { name: 'email', type: 'text' }] }).success,
    ).toBe(false);
    expect(coerceCell({ name: 'n', type: 'number' }, ' 42 ')).toBe(42);
    expect(coerceCell({ name: 'n', type: 'number' }, '')).toBeNull();
    expect(() => coerceCell({ name: 'n', type: 'number' }, 'x')).toThrow();
    expect(coerceCell({ name: 'b', type: 'boolean' }, 'sí')).toBe(true);
    expect(coerceCell({ name: 'b', type: 'boolean' }, 'false')).toBe(false);
    expect(coerceCell({ name: 't', type: 'text' }, { a: 1 })).toBe('{"a":1}');
  });

  it('crea, busca, actualiza (upsert) y borra filas', async () => {
    const ws = (await makeUser('tb')).id;
    const table = await createTable(ws, ws, {
      name: 'Orders',
      columns: [
        { name: 'email', type: 'text' },
        { name: 'count', type: 'number' },
        { name: 'vip', type: 'boolean' },
      ],
    });
    await expect(createTable(ws, ws, { name: 'orders', columns: [] })).rejects.toMatchObject({ code: 'duplicate_name' });
    const a = await insertTableRow(ws, table.id, { email: 'a@x.com', count: '2', vip: 'yes' });
    expect(a).toMatchObject({ email: 'a@x.com', count: 2, vip: true });
    await expect(insertTableRow(ws, table.id, { nope: 1 })).rejects.toMatchObject({ code: 'unknown_column', column: 'nope' });
    await expect(insertTableRow(ws, table.id, { count: 'many' })).rejects.toMatchObject({ code: 'invalid_value', column: 'count' });
    await expect(insertTableRow(ws, table.id, { email: 'x'.repeat(9_000), vip: 'x'.repeat(9000) })).rejects.toBeInstanceOf(TableError);

    expect(await findTableRows(ws, table.id, { column: 'email', value: 'a@x.com' })).toHaveLength(1);
    expect(await findTableRows(ws, table.id, { column: 'vip', value: true })).toHaveLength(1);
    expect(await findTableRows(ws, table.id, { column: 'count', value: '2' })).toHaveLength(1);
    expect(await findTableRows(ws, table.id, { column: 'email', value: 'b@x.com' })).toHaveLength(0);

    const up1 = await upsertTableRow(ws, table.id, { column: 'email', value: 'a@x.com' }, { count: 3 });
    expect(up1).toMatchObject({ created: false, row: { email: 'a@x.com', count: 3, vip: true } });
    const up2 = await upsertTableRow(ws, table.id, { column: 'email', value: 'b@x.com' }, { count: 1 });
    expect(up2).toMatchObject({ created: true, row: { email: 'b@x.com', count: 1, vip: null } });
    expect((await listTableRows(ws, table.id)).total).toBe(2);

    expect(await updateTableRow(ws, table.id, up2.row.id, { vip: false })).toMatchObject({ email: 'b@x.com', vip: false });
    expect(await deleteTableRowsWhere(ws, table.id, { column: 'email', value: 'b@x.com' })).toBe(1);
    expect((await listTables(ws))[0]).toMatchObject({ name: 'Orders', rowCount: 1 });

    // Una columna quitada deja de leerse.
    await updateTable(ws, table.id, { columns: [{ name: 'email', type: 'text' }] });
    const [row] = (await listTableRows(ws, table.id)).rows;
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'email', 'id', 'updatedAt']);

    // Otro workspace no la ve.
    const other = (await makeUser('tb2')).id;
    await expect(findTableRows(other, table.id, {})).rejects.toMatchObject({ code: 'not_found' });
    expect(await deleteTable(other, table.id)).toBe(false);
    expect(await deleteTable(ws, table.id)).toBe(true);
  });

  it('el nodo Tabla de datos deja saltear duplicados entre corridas', async () => {
    const ws = (await makeUser('tn')).id;
    const table = await createTable(ws, ws, { name: 'Seen', columns: [{ name: 'email', type: 'text' }, { name: 'times', type: 'number' }] });
    const flow = await newFlow(
      ws,
      manual(
        [
          node('find', 'data.table', { tableId: table.id, operation: 'find', column: 'email', value: '{{trigger.email}}' }),
          node('new', 'logic.if', { combine: 'all', conditions: [{ left: '{{nodes.find.output.found}}', op: 'is_false', right: '' }] }),
          node('save', 'data.table', {
            tableId: table.id,
            operation: 'upsert',
            column: 'email',
            value: '{{trigger.email}}',
            values: [{ key: 'times', value: '1' }],
          }),
        ],
        [edge('t', 'find'), edge('find', 'new'), edge('new', 'save', 'true')],
      ),
    );
    const r1 = await run(ws, flow.id, { email: 'ada@x.com' });
    expect(r1.steps.find((s) => s.nodeId === 'save')?.output).toMatchObject({ created: true });
    const r2 = await run(ws, flow.id, { email: 'ada@x.com' });
    expect(r2.steps.find((s) => s.nodeId === 'find')?.output).toMatchObject({ found: true, count: 1, row: { email: 'ada@x.com', times: 1 } });
    expect(r2.steps.some((s) => s.nodeId === 'save')).toBe(false);

    const missing = await newFlow(ws, manual([node('x', 'data.table', { tableId: 'nope', operation: 'insert' })], [edge('t', 'x')]));
    expect((await run(ws, missing.id)).error).toBe('x: table_not_found');
  });

  it('API: crear tabla y filas, con errores legibles', async () => {
    const ws = (await makeUser('ta')).id;
    session.user = admin(ws);
    const created = await tablesRoute.POST(new NextRequest('http://x/api/flow/tables', json({ name: 'Leads', columns: [{ name: 'email', type: 'text' }] })));
    expect(created.status).toBe(201);
    const { table } = (await created.json()) as { table: { id: string } };
    const dup = await tablesRoute.POST(new NextRequest('http://x/api/flow/tables', json({ name: 'leads' })));
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe('duplicate_name');
    const reserved = await tablesRoute.POST(new NextRequest('http://x/api/flow/tables', json({ name: 'X', columns: [{ name: 'id', type: 'text' }] })));
    expect(((await reserved.json()) as { error: string }).error).toBe('reserved_column');
    const params = { params: Promise.resolve({ id: table.id }) };
    expect((await rowsRoute.POST(new NextRequest('http://x', json({ data: { email: 'a@x.com' } })), params)).status).toBe(201);
    const bad = await rowsRoute.POST(new NextRequest('http://x', json({ data: { other: 1 } })), params);
    expect(await bad.json()).toEqual({ error: 'unknown_column', column: 'other' });
    const list = (await (await rowsRoute.GET(new NextRequest('http://x'), params)).json()) as { total: number };
    expect(list.total).toBe(1);
    session.user = { ...admin(ws), role: 'member' };
    expect((await rowsRoute.POST(new NextRequest('http://x', json({ data: {} })), params)).status).toBe(403);
  });
});

// ---------- Probar un paso ----------

describe('Probar un paso con datos fijados', () => {
  it('corre un nodo solo con el contexto dado, sin crear corridas', async () => {
    const ws = (await makeUser('ts')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('a', 'data.set', { fields: [{ key: 'x', value: '1' }] }),
          node('b', 'data.set', { fields: [{ key: 'sum', value: '{{nodes.a.output.x}}-{{trigger.name}}' }] }),
          node('f', 'logic.filter', { combine: 'all', conditions: [{ left: '{{trigger.name}}', op: 'equals', right: 'Ada' }] }),
        ],
        [edge('t', 'a'), edge('a', 'b'), edge('b', 'f')],
      ),
    );
    const row = { id: flow.id, name: 'F', user_id: ws, created_by: ws, error_flow_id: null, enabled: 0, failure_alerts: 1, auto_replay: 0 };
    const b = flow.graph.nodes.find((n) => n.id === 'b')!;
    const res = await testFlowStep(row, b, { trigger: { name: 'Ada' }, nodes: { a: { x: 'pinned' } } });
    expect(res).toMatchObject({ status: 'success', output: { sum: 'pinned-Ada' }, handles: ['out'], error: null });
    const f = flow.graph.nodes.find((n) => n.id === 'f')!;
    expect((await testFlowStep(row, f, { trigger: { name: 'Bob' } })).status).toBe('skipped');
    const runs = (await getDb().prepare('SELECT COUNT(*) AS n FROM flow_runs WHERE flow_id = ?').get(flow.id)) as { n: number };
    expect(Number(runs.n)).toBe(0);

    expect(isStepTestable('logic.delay')).toBe(false);
    expect(isStepTestable('trigger.manual')).toBe(false);
    expect(isStepTestable('action.http')).toBe(true);
  });

  it('API: prueba con la config sin guardar y usa lo fijado si no mandan datos', async () => {
    const ws = (await makeUser('tsa')).id;
    session.user = admin(ws);
    const flow = await newFlow(
      ws,
      manual(
        [node('a', 'data.set', { fields: [{ key: 'x', value: '1' }] }), node('b', 'data.set', { fields: [] }), node('w', 'logic.delay', {})],
        [edge('t', 'a'), edge('a', 'b'), edge('b', 'w')],
      ),
    );
    const params = { params: Promise.resolve({ id: flow.id }) };
    const pin = await pinsRoute.PUT(new NextRequest('http://x', { ...json({ nodeId: 'a', output: { x: 'from-pin' } }), method: 'PUT' }), params);
    expect(pin.status).toBe(200);
    expect((await getFlow(ws, flow.id))?.pins).toEqual({ a: { x: 'from-pin' } });

    const res = await testStepRoute.POST(
      new NextRequest('http://x', json({ nodeId: 'b', node: { type: 'data.set', config: { fields: [{ key: 'y', value: '{{nodes.a.output.x}}!' }] } } })),
      params,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: { output: unknown } }).result.output).toEqual({ y: 'from-pin!' });

    const wait = await testStepRoute.POST(new NextRequest('http://x', json({ nodeId: 'w' })), params);
    expect(((await wait.json()) as { error: string }).error).toBe('step_not_testable');

    // Soltar, tope de tamaño y nodos que no existen.
    expect((await setFlowPin(ws, flow.id, 'a', null)).ok).toBe(true);
    expect((await getFlow(ws, flow.id))?.pins).toEqual({});
    expect(await setFlowPin(ws, flow.id, 'a', { big: 'x'.repeat(PIN_LIMIT) })).toEqual({ ok: false, error: 'pin_too_large' });
    expect(await setFlowPin(ws, flow.id, 'ghost', { a: 1 })).toEqual({ ok: false, error: 'node_not_found' });

    session.user = { ...admin(ws), role: 'member' };
    expect((await testStepRoute.POST(new NextRequest('http://x', json({ nodeId: 'b' })), params)).status).toBe(403);
  });
});

// ---------- Disparadores nuevos ----------

describe('Disparadores de Notes, Board, Agents, tareas, Chat y Cal', () => {
  const NEW_EVENTS = [
    'booking.declined',
    'booking.refunded',
    'conversation.assigned',
    'conversation.resolved',
    'conversation.rated',
    'note.created',
    'note.tagged',
    'note.trashed',
    'board.created',
    'board.deleted',
    'board.comment_created',
    'agent.conversation_started',
    'agent.handoff',
    'agent.feedback',
    'task.created',
    'task.completed',
    'task.due',
  ] as const;

  it('están en el catálogo, con ejemplo y nombre en los tres idiomas', () => {
    // 32 de antes, los nuevos de esta tanda y los 10 de Groups (mensajes, tickets, chats, miembros y votos).
    // + booking.reconfirmed (Cal: reconfirmación del invitado) y link.lead / link.sale (conversiones de Link).
    // + voice.meeting.completed y voice.notes.ready (Voice, ronda 2).
    expect(FLOW_EVENT_TYPES).toHaveLength(32 + NEW_EVENTS.length + 10 + 5 + 1 + 1 + 2 + 2);
    for (const ev of ['link.lead', 'link.sale'] as const) {
      expect(EVENT_SAMPLES[ev], ev).toBeTruthy();
      for (const l of ['en', 'es', 'pt']) {
        const m = JSON.parse(readFileSync(join(__dirname, '..', '..', 'messages', l, 'flow.json'), 'utf8')) as { events: Record<string, string> };
        expect(m.events[ev.replace(/\./g, '_')], `${l} ${ev}`).toBeTruthy();
      }
    }
    const root = join(__dirname, '..', '..');
    for (const ev of NEW_EVENTS) {
      expect(FLOW_EVENT_TYPES).toContain(ev);
      expect(EVENT_SAMPLES[ev], ev).toBeTruthy();
      for (const l of ['en', 'es', 'pt']) {
        const m = JSON.parse(readFileSync(join(root, 'messages', l, 'flow.json'), 'utf8')) as { events: Record<string, string> };
        expect(m.events[ev.replace(/\./g, '_')], `${l} ${ev}`).toBeTruthy();
      }
    }
    // Las notas nunca mandan su contenido.
    expect(JSON.stringify(EVENT_SAMPLES['note.created'])).not.toMatch(/content|body/);
  });

  async function eventFlow(ws: string, event: string) {
    const res = await createFlow(ws, ws, {
      name: event,
      graph: { nodes: [node('t', 'trigger.event', { event })], edges: [] },
    });
    if (!res.ok) throw new Error(res.error);
    const { updateFlow } = await import('@/lib/flow');
    await updateFlow(ws, res.flow.id, { enabled: true });
    return res.flow.id;
  }

  async function inputs(flowId: string) {
    const rows = (await getDb().prepare('SELECT input FROM flow_runs WHERE flow_id = ? ORDER BY created_at').all(flowId)) as Array<{ input: string }>;
    return rows.map((r) => JSON.parse(r.input) as Record<string, unknown>);
  }

  it('tareas del CRM: creada y completada', async () => {
    const ws = (await makeUser('ev-task')).id;
    const created = await eventFlow(ws, 'task.created');
    const completed = await eventFlow(ws, 'task.completed');
    const task = await createActivity(ws, { type: 'task', subject: 'Call Ada' });
    await createActivity(ws, { type: 'note', subject: 'Just a note' });
    expect(await inputs(created)).toMatchObject([{ task: { id: task.id, subject: 'Call Ada', done: false } }]);
    await updateActivity(ws, task.id, { done: true });
    await updateActivity(ws, task.id, { done: true });
    expect(await inputs(completed)).toMatchObject([{ task: { id: task.id, done: true } }]);
  });

  it('chat: asignada, resuelta y calificada', async () => {
    const ws = await makeUser('ev-chat');
    const widget = await createChatWidget(ws.id, null, { name: 'Site' });
    const visitor = await getOrCreateChatVisitor(widget.id, 'v1');
    const conv = await createChatConversation(widget.id, visitor.id);
    const assigned = await eventFlow(ws.id, 'conversation.assigned');
    const resolved = await eventFlow(ws.id, 'conversation.resolved');
    const rated = await eventFlow(ws.id, 'conversation.rated');
    await updateChatConversation(conv.id, { assignedTo: ws.id });
    await updateChatConversation(conv.id, { assignedTo: ws.id });
    await updateChatConversation(conv.id, { status: 'resolved' });
    await updateChatConversation(conv.id, { status: 'resolved' });
    await submitConversationCsat(conv.id, 5, 'Great');
    await submitConversationCsat(conv.id, 1, 'Again');
    expect(await inputs(assigned)).toMatchObject([{ assignee: { id: ws.id, email: ws.email }, widget: { name: 'Site' } }]);
    expect(await inputs(resolved)).toMatchObject([{ conversation: { id: conv.id, status: 'resolved' } }]);
    expect(await inputs(rated)).toMatchObject([{ rating: { score: 5, comment: 'Great' } }]);
  });
});
