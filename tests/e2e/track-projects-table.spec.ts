import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lista de projects como la de Linear: el nombre se lee entero, las celdas se
 * editan ahí (estado, prioridad, lead, fecha), cada fila recibe issues
 * arrastrados; archivar desde el ⋯ (con Deshacer) y verlos con Display;
 * lead y miembros son personas distintas; el ⋯ no mueve la página.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

async function team(request: APIRequestContext) {
  const name = `PT team ${uid()}`;
  const p = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name } }));
  return { id: p.id, name };
}

type Plan = { id: string; name: string; status: string; priority: string; lead_id: string | null; target_date: string | null; archived_at?: string | null };
const getPlan = async (request: APIRequestContext, id: string) => (await ok<{ plan: Plan }>(request.get(`/api/track/plans/${id}`))).plan;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('Tabla de projects: nombre entero, celdas editables y soltar issues en una fila', async ({ page, request }) => {
  const t = await team(request);
  const me = (await ok<{ me: string }>(request.get('/api/track/plans?meta=only'))).me;
  const name = `Checkout mobile rediseño ${uid()}`;
  const plan = await ok<{ id: string }>(
    request.post('/api/track/plans', {
      data: { name, summary: 'Un resumen bastante largo que antes se comía el ancho del nombre en la tabla de projects', status: 'planned', teamIds: [t.id] },
    }),
  );
  await page.goto(`/en/app/track/projects?team=${t.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Filter' })).toBeVisible();
  const row = page.getByTestId('tp-plan-row').filter({ hasText: name });
  await expect(row).toHaveAttribute('data-track-drop', `plan:${plan.id}`);
  await expect(row).toHaveAttribute('data-track-drop-name', name);
  // El nombre no se corta aunque haya resumen.
  const cut = await row.locator('.tp-row-name').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(cut).toBe(false);

  // Prioridad.
  await row.getByTestId('tp-row-priority').click();
  await page.keyboard.type('High');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getPlan(request, plan.id)).priority).toBe('high');
  // Lead.
  await row.getByTestId('tp-row-lead').click();
  await page.getByTestId('tp-row-lead-menu').getByRole('option').nth(1).click();
  await expect.poll(async () => (await getPlan(request, plan.id)).lead_id).toBe(me);
  // Fecha objetivo tipeada.
  await row.getByTestId('tp-row-target').click();
  await page.keyboard.type('2026-12-15');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getPlan(request, plan.id)).target_date).toBe('2026-12-15');
  await expect(row.getByTestId('tp-row-target')).toContainText('Dec 15');
  // Estado: la fila pasa al grupo In progress sin recargar.
  await row.getByTestId('tp-row-status').click();
  await page.keyboard.type('In progress');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getPlan(request, plan.id)).status).toBe('in_progress');
  await expect(page.locator('.tp-group', { hasText: 'In progress' }).getByTestId('tp-plan-row').filter({ hasText: name })).toBeVisible();
  // La salud es de solo lectura (sale de los updates).
  await expect(row.locator('.tp-row-health button')).toHaveCount(0);
  await shot(page, 'pt-table-light');

  // Soltar un issue arrastrado sobre la fila lo suma al project (capa global TrackIssueDnd).
  const issue = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: `Suelto ${uid()}` } }));
  await page.evaluate(
    ({ issueId, identifier, planId }) => {
      const src = document.createElement('div');
      src.setAttribute('data-issue-row', '');
      src.dataset.issueKey = issueId;
      src.dataset.issueIdentifier = identifier;
      src.textContent = identifier;
      document.body.appendChild(src);
      const target = document.querySelector(`[data-track-drop="plan:${planId}"]`)!;
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      src.remove();
    },
    { issueId: issue.id, identifier: issue.identifier, planId: plan.id },
  );
  await expect
    .poll(async () => (await ok<{ rows: Array<{ id: string }> }>(request.get(`/api/track/issues?planId=${plan.id}`))).rows.map((r) => r.id))
    .toContain(issue.id);
});

test('Project: el ⋯ no mueve la página, archivar con Deshacer y verlo con Display', async ({ page, request }) => {
  const t = await team(request);
  const name = `Archivable ${uid()}`;
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name, status: 'in_progress', teamIds: [t.id] } }));
  await page.goto(`/en/app/track/projects/${plan.id}`, { waitUntil: 'networkidle' });
  const before = await page.evaluate(() => window.scrollY);
  await page.getByTestId('tp-plan-more').click();
  await expect(page.getByTestId('tp-plan-more-menu')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.keyboard.type('Archive');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tp-archived-note')).toBeVisible();
  await expect.poll(async () => Boolean((await getPlan(request, plan.id)).archived_at)).toBe(true);
  // Deshacer (⌘Z) lo devuelve.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('tp-archived-note')).toHaveCount(0);
  await expect.poll(async () => Boolean((await getPlan(request, plan.id)).archived_at)).toBe(false);
  // Archivar de nuevo: sale de la lista; Display › Archived projects lo muestra.
  await page.getByTestId('tp-plan-more').click();
  await page.keyboard.type('Archive');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tp-archived-note')).toBeVisible();
  await shot(page, 'pt-archived-page');
  await page.goto(`/en/app/track/projects?team=${t.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-plan-row').filter({ hasText: name })).toHaveCount(0);
  await page.getByTestId('tp-group').click();
  await page.keyboard.type('Archived');
  await page.keyboard.press('Enter');
  const row = page.getByTestId('tp-plan-row').filter({ hasText: name });
  await expect(row).toContainText('Archived');
  await expect(page).toHaveURL(/archived=1/);
  // Desarchivar desde la página.
  await row.locator('.tp-row-link').click();
  await page.getByTestId('tp-unarchive').click();
  await expect(page.getByTestId('tp-archived-note')).toHaveCount(0);
  await expect.poll(async () => Boolean((await getPlan(request, plan.id)).archived_at)).toBe(false);
});

test('Project: lead y miembros son personas distintas', async ({ page, request }) => {
  const t = await team(request);
  const me = (await ok<{ me: string; members: Array<{ id: string; name: string | null; email: string }> }>(request.get('/api/track/plans?meta=only')));
  const self = me.members.find((m) => m.id === me.me)!;
  const plan = await ok<{ id: string }>(request.post('/api/track/plans', { data: { name: `Lead ${uid()}`, status: 'in_progress', teamIds: [t.id], leadId: me.me, memberIds: [me.me] } }));
  await page.goto(`/en/app/track/projects/${plan.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-prop-lead')).toContainText(self.name || self.email);
  await expect(page.getByTestId('tp-prop-members')).not.toContainText(self.name || self.email);
  await expect(page.getByTestId('tp-prop-members')).toContainText('Members');
  await expect(page.getByTestId('tp-side-members')).toContainText('None');
  // El lead no se ofrece como miembro.
  await page.getByTestId('tp-prop-members').click();
  await expect(page.getByTestId('tp-prop-members-menu').getByRole('option', { name: self.name || self.email })).toHaveCount(0);
  await page.keyboard.press('Escape');
});
