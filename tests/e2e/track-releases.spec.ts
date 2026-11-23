import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, settle } from './responsive-audit';

/**
 * Releases como Linear: crear desde la lista (y ⌘K › New release), sumar
 * issues desde el release, desde el panel del issue y con ⌘K en la lista,
 * avance, notas generadas (editar, volver a generar), Release como propiedad,
 * filtro y agrupado, renombrar y borrar sin recargar. A 390 sin scroll
 * lateral; capturas en los cinco aspectos.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR ?? (process.env.CI ? 'e2e-results/shots' : '');
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Issue = { id: string; identifier: string; title: string; release_id?: string | null };

async function seed(request: APIRequestContext) {
  const tag = uid();
  const team = await ok<{ id: string; slug: string }>(request.post('/api/track/projects', { data: { name: `Rel ${tag}` } }));
  const mk = (title: string) => ok<Issue>(request.post(`/api/track/projects/${team.id}/issues`, { data: { title: `${title} ${tag}` } }));
  const a = await mk('Dark mode');
  const b = await mk('Faster search');
  const c = await mk('Export to CSV');
  return { tag, team, a, b, c };
}

async function issueOf(request: APIRequestContext, id: string): Promise<Issue> {
  return (await (await request.get(`/api/track/issues/${id}`)).json()) as Issue;
}

test.beforeEach(() => {
  test.slow();
});

test('lista y release: crear, sumar issues, avance, notas, renombrar y borrar', async ({ page, request }) => {
  const s = await seed(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/en/app/track/releases?new=1&team=${s.team.id}`, { waitUntil: 'networkidle' });
  const dialog = page.getByTestId('track-release-dialog');
  await expect(dialog).toBeVisible();
  // Esc cierra el alta; el botón la vuelve a abrir.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('track-release-new').click();
  await page.getByTestId('track-release-name').fill(`Mobile ${s.tag}`);
  await page.getByTestId('track-release-version').fill('2.1');
  await page.getByTestId('track-release-team').selectOption(s.team.id);
  await page.getByTestId('track-release-create').click();
  await expect(page).toHaveURL(/\/app\/track\/releases\/[0-9a-f-]{36}/);
  const releaseId = page.url().split('/').pop()!.split('?')[0];
  await expect(page.getByTestId('track-release-title')).toHaveText(`Mobile ${s.tag}`);

  // Sumar issues desde el release (buscar y Enter).
  await page.getByTestId('track-release-add').click();
  await page.getByTestId('track-release-picker-input').fill(s.a.title);
  await expect(page.getByTestId('track-release-picker-item').first()).toContainText(s.a.identifier);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('track-release-issue')).toHaveCount(1);
  await page.getByTestId('track-release-picker-input').fill(s.b.title);
  await page.getByTestId('track-release-picker-item').filter({ hasText: s.b.identifier }).click();
  await expect(page.getByTestId('track-release-issue')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('track-release-picker')).toHaveCount(0);

  // Avance: cerrar uno lo lleva a 50 %.
  const statuses = ((await (await request.get(`/api/track/projects/${s.team.id}/statuses`)).json()) as { rows: Array<{ id: string; category: string }> }).rows;
  await request.patch(`/api/track/issues/${s.a.id}`, { data: { statusId: statuses.find((x) => x.category === 'done')!.id } });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-release-progress')).toContainText('50%');

  // Notas generadas con el título del terminado; editar y volver a generar.
  const notes = page.getByTestId('track-release-notes');
  await expect(notes).toContainText(s.a.title);
  await page.getByTestId('track-release-notes-edit').click();
  await page.getByTestId('track-release-notes-input').fill(`# Mobile 2.1\n\nHand written ${s.tag}`);
  await page.getByTestId('track-release-notes-save').click();
  await expect(notes).toContainText(`Hand written ${s.tag}`);
  await page.getByTestId('track-release-notes-reset').click();
  await expect(notes).toContainText(s.a.title);

  // Estado: In progress.
  await page.getByRole('button', { name: 'Status' }).click();
  await page.getByTestId('track-release-status-in_progress').click();
  await expect(page.getByTestId('track-release-status-value')).toHaveText('In progress');
  await shot(page, 'track-release-page-1280');

  // Sacar un issue (con ⌘Z vuelve).
  await page.getByTestId('track-release-issue').filter({ hasText: s.b.identifier }).hover();
  await page.getByTestId('track-release-issue').filter({ hasText: s.b.identifier }).getByTestId('track-release-issue-remove').click();
  await expect(page.getByTestId('track-release-issue')).toHaveCount(1);
  await expect.poll(async () => (await issueOf(request, s.b.id)).release_id ?? null).toBeNull();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('track-release-issue')).toHaveCount(2);

  // La lista: en curso, renombrar en el lugar y borrar sin recargar.
  await page.goto('/en/app/track/releases', { waitUntil: 'networkidle' });
  const row = page.getByTestId('track-release-row').filter({ hasText: `Mobile ${s.tag}` });
  await expect(row).toContainText('50%');
  await shot(page, 'track-releases-list-1280');
  await row.locator('.track-release-row-more').click();
  await page.getByTestId('track-release-rename').click();
  await page.getByTestId('track-release-rename-input').fill(`Mobile app ${s.tag}`);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('track-release-row').filter({ hasText: `Mobile app ${s.tag}` })).toHaveCount(1);
  expect(((await (await request.get(`/api/track/releases/${releaseId}`)).json()) as { release: { name: string } }).release.name).toBe(`Mobile app ${s.tag}`);
  const renamed = page.getByTestId('track-release-row').filter({ hasText: `Mobile app ${s.tag}` });
  await renamed.locator('.track-release-row-more').click();
  await page.getByTestId('track-release-delete').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete release' }).click();
  await expect(page.getByTestId('track-release-row').filter({ hasText: `Mobile app ${s.tag}` })).toHaveCount(0);
  expect((await issueOf(request, s.a.id)).release_id ?? null).toBeNull();
});

test('issue y lista: Release en el panel, ⌘K, filtro y agrupado', async ({ page, request }) => {
  const s = await seed(request);
  const release = await ok<{ id: string }>(request.post('/api/track/releases', { data: { projectId: s.team.id, name: `Web ${s.tag}`, version: '1.0' } }));
  await page.setViewportSize({ width: 1280, height: 800 });

  // Panel del issue: chip Release.
  await page.goto(`/en/app/track/issues/${s.a.id}`, { waitUntil: 'networkidle' });
  const chip = page.getByTestId('track-side-release');
  await expect(chip).toBeVisible();
  await chip.locator('button').click();
  await page.locator('.cmdk').getByRole('option', { name: new RegExp(`Web ${s.tag} 1.0`) }).click();
  await expect(chip).toContainText(`Web ${s.tag} 1.0`);
  await expect.poll(async () => (await issueOf(request, s.a.id)).release_id).toBe(release.id);

  // Lista del team: ⌘K sobre una fila › Add to release.
  await page.goto(`/en/app/track/team/${s.team.id}`, { waitUntil: 'networkidle' });
  const rowB = page.locator('[data-issue-row]', { hasText: s.b.identifier }).first();
  await rowB.hover();
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.cmdk-input').fill('release');
  await page.locator('.cmdk').getByRole('option', { name: /Add to release…/ }).click();
  await page.locator('.cmdk').getByRole('option', { name: new RegExp(`Web ${s.tag}`) }).click();
  await expect.poll(async () => (await issueOf(request, s.b.id)).release_id).toBe(release.id);

  // Filtro Release y agrupado por Release.
  await page.getByTestId('track-filter-add').click();
  await page.getByTestId('track-filter-field-release').click();
  await page.getByTestId(`track-filter-value-release-${release.id}`).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('tr[data-issue-row]')).toHaveCount(2);
  await page.locator('.track-filter-chip-remove').click();
  await page.goto(`/en/app/track/team/${s.team.id}?group=release`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('track-group').filter({ hasText: `Web ${s.tag} 1.0` })).toHaveCount(1);
  await expect(page.getByTestId('track-group').filter({ hasText: 'No release' })).toHaveCount(1);
  await shot(page, 'track-releases-grouped-1280');
});

test('390 y los cinco aspectos: lista y página del release sin scroll lateral', async ({ browser, request, baseURL }) => {
  const s = await seed(request);
  const release = await ok<{ id: string }>(request.post('/api/track/releases', { data: { projectId: s.team.id, name: `Phone ${s.tag}`, version: '3.0' } }));
  await request.post(`/api/track/releases/${release.id}/issues`, { data: { issueIds: [s.a.id, s.b.id, s.c.id] } });
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  for (const path of ['/en/app/track/releases', `/en/app/track/releases/${release.id}`]) {
    await page.goto(path, { waitUntil: 'networkidle' });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const look of LOOKS) {
        await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
        await settle(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await shot(page, `track-releases-390-${path.includes(release.id) ? 'page' : 'list'}-${look}-${scheme}`);
      }
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
    await page.emulateMedia({ colorScheme: 'light' });
  }
  // Sacar un issue con el dedo: la cruz se ve sin hover y mide 40px.
  const remove = page.getByTestId('track-release-issue-remove').first();
  await expect(remove).toBeVisible();
  const box = (await remove.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(40);
  await remove.tap();
  await expect(page.getByTestId('track-release-issue')).toHaveCount(2);
  await ctx.close();
});

test('1280: cinco aspectos, claro y oscuro (capturas)', async ({ page, request }) => {
  test.skip(!SHOTS, 'solo capturas');
  const s = await seed(request);
  const release = await ok<{ id: string }>(request.post('/api/track/releases', { data: { projectId: s.team.id, name: `Looks ${s.tag}`, version: '1.2', status: 'in_progress' } }));
  await request.post(`/api/track/releases/${release.id}/issues`, { data: { issueIds: [s.a.id, s.b.id] } });
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const path of ['/en/app/track/releases', `/en/app/track/releases/${release.id}`]) {
    await page.goto(path, { waitUntil: 'networkidle' });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const look of LOOKS) {
        await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
        await settle(page);
        await shot(page, `track-releases-1280-${path.includes(release.id) ? 'page' : 'list'}-${look}-${scheme}`);
      }
    }
  }
});
