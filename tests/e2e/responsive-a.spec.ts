import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { auditOverlays, check, CRAWL_DIR, PHONE, setTheme, settle, SMALL_PHONE, TABLET } from './responsive-audit';

/**
 * Recorrido responsive (mitad A): shell, Home, Track, Docs, CRM, Groups, Chat,
 * Cal, Link, Board, Design, Analytics, Ajustes, onboarding, sitio y /download.
 * Cada ruta a 390px con tacto (alternando claro y oscuro), un grupo a 360px y
 * a 768px, y los overlays de cada página (menús, diálogos, pickers).
 * Un test por app para que los shards se repartan el trabajo.
 *
 * Para mirar todo a mano: RESPONSIVE_CRAWL=<carpeta> guarda capturas y el
 * reporte sin fallar (ver tests/e2e/responsive-audit.ts).
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

type Ids = Record<string, string>;
let ids: Ids | null = null;

/** Un ítem de cada cosa con nombre largo, para las rutas de detalle. */
async function seed(request: APIRequestContext): Promise<Ids> {
  if (ids) return ids;
  const long = `Responsive check with a fairly long name ${uid()}`;
  const out: Ids = {};
  const team = await ok<{ id: string; key?: string }>(request.post('/api/track/projects', { data: { name: `Mobile ${uid()}` } }));
  out.team = team.id;
  out.issue = (await ok<{ id: string }>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: long } }))).id;
  out.plan = (await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: long } }))).id;
  out.initiative = (await ok<{ id: string }>(request.post('/api/track/initiatives', { data: { name: long } }))).id;
  out.trackDash = (await ok<{ id: string }>(request.post('/api/track/dashboards', { data: { name: long } }))).id;
  out.doc = (await ok<{ id: string }>(request.post('/api/docs/pages', { data: { title: long } }))).id;
  out.board = (await ok<{ id: string }>(request.post('/api/boards', { data: { name: long } }))).id;
  const company = await ok<{ id: string }>(request.post('/api/crm/companies', { data: { name: long, domain: `r-${uid()}.example.com` } }));
  out.company = company.id;
  out.contact = (await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Ana', lastName: `Responsive ${uid()}`, email: `r-${uid()}@example.com`, companyId: company.id } }))).id;
  const pipes = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string }> }> }>(request.get('/api/crm/pipelines'));
  out.deal = (await ok<{ id: string }>(request.post('/api/crm/deals', { data: { name: long, pipelineId: pipes.rows[0].id, stageId: pipes.rows[0].stages[0].id, amount: 1200 } }))).id;
  out.lead = (await ok<{ id: string }>(request.post('/api/crm/leads', { data: { name: long } }))).id;
  out.playbook = (await ok<{ id: string }>(request.post('/api/crm/playbooks', { data: { name: long } }))).id;
  out.crmReport = (await ok<{ id: string }>(request.post('/api/crm/custom-reports', { data: { name: long, config: { source: 'deals' } } }))).id;
  out.eventType = (await ok<{ id: string }>(request.post('/api/calendar/event-types', { data: { title: long, slug: `r-${uid()}`, durationMin: 30, active: true } }))).id;
  const times = [2, 3].map((d) => new Date(Date.now() + d * 86_400_000).toISOString());
  out.poll = (await ok<{ id: string }>(request.post('/api/calendar/polls', { data: { title: long, durationMin: 30, times } }))).id;
  out.link = (await ok<{ id: string }>(request.post('/api/links', { data: { url: `https://example.com/${uid()}`, slug: `r-${uid()}`, title: long } }))).id;
  out.widget = (await ok<{ id: string }>(request.post('/api/chat/widgets', { data: { name: long } }))).id;
  out.design = (await ok<{ design: { id: string } }>(request.post('/api/design/designs', { data: { name: long, width: 1080, height: 1080 } }))).design.id;
  // Un número falso ya conectado (de otra corrida o de otro spec) sirve; el plan limita cuántos se crean.
  const { numbers } = await ok<{ numbers: Array<{ id: string; provider: string; status: string }> }>(request.get('/api/groups/numbers'));
  let number = numbers.find((n) => n.provider === 'fake' && n.status === 'connected');
  if (!number) {
    const created = await ok<{ id: string }>(request.post('/api/groups/numbers', { data: { provider: 'fake', name: 'Responsive line' } }));
    await ok(request.post(`/api/groups/numbers/${created.id}/connect`, { data: { action: 'connect' } }));
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${created.id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
      .toBe('connected');
    number = { id: created.id, provider: 'fake', status: 'connected' };
  }
  const g = await ok<{ results: Array<{ chatId?: string }> }>(request.post('/api/groups/create', { data: { numberId: number.id, name: long, phones: ['+15550009001'] } }));
  out.group = g.results[0].chatId!;
  const { projects } = await ok<{ projects: Array<{ id: string }> }>(request.get('/api/analytics/projects'));
  out.anProject = projects[0]?.id ?? (await ok<{ project: { id: string } }>(request.post('/api/analytics/projects', { data: { name: 'Responsive site' } }))).project.id;
  out.insight = (await ok<{ insight: { id: string } }>(
    request.post('/api/analytics/insights', { data: { projectId: out.anProject, name: long, query: { kind: 'trends', series: [{ event: 'view' }], dateRange: { from: '-7d' }, display: 'number' } } }),
  )).insight.id;
  out.anDash = (await ok<{ dashboard: { id: string } }>(request.post('/api/analytics/dashboards', { data: { projectId: out.anProject, name: long } }))).dashboard.id;
  ids = out;
  return out;
}

/** Rutas por app. `{x}` se reemplaza por ids.x. */
const APPS: Record<string, string[]> = {
  shell: ['/en/app', '/en/app/welcome', '/en/app/assistant'],
  site: [
    '/en', '/en/products', '/en/products/docs', '/en/products/crm', '/en/compare', '/en/changelog', '/en/blog', '/en/download',
    '/en/security', '/en/privacy', '/en/roadmap', '/en/feedback-board', '/en/tools', '/en/brand', '/en/status', '/en/videos',
  ],
  track: [
    '/en/app/track', '/en/app/track/inbox', '/en/app/track/my-tasks', '/en/app/track/issues', '/en/app/track/issues/{issue}',
    '/en/app/track/projects', '/en/app/track/projects/{plan}', '/en/app/track/initiatives', '/en/app/track/initiatives/{initiative}',
    '/en/app/track/cycles', '/en/app/track/roadmap', '/en/app/track/triage', '/en/app/track/teams', '/en/app/track/team/{team}',
    '/en/app/track/dashboards', '/en/app/track/dashboards/{trackDash}', '/en/app/track/insights', '/en/app/track/customers',
    '/en/app/track/settings', '/en/app/track/projects/new', '/en/app/track/teams/new',
  ],
  docs: ['/en/app/docs', '/en/app/docs/{doc}', '/en/app/docs/settings', '/en/app/docs/import'],
  crm: [
    '/en/app/crm', '/en/app/crm/contacts', '/en/app/crm/contacts/{contact}', '/en/app/crm/companies', '/en/app/crm/companies/{company}',
    '/en/app/crm/deals', '/en/app/crm/deals/{deal}', '/en/app/crm/leads', '/en/app/crm/leads/{lead}', '/en/app/crm/tasks',
    '/en/app/crm/tasks/queue', '/en/app/crm/lists', '/en/app/crm/sequences', '/en/app/crm/templates', '/en/app/crm/workflows',
    '/en/app/crm/workflows/new', '/en/app/crm/reports', '/en/app/crm/reports/custom/{crmReport}', '/en/app/crm/dashboards',
    '/en/app/crm/forecast', '/en/app/crm/quotes', '/en/app/crm/products', '/en/app/crm/documents', '/en/app/crm/videos',
    '/en/app/crm/playbooks', '/en/app/crm/playbooks/{playbook}', '/en/app/crm/forms', '/en/app/crm/objects', '/en/app/crm/approvals',
    '/en/app/crm/agents', '/en/app/crm/trash', '/en/app/crm/settings', '/en/app/crm/contacts/new', '/en/app/crm/deals/new',
  ],
  groups: [
    '/en/app/groups', '/en/app/groups/inbox', '/en/app/groups/inbox/{group}', '/en/app/groups/list', '/en/app/groups/list/{group}',
    '/en/app/groups/broadcasts', '/en/app/groups/broadcasts/new', '/en/app/groups/templates', '/en/app/groups/tasks',
    '/en/app/groups/tickets', '/en/app/groups/analytics', '/en/app/groups/settings',
  ],
  chat: [
    '/en/app/chat', '/en/app/chat/inbox', '/en/app/chat/people', '/en/app/chat/companies', '/en/app/chat/campaigns',
    '/en/app/chat/reports', '/en/app/chat/views', '/en/app/chat/teams', '/en/app/chat/widgets', '/en/app/chat/widgets/{widget}',
    '/en/app/chat/widgets/{widget}/rules', '/en/app/chat/import', '/en/app/chat/settings',
  ],
  cal: [
    '/en/app/calendar', '/en/app/calendar/bookings', '/en/app/calendar/event-types', '/en/app/calendar/event-types/{eventType}',
    '/en/app/calendar/availability', '/en/app/calendar/polls', '/en/app/calendar/polls/{poll}', '/en/app/calendar/routing',
    '/en/app/calendar/analytics', '/en/app/calendar/settings',
  ],
  link: [
    '/en/app/links', '/en/app/links/{link}', '/en/app/links/new', '/en/app/links/analytics', '/en/app/links/bio', '/en/app/links/domains',
    '/en/app/links/folders', '/en/app/links/bulk', '/en/app/links/import', '/en/app/links/settings',
  ],
  board: ['/en/app/board', '/en/app/board/{board}', '/en/app/board/settings'],
  design: ['/en/app/design', '/en/app/design/{design}', '/en/app/design/templates', '/en/app/design/brand', '/en/app/design/settings'],
  analytics: [
    '/en/app/analytics', '/en/app/analytics/dashboards', '/en/app/analytics/dashboards/{anDash}', '/en/app/analytics/insights',
    '/en/app/analytics/insights/{insight}', '/en/app/analytics/insights/new', '/en/app/analytics/events', '/en/app/analytics/persons',
    '/en/app/analytics/replay', '/en/app/analytics/flags', '/en/app/analytics/experiments', '/en/app/analytics/surveys',
    '/en/app/analytics/errors', '/en/app/analytics/sql', '/en/app/analytics/cohorts', '/en/app/analytics/heatmaps',
    '/en/app/analytics/llm', '/en/app/analytics/settings', '/en/app/analytics/data', '/en/app/analytics/actions',
  ],
  settings: [
    '/en/app/settings', '/en/app/settings/workspace', '/en/app/settings/members', '/en/app/settings/teams', '/en/app/settings/security',
    '/en/app/settings/notifications', '/en/app/settings/billing', '/en/app/settings/api', '/en/app/settings/connections',
    '/en/app/settings/import', '/en/app/settings/lifecycle', '/en/app/settings/feedback', '/en/app/settings/roadmap', '/en/app/settings/changelog',
  ],
};

/** Overlays que se abren por nombre además de los menús (aria-haspopup / aria-expanded). */
const OVERLAY_NAMES = /^(share|new|create|invite|add|filter|display|view options|sort|more|import)\b/i;

const fill = (p: string, i: Ids) => p.replace(/\{(\w+)\}/g, (_, k) => i[k]);

async function visit(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  expect(res?.status() ?? 200, url).toBeLessThan(500);
  await settle(page);
}

test.describe('responsive A: teléfono', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });
  test.setTimeout(CRAWL_DIR ? 1_800_000 : 300_000);

  for (const [app, routes] of Object.entries(APPS)) {
    test(`${app} a 390px, claro y oscuro, con overlays`, async ({ page, context, request, baseURL }) => {
      const i = await seed(request);
      for (const [n, route] of routes.entries()) {
        const theme = n % 2 ? 'dark' : 'light';
        await setTheme(context, baseURL!, theme);
        const url = fill(route, i);
        await visit(page, url);
        await check(page, `390 ${theme} ${route}`);
        await auditOverlays(page, `390 ${theme} ${route}`, { extra: OVERLAY_NAMES, max: CRAWL_DIR ? 10 : 4 });
      }
    });
  }
});

test.describe('responsive A: shell', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('drawer, switcher, workspace, cuenta, ⌘K y ⌘J a 390px', async ({ page, context, baseURL }) => {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(context, baseURL!, theme);
      await visit(page, '/en/app/docs');
      // Drawer del sidebar.
      await page.locator('.band-menu').click();
      await expect(page.locator('.side.open')).toBeVisible();
      await check(page, `shell ${theme} drawer`);
      // Menús del drawer (workspace, cuenta).
      await auditOverlays(page, `shell ${theme} drawer`, { max: 6, root: '.side' });
      await visit(page, '/en/app/docs');
      await page.locator('.band-product').click();
      await check(page, `shell ${theme} app switcher`);
      await page.keyboard.press('Escape');
      await page.locator('.band-search:not(.band-ai)').click();
      await expect(page.locator('.cmdk-backdrop, [role="dialog"]').first()).toBeVisible();
      await check(page, `shell ${theme} cmdk`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Meta+j');
      await page.waitForTimeout(400);
      await check(page, `shell ${theme} assistant`);
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('responsive A: 360px y tablet', () => {
  test.use({ hasTouch: true, isMobile: true });
  const SAMPLE = ['/en/app', '/en/app/track/issues', '/en/app/track/issues/{issue}', '/en/app/docs/{doc}', '/en/app/crm/contacts', '/en/app/crm/deals/{deal}',
    '/en/app/groups/inbox/{group}', '/en/app/chat/inbox', '/en/app/calendar/event-types/{eventType}', '/en/app/links', '/en/app/board/{board}',
    '/en/app/design', '/en/app/analytics/insights/{insight}', '/en/app/settings/members', '/en', '/en/download'];

  for (const [vp, size] of [['360', SMALL_PHONE], ['768', TABLET]] as const) {
    test(`muestra de rutas a ${vp}px`, async ({ page, context, request, baseURL }) => {
      test.setTimeout(CRAWL_DIR ? 1_800_000 : 240_000);
      await page.setViewportSize(size);
      const i = await seed(request);
      for (const [n, route] of SAMPLE.entries()) {
        const theme = n % 2 ? 'light' : 'dark';
        await setTheme(context, baseURL!, theme);
        await visit(page, fill(route, i));
        // A 768 el tacto es de tablet: los mismos 40px.
        await check(page, `${vp} ${theme} ${route}`);
        if (vp === '360') await auditOverlays(page, `${vp} ${theme} ${route}`, { extra: OVERLAY_NAMES, max: CRAWL_DIR ? 8 : 3 });
      }
    });
  }
});
