import { createClient } from '@libsql/client';
import { expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

test('Cal: un sí/no obligatorio del routing se puede responder "No"', async ({ page, request }) => {
  const slug = `yn-${uid()}`;
  const form = await (await request.post('/api/calendar/routing', { data: { slug, title: 'Sí o no', active: true } })).json();
  const field = await (
    await request.post(`/api/calendar/routing/${form.id}/fields`, { data: { name: 'big', label: '¿Más de 10 personas?', type: 'boolean', required: true } })
  ).json();
  const rule = await request.post(`/api/calendar/routing/${form.id}/rules`, {
    data: { fieldId: field.id, operator: 'truthy', action: 'message', message: 'Equipo grande' },
  });
  expect(rule.status()).toBe(201);
  await request.patch(`/api/calendar/routing/${form.id}`, { data: { fallbackAction: 'message', fallbackMessage: 'Equipo chico' } });
  const { handle } = await (await request.get('/api/calendar/config')).json();

  await page.goto(`/es/r/${handle}/${slug}`, { waitUntil: 'networkidle' });
  const group = page.getByRole('group', { name: /Más de 10 personas/ });
  await expect(group.getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  // Obligatorio: sin elegir no se envía.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Equipo chico')).toHaveCount(0);
  await group.getByRole('radio', { name: 'No' }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Equipo chico')).toBeVisible();
});

test('Cal: un routing form nuevo nace sin publicar', async ({ page }) => {
  const title = `Draft ${uid()}`;
  await page.goto('/es/app/calendar/routing');
  await page.getByRole('button', { name: /Crear formulario/ }).first().click();
  await page.getByPlaceholder(/Nombre del formulario/).fill(title);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/calendar\/routing\/[0-9a-f-]+$/, { timeout: 15_000 });
  await expect(page.getByRole('tab', { name: /Publicar/ })).toContainText('Sin publicar');
});

test('Campana: avisos traducidos, sin pospuestos y una sola acción de marcar todo', async ({ page, request }) => {
  await request.patch('/api/notifications', { data: { readAll: true } });
  const id = crypto.randomUUID();
  const identifier = `QA-${uid().toUpperCase()}`;
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  await db.execute({
    sql: `INSERT INTO notifications (id, user_id, type, title, body, href, source_type, source_id, meta, created_at)
          VALUES (?, 'demo', 'track_reminder', ?, 'Login falla en Safari', '/app/track/inbox', 'track_issue', ?, ?, ?)`,
    args: [id, `Reminder: ${identifier}`, id, JSON.stringify({ issueIdentifier: identifier }), new Date().toISOString()],
  });
  db.close();

  await page.goto('/es/app/track/inbox', { waitUntil: 'networkidle' });
  const bell = page.getByRole('button', { name: 'Notificaciones' });
  await expect(bell).toContainText('1');
  await bell.click();
  await expect(page.getByText(`Recordatorio de ${identifier}`).first()).toBeVisible();
  await expect(page.getByText(`Reminder: ${identifier}`)).toHaveCount(0);
  // Tiempo relativo en español ("hace 1 minuto", "este minuto"), no "1 minute ago".
  await expect(page.locator('.side-bell-panel time').first()).toHaveText(/minuto|hora|ahora/);
  await expect(page.locator('.side-bell-panel')).not.toContainText('ago');
  await expect(page.locator('.side-bell-panel').getByRole('button', { name: 'Marcar todas como leídas' })).toHaveCount(1);
  await bell.click();

  // Pospuesto desde la bandeja: deja de contar en la campana y en el sidebar sin recargar.
  const row = page.locator('.track-inbox-item', { hasText: identifier });
  await row.getByRole('button', { name: /Posponer/ }).click();
  await page.getByRole('menuitem', { name: /mañana/i }).first().click();
  await expect(row).toHaveCount(0);
  await expect(bell.locator('.side-bell-badge')).toHaveCount(0);
  await bell.click();
  await expect(page.locator('.side-bell-panel').getByText(identifier)).toHaveCount(0);
});

test('Link: el alta masiva revisa cada fila antes de crear', async ({ page }) => {
  await page.goto('/es/app/links/bulk', { waitUntil: 'networkidle' });
  const s = uid();
  await page
    .locator('#bulk-urls')
    .fill([`https://example.com/${s}`, 'no-es-url', `https://example.com/a, p-${s}, Uno`, `https://example.com/b, p-${s}, Dos`].join('\n'));
  const preview = page.getByTestId('bulk-preview');
  await expect(preview).toContainText('2 filas listas, 2 con problemas');
  await expect(preview.locator('tr[data-problem="invalid_url"]')).toHaveCount(1);
  await expect(preview.locator('tr[data-problem="duplicate_slug"]')).toHaveCount(1);
  await expect(preview).not.toContainText('Ninguno');
});
