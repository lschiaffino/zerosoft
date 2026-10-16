import { expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

test('Cal: el editor del tipo de evento guarda todas las pestañas con un solo Guardar', async ({ page, request }) => {
  const slug = `ed-${uid()}`;
  const et = await (await request.post('/api/calendar/event-types', { data: { slug, title: 'Editor', durationMin: 30 } })).json();
  await page.goto(`/en/app/calendar/event-types/${et.id}`, { waitUntil: 'networkidle' });

  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();

  // General
  await page.getByLabel('Title').fill('Editor renamed');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  // Preguntas: la clave sale de la etiqueta.
  await page.getByRole('tab', { name: 'Questions' }).click();
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByRole('textbox', { name: 'Question 1' }).fill('Company size');

  // Avanzado: límites propios en vez de los del calendario.
  const tabs = page.getByRole('tab', { name: 'Advanced' });
  await tabs.focus();
  await expect(tabs).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: /^Questions/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tabs).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('switch', { name: "Use the calendar's defaults" }).uncheck();
  await page.getByLabel('Minimum notice (hours)').fill('2');

  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible({ timeout: 20_000 });
  const after = await (await request.get(`/api/calendar/event-types/${et.id}`)).json();
  expect(after.title).toBe('Editor renamed');
  expect(after.bookingRulesParsed.minNoticeHours).toBe(2);
  expect(after.fieldsParsed).toEqual([{ name: 'company_size', label: 'Company size', type: 'text', required: false }]);

  // Volver a los valores por defecto saca los límites del evento (caen a los del calendario).
  await page.getByRole('switch', { name: "Use the calendar's defaults" }).check();
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved' })).toBeVisible({ timeout: 20_000 });
  const again = await (await request.get(`/api/calendar/event-types/${et.id}`)).json();
  expect(again.bookingRulesParsed).not.toHaveProperty('minNoticeHours');
});

test('Cal: un error de validación lleva a su pestaña y no guarda', async ({ page, request }) => {
  const et = await (await request.post('/api/calendar/event-types', { data: { slug: `val-${uid()}`, title: 'Val', durationMin: 30 } })).json();
  await page.goto(`/en/app/calendar/event-types/${et.id}?tab=share`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'General' }).click();
  await page.getByLabel('Title').fill('');
  await page.getByRole('tab', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Add a title.' })).toBeVisible();
  expect((await (await request.get(`/api/calendar/event-types/${et.id}`)).json()).title).toBe('Val');
});

test('Cal: alta rápida deriva la URL del título y avisa con un toast', async ({ page, request }) => {
  const title = `Intro ${uid()}`;
  await page.goto('/en/app/calendar/event-types?new=1', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Event name, e.g. Intro call').fill(title);
  await expect(page.getByRole('dialog')).toContainText(`/${title.toLowerCase().replace(' ', '-')}`);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('status').filter({ hasText: `Created ${title}.` })).toBeVisible({ timeout: 15_000 });
  const { rows } = await (await request.get('/api/calendar/event-types')).json();
  expect(rows.find((r: { title: string }) => r.title === title).slug).toBe(title.toLowerCase().replace(' ', '-'));
});

test('Cal: routing en tres paradas, la clave de "Email" es email', async ({ page, request }) => {
  const created = await request.post('/api/calendar/routing', { data: { slug: `rt-${uid()}`, title: 'Steps', active: true } });
  const form = await created.json();
  await page.goto(`/en/app/calendar/routing/${form.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('tab', { name: /Questions/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('New question').fill('Email');
  await page.getByRole('button', { name: 'Add question' }).click();
  await expect(page.getByRole('tab', { name: /Questions/ })).toContainText('1 question');
  const full = await (await request.get(`/api/calendar/routing/${form.id}`)).json();
  expect(full.fields[0]).toMatchObject({ name: 'email', label: 'Email' });

  await page.getByRole('button', { name: 'Continue to Rules' }).click();
  await expect(page.getByRole('tab', { name: /Rules/ })).toHaveAttribute('aria-selected', 'true');
});

test('Cal: la página pública usa el color de marca del evento', async ({ page, request }) => {
  const slug = `br-${uid()}`;
  const et = await (await request.post('/api/calendar/event-types', { data: { slug, title: 'Branded', durationMin: 30, brandColor: '#e6b400' } })).json();
  expect(et.id).toBeTruthy();
  const { handle } = await (await request.get('/api/calendar/config')).json();
  await page.goto(`/en/book/${handle}/${slug}`, { waitUntil: 'networkidle' });
  const vars = await page.locator('.bk').evaluate((el) => ({
    bk: getComputedStyle(el).getPropertyValue('--bk').trim(),
    on: getComputedStyle(el).getPropertyValue('--bk-on').trim(),
  }));
  // Amarillo: el texto sobre el color va en tinta, no en blanco.
  expect(vars).toEqual({ bk: '#e6b400', on: '#111111' });
  await expect(page.getByRole('heading', { name: 'Branded' })).toBeVisible();
});
