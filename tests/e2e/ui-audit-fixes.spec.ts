import { createClient } from '@libsql/client';
import { expect, test, type Page } from '@playwright/test';

/** Regresiones de la auditoría de UI: arreglos compartidos y errores funcionales. */
const LONG = 'Implementación integral de la plataforma de atención al cliente para Latinoamérica y el Caribe, fase 2';
const uid = () => Math.random().toString(36).slice(2, 8);

async function noPageScroll(page: Page) {
  const { doc, win } = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(doc).toBeLessThanOrEqual(win + 1);
}

test('un <th scope="row"> se ve como las demás celdas', async ({ page }) => {
  await page.goto('/en/app/people', { waitUntil: 'networkidle' });
  const th = page.locator('table.table tbody th').first();
  await expect(th).toBeVisible();
  const css = await th.evaluate((el) => {
    const s = getComputedStyle(el);
    const td = el.parentElement!.querySelector('td');
    return { size: s.fontSize, border: s.borderBottomColor, tdBorder: td ? getComputedStyle(td).borderBottomColor : '', padding: s.paddingTop };
  });
  expect(css.size).toBe('14px');
  expect(css.border).toBe(css.tdBorder);
  expect(parseFloat(css.padding)).toBeGreaterThan(0);
});

test('<section>: sin aire en la app, con aire en el sitio público', async ({ page }) => {
  await page.goto('/en/app/hiring/settings', { waitUntil: 'networkidle' });
  const app = await page.locator('.app-content section').first().evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(app).toBeLessThan(40);
  await page.goto('/en', { waitUntil: 'networkidle' });
  // Algunas secciones del home fijan su propio padding; la regla global sigue en las demás.
  const site = await page.evaluate(() => Math.max(...[...document.querySelectorAll('section')].map((el) => parseFloat(getComputedStyle(el).paddingTop))));
  expect(site).toBeGreaterThanOrEqual(40);
});

test('un título largo editable se lee entero y Enter confirma sin agregar saltos', async ({ page, request }) => {
  const res = await request.post('/api/sign/envelopes', { data: { title: LONG } });
  expect(res.ok()).toBeTruthy();
  const created = (await res.json()) as { id?: string; envelope?: { id: string } };
  await page.goto(`/en/app/sign/envelopes/${created.id ?? created.envelope?.id}`, { waitUntil: 'networkidle' });
  const title = page.locator('.ui-title-input');
  await expect(title).toHaveValue(LONG);
  const box = await title.evaluate((el) => ({ w: el.clientWidth, cw: el.scrollWidth, h: el.clientHeight, sh: el.scrollHeight }));
  expect(box.w).toBeGreaterThan(500);
  expect(box.sh).toBeLessThanOrEqual(box.h + 2);
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(title).toHaveValue(LONG);
  await expect(title).not.toBeFocused();
});

test('los títulos editables conservan el tamaño y el peso de su app', async ({ page, request }) => {
  const plan = await request.post('/api/track/plans', { data: { name: LONG } });
  expect(plan.ok()).toBeTruthy();
  const { id } = (await plan.json()) as { id: string };
  await page.goto(`/en/app/track/projects/${id}`, { waitUntil: 'networkidle' });
  const title = page.getByTestId('tp-plan-name');
  await expect(title).toHaveValue(LONG);
  expect(await title.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight])).toEqual(['24px', '700']);

  // Esc descarta lo escrito: no se guarda.
  await title.fill('Borrador descartado');
  await page.keyboard.press('Escape');
  await expect(title).toHaveValue(LONG);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('tp-plan-name')).toHaveValue(LONG);

  const form = await request.post('/api/forms', { data: { name: LONG, template: null, lang: 'en' } });
  expect(form.ok()).toBeTruthy();
  const created = (await form.json()) as { id?: string; form?: { id: string } };
  await page.goto(`/en/app/forms/${created.id ?? created.form?.id}`, { waitUntil: 'networkidle' });
  const name = page.locator('#fm-name');
  await expect(name).toHaveValue(LONG);
  expect(await name.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight])).toEqual(['21.6px', '700']);
});

test('una navegación lenta da respuesta y las estáticas conservan el esqueleto', async ({ page }) => {
  await page.goto('/en/app/settings', { waitUntil: 'networkidle' });
  await page.route('**/app/sign/settings**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.locator('.st-nav a[href$="/app/sign/settings"]').click();
  await expect(page.getByTestId('nav-progress')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/sign\/settings/);
  await expect(page.getByTestId('nav-progress')).toHaveCount(0);
});

test('los registros desconocidos responden 404 y los válidos abren', async ({ request }) => {
  for (const path of ['people/emp_zzz', 'people/reviews/zzz', 'shop/products/zzz', 'shop/orders/zzz', 'books/invoices/zzz', 'books/contacts/zzz', 'hiring/jobs/zzz', 'hiring/candidates/zzz', 'sign/envelopes/zzz', 'sign/templates/zzz', 'sign/settings/x', 'agents/zzz', 'analytics/insights/zzz', 'analytics/dashboards/zzz', 'analytics/flags/zzz', 'analytics/persons/zzz', 'calendar/event-types/zzz', 'calendar/polls/zzz', 'links/zzz', 'rec/zzz', 'robots/zzz', 'social/posts/zzz', 'talk/zzz', 'voice/meetings/zzz', 'track/projects/zzz']) {
    expect((await request.get(`/en/app/${path}`)).status(), path).toBe(404);
  }
  for (const path of ['agents', 'agents/settings', 'analytics', 'analytics/insights', 'analytics/insights/new', 'calendar', 'calendar/polls', 'links', 'links/new', 'rec', 'rec/new', 'robots', 'robots/recorder', 'social', 'social/posts', 'talk', 'voice', 'books/invoices/new', 'shop/products/new', 'hiring/jobs/new', 'docs/import']) {
    expect((await request.get(`/en/app/${path}`, { maxRedirects: 2 })).status(), path).toBe(200);
  }
  // Registros reales recién creados.
  const job = (await (await request.post('/api/hiring/jobs', { data: { title: `J ${uid()}` } })).json()) as { id?: string; job?: { id: string } };
  expect((await request.get(`/en/app/hiring/jobs/${job.id ?? job.job?.id}`)).status()).toBe(200);
  const robot = (await request.get('/api/robots')).ok();
  expect(robot).toBeTruthy();
  const link = (await (await request.post('/api/links', { data: { url: 'https://example.com/a', slug: `l-${uid()}` } })).json()) as { id: string };
  expect((await request.get(`/en/app/links/${link.id}`)).status()).toBe(200);
});

test('Vista previa de empresa: carga y atrapa el foco', async ({ page, request }) => {
  await request.post('/api/crm/companies', { data: { name: `Preview ${uid()}` } });
  await page.goto('/en/app/crm/companies', { waitUntil: 'networkidle' });
  await page.locator('.preview-btn').first().click();
  const panel = page.locator('.preview-panel');
  await expect(panel.locator('.preview-close')).toBeFocused();
  await expect(panel).not.toContainText(/couldn.t load|failed/i);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('las secciones y registros desconocidos responden 404', async ({ request }) => {
  for (const path of ['sign/zzz', 'shop/zzz', 'books/zzz', 'people/zzz', 'hiring/zzz', 'forms/zzz', 'crm/contacts/zzz', 'crm/companies/zzz', 'crm/deals/zzz', 'crm/leads/zzz', 'docs/zzz']) {
    const res = await request.get(`/en/app/${path}`);
    expect(res.status(), path).toBe(404);
  }
  for (const path of ['sign', 'sign/settings', 'shop/products', 'books/invoices', 'people/org', 'hiring/jobs', 'forms', 'crm/contacts', 'docs']) {
    const res = await request.get(`/en/app/${path}`);
    expect(res.status(), path).toBe(200);
  }
});

test('People: la ficha de una persona sigue abriendo', async ({ page }) => {
  const res = await page.goto('/en/app/people/me', { waitUntil: 'networkidle' });
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/app\/people\/emp_/);
});

test('Ajustes de Sign: el link de la plataforma lleva a una página real', async ({ page }) => {
  await page.goto('/en/app/settings', { waitUntil: 'networkidle' });
  await page.locator('.st-nav a[href$="/app/sign/settings"]').click();
  await expect(page).toHaveURL(/\/app\/sign\/settings/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sign');
  await expect(page.locator('.st-link', { hasText: 'Sign templates' })).toBeVisible();
});

test('Voice, pestaña de escritorio: sin claves crudas', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('MISSING_MESSAGE')) errors.push(m.text());
  });
  await page.goto('/es/app/voice/settings?tab=desktop', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).not.toContainText('voice.settings');
  expect(errors).toEqual([]);
});

test('Esc cierra los menús de fila de Track y devuelve el foco', async ({ page, request }) => {
  const project = (await (await request.post('/api/track/projects', { data: { name: `Esc ${uid()}` } })).json()) as { id: string };
  const issue = await request.post(`/api/track/projects/${project.id}/issues`, { data: { title: `Menú ${uid()}` } });
  expect(issue.ok()).toBeTruthy();
  await page.goto('/en/app/track/issues', { waitUntil: 'networkidle' });
  const triggers = page.locator('.track-inline-trigger');
  const n = Math.min(await triggers.count(), 4);
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await triggers.nth(i).click();
    await expect(page.locator('.track-menu')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.track-menu')).toHaveCount(0);
  }
});

test.describe('390 px con nombres largos', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('sin scroll horizontal', async ({ page, request }) => {
    await request.post('/api/rec/folders', { data: { name: LONG, space: 'personal' } });
    await request.post('/api/voice/folders', { data: { name: LONG } });
    await request.post('/api/crm/companies', { data: { name: LONG } });
    await request.post('/api/crm/contacts', { data: { firstName: LONG, lastName: LONG, email: `${uid()}@departamento-de-administracion-y-finanzas.example.com` } });
    for (const path of ['rec', 'voice', 'crm/companies', 'crm/contacts']) {
      await page.goto(`/es/app/${path}`, { waitUntil: 'networkidle' });
      await noPageScroll(page);
    }
  });
});

test('Sin errores de hidratación en Link y Books', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const path of ['pt/app/links/domains', 'en/app/books/purchase-orders']) {
    await page.goto(`/${path}`, { waitUntil: 'networkidle' });
  }
  expect(errors).toEqual([]);
});

test('abrir un perfil de People deja una sola fila en la auditoría de datos personales', async ({ page, request }) => {
  const created = await request.post('/api/people/employees', { data: { name: `Auditada ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { employee } = (await created.json()) as { employee: { id: string } };
  const views = async () => {
    const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
    try {
      const { rows } = await db.execute({ sql: "SELECT COUNT(*) AS n FROM people_audit WHERE employee_id = ? AND action = 'view' AND field = 'personal'", args: [employee.id] });
      return Number(rows[0].n);
    } finally {
      db.close();
    }
  };
  const before = await views();
  await page.goto(`/es/app/people/${employee.id}`, { waitUntil: 'networkidle' });
  expect((await views()) - before).toBe(1);
});
