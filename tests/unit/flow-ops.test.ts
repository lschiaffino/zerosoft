import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createContact, createDeal, createPipeline, createStage } from '@/lib/crm';
import { createCredential } from '@/lib/flow-credentials';
import {
  checkWebhookAuth,
  createFlow,
  enqueueRun,
  getFlowSettings,
  getRunWithSteps,
  listFlowWebhooks,
  pruneFlowRuns,
  rememberFlowLocale,
  updateFlow,
  updateFlowSettings,
  webhookAccepts,
} from '@/lib/flow';
import { buildFailureEmail, notifyRunFailure, replayRun } from '@/lib/flow-alerts';
import { crmFieldKey } from '@/lib/flow-app-nodes';
import { runFlowNow } from '@/lib/flow-http';
import { validateGraph, type FlowGraph } from '@/lib/flow-schema';
import { addTime, filterArgs, formatDate, inTimezone, renderString, renderValue, toDate } from '@/lib/flow-template';
import { processFlowQueue } from '@/lib/flow-worker';
import { createIssue, createProject, getIssue, listStatuses } from '@/lib/track-data';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const hookRoute = await import('@/app/api/flow/hooks/[token]/route');
const replayRoute = await import('@/app/api/flow/runs/[id]/replay/route');
const settingsRoute = await import('@/app/api/flow/settings/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  session.user = null;
});

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, config } as FlowGraph['nodes'][number];
}

function edge(source: string, target: string) {
  return { id: `${source}-${target}`, source, target, sourceHandle: null };
}

function graph(nodes: FlowGraph['nodes'], edges: FlowGraph['edges'] = []): FlowGraph {
  return { nodes, edges };
}

type RunDetail = NonNullable<Awaited<ReturnType<typeof getRunWithSteps>>>;
const step = (run: RunDetail | null, id: string) => run?.steps.find((s) => s.nodeId === id);

async function admin(label: string) {
  const u = await makeUser(label);
  session.user = { id: u.id, role: 'owner', email: u.email };
  return u;
}

/** Emails que salieron por el proveedor de consola (sin RESEND_API_KEY). */
function emailLog() {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  return () => spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[email:console]'));
}

describe('Flow: filtros de fecha y texto', () => {
  const NOON = '2026-03-10T15:04:05.000Z';

  it('date con formato, zona y presets', () => {
    expect(formatDate(NOON)).toBe('2026-03-10 15:04');
    expect(formatDate(NOON, 'DD/MM/YYYY HH:mm:ss')).toBe('10/03/2026 15:04:05');
    expect(formatDate(NOON, 'ddd D MMM YY, h:mm A')).toBe('Tue 10 Mar 26, 3:04 PM');
    expect(formatDate(NOON, 'HH:mm Z', 'America/Argentina/Buenos_Aires')).toBe('12:04 -03:00');
    expect(formatDate(NOON, '[Week of] YYYY-MM-DD')).toBe('Week of 2026-03-10');
    expect(formatDate(NOON, 'date')).toBe('2026-03-10');
    expect(formatDate(NOON, 'unix')).toBe(String(Date.parse(NOON) / 1000));
    expect(formatDate('2026-03-10 15:04:05', 'iso')).toBe(NOON);
    expect(formatDate(1773155045, 'iso')).toBe('2026-03-10T15:04:05.000Z');
    expect(formatDate('not a date')).toBeNull();
  });

  it('add_time respeta el calendario y el offset del texto', () => {
    expect(addTime('2026-01-31T10:00:00Z', 1, 'month')).toBe('2026-02-28T10:00:00.000Z');
    expect(addTime('2024-02-29T00:00:00Z', 1, 'years')).toBe('2025-02-28T00:00:00.000Z');
    expect(addTime(NOON, -90, 'minutes')).toBe('2026-03-10T13:34:05.000Z');
    expect(addTime(NOON, 2, '')).toBe('2026-03-12T15:04:05.000Z');
    expect(addTime('2026-03-10T12:00:00.000-03:00', 1, 'h')).toBe('2026-03-10T13:00:00.000-03:00');
    expect(addTime(NOON, 1, 'fortnights')).toBeNull();
    expect(addTime(NOON, 'x', 'days')).toBeNull();
  });

  it('timezone deja la hora de pared y date la conserva', () => {
    expect(inTimezone(NOON, 'Asia/Kolkata')).toBe('2026-03-10T20:34:05.000+05:30');
    expect(inTimezone(NOON, 'Nowhere/City')).toBeNull();
    const ctx = { trigger: { startsAt: NOON } };
    expect(
      renderString('{{trigger.startsAt | add_time:-1,hours | timezone:America/Argentina/Buenos_Aires | date:"DD/MM HH:mm"}}', ctx),
    ).toBe('10/03 11:04');
    // Si no es una fecha, el valor sigue igual.
    expect(renderString('{{trigger.x | date}}', { trigger: { x: 'soon' } })).toBe('soon');
    expect(toDate('2026-03-10')?.toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('replace, split y argumentos con comillas', () => {
    expect(filterArgs('"a, b","c"')).toEqual(['a, b', 'c']);
    expect(filterArgs(' x , y ')).toEqual(['x', 'y']);
    expect(filterArgs(undefined)).toEqual([]);
    const ctx = { trigger: { tags: 'red, green ,blue', phone: '+54 9 11-1234' } };
    expect(renderValue('{{trigger.tags | split}}', ctx)).toEqual(['red', 'green', 'blue']);
    expect(renderValue('{{trigger.tags | split:"," | length}}', ctx)).toBe(3);
    expect(renderString('{{trigger.phone | replace:" ","" | replace:"-",""}}', ctx)).toBe('+549111234');
    expect(renderString('{{trigger.tags | split | join:" / "}}', ctx)).toBe('red / green / blue');
    expect(renderValue('{{trigger.none | split}}', ctx)).toEqual([]);
  });
});

describe('Flow: acciones de CRM y Track', () => {
  it('actualiza un contacto por email (propiedades y custom) sin tocar otros workspaces', async () => {
    const ws = (await makeUser('crmup')).id;
    const other = (await makeUser('crmup-other')).id;
    const c = await createContact(ws, { email: 'ada@example.com', firstName: 'Ada', custom: { plan: 'free', seats: 1 } });
    const foreign = await createContact(other, { email: 'ada@example.com', firstName: 'Ajena' });
    const res = await createFlow(ws, ws, {
      name: 'crm',
      graph: graph(
        [
          node('t', 'trigger.manual', { sample: JSON.stringify({ email: 'ADA@example.com', plan: 'pro' }) }),
          node('u', 'app.crm_update', {
            entity: 'contact',
            email: '{{trigger.email}}',
            fields: [
              { key: 'job_title', value: 'CTO' },
              { key: 'lifecycleStage', value: 'customer' },
              { key: 'custom.plan', value: '{{trigger.plan}}' },
            ],
          }),
        ],
        [edge('t', 'u')],
      ),
    });
    if (!res.ok) throw new Error(res.error);
    const run = await runFlowNow(ws, res.flow.id, undefined);
    expect(run.ok && run.run?.status).toBe('success');
    const out = step(run.ok ? run.run : null, 'u')?.output as { id: string; changed: string[]; record: Record<string, unknown> };
    expect(out.id).toBe(c.id);
    expect(out.changed).toEqual(['jobTitle', 'lifecycleStage', 'custom']);
    expect(out.record).toMatchObject({ job_title: 'CTO', lifecycle_stage: 'customer', custom: { plan: 'pro', seats: 1 } });
    expect(out.record.user_id).toBeUndefined();
    const untouched = (await getDb().prepare('SELECT job_title FROM crm_contacts WHERE id = ?').get(foreign.id)) as { job_title: string };
    expect(untouched.job_title).toBe('');

    // Un id de otro workspace no se encuentra; una propiedad desconocida falla con su nombre.
    const bad = await createFlow(ws, ws, {
      name: 'crm bad',
      graph: graph(
        [
          node('t', 'trigger.manual', { sample: '{}' }),
          node('a', 'app.crm_update', { entity: 'contact', recordId: foreign.id, fields: [{ key: 'city', value: 'x' }], onError: 'continue' }),
          node('b', 'app.crm_update', { entity: 'contact', recordId: c.id, fields: [{ key: 'password', value: 'x' }] }),
        ],
        [edge('t', 'a'), edge('a', 'b')],
      ),
    });
    if (!bad.ok) throw new Error(bad.error);
    const r2 = await runFlowNow(ws, bad.flow.id, undefined);
    const detail = r2.ok ? r2.run : null;
    expect(step(detail, 'a')?.error).toBe('record_not_found');
    expect(step(detail, 'b')?.error).toBe('unknown_property (password)');
    expect(crmFieldKey('owner')).toBe('ownerId');
    expect(crmFieldKey('first_name')).toBe('firstName');
  });

  it('mueve un deal de etapa por nombre y crea una tarea con contacto por email y owner', async () => {
    const owner = await makeUser('crmtask');
    const ws = owner.id;
    const p = await createPipeline(ws, 'Sales');
    const lead = (await createStage(ws, p.id, { name: 'Lead' }))!;
    await createStage(ws, p.id, { name: 'Demo' });
    const created = await createDeal(ws, { pipelineId: p.id, stageId: lead.id, name: 'Acme', amount: 100 });
    if (!created.ok) throw new Error('deal');
    const contact = await createContact(ws, { email: 'bob@example.com', firstName: 'Bob' });
    const res = await createFlow(ws, ws, {
      name: 'deal',
      graph: graph(
        [
          node('t', 'trigger.manual', { sample: JSON.stringify({ deal: created.deal.id }) }),
          node('d', 'app.crm_update', { entity: 'deal', recordId: '{{trigger.deal}}', fields: [{ key: 'amount', value: '2,500' }], stage: 'demo' }),
          node('k', 'app.crm_task', {
            subject: 'Call {{nodes.d.output.record.name}}',
            dueIn: 2,
            dueUnit: 'hours',
            contactId: 'bob@example.com',
            dealId: '{{trigger.deal}}',
            owner: owner.email,
          }),
        ],
        [edge('t', 'd'), edge('d', 'k')],
      ),
    });
    if (!res.ok) throw new Error(res.error);
    const before = Date.now();
    const run = await runFlowNow(ws, res.flow.id, undefined);
    const detail = run.ok ? run.run : null;
    expect(detail?.status).toBe('success');
    expect(step(detail, 'd')?.output).toMatchObject({ stage: 'Demo', record: { amount: 2500, name: 'Acme' } });
    const task = (step(detail, 'k')?.output as { task: Record<string, string> }).task;
    expect(task).toMatchObject({ subject: 'Call Acme', contactId: contact.id, dealId: created.deal.id, ownerId: ws });
    const due = Date.parse(`${task.dueAt.replace(' ', 'T')}Z`);
    expect(due - before).toBeGreaterThan(2 * 3_600_000 - 5_000);
    expect(due - before).toBeLessThan(2 * 3_600_000 + 60_000);

    // Owner que no es del workspace y etapa inexistente fallan con códigos claros.
    const stranger = await makeUser('stranger');
    const bad = await createFlow(ws, ws, {
      name: 'bad task',
      graph: graph(
        [
          node('t', 'trigger.manual', { sample: '{}' }),
          node('k', 'app.crm_task', { subject: 'x', owner: stranger.email, onError: 'continue' }),
          node('d', 'app.crm_update', { entity: 'deal', recordId: created.deal.id, stage: 'Nope' }),
        ],
        [edge('t', 'k'), edge('k', 'd')],
      ),
    });
    if (!bad.ok) throw new Error(bad.error);
    const r2 = await runFlowNow(ws, bad.flow.id, undefined);
    expect(step(r2.ok ? r2.run : null, 'k')?.error).toBe('invalid_owner');
    expect(step(r2.ok ? r2.run : null, 'd')?.error).toBe('invalid_stage');
  });

  it('actualiza un issue de Track por identificador: status por nombre, prioridad, assignee y comentario', async () => {
    const owner = await makeUser('trk');
    const ws = owner.id;
    const project = await createProject(ws, null, { name: 'Engineering' });
    const issue = await createIssue(project.id, ws, { title: 'Bug', priority: 'low' }, { source: 'app' });
    const statuses = await listStatuses(project.id);
    const done = statuses.find((s) => s.category === 'done')!;
    const res = await createFlow(ws, ws, {
      name: 'trk',
      graph: graph(
        [
          node('t', 'trigger.manual', { sample: JSON.stringify({ id: issue.identifier.toLowerCase() }) }),
          node('u', 'app.track_update', {
            issue: '{{trigger.id}}',
            status: done.name.toUpperCase(),
            priority: 'urgent',
            assignee: owner.email,
            comment: 'Closed by a flow',
            dueDate: '2026-12-01T10:00:00Z',
          }),
        ],
        [edge('t', 'u')],
      ),
    });
    if (!res.ok) throw new Error(res.error);
    const run = await runFlowNow(ws, res.flow.id, undefined);
    const out = step(run.ok ? run.run : null, 'u')?.output as { issue: Record<string, unknown>; changed: string[]; commentId: string };
    expect(run.ok && run.run?.status).toBe('success');
    expect(out.issue).toMatchObject({ id: issue.id, status: done.name, priority: 'urgent', assigneeId: ws, dueDate: '2026-12-01' });
    expect(out.changed).toEqual(['statusId', 'priority', 'assigneeId', 'dueDate']);
    expect(out.commentId).toBeTruthy();
    expect((await getIssue(issue.id))?.status_id).toBe(done.id);

    // Un issue de otro workspace no se encuentra.
    const other = await makeUser('trk-other');
    const otherProject = await createProject(other.id, null, { name: 'Other' });
    const foreign = await createIssue(otherProject.id, other.id, { title: 'Ajeno' }, { source: 'app' });
    const bad = await createFlow(ws, ws, {
      name: 'trk bad',
      graph: graph(
        [node('t', 'trigger.manual', { sample: '{}' }), node('u', 'app.track_update', { issue: foreign.id, priority: 'high' })],
        [edge('t', 'u')],
      ),
    });
    if (!bad.ok) throw new Error(bad.error);
    const r2 = await runFlowNow(ws, bad.flow.id, undefined);
    expect(step(r2.ok ? r2.run : null, 'u')?.error).toBe('issue_not_found');
    expect((await getIssue(foreign.id))?.priority).not.toBe('high');
  });
});

describe('Flow: webhooks con método, autenticación y respuesta', () => {
  const call = (token: string, init: { method?: string; headers?: Record<string, string>; body?: string; query?: string } = {}) => {
    const method = init.method ?? 'POST';
    const req = new NextRequest(`http://localhost/api/flow/hooks/${token}${init.query ?? ''}`, {
      method,
      headers: init.headers,
      body: method === 'GET' ? undefined : (init.body ?? '{}'),
    });
    const props = { params: Promise.resolve({ token }) };
    return method === 'GET' ? hookRoute.GET(req, props) : hookRoute.POST(req, props);
  };

  async function hookFlow(ws: string, triggerConfig: Record<string, unknown>, rest: FlowGraph['nodes'] = [], edges: FlowGraph['edges'] = []) {
    const res = await createFlow(ws, ws, { name: 'hook', graph: graph([node('t', 'trigger.webhook', triggerConfig), ...rest], edges) });
    if (!res.ok) throw new Error(res.error);
    await updateFlow(ws, res.flow.id, { enabled: true });
    const [{ token }] = await listFlowWebhooks(ws, res.flow.id);
    return { flowId: res.flow.id, token };
  }

  it('acepta GET solo si el trigger lo permite', async () => {
    const ws = (await makeUser('hookget')).id;
    const post = await hookFlow(ws, {});
    expect((await call(post.token, { method: 'GET' })).status).toBe(405);
    expect((await call(post.token)).status).toBe(202);
    const get = await hookFlow(ws, { accept: 'get_only' });
    expect((await call(get.token)).status).toBe(405);
    const ok = await call(get.token, { method: 'GET', query: '?email=a%40b.co' });
    expect(ok.status).toBe(202);
    const { runId } = (await ok.json()) as { runId: string };
    await processFlowQueue();
    const run = await getRunWithSteps(ws, runId);
    expect(run?.input).toMatchObject({ method: 'GET', query: { email: 'a@b.co' } });
    expect(webhookAccepts('get_post', 'get')).toBe(true);
    expect(webhookAccepts(undefined, 'GET')).toBe(false);
  });

  it('exige el header de la credencial y no lo pasa al flow', async () => {
    const ws = (await makeUser('hookauth')).id;
    const cred = await createCredential(ws, ws, { name: 'hook-key', type: 'api_key', data: { headerName: 'X-Api-Key', value: 'k_secret_123' } });
    if (!cred.ok) throw new Error('cred');
    const { token } = await hookFlow(ws, { authCredentialId: cred.credential.id });
    expect((await call(token)).status).toBe(401);
    expect((await call(token, { headers: { 'x-api-key': 'wrong' } })).status).toBe(401);
    const ok = await call(token, { headers: { 'x-api-key': 'k_secret_123', 'x-other': '1', 'content-type': 'application/json' } });
    expect(ok.status).toBe(202);
    const { runId } = (await ok.json()) as { runId: string };
    const run = await getRunWithSteps(ws, runId);
    const headers = (run?.input as { headers: Record<string, string> }).headers;
    expect(headers['x-other']).toBe('1');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('usuario y contraseña (Basic) con WWW-Authenticate', async () => {
    const ws = (await makeUser('hookbasic')).id;
    const cred = await createCredential(ws, ws, { name: 'hook-basic', type: 'basic', data: { username: 'ada', password: 'p4ss-word' } });
    if (!cred.ok) throw new Error('cred');
    const { token } = await hookFlow(ws, { authCredentialId: cred.credential.id });
    const denied = await call(token);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toContain('Basic');
    const auth = `Basic ${Buffer.from('ada:p4ss-word').toString('base64')}`;
    expect((await call(token, { headers: { authorization: auth } })).status).toBe(202);
    const wrong = `Basic ${Buffer.from('ada:nope').toString('base64')}`;
    expect((await call(token, { headers: { authorization: wrong } })).status).toBe(401);
    expect(checkWebhookAuth({ type: 'api_key', data: { headerName: 'Authorization', prefix: 'Bearer', value: 'tok_1' } }, () => 'Bearer tok_1')).toBe(true);
  });

  it('responde con el nodo Responder al webhook (o 500 si la corrida falla)', async () => {
    const ws = (await makeUser('hookreply')).id;
    const { token } = await hookFlow(
      ws,
      { respond: 'reply_node' },
      [
        node('s', 'data.set', { fields: [{ key: 'greeting', value: 'Hi {{trigger.body.name}}' }] }),
        node('r', 'action.webhook_reply', {
          statusCode: 201,
          contentType: 'json',
          body: '{"message": {{nodes.s.output.greeting | json}}}',
          headers: [
            { key: 'x-flow', value: 'yes' },
            { key: 'set-cookie', value: 'a=b' },
          ],
        }),
      ],
      [edge('t', 's'), edge('s', 'r')],
    );
    const res = await call(token, { body: JSON.stringify({ name: 'Ada' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ message: 'Hi Ada' });
    expect(res.headers.get('x-flow')).toBe('yes');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('content-security-policy')).toBe('sandbox');

    const failing = await hookFlow(
      ws,
      { respond: 'reply_node' },
      [node('j', 'data.json_parse', { text: 'not json' }), node('r', 'action.webhook_reply', { body: '{}' })],
      [edge('t', 'j'), edge('j', 'r')],
    );
    const bad = await call(failing.token);
    expect(bad.status).toBe(500);
    expect(await bad.json()).toMatchObject({ ok: false, error: 'flow_failed' });
    expect(validateGraph(graph([node('t', 'trigger.webhook', { respond: 'reply_node' }), node('r', 'action.webhook_reply')], [edge('t', 'r')])).ok).toBe(true);
  });
});

describe('Flow: avisos de falla y replay', () => {
  async function failingFlow(ws: string, actor: string, opts: { autoReplay?: boolean } = {}) {
    const res = await createFlow(ws, actor, {
      name: 'Nightly sync',
      graph: graph(
        [node('t', 'trigger.webhook'), node('a', 'data.set', { fields: [{ key: 'n', value: '1' }] }), node('j', 'data.json_parse', { text: 'oops' })],
        [edge('t', 'a'), edge('a', 'j')],
      ),
    });
    if (!res.ok) throw new Error(res.error);
    await updateFlow(ws, res.flow.id, { enabled: true, autoReplay: opts.autoReplay ?? false });
    return res.flow.id;
  }

  async function failRun(ws: string, flowId: string) {
    const id = await enqueueRun({ id: flowId, user_id: ws }, 'trigger.webhook', { method: 'POST', body: {}, query: {}, headers: {} });
    await processFlowQueue();
    return (await getRunWithSteps(ws, id!))!;
  }

  it('manda como mucho un email por flow y hora, al dueño, y no por pruebas manuales', async () => {
    const owner = await makeUser('alerts');
    const ws = owner.id;
    const flowId = await failingFlow(ws, ws);
    const sent = emailLog();
    expect((await failRun(ws, flowId)).status).toBe('failed');
    expect((await failRun(ws, flowId)).status).toBe('failed');
    const mails = sent();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain(`to=${owner.email}`);
    expect(mails[0]).toContain('Flow failed: Nightly sync');
    // Pruebas manuales: no avisan.
    await getDb().prepare('UPDATE flow_flows SET failure_email_at = NULL WHERE id = ?').run(flowId);
    await runFlowNow(ws, flowId, undefined);
    expect(sent()).toHaveLength(1);
    // Apagado en el flow: tampoco.
    await updateFlow(ws, flowId, { failureAlerts: false });
    await failRun(ws, flowId);
    expect(sent()).toHaveLength(1);
  });

  it('el email sale en el idioma del workspace y ofrece el replay', async () => {
    const mail = buildFailureEmail({
      locale: 'es',
      flowName: 'Sync',
      error: 'j: invalid_json',
      failedNode: 'j',
      runUrl: 'https://zerosoft.ai/es/app/flow/f1?run=r1',
      failedAt: '2026-03-10T15:04:05.000Z',
      replayAt: null,
    });
    expect(mail.subject).toBe('Falló un flow: Sync');
    expect(mail.text).toContain('Error: invalid_json');
    expect(mail.text).toContain('Replay');
    expect(mail.html).toContain('https://zerosoft.ai/es/app/flow/f1?run=r1');
    const auto = buildFailureEmail({ locale: 'en', flowName: 'Sync', error: null, failedNode: null, runUrl: 'u', failedAt: '2026-03-10T15:04:05.000Z', replayAt: '2026-03-10T15:19:05.000Z' });
    expect(auto.text).toContain('2026-03-10 15:19 UTC');

    const ws = (await makeUser('locale')).id;
    await rememberFlowLocale(ws, 'pt');
    expect(await getFlowSettings(ws)).toEqual({ retentionDays: 30, locale: 'pt' });
    await rememberFlowLocale(ws, 'xx');
    expect((await getFlowSettings(ws)).locale).toBe('pt');
    const flow = { id: 'nope', name: 'x', user_id: ws, created_by: ws, failure_alerts: 1, auto_replay: 0 };
    const run = { id: 'r', trigger_type: 'manual', rerun_of: null, created_at: '' };
    expect(await notifyRunFailure({ flow, run, error: 'x', failedNode: null, replayAt: null })).toBe(false);
  });

  it('replay manual desde el paso que falló, y replay automático una sola vez', async () => {
    const owner = await admin('replay');
    const ws = owner.id;
    emailLog();
    const flowId = await failingFlow(ws, ws, { autoReplay: true });
    const failed = await failRun(ws, flowId);
    expect(failed.status).toBe('failed');
    expect(failed.replayAt).toBeTruthy();

    // Se corrige el nodo y se hace replay: el paso anterior reusa su salida.
    const fixed = graph(
      [node('t', 'trigger.webhook'), node('a', 'data.set', { fields: [{ key: 'n', value: '1' }] }), node('j', 'data.json_parse', { text: '{"ok": true}' })],
      [edge('t', 'a'), edge('a', 'j')],
    );
    await updateFlow(ws, flowId, { graph: fixed });
    const res = await replayRoute.POST(new NextRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: failed.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: RunDetail; mode: string };
    expect(body.mode).toBe('from_step');
    expect(body.run.status).toBe('success');
    expect(body.run.rerunOf).toBe(failed.id);
    expect(step(body.run, 'j')?.output).toEqual({ ok: true });
    // El replay manual reemplaza al automático agendado.
    expect((await getRunWithSteps(ws, failed.id))?.replayAt).toBeNull();
    const again = await replayRoute.POST(new NextRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: body.run.id }) });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: 'run_not_failed' });

    // Automático: otra falla, se corrige y el worker la repite pasado el plazo.
    await updateFlow(ws, flowId, {
      graph: graph(
        [node('t', 'trigger.webhook'), node('a', 'data.set', { fields: [{ key: 'n', value: '1' }] }), node('j', 'data.json_parse', { text: 'oops' })],
        [edge('t', 'a'), edge('a', 'j')],
      ),
    });
    const second = await failRun(ws, flowId);
    expect(second.replayAt).toBeTruthy();
    await updateFlow(ws, flowId, { graph: fixed });
    const early = await processFlowQueue();
    expect(early.replays).toBe(0);
    const later = await processFlowQueue({ now: new Date(Date.now() + 16 * 60_000) });
    expect(later.replays).toBe(1);
    const replays = (await getDb()
      .prepare("SELECT id, status FROM flow_runs WHERE rerun_of = ? AND status = 'success'")
      .all(second.id)) as Array<{ id: string }>;
    expect(replays).toHaveLength(1);
    expect((await processFlowQueue({ now: new Date(Date.now() + 16 * 60_000) })).replays).toBe(0);

    // Sin paso fallido (p. ej. rate_limited): replay completo con el mismo input.
    const ts = new Date().toISOString();
    await getDb()
      .prepare(
        `INSERT INTO flow_runs (id, flow_id, user_id, trigger_type, status, input, error, chain_seen, created_at, started_at, finished_at, captured_by)
         VALUES ('rl-run', ?, ?, 'trigger.webhook', 'failed', '{"body":{}}', 'rate_limited', '[]', ?, ?, ?, (SELECT created_by FROM flow_flows WHERE id = ?))`,
      )
      .run(flowId, ws, ts, ts, ts, flowId);
    const full = await replayRun(ws, 'rl-run');
    expect(full).toMatchObject({ ok: true, mode: 'full', status: 'success' });
    expect(await replayRun((await makeUser('nobody')).id, 'rl-run')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('Flow: retención del historial', () => {
  it('borra corridas y pasos viejos por lotes, según la retención de cada workspace', async () => {
    const a = (await makeUser('ret-a')).id;
    const b = (await makeUser('ret-b')).id;
    const mk = async (ws: string) => {
      const res = await createFlow(ws, ws, { name: 'r', graph: graph([node('t', 'trigger.manual', { sample: '{}' })]) });
      if (!res.ok) throw new Error(res.error);
      return res.flow.id;
    };
    const fa = await mk(a);
    const fb = await mk(b);
    await updateFlowSettings(a, { retentionDays: 7 });
    const db = getDb();
    const insert = async (flowId: string, ws: string, daysAgo: number, status = 'success', id = crypto.randomUUID()) => {
      const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
      await db
        .prepare(
          `INSERT INTO flow_runs (id, flow_id, user_id, trigger_type, status, input, chain_seen, created_at, started_at, finished_at)
           VALUES (?, ?, ?, 'manual', ?, '{}', '[]', ?, ?, ?)`,
        )
        .run(id, flowId, ws, status, at, at, at);
      await db
        .prepare("INSERT INTO flow_steps (id, run_id, node_id, node_type, status, started_at) VALUES (?, ?, 't', 'trigger.manual', 'success', ?)")
        .run(crypto.randomUUID(), id, at);
      return id;
    };
    const aOld = await insert(fa, a, 10);
    const aOlder = await insert(fa, a, 12, 'failed');
    const aWaiting = await insert(fa, a, 20, 'waiting');
    const aRecent = await insert(fa, a, 3);
    const bOld = await insert(fb, b, 10);
    const bVeryOld = await insert(fb, b, 40);
    const bOldest = await insert(fb, b, 45);

    const res = await pruneFlowRuns({ batch: 1, maxBatches: 50 });
    const left = new Set(((await db.prepare('SELECT id FROM flow_runs WHERE flow_id IN (?, ?)').all(fa, fb)) as Array<{ id: string }>).map((r) => r.id));
    expect(left.has(aOld)).toBe(false);
    expect(left.has(aOlder)).toBe(false);
    expect(left.has(aWaiting)).toBe(true);
    expect(left.has(aRecent)).toBe(true);
    expect(left.has(bOld)).toBe(true);
    expect(left.has(bVeryOld)).toBe(false);
    expect(left.has(bOldest)).toBe(false);
    expect(res.runs).toBe(4);
    expect(res.batches).toBe(4);
    const orphanSteps = (await db.prepare('SELECT COUNT(*) AS n FROM flow_steps WHERE run_id IN (?, ?, ?)').get(aOld, aOlder, bVeryOld)) as { n: number };
    expect(Number(orphanSteps.n)).toBe(0);
    // Tope de lotes: una pasada con maxBatches 1 borra como mucho un lote.
    await insert(fa, a, 30);
    await insert(fa, a, 31);
    expect((await pruneFlowRuns({ batch: 1, maxBatches: 1 })).runs).toBe(1);
    expect((await pruneFlowRuns({ batch: 1, maxBatches: 1 })).runs).toBe(1);
  });

  it('ajustes por API: solo valores de la lista y solo admins', async () => {
    const u = await admin('ret-api');
    const patch = (body: unknown) =>
      settingsRoute.PATCH(new NextRequest('http://localhost/api/flow/settings', { method: 'PATCH', body: JSON.stringify(body) }));
    expect((await patch({ retentionDays: 3 })).status).toBe(400);
    const ok = await patch({ retentionDays: 90, locale: 'es' });
    expect(await ok.json()).toEqual({ settings: { retentionDays: 90, locale: 'es' } });
    expect(await getFlowSettings(u.id)).toEqual({ retentionDays: 90, locale: 'es' });
    session.user = { id: u.id, role: 'member' };
    expect((await patch({ retentionDays: 7 })).status).toBe(403);
    expect((await (await settingsRoute.GET()).json()).settings.retentionDays).toBe(90);
  });
});
