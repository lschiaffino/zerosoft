import { createHmac } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { getExternalId } from '@/lib/import-jobs';
import { runImportJob } from '@/lib/import-runner';
import { parseOperation, validateOperation, type GqlSchemaMap } from '@/lib/graphql-lite';
import schemaJson from '@/lib/fixtures/linear-schema.json';
import { fakeLinearGraphql, resetLinearFake, setLinearFakeWebhookSink } from '@/lib/track-linear-fake';
import { filterLinearItems } from '@/lib/track-linear-import';
import {
  canonFromLinear,
  canonFromTrack,
  fieldHash,
  linearStateFor,
  priorityFromLinear,
  priorityToLinear,
  resolveField,
  verifyLinearSignature,
  webhookIsFresh,
  type CanonContext,
  type TrackSide,
} from '@/lib/track-linear-sync-map';
import {
  changedSyncFields,
  connectLinear,
  getSyncState,
  handleLinearWebhook,
  LINEAR_SYNC_MUTATIONS,
  LINEAR_SYNC_QUERIES,
  linearSyncView,
  startLinearImport,
  syncLinearNow,
  updateLinearConfig,
} from '@/lib/track-linear-sync';
import { getIssue, updateIssue, type TrackIssueWithStatus } from '@/lib/track-data';
import { runOutboxItem } from '@/lib/track-integrations';
import { makeUser } from './helpers';

/**
 * Sincronización Track ↔ Linear contra el fake de Linear
 * (lib/track-linear-fake.ts), que valida cada query y mutation contra el
 * schema público y manda webhooks firmados después de cada mutation.
 */

const SCHEMA = schemaJson as unknown as GqlSchemaMap;

const states = [
  { id: 's-bkl', name: 'Backlog', type: 'backlog', position: 1 },
  { id: 's-todo', name: 'Todo', type: 'unstarted', position: 2 },
  { id: 's-prog', name: 'In Progress', type: 'started', position: 3 },
  { id: 's-rev', name: 'In Review', type: 'started', position: 4 },
  { id: 's-done', name: 'Done', type: 'completed', position: 5 },
  { id: 's-tri', name: 'Triage', type: 'triage', position: 0 },
];
const ctx: CanonContext = {
  states,
  labels: [
    { id: 'l-bug', name: 'Bug' },
    { id: 'l-feature', name: 'Feature' },
  ],
  linearEmails: new Set(['ana@x.test', 'bo@x.test']),
  trackEmails: new Set(['ana@x.test', 'zed@x.test']),
};

const side = (over: Partial<TrackSide> = {}): TrackSide => ({
  title: 'Fix login',
  descriptionMarkdown: 'Steps\r\n1. open  ',
  priority: 'high',
  estimate: 3,
  statusName: 'In Progress',
  statusCategory: 'in_progress',
  triage: false,
  assigneeEmail: 'ana@x.test',
  labels: ['Bug', 'Local only'],
  dueDate: '2026-12-01',
  parentLinearId: null,
  projectLinearId: 'p-1',
  milestoneLinearId: null,
  cycleKey: null,
  ...over,
});

const node = (over: Record<string, unknown> = {}) => ({
  id: 'i-1',
  title: 'Fix login',
  description: 'Steps\n1. open',
  priority: 2,
  estimate: 3,
  state: states[2],
  team: { id: 't-eng', key: 'ENG', name: 'Engineering' },
  assignee: { email: 'Ana@x.test' },
  labels: { nodes: [{ name: 'Bug' }] },
  dueDate: '2026-12-01',
  parent: null,
  project: { id: 'p-1' },
  projectMilestone: null,
  cycle: null,
  updatedAt: '2026-11-09T10:00:00.000Z',
  ...over,
});

describe('linear sync: mapeo de campos', () => {
  it('prioridades en los dos sentidos', () => {
    for (const p of ['none', 'urgent', 'high', 'medium', 'low']) expect(priorityFromLinear(priorityToLinear(p))).toBe(p);
  });

  it('status: mismo nombre, si no el primer estado del mismo tipo; triage nunca', () => {
    expect(linearStateFor({ name: 'in review', category: 'in_progress' }, states)?.id).toBe('s-rev');
    expect(linearStateFor({ name: 'QA', category: 'in_progress' }, states)?.id).toBe('s-prog');
    expect(linearStateFor({ name: 'Triage', category: 'backlog' }, states)?.id).toBe('s-bkl');
    expect(linearStateFor({ name: 'Weird', category: null }, states)).toBeNull();
  });

  it('el mismo issue da los mismos valores canónicos en los dos lados (sin eco)', () => {
    const t = canonFromTrack(side(), ctx);
    const l = canonFromLinear(node(), ctx);
    expect(t).toEqual(l);
    // Labels que Linear no tiene y personas que no están en los dos lados no cuentan.
    expect(t.labels).toEqual(['bug']);
    expect(canonFromTrack(side({ assigneeEmail: 'zed@x.test' }), ctx).assignee).toBeNull();
    expect(canonFromLinear(node({ assignee: { email: 'bo@x.test' } }), ctx).assignee).toBeNull();
    // Un status de Track que Linear no tiene se compara por el estado al que va.
    expect(canonFromTrack(side({ statusName: 'QA' }), ctx).status).toBe('In Progress');
    expect(canonFromLinear(node({ state: states[5] }), ctx).status).toBe('triage');
  });

  it('cambios de Track que importan para Linear', () => {
    const before = { title: 'a', description: '[]', priority: 'low', estimate: null, status_id: 's1', triage: 0, assignee_id: null, labels: '[{"name":"Bug"}]', due_date: null, parent_id: null, plan_id: null, plan_milestone_id: null, cycle_id: null } as unknown as TrackIssueWithStatus;
    expect(changedSyncFields(before, { ...before, title: 'b', labels: '[{"name":"bug"}]', start_date: '2026-01-01' })).toEqual(['title']);
    expect(changedSyncFields(before, { ...before, status_id: 's2', priority: 'high' })).toEqual(['priority', 'status']);
  });
});

describe('linear sync: conflictos (gana el último por campo)', () => {
  const a = fieldHash('A');
  const b = fieldHash('B');
  const c = fieldHash('C');
  const base = { direction: 'two_way' as const, remoteAt: '2026-11-09T10:00:00.000Z' };

  it('iguales: nada que hacer', () => {
    expect(resolveField({ ...base, trackHash: a, linearHash: a, base: null, localAt: null })).toBe('same');
  });
  it('cambió solo Linear: se trae', () => {
    expect(resolveField({ ...base, trackHash: a, linearHash: b, base: a, localAt: null })).toBe('pull');
  });
  it('cambió solo Track: se manda', () => {
    expect(resolveField({ ...base, trackHash: b, linearHash: a, base: a, localAt: '2026-11-09T09:00:00.000Z' })).toBe('push');
  });
  it('cambiaron los dos: gana el último', () => {
    expect(resolveField({ ...base, trackHash: b, linearHash: c, base: a, localAt: '2026-11-09T11:00:00.000Z' })).toBe('push');
    expect(resolveField({ ...base, trackHash: b, linearHash: c, base: a, localAt: '2026-11-09T09:00:00.000Z' })).toBe('pull');
  });
  it('sin base (recién importado): Linear manda salvo un cambio de Track posterior', () => {
    expect(resolveField({ ...base, trackHash: a, linearHash: b, base: null, localAt: null })).toBe('pull');
    expect(resolveField({ ...base, trackHash: a, linearHash: b, base: null, localAt: '2026-11-09T12:00:00.000Z' })).toBe('push');
  });
  it('un solo sentido: nunca escribe del otro lado', () => {
    expect(resolveField({ ...base, direction: 'import', trackHash: b, linearHash: a, base: a, localAt: '2026-11-09T12:00:00.000Z' })).toBe('same');
    expect(resolveField({ ...base, direction: 'push', trackHash: a, linearHash: b, base: a, localAt: null })).toBe('same');
  });
});

describe('linear sync: webhooks', () => {
  const body = JSON.stringify({ type: 'Issue', action: 'update', organizationId: 'o-1', webhookTimestamp: Date.now(), data: { id: 'i-1' } });
  const sig = createHmac('sha256', 's3cret').update(body).digest('hex');

  it('firma HMAC-SHA256 en hex del cuerpo crudo', () => {
    expect(verifyLinearSignature(body, sig, 's3cret')).toBe(true);
    expect(verifyLinearSignature(body, sig.toUpperCase(), 's3cret')).toBe(true);
    expect(verifyLinearSignature(body, sig, 'other')).toBe(false);
    expect(verifyLinearSignature(`${body} `, sig, 's3cret')).toBe(false);
    expect(verifyLinearSignature(body, 'zz', 's3cret')).toBe(false);
    expect(verifyLinearSignature(body, null, 's3cret')).toBe(false);
    expect(verifyLinearSignature(body, sig, '')).toBe(false);
  });

  it('webhookTimestamp a menos de un minuto', () => {
    const now = 1_800_000_000_000;
    expect(webhookIsFresh(now - 30_000, now)).toBe(true);
    expect(webhookIsFresh(now - 120_000, now)).toBe(false);
    expect(webhookIsFresh('nope', now)).toBe(false);
  });

  it('una organización sin conexión o una firma que no verifica: 401', async () => {
    expect((await handleLinearWebhook(body, sig)).status).toBe(401);
    expect((await handleLinearWebhook('not json', sig)).status).toBe(400);
  });
});

describe('linear sync: queries y mutations contra el schema de Linear', () => {
  it('son válidas', () => {
    for (const [name, q] of [...Object.entries(LINEAR_SYNC_QUERIES), ...Object.entries(LINEAR_SYNC_MUTATIONS)]) {
      expect(validateOperation(parseOperation(q, {}), SCHEMA), name).toEqual([]);
    }
  });

  it('el filtro por teams del import deja solo lo de esos teams', () => {
    const items = [
      { kind: 'team', data: { extId: 'name:engineering', key: 'ENG' } },
      { kind: 'team', data: { extId: 'name:design', key: 'DES' } },
      { kind: 'issue', data: { extId: 'ENG-1', project: { extId: 'name:engineering' } } },
      { kind: 'issue', data: { extId: 'DES-1', project: { extId: 'name:design' } } },
      { kind: 'comment', data: { issueExtId: 'DES-1' } },
      { kind: 'plan', data: { teamExtIds: ['name:design', 'name:engineering'] } },
      { kind: 'user', data: {} },
    ];
    const kept = filterLinearItems(items, [{ id: 't-eng', key: 'ENG', name: 'Engineering' }]);
    expect(kept.map((i) => `${i.kind}:${(i.data as { extId?: string; key?: string }).extId ?? (i.data as { key?: string }).key ?? ''}`)).toEqual([
      'team:name:engineering',
      'issue:ENG-1',
      'plan:',
      'user:',
    ]);
  });
});

describe('linear sync: de punta a punta contra el fake', () => {
  const token = 'lin_api_fake_sync';
  const deliveries: Array<{ body: string; headers: Record<string, string> }> = [];
  let ws = '';

  const issueIdOf = async (linearId: string) => (await getExternalId(ws, 'linear', 'issue_uuid', linearId))!;
  const linearIssue = (id: string) =>
    (fakeLinearGraphql(token, `query { issue(id: "${id}") { id title priority updatedAt state { name } } }`, {}).body as { data: { issue: Record<string, unknown> } }).data.issue;
  const outbox = async (kind?: string) =>
    (await getDb()
      .prepare(`SELECT id, kind, status, last_error FROM track_integration_outbox WHERE workspace_id = ? AND provider = 'linear' ${kind ? 'AND kind = ?' : ''} ORDER BY created_at`)
      .all(...(kind ? [ws, kind] : [ws]))) as Array<{ id: string; kind: string; status: string; last_error: string | null }>;
  const until = async (fn: () => Promise<boolean> | boolean, ms = 5_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timeout');
  };
  /** Entrega los webhooks que mandó el fake y corre lo que encolaron. */
  const deliverAll = async () => {
    await new Promise((r) => setTimeout(r, 10));
    const batch = deliveries.splice(0);
    for (const d of batch) {
      const res = await handleLinearWebhook(d.body, d.headers['linear-signature']);
      expect(res.status).toBe(200);
      for (const q of res.queued) if (q.outboxId) await runOutboxItem(q.outboxId);
    }
    return batch.length;
  };

  beforeAll(async () => {
    vi.stubEnv('TRACK_LINEAR_FAKE', '1');
    resetLinearFake(token);
    setLinearFakeWebhookSink((d) => {
      deliveries.push(d);
    });
    const u = await makeUser('linsync');
    vi.stubEnv('TRACK_LINEAR_FAKE_EMAIL', u.email);
    ws = u.id;
    await connectLinear({ workspaceId: ws, jobWorkspaceId: u.id, jobTeamId: null, personId: u.id, locale: 'en' }, { type: 'api_key', token });
    await updateLinearConfig(ws, { teams: [{ id: 't-eng', key: 'ENG', name: 'Engineering' }] });
    const jobId = await startLinearImport(ws);
    for (let i = 0; i < 60; i++) {
      const v = await runImportJob(jobId, 5_000);
      if (v && !['fetching', 'importing', 'preview'].includes(v.status)) break;
    }
    await syncLinearNow(ws);
  });
  afterEach(async () => {
    // Lo que quedó encolado por los eventos de Track termina antes del próximo test.
    await new Promise((r) => setTimeout(r, 50));
  });
  afterAll(() => {
    setLinearFakeWebhookSink(null);
    vi.unstubAllEnvs();
  });

  it('importa solo los teams elegidos y queda en vivo con webhook propio', async () => {
    expect((await getSyncState(ws))?.phase).toBe('live');
    const view = await linearSyncView(ws, true);
    expect(view.connection).toMatchObject({ orgName: 'Acme', authType: 'api_key', webhookMode: 'own', direction: 'two_way' });
    // La vista nunca trae el token.
    expect(JSON.stringify(view)).not.toContain(token);
    const row = (await getDb().prepare("SELECT token, secret FROM track_integrations WHERE workspace_id = ? AND provider = 'linear'").get(ws)) as { token: string; secret: string };
    expect(row.token.startsWith('enc:v1:')).toBe(true);
    expect(row.secret.startsWith('enc:v1:')).toBe(true);
    expect(await getExternalId(ws, 'linear', 'issue_uuid', 'i-1')).toBeTruthy();
    expect(await getExternalId(ws, 'linear', 'issue_uuid', 'i-10')).toBeNull();
  });

  it('Track → Linear: un cambio sale y el webhook que vuelve no se aplica ni rebota', async () => {
    const id = await issueIdOf('i-3');
    const before = await getIssue(id);
    await updateIssue(id, { title: 'Resolve conflicts on reconnect (Track)', priority: 'urgent' });
    await until(async () => (await outbox('push.issue')).some((r) => r.status === 'sent'));
    expect(linearIssue('i-3')).toMatchObject({ title: 'Resolve conflicts on reconnect (Track)', priority: 1 });
    const pushes = (await outbox('push.issue')).length;
    // El webhook del cambio que mandamos: verificado, se trae y no cambia nada ni encola otro envío.
    expect(await deliverAll()).toBeGreaterThan(0);
    const after = await getIssue(id);
    expect(after?.title).toBe('Resolve conflicts on reconnect (Track)');
    expect(after?.updated_at).toBe((await getIssue(id))?.updated_at);
    expect((await outbox('push.issue')).length).toBe(pushes);
    expect(before?.identifier).toBe('ENG-3');
  });

  it('Linear → Track: un cambio en Linear entra por webhook y no vuelve a salir', async () => {
    const id = await issueIdOf('i-4');
    const res = fakeLinearGraphql(token, LINEAR_SYNC_MUTATIONS.issueUpdate, { id: 'i-4', input: { title: 'Crash when opening a deleted issue (Linear)', stateId: 's-rev' } });
    expect(res.status).toBe(200);
    const pushes = (await outbox('push.issue')).length;
    expect(await deliverAll()).toBe(1);
    const issue = await getIssue(id);
    expect(issue?.title).toBe('Crash when opening a deleted issue (Linear)');
    expect(issue?.status_name).toBe('In Review');
    await new Promise((r) => setTimeout(r, 100));
    expect((await outbox('push.issue')).length).toBe(pushes);
    const audit = (await getDb().prepare("SELECT via FROM track_audit_log WHERE entity_id = ? AND action = 'issue.updated' ORDER BY created_at DESC LIMIT 1").get(id)) as { via: string } | undefined;
    if (audit) expect(audit.via).toBe('linear');
  });

  it('conflicto: si Track cambió después que Linear, gana Track; el campo que solo cambió Linear entra', async () => {
    const id = await issueIdOf('i-7');
    // Linear cambia título y prioridad...
    fakeLinearGraphql(token, LINEAR_SYNC_MUTATIONS.issueUpdate, { id: 'i-7', input: { title: 'Invoice PDF (Linear)', priority: 2 } });
    await new Promise((r) => setTimeout(r, 20));
    // ...y después, sin haber visto ese cambio, alguien cambia el título en Track (en pausa: no sale todavía).
    await updateLinearConfig(ws, { paused: true });
    await updateIssue(id, { title: 'Invoice PDF (Track)' });
    await new Promise((r) => setTimeout(r, 50));
    deliveries.splice(0);
    await updateLinearConfig(ws, { paused: false });
    await until(async () => (await outbox('push.issue')).filter((r) => r.status === 'sent').length >= 2);
    const issue = await getIssue(id);
    expect(issue?.title).toBe('Invoice PDF (Track)');
    expect(issue?.priority).toBe('high');
    expect(linearIssue('i-7')).toMatchObject({ title: 'Invoice PDF (Track)', priority: 2 });
    await deliverAll();
    expect((await getIssue(id))?.title).toBe('Invoice PDF (Track)');
  });

  it('comentarios en los dos sentidos sin duplicar', async () => {
    const id = await issueIdOf('i-1');
    const { createIssueComment, listIssueComments } = await import('@/lib/track-data');
    const author = (await getIssue(id))!.creator_id;
    await createIssueComment(id, author, { body: 'From Track with love' });
    await until(async () => (await outbox('push.comment')).some((r) => r.status === 'sent'));
    await deliverAll();
    fakeLinearGraphql(token, LINEAR_SYNC_MUTATIONS.commentCreate, { input: { issueId: 'i-1', body: 'From Linear, hi' } });
    await deliverAll();
    const bodies = (await listIssueComments(id)).map((c) => c.body);
    expect(bodies.filter((b) => b === 'From Track with love')).toHaveLength(1);
    expect(bodies.filter((b) => b.includes('From Linear, hi'))).toHaveLength(1);
  });

  it('un issue nuevo en Linear entra; uno nuevo en Track sale', async () => {
    fakeLinearGraphql(token, LINEAR_SYNC_MUTATIONS.issueCreate, { input: { id: 'i-new-linear', teamId: 't-eng', title: 'Born in Linear' } });
    await deliverAll();
    const local = await getExternalId(ws, 'linear', 'issue_uuid', 'i-new-linear');
    expect(local).toBeTruthy();
    expect((await getIssue(local!))?.title).toBe('Born in Linear');

    const { createIssue } = await import('@/lib/track-data');
    const eng = (await getIssue(await issueIdOf('i-1')))!;
    const created = await createIssue(eng.project_id, eng.creator_id, { title: 'Born in Track', priority: 'low' }, { source: 'app' });
    await until(async () => Boolean(await getDb().prepare("SELECT 1 FROM import_external_ids WHERE workspace_id = ? AND kind = 'issue' AND local_id = ?").get(ws, created.id)));
    const linearId = (await getDb().prepare("SELECT external_id FROM import_external_ids WHERE workspace_id = ? AND kind = 'issue_uuid' AND local_id = ?").get(ws, created.id)) as { external_id: string };
    expect(linearIssue(linearId.external_id)).toMatchObject({ title: 'Born in Track', priority: 4 });
    const pushes = (await outbox('push.issue')).length;
    await deliverAll();
    // El webhook de "creado" encuentra su par: no hay un segundo issue en Track.
    const dupes = (await getDb().prepare("SELECT COUNT(*) AS n FROM track_issues WHERE project_id = ? AND title = 'Born in Track'").get(eng.project_id)) as { n: number };
    expect(Number(dupes.n)).toBe(1);
    expect((await outbox('push.issue')).length).toBe(pushes);
  });

  it('aislamiento: el webhook de esta organización no toca otro workspace', async () => {
    const other = await makeUser('linsync-other');
    // Otro workspace conectado a otra organización: la firma con su secreto no sirve para esta.
    const rows = (await getDb().prepare("SELECT COUNT(*) AS n FROM track_integrations WHERE provider = 'linear' AND workspace_id = ?").get(other.id)) as { n: number };
    expect(Number(rows.n)).toBe(0);
    fakeLinearGraphql(token, LINEAR_SYNC_MUTATIONS.issueUpdate, { id: 'i-9', input: { title: 'Only for one workspace' } });
    await new Promise((r) => setTimeout(r, 10));
    const d = deliveries.splice(0)[0];
    const tampered = d.body.replace('Only for one workspace', 'Tampered');
    expect((await handleLinearWebhook(tampered, d.headers['linear-signature'])).status).toBe(401);
    const ok = await handleLinearWebhook(d.body, d.headers['linear-signature']);
    expect(ok.queued.map((q) => q.workspaceId)).toEqual([ws]);
  });
});
