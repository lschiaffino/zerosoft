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
