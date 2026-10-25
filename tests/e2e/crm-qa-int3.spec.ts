import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Detalles del CRM que dejó la última QA: el registro de un toque entra a
 * 390px, teléfonos formateados con una sola función, período del forecast
 * localizado, ⌘K con ajustes y playbooks, menú M del board junto a la card,
 * C en Lists, cortes a 390px y la franja "Powered by" de /view.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const PHONE = { width: 390, height: 844 };
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';

async function ok<T = unknown>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (r.status() === 204 ? null : await r.json()) as T;
}

async function insideViewport(el: Locator, width = PHONE.width) {
  const box = (await el.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
}

/** El texto entra en su caja (sin recorte por overflow ni por el input). */
async function notClipped(el: Locator) {
  const { sw, cw } = await el.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw + 1);
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

async function firstPipeline(request: APIRequestContext) {
  const body = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; is_won: number; is_lost: number }> }> }>(
    request.get('/api/crm/pipelines'),
  );
  const p = body.rows[0];
  return { id: p.id, open: p.stages.filter((s) => !s.is_won && !s.is_lost) };
}

test.describe('a 390px', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('"Log this touch" entra completo y el teléfono se ve formateado', async ({ page, request }) => {
    const last = `Touch ${uid()}`;
    const contact = await ok<{ id: string }>(
      request.post('/api/crm/contacts', { data: { firstName: 'Ana', lastName: last, phone: '+5491155550100' } }),
    );
    await page.goto('/en/app/crm/contacts', { waitUntil: 'networkidle' });
    const card = page.locator('.crm-cards tbody tr').filter({ hasText: last });
    await expect(card.getByText('+54 9 11 5555-0100')).toBeVisible();
    await card.getByRole('link', { name: 'Call' }).first().evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
    await card.getByRole('link', { name: 'Call' }).first().click();
    const log = page.getByRole('form', { name: 'Log this touch' });
    await expect(log).toBeVisible();
    await insideViewport(log);
    await noHorizontalScroll(page);
    await page.keyboard.press('Escape');

    await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByText('+54 9 11 5555-0100').first()).toBeVisible();
  });

  test('Overview, Products y la tarea nueva sin cortes', async ({ page, request }) => {
    const subject = `A long activity subject that wraps on a phone ${uid()}`;
    await ok(request.post('/api/crm/activities', { data: { type: 'note', subject } }));
    await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
    const row = page.locator('.recent-row').filter({ hasText: subject }).first();
    await expect(row).toBeVisible();
    const date = row.locator('.recent-date');
    await notClipped(date);
    const rowBox = (await row.boundingBox())!;
    const dateBox = (await date.boundingBox())!;
    expect(dateBox.x + dateBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
    await noHorizontalScroll(page);

    const product = `Plan ${uid()}`;
    await ok(request.post('/api/crm/products', { data: { name: product, price: 125000, currency: 'USD' } }));
    await page.goto('/en/app/crm/products', { waitUntil: 'networkidle' });
    const prow = page.locator('tr').filter({ hasText: product });
    const price = prow.locator('td.num').first();
    await expect(price).toBeVisible();
    await notClipped(price);
    await insideViewport(price);
    await noHorizontalScroll(page);

    await page.goto('/en/app/crm/tasks', { waitUntil: 'networkidle' });
    await page.getByTestId('crm-quick-task').click();
    const due = page.getByLabel('Due');
    await due.fill('2030-01-04T09:00');
    const dueBox = (await due.boundingBox())!;
    expect(dueBox.width).toBeGreaterThanOrEqual(200);
    await insideViewport(due);
  });

  test('board: M abre el menú junto a la card', async ({ page, request }) => {
    const p = await firstPipeline(request);
    const name = `Near ${uid()}`;
    await ok(request.post('/api/crm/deals', { data: { name, pipelineId: p.id, stageId: p.open[0].id, amount: 10 } }));
    await page.goto(`/en/app/crm/deals?pipeline=${p.id}`, { waitUntil: 'networkidle' });
    const card = page.locator('.kb-card', { hasText: name });
    await card.focus();
    await page.keyboard.press('m');
    const menu = page.getByRole('menu', { name: 'Move to…' });
    await expect(menu).toBeVisible();
    await insideViewport(menu);
    const c = (await card.boundingBox())!;
    const m = (await menu.boundingBox())!;
    // Pegado a la card: arriba o abajo, a menos de 16px de su borde.
    const gap = m.y >= c.y ? m.y - (c.y + c.height) : c.y - (m.y + m.height);
    expect(Math.abs(gap)).toBeLessThanOrEqual(16);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('/view: la franja "Powered by" tiene el fondo de la página', async ({ page, request }) => {
    const doc = await ok<{ id: string }>(
      request.post('/api/crm/documents', { multipart: { file: { name: 'deck.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF) }, name: `Deck ${uid()}` } }),
    );
    const link = await ok<{ token: string }>(request.post(`/api/crm/documents/${doc.id}/links`, { data: {} }));
    await page.goto(`/en/view/${link.token}`, { waitUntil: 'domcontentloaded' });
    const strip = page.locator('.powered-by');
    await expect(strip).toBeVisible();
    const [mainBg, stripBg] = await Promise.all([
      page.locator('.dv-main').evaluate((n) => getComputedStyle(n).backgroundColor),
      strip.evaluate((n) => getComputedStyle(n).backgroundColor),
    ]);
    expect(stripBg).toBe(mainBg);
  });
});

test('Forecast muestra el período con el nombre del mes', async ({ page }) => {
  await page.goto('/en/app/crm/forecast', { waitUntil: 'networkidle' });
  const label = page.getByTestId('fc-period');
  await expect(label).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
  await page.getByRole('button', { name: 'Quarter' }).click();
  await expect(label).toHaveText(/^Q[1-4] \d{4}$/);
  await page.goto('/es/app/crm/forecast', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('fc-period')).not.toHaveText(/\d{4}-\d{2}/);
});

test('⌘K: ajustes del CRM y playbooks', async ({ page }) => {
  await page.goto('/en/app/crm', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await search.getByRole('combobox').fill('CRM settings');
  await expect(search.getByRole('option', { name: /CRM settings/ }).first()).toBeVisible();
  await search.getByRole('combobox').fill('playbooks');
  await expect(search.getByRole('option', { name: /Open playbooks/ })).toBeVisible();
  await search.getByRole('option', { name: /Open playbooks/ }).click();
  await page.waitForURL(/\/app\/crm\/playbooks/);
});

test('Lists: C abre el alta con el foco en Name', async ({ page }) => {
  await page.goto('/en/app/crm/lists', { waitUntil: 'networkidle' });
  await page.keyboard.press('c');
  await expect(page.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.type('Hot leads');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Hot leads');
});
