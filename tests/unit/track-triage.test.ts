import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { createIssue, createProject, getIssue, listStatuses, updateIssue, updateProject } from '@/lib/track-data';
import { findOrCreateLabel } from '@/lib/track-labels';
import { getDb } from '@/lib/db';
import {
  currentTriageOwner,
  emailDomain,
  nextTriageHandoff,
  planTriageRules,
  slaRiskAt,
  slaState,
  stateAfterActivity,
} from '@/lib/track-triage-shared';
import { createTriageRule, listTriageRules, snoozeTriageIssue, updateTriageRule, updateTriageSettings } from '@/lib/track-triage';
import { getIssueSla, runSlaChecks } from '@/lib/track-sla';
import { createCustomerRequest, listCustomers, listIssueRequests, matchCrmCustomer } from '@/lib/track-customers';
import { decideSuggestion, generateTriageSuggestions, heuristicSuggestions, summarizeIssue } from '@/lib/track-ai';
import {
  addAgentActivity,
  appByToken,
  createAgentApp,
  delegateIssue,
  getSession,
  processAgentSession,
  sessionForApp,
  signPayload,
} from '@/lib/track-agents';
import { listTriageIssues } from '@/lib/track-bulk';
import { createApiKey } from '@/lib/api-auth';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
const jobs = vi.hoisted(() => [] as Array<() => Promise<void>>);
/** Corre lo que quedó en after() (webhooks, agentes, IA en segundo plano). */
async function flush() {
  while (jobs.length) await jobs.shift()!().catch(() => {});
}
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    jobs.push(task);
  },
}));
vi.mock('@/lib/events', () => ({ emitEvent: async () => {}, emitEventSoon: async () => {} }));

const insightsRoute = await import('@/app/api/track/issues/[id]/insights/route');
const requestsRoute = await import('@/app/api/track/issues/[id]/customer-requests/route');
const v1Requests = await import('@/app/api/v1/track/requests/route');
const v1Activities = await import('@/app/api/v1/track/agent-sessions/[id]/activities/route');
const rulesRoute = await import('@/app/api/track/projects/[id]/triage-rules/route');

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://x/t', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

beforeAll(() => {
  process.env.TRACK_AI_FAKE = '1';
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.AI_FREE_TOKENS_PER_MONTH = 'unlimited';
});
afterAll(() => {
  delete process.env.TRACK_AI_FAKE;
});

async function triageProject() {
  const owner = await makeUser('tri');
  const project = await createProject(owner.id, null, { name: `T ${crypto.randomUUID().slice(0, 6)}` });
  await updateProject(project.id, { triageEnabled: true });
  session.user = { ...owner, team: null, role: 'owner' };
  return { owner, project };
}

describe('Track T3: lógica pura', () => {
  it('rota el responsable de triage por día o semana desde el ancla', () => {
    const s = { ownerIds: ['a', 'b', 'c'], ownerRotation: 'weekly' as const, ownerAnchor: '2026-10-05' };
    expect(currentTriageOwner(s, new Date('2026-10-06T10:00:00Z'))).toBe('a');
    expect(currentTriageOwner(s, new Date('2026-10-13T10:00:00Z'))).toBe('b');
    expect(currentTriageOwner(s, new Date('2026-10-27T10:00:00Z'))).toBe('a');
    expect(currentTriageOwner({ ...s, ownerRotation: 'daily' }, new Date('2026-10-07T01:00:00Z'))).toBe('c');
    expect(nextTriageHandoff(s, new Date('2026-10-06T10:00:00Z'))?.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(currentTriageOwner({ ...s, ownerIds: [] })).toBeNull();
  });

  it('las reglas corren en orden: gana la de arriba y los labels se suman', () => {
    const subject = { source: 'chat', title: 'Checkout crash on iOS', description: '', priority: 'medium', labelIds: [], customers: ['Acme'] };
    const plan = planTriageRules(
      [
        { id: '1', name: 'Crashes', position: 0, enabled: true, conditions: [{ field: 'text', op: 'contains', values: ['crash'] }], actions: { priority: 'urgent', labelIds: ['bug'] } },
        { id: '2', name: 'Chat', position: 1, enabled: true, conditions: [{ field: 'source', op: 'is', values: ['chat', 'api'] }], actions: { priority: 'low', labelIds: ['support'] } },
        { id: '3', name: 'Off', position: 2, enabled: false, conditions: [], actions: { assigneeId: 'x' } },
        { id: '4', name: 'Not GitHub', position: 3, enabled: true, conditions: [{ field: 'source', op: 'is_not', values: ['github'] }, { field: 'customer', op: 'contains', values: ['acme'] }], actions: { assigneeId: 'ana' } },
      ],
      subject,
    );
    expect(plan.matched.map((m) => m.id)).toEqual(['1', '2', '4']);
    expect(plan.actions).toEqual({ priority: 'urgent', labelIds: ['bug', 'support'], assigneeId: 'ana' });
    expect(plan.conflicts).toEqual(['priority']);
  });

  it('SLA: en riesgo en el último cuarto (máximo 24 h), vencido y cumplido', () => {
    const start = new Date('2026-10-01T00:00:00Z');
    expect(slaRiskAt(start, 24).toISOString()).toBe('2026-10-01T18:00:00.000Z');
    expect(slaRiskAt(start, 168).toISOString()).toBe('2026-10-07T00:00:00.000Z');
    const sla = { riskAt: '2026-10-01T18:00:00.000Z', dueAt: '2026-10-02T00:00:00.000Z', completedAt: null };
    expect(slaState(sla, new Date('2026-10-01T10:00:00Z'))).toBe('on_track');
    expect(slaState(sla, new Date('2026-10-01T19:00:00Z'))).toBe('at_risk');
    expect(slaState(sla, new Date('2026-10-02T01:00:00Z'))).toBe('breached');
    expect(slaState({ ...sla, completedAt: '2026-10-01T20:00:00.000Z' })).toBe('met');
    expect(slaState({ ...sla, completedAt: '2026-10-03T00:00:00.000Z' })).toBe('failed');
  });

  it('estado de la sesión del agente según la última actividad; dominios personales no cuentan', () => {
    expect(stateAfterActivity('thought', 'pending')).toBe('active');
    expect(stateAfterActivity('elicitation', 'active')).toBe('awaiting_input');
    expect(stateAfterActivity('response', 'active')).toBe('complete');
    expect(stateAfterActivity('prompt', 'complete')).toBe('pending');
    expect(stateAfterActivity('response', 'stopped')).toBe('stopped');
    expect(emailDomain('ana@Acme.io')).toBe('acme.io');
    expect(emailDomain('ana@gmail.com')).toBeNull();
  });
});

describe('Track T3: entrada a triage', () => {
  it('las reglas fijan prioridad, labels y asignado; el responsable de turno recibe aviso; snooze oculta de la cola', async () => {
    const { owner, project } = await triageProject();
    const bug = await findOrCreateLabel(owner.id, 'Bug');
    await createTriageRule(project.id, { name: 'Crashes', conditions: [{ field: 'text', op: 'contains', values: ['crash'] }], actions: { priority: 'urgent', labelIds: [bug.id], assigneeId: owner.id } }, owner.id);
    await updateTriageSettings(project.id, { ownerIds: [owner.id], ownerAction: 'notify' });
    const issue = await createIssue(project.id, owner.id, { title: 'App crash at checkout', description: [] }, { source: 'chat' });
    expect(issue.triage).toBe(1);
    expect(issue.priority).toBe('urgent');
    expect(issue.assignee_id).toBe(owner.id);
    expect(JSON.parse(issue.labels).map((l: { id: string }) => l.id)).toEqual([bug.id]);
    const notes = (await getDb().prepare("SELECT * FROM notifications WHERE user_id = ? AND source_type = 'track_triage'").all(owner.id)) as unknown[];
    expect(notes).toHaveLength(1);

    // Un issue creado desde la app no pasa por triage ni por las reglas.
    const own = await createIssue(project.id, owner.id, { title: 'crash too' }, { source: 'app' });
    expect(own.triage).toBe(0);
    expect(own.priority).toBe('medium');

    expect((await listTriageIssues(project.id)).map((i) => i.id)).toContain(issue.id);
    await snoozeTriageIssue(issue.id, new Date(Date.now() + 3_600_000).toISOString(), owner.id);
    expect((await listTriageIssues(project.id)).map((i) => i.id)).not.toContain(issue.id);
    expect((await listTriageIssues(project.id, { snoozed: true })).map((i) => i.id)).toEqual([issue.id]);
  });

  it('una regla puede aceptar el issue directo en un estado; el orden se cambia moviendo la regla', async () => {
    const { owner, project } = await triageProject();
    const statuses = await listStatuses(project.id);
    const todo = statuses.find((s) => s.category === 'todo')!;
    const a = await createTriageRule(project.id, { name: 'A', conditions: [], actions: { priority: 'low' } }, owner.id);
    const b = await createTriageRule(project.id, { name: 'B', conditions: [{ field: 'source', op: 'is', values: ['api'] }], actions: { priority: 'high', acceptStatusId: todo.id } }, owner.id);
    await updateTriageRule(b, { position: 0 });
    expect((await listTriageRules(project.id)).map((r) => r.id)).toEqual([b.id, a.id]);
    const issue = await createIssue(project.id, owner.id, { title: 'From API' }, { source: 'api' });
    expect(issue.triage).toBe(0);
    expect(issue.status_id).toBe(todo.id);
    expect(issue.priority).toBe('high');
  });

  it('la ruta de reglas valida que el asignado sea del proyecto', async () => {
    const { project } = await triageProject();
    const res = await rulesRoute.POST(req('POST', { name: 'X', conditions: [], actions: { assigneeId: 'nobody' } }), params(project.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_member');
  });
});

describe('Track T3: SLAs', () => {
  it('arranca con la prioridad, cambia con ella, se cumple al cerrar y avisa una sola vez', async () => {
    const { owner, project } = await triageProject();
    await updateTriageSettings(project.id, { slaEnabled: true, slaHours: { urgent: 24, high: 168 } });
    const issue = await createIssue(project.id, owner.id, { title: 'Down', priority: 'urgent' }, { source: 'app' });
    const sla = await getIssueSla(issue.id);
    expect(sla?.priority).toBe('urgent');
    expect(Date.parse(sla!.dueAt) - Date.parse(sla!.startedAt)).toBe(24 * 3_600_000);

    await updateIssue(issue.id, { priority: 'high' }, owner.id);
    expect(Date.parse((await getIssueSla(issue.id))!.dueAt) - Date.parse(sla!.startedAt)).toBe(168 * 3_600_000);
    await updateIssue(issue.id, { priority: 'low' }, owner.id);
    expect(await getIssueSla(issue.id)).toBeNull();

    // Vencido: el cron avisa una vez aunque corra dos veces en paralelo.
    await updateIssue(issue.id, { priority: 'urgent' }, owner.id);
    const later = new Date(Date.now() + 25 * 3_600_000);
    const [r1, r2] = await Promise.all([runSlaChecks({ now: later }), runSlaChecks({ now: later })]);
    expect(r1.breach + r2.breach).toBe(1);
    const notes = (await getDb().prepare("SELECT meta FROM notifications WHERE source_type = 'track_sla' AND source_id = ?").all(issue.id)) as Array<{ meta: string }>;
    expect(notes.map((n) => JSON.parse(n.meta).kind)).toEqual(['sla_breach']);

    const done = (await listStatuses(project.id)).find((s) => s.category === 'done')!;
    await updateIssue(issue.id, { statusId: done.id }, owner.id);
    const closed = await getIssueSla(issue.id);
    expect(closed?.completedAt).toBeTruthy();
    expect(closed?.state).toBe('met');
    // Las listas traen el vencimiento solo mientras está abierto.
    expect((await getIssue(issue.id))?.sla_due_at).toBeNull();
  });
});

describe('Track T3: pedidos de clientes', () => {
  it('asocia por dominio a la empresa del CRM, suma demanda e ingresos y la ruta respeta el workspace', async () => {
    const { owner, project } = await triageProject();
    const db = getDb();
    const companyId = crypto.randomUUID();
    await db.prepare("INSERT INTO crm_companies (id, user_id, name, domain) VALUES (?, ?, 'Acme', 'acme.io')").run(companyId, owner.id);
    const pipe = crypto.randomUUID();
    const stage = crypto.randomUUID();
    await db.prepare("INSERT INTO crm_pipelines (id, user_id, name) VALUES (?, ?, 'P')").run(pipe, owner.id);
    await db.prepare("INSERT INTO crm_stages (id, pipeline_id, name, is_won) VALUES (?, ?, 'Won', 1)").run(stage, pipe);
    const deal = crypto.randomUUID();
    await db.prepare("INSERT INTO crm_deals (id, user_id, pipeline_id, stage_id, name, amount) VALUES (?, ?, ?, ?, 'D', 5000)").run(deal, owner.id, pipe, stage);
    await db.prepare('INSERT INTO crm_deal_companies (deal_id, company_id, user_id) VALUES (?, ?, ?)').run(deal, companyId, owner.id);

    expect(await matchCrmCustomer(owner.id, 'ana@acme.io')).toEqual({ companyId, contactId: null });
    const a = await createIssue(project.id, owner.id, { title: 'Export to PDF' }, { source: 'app' });
    const b = await createIssue(project.id, owner.id, { title: 'Dark mode' }, { source: 'app' });
    await createCustomerRequest(owner.id, a.id, { customerEmail: 'ana@acme.io', body: 'We need PDF exports', important: true, source: 'email' }, owner.id);
    await createCustomerRequest(owner.id, a.id, { customerName: 'Globex' }, owner.id);
    await createCustomerRequest(owner.id, b.id, { customerName: 'Initech' }, owner.id);
    const rows = await listIssueRequests(a.id);
    expect(rows.map((r) => r.customer)).toEqual(['Acme', 'Globex']);
    expect(rows[0].important).toBe(true);

    const withDemand = await getIssue(a.id);
    expect(withDemand?.customer_count).toBe(2);
    expect(withDemand?.customer_revenue).toBe(5000);
    const customers = await listCustomers(owner.id, [project.id]);
    expect(customers.find((c) => c.name === 'Acme')).toMatchObject({ requests: 1, important: 1, revenue: 5000, openIssues: 1 });

    // Otro workspace no ve ni agrega pedidos a este issue.
    const other = await makeUser('other');
    session.user = { ...other, team: null, role: 'owner' };
    expect((await requestsRoute.POST(req('POST', { customerName: 'X' }), params(a.id))).status).toBe(404);
    expect((await insightsRoute.GET(req('GET'), params(a.id))).status).toBe(404);
  });

  it('API v1: un pedido por email crea el issue en triage con su cita y corre las reglas', async () => {
    const { owner, project } = await triageProject();
    await createTriageRule(project.id, { name: 'Customers', conditions: [{ field: 'customer', op: 'contains', values: ['initech'] }], actions: { priority: 'high' } }, owner.id);
    const { key } = await createApiKey(owner.id, 'k', owner.id, ['track:write']);
    const res = await v1Requests.POST(
      new Request('http://x/api/v1/track/requests', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, title: 'Invoices are wrong', body: 'Totals do not add up', customer: { email: 'bob@initech.com', name: 'Initech' }, source: 'email' }),
      }),
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    const issue = await getIssue(data.issue.id);
    expect(issue?.triage).toBe(1);
    expect(issue?.priority).toBe('high');
    expect((await listIssueRequests(issue!.id))[0]).toMatchObject({ source: 'email', body: 'Totals do not add up' });
  });
});

describe('Track T3: IA (modelo falso)', () => {
  it('sugiere label, duplicado y asignado; aceptar aplica al issue', async () => {
    const { owner, project } = await triageProject();
    const label = await findOrCreateLabel(owner.id, 'Billing');
    const prev = await createIssue(project.id, owner.id, { title: 'Billing invoice totals wrong', assigneeId: owner.id }, { source: 'app' });
    const issue = await createIssue(project.id, owner.id, { title: 'Billing invoice totals wrong again' }, { source: 'api' });
    const list = await generateTriageSuggestions(issue.id, { actorId: owner.id });
    const kinds = list.map((s) => s.kind).sort();
    expect(kinds).toEqual(['assignee', 'duplicate', 'labels']);
    expect(list.find((s) => s.kind === 'duplicate')?.value).toBe(prev.id);
    const lab = list.find((s) => s.kind === 'labels')!;
    expect(lab.value).toBe(label.id);
    await decideSuggestion(issue.id, lab.id, 'accept', owner.id);
    expect(JSON.parse((await getIssue(issue.id))!.labels).map((l: { id: string }) => l.id)).toEqual([label.id]);
    const after = await decideSuggestion(issue.id, list.find((s) => s.kind === 'assignee')!.id, 'dismiss', owner.id);
    expect(after.find((s) => s.kind === 'assignee')?.status).toBe('dismissed');
    expect((await getIssue(issue.id))?.assignee_id).toBeNull();

    const sum = await summarizeIssue(issue.id);
    expect(sum.summary).toContain('Billing invoice totals wrong again');
    const usage = (await getDb().prepare("SELECT feature FROM ai_usage WHERE user_id = ? AND feature LIKE 'track_%'").all(owner.id)) as Array<{ feature: string }>;
    expect(usage.map((u) => u.feature)).toEqual(expect.arrayContaining(['track_triage_ai', 'track_issue_summary']));
  });

  it('la heurística no inventa labels que no aparecen', () => {
    const out = heuristicSuggestions({ title: 'Login page is slow', description: '', priority: 'medium' }, { members: [], labels: [{ id: 'l1', name: 'Billing' }], issues: [] });
    expect(out.labels).toEqual([]);
    expect(out.duplicates).toEqual([]);
  });
});

describe('Track T3: agentes que trabajan issues', () => {
  it('agente externo: webhook firmado al delegar y respuestas por la API con su token', async () => {
    const { owner, project } = await triageProject();
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
    const calls: Array<{ body: string; sig: string | null }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push({ body: String(init?.body), sig: new Headers(init?.headers).get('x-zerosoft-signature') });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    try {
      const { app, token, signingSecret } = await createAgentApp(owner.id, { name: 'Coder', webhookUrl: 'http://127.0.0.1:9/hook' }, owner.id);
      expect((await appByToken(token))?.id).toBe(app.id);
      const issue = await createIssue(project.id, owner.id, { title: 'Fix the login' }, { source: 'app' });
      const s = await delegateIssue(issue, owner.id, { kind: 'external', id: app.id }, owner.id, 'Please take it');
      await flush();
      expect(calls).toHaveLength(1);
      const payload = JSON.parse(calls[0].body);
      expect(payload).toMatchObject({ type: 'AgentSessionEvent', action: 'created', agentSession: { id: s.id, issue: { identifier: issue.identifier } } });
      expect(payload.agentActivity.body).toBe('Please take it');
      expect(calls[0].sig).toBe(`sha256=${createHmac('sha256', signingSecret).update(calls[0].body).digest('hex')}`);
      expect(signPayload(signingSecret, 'x')).toMatch(/^sha256=/);

      // Responde con su token; otro token no puede tocar la sesión.
      const bad = await v1Activities.POST(
        new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer zsa_nope' }, body: JSON.stringify({ type: 'thought', body: 'x' }) }),
        params(s.id),
      );
      expect(bad!.status).toBe(401);
      const ok = await v1Activities.POST(
        new Request('http://x', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'response', body: 'Opened PR #4' }) }),
        params(s.id),
      );
      expect(ok!.status).toBe(201);
      expect((await getSession(s.id))?.state).toBe('complete');
      const row = await sessionForApp({ id: app.id, workspace_id: owner.id }, s.id);
      await expect(addAgentActivity(row!, { type: 'elicitation', body: 'Which branch?' })).resolves.toMatchObject({ state: 'awaiting_input' });
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.ALLOW_PRIVATE_WEBHOOKS;
    }
  });

  it('agente de zerosoft: piensa, mueve el issue a en progreso y responde en la sesión', async () => {
    const { owner, project } = await triageProject();
    const agentId = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO agents (id, user_id, name, instructions, enabled, created_at, updated_at) VALUES (?, ?, 'Helper', 'Be brief', 1, datetime('now'), datetime('now'))")
      .run(agentId, owner.id);
    const issue = await createIssue(project.id, owner.id, { title: 'Write release notes' }, { source: 'app' });
    const s = await delegateIssue(issue, owner.id, { kind: 'zerosoft', id: agentId }, owner.id);
    await flush();
    const done = await getSession(s.id);
    expect(done?.state).toBe('complete');
    expect(done?.activities.map((a) => a.type)).toEqual(['thought', 'action', 'response']);
    expect((await getIssue(issue.id))?.status_category).toBe('in_progress');
    // Segunda corrida: nada pendiente, no repite.
    expect(await processAgentSession(s.id)).toBe(false);
  });
});
