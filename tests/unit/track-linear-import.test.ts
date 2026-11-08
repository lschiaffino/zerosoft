import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createImportJob, getImportJob, getImportJobRow, type ImportJobView } from '@/lib/import-jobs';
import { runImportJob, startImportJob } from '@/lib/import-runner';
import { parseOperation, validateOperation, type GqlSchemaMap } from '@/lib/graphql-lite';
import { LINEAR_QUERIES } from '@/lib/track-linear-import';
import { fakeLinearGraphql } from '@/lib/track-linear-fake';
import { createIssue, listIssues, listStatuses, nextIdentifier, resolveIssueRef } from '@/lib/track-data';
import schemaJson from '@/lib/fixtures/linear-schema.json';
import { makeUser } from './helpers';

/**
 * Import de Linear por API contra el fake (lib/track-linear-fake.ts), que
 * valida cada query contra los tipos del schema público de Linear
 * (lib/fixtures/linear-schema.json, sacado de
 * github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql).
 */

const SCHEMA = schemaJson as unknown as GqlSchemaMap;

async function runToEnd(id: string): Promise<ImportJobView> {
  for (let i = 0; i < 80; i++) {
    const view = (await runImportJob(id, 5_000))!;
    if (!['fetching', 'importing'].includes(view.status)) return view;
  }
  throw new Error('job did not finish');
}

async function importLinear(userId: string, token: string) {
  const job = await createImportJob({ workspaceId: userId, teamId: null, userId, app: 'track', source: 'linear', options: { target: 'new' }, secret: token });
  const preview = await runToEnd(job.id);
  expect(preview.status).toBe('preview');
  expect(await startImportJob((await getImportJob(job.id))!)).toBe(true);
  return { job, preview, done: await runToEnd(job.id) };
}

describe('track import de Linear: queries contra el schema público', () => {
  it('cada query del importador es válida en el schema de Linear', () => {
    for (const [name, query] of Object.entries(LINEAR_QUERIES)) {
      const op = parseOperation(query, { after: null });
      expect(validateOperation(op, SCHEMA), name).toEqual([]);
    }
  });

  it('el validador marca campos y argumentos que Linear no tiene', () => {
    const op = parseOperation('query { issues(first: 10, bogus: 1) { nodes { id startDate state { nam } } } }');
    expect(validateOperation(op, SCHEMA)).toEqual([
      'Unknown argument "bogus" on field "Query.issues".',
      'Cannot query field "startDate" on type "Issue".',
      'Cannot query field "nam" on type "WorkflowState".',
    ]);
  });

  it('el fake responde como Linear: key inválida, query inválida y first > 250', () => {
    vi.stubEnv('TRACK_LINEAR_FAKE', '1');
    expect(fakeLinearGraphql('lin_api_nope', LINEAR_QUERIES.viewer, {}).body).toMatchObject({ errors: [{ extensions: { code: 'AUTHENTICATION_ERROR' } }] });
    expect(fakeLinearGraphql('lin_api_fake', 'query { issues { nodes { foo } } }', {}).body).toMatchObject({
      errors: [{ message: 'Cannot query field "foo" on type "Issue".' }],
    });
    expect(fakeLinearGraphql('lin_api_fake', 'query { issues(first: 500) { nodes { id } } }', {}).status).toBe(400);
    const page = fakeLinearGraphql('lin_api_fake', 'query { issues(first: 3) { pageInfo { hasNextPage endCursor } nodes { identifier } } }', {}).body as {
      data: { issues: { pageInfo: { hasNextPage: boolean }; nodes: unknown[] } };
    };
    expect(page.data.issues.nodes).toHaveLength(3);
    expect(page.data.issues.pageInfo.hasNextPage).toBe(true);
  });
});

describe('track import de Linear: workspace entero', () => {
  let email = '';
  beforeEach(() => {
    vi.stubEnv('TRACK_LINEAR_FAKE', '1');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('trae teams, workflows, projects, cycles, issues, comentarios, adjuntos y relaciones; reimportar actualiza sin duplicar', async () => {
    const u = await makeUser('linws');
    email = u.email;
    vi.stubEnv('TRACK_LINEAR_FAKE_EMAIL', email);
    const db = getDb();

    const { job, preview, done } = await importLinear(u.id, 'lin_api_fake');
    // La key se guarda cifrada y se borra al terminar de leer.
    expect((await getImportJobRow(job.id))?.secret).toBeNull();
    const p = preview.preview as Record<string, unknown>;
    expect(p).toMatchObject({ sourceName: 'Acme', issues: 11, comments: 4, relations: 4, attachments: 4, initiatives: 1, documents: 1, triage: 1, archived: 1, cycles: 3 });
    expect((p.projects as Array<{ name: string }>).map((t) => t.name).sort()).toEqual(['Design', 'Engineering']);
    expect((p.plans as Array<{ name: string }>).map((x) => x.name)).toEqual(['Mobile app v2', 'Billing revamp']);
    const people = p.people as Array<{ label: string; member: string | null }>;
    expect(people.find((x) => x.label === email)?.member).toBeTruthy();
    expect(people.find((x) => x.label === 'bo@acme-linear.test')?.member).toBeNull();

    expect(done.status).toBe('done');
    expect(done.report).toMatchObject({ issues: 11, updated: 0, projectsCreated: 2, plansCreated: 2, initiativesCreated: 1, planUpdates: 2, relations: 4, attachments: 4, parents: 2, comments: 4 });

    const teams = (await db.prepare('SELECT id, slug, triage_enabled FROM track_projects WHERE owner_id = ? ORDER BY slug').all(u.id)) as Array<{ id: string; slug: string; triage_enabled: number }>;
    expect(teams.map((t) => t.slug.toUpperCase())).toEqual(['DES', 'ENG']);
    const eng = teams[1];
    expect(eng.triage_enabled).toBe(1);
    // El workflow de Linear en su orden, sin Triage (es la cola) ni los estados por defecto que no usa.
    expect((await listStatuses(eng.id)).map((s) => s.name)).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled', 'Duplicate']);
    expect((await listStatuses(teams[0].id)).map((s) => `${s.name}:${s.category}`)).toEqual([
      'Ideas:backlog',
      'Ready:todo',
      'Designing:in_progress',
      'Shipped:done',
      'Canceled:cancelled',
    ]);

    type Row = Record<string, string | number | null>;
    const issue = async (title: string) => (await db.prepare('SELECT * FROM track_issues WHERE project_id IN (?, ?) AND title = ?').get(teams[0].id, eng.id, title)) as Row;
    const offline = await issue('Offline sync for the mobile app');
    // Mismos identificadores que en Linear: branches, PRs y links viejos siguen sirviendo.
    expect(offline.identifier).toBe('ENG-1');
    expect((await issue('Empty states audit')).identifier).toBe('DES-2');
    expect(offline).toMatchObject({ priority: 'urgent', estimate: 5, assignee_id: u.id, triage: 0, archived_at: null });
    expect(String(offline.description)).toContain('- [ ] Conflict handling');
    // La imagen subida a Linear se copió a Track: el link ya no depende de Linear.
    expect(String(offline.description)).not.toContain('uploads.linear.app');
    expect(String(offline.description)).toMatch(/!\[diagram\]\((\/uploads\/track\/|https:\/\/)[^)]+diagram\.png\)/);
    expect(done.report).toMatchObject({ uploads: 1, uploadsFailed: 0 });
    expect(JSON.parse(String(offline.labels)).map((l: { name: string }) => l.name)).toEqual(['Feature', 'Performance']);
    const cycle = (await db.prepare('SELECT name FROM track_cycles WHERE id = ?').get(offline.cycle_id)) as { name: string };
    expect(cycle.name).toBe('Polish sprint');

    // Project de Linear → project de Track con lead, teams, milestones y updates.
    const plan = (await db.prepare('SELECT * FROM track_plans WHERE id = ?').get(offline.plan_id)) as Row;
    expect(plan).toMatchObject({ name: 'Mobile app v2', status: 'in_progress', priority: 'high', lead_id: u.id, summary: 'Rebuild the mobile app on the new API' });
    expect(String(plan.description)).toContain('## Goals');
    const planTeams = (await db.prepare('SELECT COUNT(*) AS n FROM track_plan_teams WHERE plan_id = ?').get(plan.id)) as { n: number };
    expect(Number(planTeams.n)).toBe(2);
    const ms = (await db.prepare('SELECT id, name FROM track_plan_milestones WHERE plan_id = ? ORDER BY position').all(plan.id)) as Array<{ id: string; name: string }>;
    expect(ms.map((m) => m.name)).toEqual(['Beta', 'GA']);
    expect(offline.plan_milestone_id).toBe(ms[0].id);
    const updates = (await db.prepare('SELECT health, body FROM track_plan_updates WHERE plan_id = ? ORDER BY created_at').all(plan.id)) as Array<{ health: string; body: string }>;
    expect(updates.map((x) => x.health)).toEqual(['on_track', 'at_risk']);
    // Bo no es miembro: el update queda a su nombre (meta), sin pegar el nombre en el texto.
    expect(updates[0].body).toBe('Kickoff done, API contract agreed.');
    const metaRow = (await db.prepare("SELECT meta FROM track_plan_updates WHERE plan_id = ? AND body LIKE 'Kickoff%'").get(plan.id)) as { meta: string };
    expect(JSON.parse(metaRow.meta).importedAuthor).toMatchObject({ name: 'Bo Lindqvist' });

    // Initiative de Linear con sus dos projects.
    const init = (await db.prepare('SELECT id, status, lead_id FROM track_initiatives WHERE owner_id = ? AND name = ?').get(u.id, 'Mobile launch')) as Row;
    expect(init).toMatchObject({ status: 'active', lead_id: u.id });
    const linked = (await db.prepare('SELECT COUNT(*) AS n FROM track_initiative_plans WHERE initiative_id = ?').get(init.id)) as { n: number };
    expect(Number(linked.n)).toBe(2);

    // Sub-issues, triage, archivados.
    expect((await issue('Queue writes while offline')).parent_id).toBe(offline.id);
    expect((await issue('Customer reports slow search')).triage).toBe(1);
    expect((await issue('Old migration cleanup')).archived_at).toBeTruthy();

    // Comentarios con su hilo.
    const comments = (await db.prepare('SELECT id, body, parent_id FROM track_issue_comments WHERE issue_id = ? ORDER BY created_at').all(offline.id)) as Row[];
    expect(comments).toHaveLength(2);
    expect(comments[1].parent_id).toBe(comments[0].id);

    // Relaciones: bloquea, duplicado y "similar" como relacionado.
    const rels = (await db
      .prepare(
        `SELECT a.title AS a, b.title AS b, r.type FROM track_issue_relations r JOIN track_issues a ON a.id = r.issue_id JOIN track_issues b ON b.id = r.related_issue_id
         WHERE a.project_id IN (?, ?) ORDER BY r.type, a.title`,
      )
      .all(teams[0].id, eng.id)) as Row[];
    expect(rels).toEqual([
      { a: 'Queue writes while offline', b: 'Resolve conflicts on reconnect', type: 'blocks' },
      { a: 'Crash opening deleted issue from email', b: 'Crash when opening a deleted issue', type: 'duplicates' },
      { a: 'Crash when opening a deleted issue', b: 'Customer reports slow search', type: 'related' },
      { a: 'Offline sync for the mobile app', b: 'Offline state illustrations', type: 'related' },
    ]);

    // Adjuntos: el PR va a GitHub; el resto, a los links del issue.
    const pr = (await db.prepare("SELECT repo, ref, state FROM track_issue_links WHERE issue_id = ? AND kind = 'pr'").get(offline.id)) as Row;
    expect(pr).toEqual({ repo: 'acme/mobile', ref: '42', state: 'open' });
    const refs = (await db.prepare('SELECT provider, url FROM track_external_refs WHERE issue_id = ? ORDER BY url').all(offline.id)) as Row[];
    expect(refs.map((r) => r.provider)).toEqual(['link', 'link']);

    // Reimportar lo mismo: nada nuevo, nada duplicado.
    const again = await importLinear(u.id, 'lin_api_fake');
    expect((again.preview.preview as Record<string, unknown>).alreadyImported).toBe(11);
    expect(again.done.report).toMatchObject({ issues: 0, updated: 0, skipped: 11, comments: 0, projectsCreated: 0, plansCreated: 0, initiativesCreated: 0, relations: 0, attachments: 0, planUpdates: 0 });

    // Una edición hecha en Track después del import se respeta.
    await db.prepare("UPDATE track_issues SET title = 'Edited in Track', updated_at = ? WHERE id = ?").run(new Date().toISOString(), (await issue('Resolve conflicts on reconnect')).id);

    // Documento de Linear → página de Docs del workspace, enlazada como recurso del project.
    const docPage = (await db.prepare("SELECT id, user_id, content FROM docs_pages WHERE user_id = ? AND title = 'Offline sync spec'").get(u.id)) as Row;
    expect(String(docPage.content)).toContain('Writes queue locally');
    const planLinks = JSON.parse(String(((await db.prepare('SELECT links FROM track_plans WHERE id = ?').get(plan.id)) as Row).links)) as Array<{ url: string }>;
    expect(planLinks.map((l) => l.url)).toContain(`/app/docs/${docPage.id}`);

    // Mientras dura la mudanza alguien crea un issue en Track: toma ENG-10, que Linear también va a usar.
    const local = await createIssue(eng.id, u.id, { title: 'Created in Track during the move', description: [] }, { source: 'app' });
    expect(local.identifier).toBe('ENG-10');

    // Un día después en Linear: un issue renombrado y movido, un comentario y un issue nuevos.
    const v2 = await importLinear(u.id, 'lin_api_fake_v2');
    expect(v2.preview.preview).toMatchObject({ issues: 12, alreadyImported: 11, toUpdate: 1 });
    expect(v2.done.report).toMatchObject({ issues: 1, updated: 1, skipped: 10, comments: 1, projectsCreated: 0, plansCreated: 0 });
    const renamed = (await db.prepare('SELECT title, status_id FROM track_issues WHERE id = ?').get(offline.id)) as Row;
    expect(renamed.title).toBe('Offline sync for the mobile app (v2)');
    expect((await listStatuses(eng.id)).find((s) => s.id === renamed.status_id)?.name).toBe('In Review');
    expect(await issue('Edited in Track')).toBeTruthy();
    // El ID de Linear es del issue de Linear; el local pasó al siguiente y el informe lo dice.
    const retry = await issue('Retry failed uploads');
    expect(retry.identifier).toBe('ENG-10');
    expect((await issue('Created in Track during the move')).identifier).toBe('ENG-11');
    expect(v2.done.report).toMatchObject({ renumbered: [{ from: 'ENG-10', to: 'ENG-11' }], documents: 1 });
    expect(await resolveIssueRef('ENG-10', null, u.id)).toBe(retry.id);
    expect(await nextIdentifier(eng.id)).toBe('ENG-12');
    const total = (await db.prepare('SELECT COUNT(*) AS n FROM track_issues WHERE project_id IN (?, ?)').get(teams[0].id, eng.id)) as { n: number };
    expect(Number(total.n)).toBe(13);

    // Una página de 2 issues trae igual el total por status (las columnas del board dicen el real).
    const page = await listIssues(eng.id, { pageSize: 2, page: 1 });
    expect(page.rows).toHaveLength(2);
    expect(Object.values(page.statusCounts ?? {}).reduce((a, b) => a + b, 0)).toBe(page.total);
  }, 60_000);

  it('una key que Linear rechaza falla con unauthorized y no deja la key guardada', async () => {
    const u = await makeUser('linbad');
    const job = await createImportJob({ workspaceId: u.id, teamId: null, userId: u.id, app: 'track', source: 'linear', options: { target: 'new' }, secret: 'lin_api_fake_wrong' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] }), { status: 400 })));
    const view = (await runImportJob(job.id))!;
    vi.unstubAllGlobals();
    expect(view).toMatchObject({ status: 'failed', error: 'unauthorized' });
    expect((await getImportJobRow(job.id))?.secret).toBeNull();
  });
});
