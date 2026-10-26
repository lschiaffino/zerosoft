import { describe, expect, it } from 'vitest';
import { getDb, type FlowFlowRow } from '@/lib/db';
import {
  createContact,
  createCustomField,
  createList,
  getContact,
  listTimeline,
  updateContact,
} from '@/lib/crm';
import { createForm, getForm, listSubmissions, submissionsCsv, submitForm, updateForm } from '@/lib/crm-forms';
import { mapSubmission, normalizeFields, validateSubmission, DEFAULT_FORM_SETTINGS, type FormField } from '@/lib/crm-forms-schema';
import { FORM_EMBED_SCRIPT } from '@/lib/crm-forms-embed';
import { createTag, tagsForRecords } from '@/lib/crm-tags';
import { createWorkflow, listWorkflowRuns } from '@/lib/crm-workflows';
import { createScoreRule, recalcContactScore, runNightlyScoring } from '@/lib/crm-scoring';
import { crossesThreshold, evaluateScore, matchesProperty, type ScoreRule } from '@/lib/crm-scoring-schema';
import { createFlow, updateFlow } from '@/lib/flow';
import type { FlowGraph } from '@/lib/flow-schema';
import { RESERVED_SLUGS } from '@/lib/reserved';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { makeUser } from './helpers';

const submitRoute = await import('@/lib/routes/crm/forms/submit/[key]/route');

function post(key: string, body: unknown, ip = '10.0.0.1') {
  return submitRoute.POST(
    new Request(`http://localhost/api/crm/forms/submit/${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ key }) },
  );
}

const FIELDS: FormField[] = [
  { id: 'email', type: 'email', label: 'Email', property: 'email', required: true },
  { id: 'name', type: 'text', label: 'Name', property: 'fullName', required: false },
  { id: 'company', type: 'text', label: 'Company', property: 'company.name', required: false },
  { id: 'plan', type: 'select', label: 'Plan', property: 'custom.plan', required: false, options: ['Pro', 'Team'] },
  { id: 'msg', type: 'textarea', label: 'Message', property: '', required: false },
  { id: 'src', type: 'hidden', label: 'UTM source', property: 'custom.utm_source', required: false, urlParam: 'utm_source' },
];

async function eventFlow(ws: string, event: string): Promise<FlowFlowRow> {
  const graph: FlowGraph = {
    nodes: [
      { id: 't', type: 'trigger.event', position: { x: 0, y: 0 }, config: { event } },
      { id: 's', type: 'data.set', position: { x: 0, y: 100 }, config: { fields: [] } },
    ],
    edges: [{ id: 't-s', source: 't', target: 's', sourceHandle: null }],
  };
  const res = await createFlow(ws, ws, { name: `on ${event}`, graph });
  if (!res.ok) throw new Error(res.error);
  const up = await updateFlow(ws, res.flow.id, { enabled: true });
  if (!up.ok) throw new Error(up.error);
  return (await getDb().prepare('SELECT * FROM flow_flows WHERE id = ?').get(res.flow.id)) as FlowFlowRow;
}

async function flowRuns(flowId: string): Promise<number> {
  return ((await getDb().prepare('SELECT COUNT(*) AS c FROM flow_runs WHERE flow_id = ?').get(flowId)) as { c: number }).c;
}

describe('forms: validación y mapeo (puro)', () => {
  it('valida requeridos, email, opciones y consentimiento', () => {
    const settings = { ...DEFAULT_FORM_SETTINGS, consentText: 'I agree', consentRequired: true };
    const bad = validateSubmission(FIELDS, settings, { values: { email: 'nope', plan: 'Enterprise' }, consent: false });
    expect(bad.errors).toMatchObject({ email: 'invalid_email', plan: 'invalid_option', __consent: 'required' });
    const missing = validateSubmission(FIELDS, DEFAULT_FORM_SETTINGS, { values: {} });
    expect(missing.errors.email).toBe('required');
    const ok = validateSubmission(FIELDS, DEFAULT_FORM_SETTINGS, { values: { email: 'ADA@Example.com', plan: 'Pro' } }, { utm_source: 'google' });
    expect(ok.errors).toEqual({});
    expect(ok.values).toMatchObject({ email: 'ada@example.com', plan: 'Pro', src: 'google' });
  });

  it('mapea a contacto, custom y empresa; fullName se separa', () => {
    const m = mapSubmission(FIELDS, { email: 'a@b.co', name: 'Ada King Lovelace', company: 'Acme', plan: 'Team', msg: 'hi', src: 'x' });
    expect(m.contact).toEqual({ email: 'a@b.co', firstName: 'Ada', lastName: 'King Lovelace' });
    expect(m.contactCustom).toEqual({ plan: 'Team', utm_source: 'x' });
    expect(m.company).toEqual({ name: 'Acme' });
  });

  it('normalizeFields descarta campos inválidos y claves duplicadas', () => {
    const fields = normalizeFields([...FIELDS, { id: 'email', type: 'text', label: 'dup', property: '', required: false }, { id: 'bad key', type: 'text' }]);
    expect(fields.map((f) => f.id)).toEqual(FIELDS.map((f) => f.id));
  });
});

describe('forms: envío público', () => {
  it('crea el contacto con mapeo, empresa, lista, tags, actividad, workflow y evento de Flow; dedupe por email', async () => {
    const ws = await makeUser('form');
    await createCustomField(ws.id, { entity: 'contacts', name: 'plan', label: 'Plan', type: 'text' });
    const list = await createList(ws.id, { name: 'Inbound', kind: 'static' });
    const tagRes = await createTag(ws.id, { name: 'Web lead' });
    if (!tagRes.ok) throw new Error(tagRes.error);
    const tag = tagRes.tag;
    const form = await createForm(ws.id, {
      name: 'Contact us',
      slug: `contact-${ws.id.slice(-6)}`,
      fields: FIELDS,
      settings: { lifecycleStage: 'mql', listId: list.id, tagIds: [tag.id], minSubmitSeconds: 0, notifyOwner: true },
    });
    await createWorkflow(ws.id, {
      name: 'On form',
      enabled: true,
      triggers: [{ type: 'form_submitted', config: { formId: form.id } }],
      actions: [{ type: 'create_task', config: { subject: 'Follow up form lead', dueInDays: 1 } }],
    });
    const flow = await eventFlow(ws.id, 'form.submitted');

    const res = await post(form.slug!, {
      values: { email: 'Ada@Acme.io', name: 'Ada Lovelace', company: 'Acme', plan: 'Pro', msg: 'Hello' },
      pageUrl: 'https://acme.io/pricing?utm_source=google&utm_campaign=q4',
      elapsedMs: 5000,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; successMode: string };
    expect(body).toMatchObject({ ok: true, successMode: 'message' });

    const { rows } = await listSubmissions(ws.id, form.id);
    expect(rows).toHaveLength(1);
    const sub = rows[0];
    expect(sub.contact_created).toBe(1);
    expect(JSON.parse(sub.utm)).toEqual({ utm_source: 'google', utm_campaign: 'q4' });
    const detail = (await getContact(ws.id, sub.contact_id!))!;
    expect(detail.contact).toMatchObject({ email: 'ada@acme.io', first_name: 'Ada', last_name: 'Lovelace', lifecycle_stage: 'mql', source: 'form' });
    expect(JSON.parse(detail.contact.custom)).toMatchObject({ plan: 'Pro', utm_source: 'google' });
    expect(detail.company?.name).toBe('Acme');
    expect(detail.lists.map((l) => l.id)).toContain(list.id);
    expect((await tagsForRecords(ws.id, 'contact', [detail.contact.id])).get(detail.contact.id)?.map((x) => x.id)).toEqual([tag.id]);

    const timeline = await listTimeline(ws.id, { contactId: detail.contact.id });
    expect(timeline.some((a) => a.subject === 'Form submitted: Contact us' && a.body.includes('Message: Hello'))).toBe(true);
    expect(timeline.some((a) => a.type === 'task' && a.subject === 'Follow up form lead')).toBe(true);
    expect(await flowRuns(flow.id)).toBe(1);
    const notes = (await getDb()
      .prepare("SELECT COUNT(*) AS c FROM notifications WHERE type = 'crm_form' AND source_id = ?")
      .get(form.id)) as { c: number };
    expect(notes.c).toBe(1);

    // Segundo envío con el mismo email (otra capitalización): actualiza, no duplica,
    // y no retrocede el lifecycle de un customer.
    await updateContact(ws.id, detail.contact.id, { lifecycleStage: 'customer' });
    const again = await submitForm(form.slug!, { values: { email: 'ADA@acme.io', name: 'Ada Byron', plan: 'Team' }, elapsedMs: 9000 });
    expect(again).toMatchObject({ ok: true, created: false, contactId: detail.contact.id });
    const count = (await getDb()
      .prepare("SELECT COUNT(*) AS c FROM crm_contacts WHERE user_id = ? AND lower(email) = 'ada@acme.io'")
      .get(ws.id)) as { c: number };
    expect(count.c).toBe(1);
    const after = (await getContact(ws.id, detail.contact.id))!.contact;
    expect(after).toMatchObject({ first_name: 'Ada', last_name: 'Byron', lifecycle_stage: 'customer' });
    expect(JSON.parse(after.custom).plan).toBe('Team');
    expect((await getForm(ws.id, form.id))!.submission_count).toBe(2);

    // updateExisting = false → un contacto nuevo por envío.
    await updateForm(ws.id, form.id, { settings: { updateExisting: false } });
    const dup = await submitForm(form.slug!, { values: { email: 'ada@acme.io' }, elapsedMs: 9000 });
    expect(dup).toMatchObject({ ok: true, created: true });
  });

  it('anti-spam: honeypot y tiempo mínimo responden ok sin guardar; requeridos dan 400; pausado 409', async () => {
    const ws = await makeUser('spam');
    const form = await createForm(ws.id, { name: 'Spam', fields: FIELDS, settings: { minSubmitSeconds: 3 } });
    const honeypot = await post(form.token, { values: { email: 'bot@spam.io' }, website_url: 'http://spam', elapsedMs: 9000 }, '10.1.0.1');
    expect(honeypot.status).toBe(200);
    const fast = await post(form.token, { values: { email: 'bot2@spam.io' }, elapsedMs: 500 }, '10.1.0.2');
    expect(fast.status).toBe(200);
    expect((await listSubmissions(ws.id, form.id)).total).toBe(0);
    const contacts = (await getDb().prepare('SELECT COUNT(*) AS c FROM crm_contacts WHERE user_id = ?').get(ws.id)) as { c: number };
    expect(contacts.c).toBe(0);

    const invalid = await post(form.token, { values: { email: '' }, elapsedMs: 9000 }, '10.1.0.3');
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { fieldErrors: Record<string, string> }).fieldErrors).toEqual({ email: 'required' });

    await updateForm(ws.id, form.id, { status: 'paused' });
    expect((await post(form.token, { values: { email: 'a@b.co' }, elapsedMs: 9000 }, '10.1.0.4')).status).toBe(409);
    expect((await post('nope-does-not-exist', { values: {} }, '10.1.0.5')).status).toBe(404);
  });

  it('rate limit por IP y form: el 6º envío en un minuto recibe 429', async () => {
    const ws = await makeUser('rl');
    const form = await createForm(ws.id, { name: 'RL', fields: FIELDS, settings: { minSubmitSeconds: 0 } });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await post(form.token, { values: { email: `p${i}@rl.io` } }, '10.9.9.9')).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    // Otra IP no está limitada.
    expect((await post(form.token, { values: { email: 'other@rl.io' } }, '10.9.9.10')).status).toBe(200);
  });

  it('slug único entre forms y CSV con escape de fórmulas', async () => {
    const a = await makeUser('slug');
    const b = await makeUser('slug');
    const slug = `demo-${a.id.slice(-6)}`;
    await createForm(a.id, { name: 'A', slug });
    await expect(createForm(b.id, { name: 'B', slug })).rejects.toThrow('slug_taken');
    const form = await createForm(a.id, { name: 'CSV', fields: FIELDS, settings: { minSubmitSeconds: 0 } });
    await submitForm(form.token, { values: { email: 'x@y.co', msg: '=HYPERLINK("http://evil")' } });
    const { rows } = await listSubmissions(a.id, form.id);
    const csv = submissionsCsv(form, rows);
    expect(csv.split('\r\n')[0]).toContain('Email,Name,Company,Plan,Message,UTM source');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('forms: embed y rutas públicas', () => {
  it('el script de embed parsea e inserta un iframe con UTM y alto automático', () => {
    expect(() => new Function(FORM_EMBED_SCRIPT)).not.toThrow();
    const inserted: Array<{ src: string; style: { cssText: string; height?: string } }> = [];
    const listeners: Array<(e: unknown) => void> = [];
    const script = {
      src: 'https://zerosoft.ai/api/crm/forms/embed.js',
      getAttribute: (k: string) => ({ 'data-form': 'contact-us', 'data-locale': 'es' })[k] ?? null,
      parentNode: { insertBefore: (el: (typeof inserted)[number]) => inserted.push(el) },
      dispatchEvent: () => true,
    };
    const fakeWindow = {
      location: { href: 'https://acme.io/pricing?utm_source=google&x=1' },
      addEventListener: (_: string, fn: (e: unknown) => void) => listeners.push(fn),
    };
    const fakeDocument = {
      currentScript: script,
      referrer: '',
      createElement: () => ({ style: {} as { cssText: string; height?: string }, setAttribute() {}, src: '', title: '', loading: '' }),
    };
    new Function('document', 'window', 'URL', 'URLSearchParams', 'CustomEvent', FORM_EMBED_SCRIPT)(
      fakeDocument,
      fakeWindow,
      URL,
      URLSearchParams,
      class {},
    );
    expect(inserted).toHaveLength(1);
    const src = new URL(inserted[0].src);
    expect(src.origin + src.pathname).toBe('https://zerosoft.ai/es/f/contact-us');
    expect(src.searchParams.get('embed')).toBe('1');
    expect(src.searchParams.get('utm_source')).toBe('google');
    expect(src.searchParams.get('x')).toBeNull();
    expect(src.searchParams.get('page_url')).toContain('acme.io/pricing');
    // Mensaje de alto desde el iframe (mismo origen y misma ventana) → ajusta height.
    const frame = inserted[0] as unknown as { contentWindow: unknown; style: { height?: string } };
    frame.contentWindow = {};
    listeners[0]({ origin: 'https://zerosoft.ai', source: frame.contentWindow, data: { type: 'zs-form:height', height: 612.4 } });
    expect(frame.style.height).toBe('613px');
    // Otro origen se ignora.
    listeners[0]({ origin: 'https://evil.io', source: frame.contentWindow, data: { type: 'zs-form:height', height: 10 } });
    expect(frame.style.height).toBe('613px');
  });

  it('/f está reservado y las migraciones 023 tienen ids únicos', () => {
    expect(RESERVED_SLUGS.has('f')).toBe(true);
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('023_crm_'))).toEqual(['023_crm_forms_scoring', '023_crm_teams_visibility']);
  });
});

describe('lead scoring', () => {
  it('evaluación pura: propiedades, actividad y umbrales', () => {
    const rules: ScoreRule[] = [
      { id: 'r1', name: 'MQL', kind: 'property', config: { field: 'lifecycleStage', op: 'equals', value: 'mql' }, points: 20, enabled: true, position: 0 },
      { id: 'r2', name: 'Student', kind: 'property', config: { field: 'jobTitle', op: 'contains', value: 'student' }, points: -15, enabled: true, position: 1 },
      { id: 'r3', name: 'Opens', kind: 'activity', config: { activity: 'email_opened', days: 30, min: 3 }, points: 10, enabled: true, position: 2 },
      { id: 'r4', name: 'Off', kind: 'property', config: { field: 'country', op: 'is_set', value: '' }, points: 99, enabled: false, position: 3 },
    ];
    const contact = { lifecycle_stage: 'mql', job_title: 'PhD Student', country: 'AR', custom: '{}' };
    expect(evaluateScore(rules, contact, { 'email_opened:30': 2 }).score).toBe(5);
    const full = evaluateScore(rules, contact, { 'email_opened:30': 3 });
    expect(full.score).toBe(15);
    expect(full.breakdown.map((b) => b.ruleId)).toEqual(['r1', 'r2', 'r3']);
    expect(matchesProperty('12', { field: 'custom.seats', op: 'gt', value: '10' })).toBe(true);
    expect(matchesProperty('', { field: 'custom.seats', op: 'gt', value: '10' })).toBe(false);
    expect(crossesThreshold(20, 30, 25, 'up')).toBe(true);
    expect(crossesThreshold(30, 35, 25, 'up')).toBe(false);
    expect(crossesThreshold(30, 20, 25, 'up')).toBe(false);
    expect(crossesThreshold(30, 20, 25, 'down')).toBe(true);
    expect(crossesThreshold(5, 6, null)).toBe(true);
    expect(crossesThreshold(6, 6, null)).toBe(false);
  });

  it('recalcula con eventos, dispara score_changed al cruzar el umbral y contact.score_changed en Flow; ventanas vencen', async () => {
    const ws = await makeUser('score');
    await createScoreRule(ws.id, { kind: 'property', name: 'MQL', config: { field: 'lifecycleStage', op: 'equals', value: 'mql' }, points: 20 });
    await createScoreRule(ws.id, { kind: 'activity', name: 'Form', config: { activity: 'form_submitted', days: 30, min: 1 }, points: 10 });
    await createWorkflow(ws.id, {
      name: 'Hot lead',
      enabled: true,
      triggers: [{ type: 'score_changed', config: { threshold: 25, direction: 'up' } }],
      actions: [{ type: 'create_task', config: { subject: 'Call hot lead', dueInDays: 0 } }],
    });
    const flow = await eventFlow(ws.id, 'contact.score_changed');

    const c = await createContact(ws.id, { email: 'lead@score.io', lifecycleStage: 'lead' });
    expect((await getContact(ws.id, c.id))!.contact.score).toBe(0);

    await updateContact(ws.id, c.id, { lifecycleStage: 'mql' });
    const afterMql = (await getContact(ws.id, c.id))!.contact;
    expect(afterMql.score).toBe(20);
    expect(JSON.parse(afterMql.score_breakdown)).toEqual([expect.objectContaining({ name: 'MQL', points: 20 })]);
    const tasks = async () =>
      (await listTimeline(ws.id, { contactId: c.id, type: 'task' })).filter((t) => t.subject === 'Call hot lead').length;
    expect(await tasks()).toBe(0);

    // Envío de form → +10 → 30: cruza 25 hacia arriba.
    const form = await createForm(ws.id, { name: 'F', settings: { minSubmitSeconds: 0, lifecycleStage: '' } });
    await submitForm(form.token, { values: { email: 'lead@score.io' } });
    expect((await getContact(ws.id, c.id))!.contact.score).toBe(30);
    expect(await tasks()).toBe(1);
    expect(await flowRuns(flow.id)).toBe(2);

    // Sin cambio de score no hay disparo; 30 → 30.
    await updateContact(ws.id, c.id, { jobTitle: 'CTO' });
    expect(await tasks()).toBe(1);

    // 40 días después la ventana de 30 días ya no cuenta el envío: 20.
    const later = await recalcContactScore(ws.id, c.id, { now: new Date(Date.now() + 40 * 86_400_000) });
    expect(later).toMatchObject({ oldScore: 30, score: 20, changed: true });
    expect(await tasks()).toBe(1);

    // Recálculo nocturno: una vez por día por workspace.
    const first = await runNightlyScoring(new Date(), 50);
    expect(first.workspaces).toBeGreaterThanOrEqual(1);
    const second = await runNightlyScoring(new Date(), 50);
    const state = (await getDb().prepare('SELECT last_full_run FROM crm_score_state WHERE user_id = ?').get(ws.id)) as {
      last_full_run: string;
    };
    expect(state.last_full_run).toBe(new Date().toISOString().slice(0, 10));
    expect(second.workspaces).toBe(0);
  });
});

describe('workflows v2: if/else y Run Flow', () => {
  it('branch corre solo la rama que corresponde y run_flow encola el flow', async () => {
    const ws = await makeUser('wf2');
    const graph: FlowGraph = {
      nodes: [
        { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } },
        { id: 's', type: 'data.set', position: { x: 0, y: 100 }, config: { fields: [] } },
      ],
      edges: [{ id: 't-s', source: 't', target: 's', sourceHandle: null }],
    };
    const created = await createFlow(ws.id, ws.id, { name: 'Manual', graph });
    if (!created.ok) throw new Error(created.error);
    const wf = await createWorkflow(ws.id, {
      name: 'Branch',
      enabled: true,
      triggers: [{ type: 'contact_created' }],
      actions: [
        { type: 'branch', config: { entity: 'contact', field: 'lifecycleStage', op: 'equals', value: 'customer' }, position: 0 },
        { type: 'create_task', config: { subject: 'YES branch', when: 'yes' }, position: 1 },
        { type: 'create_task', config: { subject: 'NO branch', when: 'no' }, position: 2 },
        { type: 'run_flow', config: { flowId: created.flow.id }, position: 3 },
      ],
    });
    const lead = await createContact(ws.id, { email: 'lead@wf2.io', lifecycleStage: 'lead' });
    const customer = await createContact(ws.id, { email: 'cust@wf2.io', lifecycleStage: 'customer' });
    const subjects = async (id: string) =>
      (await listTimeline(ws.id, { contactId: id, type: 'task' })).map((t) => t.subject).sort();
    expect(await subjects(lead.id)).toEqual(['NO branch']);
    expect(await subjects(customer.id)).toEqual(['YES branch']);
    expect(await flowRuns(created.flow.id)).toBe(2);
    const runs = await listWorkflowRuns(ws.id, wf.id);
    expect(runs.every((r) => r.status === 'done')).toBe(true);
  });
});
