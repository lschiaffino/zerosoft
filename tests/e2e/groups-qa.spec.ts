import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Arreglos de la pasada de QA de Groups (en /es): renombrar un grupo se ve
 * sin recargar, "Desde el número" propone uno conectado y marca los que no,
 * y un envío masivo no saca al chat de "Esperando".
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.GROUPS_QA_SHOTS;

async function connectedNumber(request: APIRequestContext, name: string) {
  const { id } = (await (await request.post('/api/groups/numbers', { data: { provider: 'fake', name } })).json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookPath: new URL(info.webhookUrl).pathname };
}

test('renombrar en la página del grupo actualiza el título y la lista sin recargar', async ({ page, request }) => {
  const n = await connectedNumber(request, `Linea ${uid()}`);
  const before = `Antes ${uid()}`;
  const res = (await (await request.post('/api/groups/create', { data: { numberId: n.id, name: before, phones: [] } })).json()) as {
    results: Array<{ chatId: string }>;
  };
  const id = res.results[0].chatId;
  await page.goto(`/es/app/groups/list/${id}`, { waitUntil: 'networkidle' });
  const after = `Después ${uid()}`;
  const input = page.getByLabel('Nombre', { exact: true });
  await input.fill(after);
  await page.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: after })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qa1-rename-group-page.png` });
  // Navegación dentro de la app (sin recargar): la lista ya tiene el nombre nuevo.
  await page.getByRole('link', { name: 'Grupos', exact: true }).first().click();
  await expect(page).toHaveURL(/\/groups\/list$/);
  await expect(page.getByRole('link', { name: after })).toBeVisible();
  await expect(page.getByRole('link', { name: before })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qa1-rename-list.png` });
});

test('"Desde el número" propone un número conectado y deshabilita los que no lo están', async ({ page, request }) => {
  // Un número sin conectar creado primero (queda arriba en la lista).
  const broken = `Caido ${uid()}`;
  await request.post('/api/groups/numbers', { data: { provider: 'fake', name: broken } });
  await connectedNumber(request, `Activo ${uid()}`);
  await page.goto('/es/app/groups/list', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Nuevo grupo/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo grupo de WhatsApp' });
  const select = dialog.getByLabel('Desde el número');
  const chosen = await select.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]);
  expect(chosen).toBeTruthy();
  expect(await select.evaluate((el: HTMLSelectElement) => el.selectedOptions[0].disabled)).toBe(false);
  const brokenOption = select.locator('option', { hasText: broken });
  await expect(brokenOption).toHaveAttribute('disabled', '');
  await expect(brokenOption).toContainText('No conectado');
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/qa3-number-picker.png` });
  }
  await page.keyboard.press('Escape');

  // El composer de envíos masivos sigue la misma regla.
  await page.goto('/es/app/groups/broadcasts/new', { waitUntil: 'networkidle' });
  const from = page.getByLabel('Desde el número');
  expect(await from.evaluate((el: HTMLSelectElement) => el.selectedOptions[0].disabled)).toBe(false);
  await expect(from.locator('option', { hasText: broken })).toHaveAttribute('disabled', '');
});

test('un envío masivo no saca al chat de "Esperando"', async ({ page, request }) => {
  const n = await connectedNumber(request, `Masivo ${uid()}`);
  const who = `Bruno${uid()}`;
  const chatId = `120363${Date.now()}5@g.us`;
  await request.post(n.webhookPath, {
    data: {
      events: [
        { type: 'message', chatId, isGroup: true, chatName: `Cliente ${who}`, fromMe: false, senderPhone: '5491155550010', senderName: who, providerMessageId: `qa-${uid()}`, body: '¿Hay novedades?' },
      ],
    },
  });
  const chats = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(who)}`)).json()) as { rows: Array<{ id: string }> };
  const chat = chats.rows[0];
  const b = (await (await request.post('/api/groups/broadcasts', { data: { chatIds: [chat.id], body: 'Newsletter de octubre' } })).json()) as { id: string };
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/broadcasts/${b.id}`)).json()) as { broadcast: { status: string } }).broadcast.status, { timeout: 20_000 })
    .toBe('done');
  await page.goto(`/es/app/groups/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.gr-msg-out', { hasText: 'Newsletter de octubre' })).toBeVisible();
  await expect(page.locator('.gr-row', { hasText: `Cliente ${who}` }).getByText(/Esperando/)).toBeVisible();
  await expect(page.getByText('Esperando respuesta.')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/qa2-broadcast-still-waiting.png` });
});
