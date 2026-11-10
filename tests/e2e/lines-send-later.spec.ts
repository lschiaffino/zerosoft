import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: enviar más tarde, contra el proveedor falso (GROUPS_FAKE=1). El
 * selector de "cuándo" es el de Inbox (presets con atajos del 1 al 6 y una
 * fecha propia); se abre con el reloj junto a Enviar, clic derecho en Enviar,
 * Ctrl/⌘+Shift+Enter o el menú +. Lo programado queda en una tira arriba del
 * campo (enviar ahora, cambiar hora, editar, cancelar) y en la vista de todos
 * los programados de la lista de chats. "Repetir" sigue a mano.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Later ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

const dm = () => `549${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}@c.us`;

async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, body: string, senderName: string) {
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName, providerMessageId: `e2e-${uid()}`, body }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function openChat(page: Page, request: APIRequestContext, name: string) {
  const n = await fakeNumber(request);
  await inbound(request, n, dm(), '¿me avisás mañana?', name);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: name }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

test('programar con el reloj, deshacer, y editar, cambiar la hora y cancelar desde la tira', async ({ page, request }) => {
  const errors = watchErrors(page);
  const name = `Later${uid()}`;
  await openChat(page, request, name);
  const field = page.locator('textarea.wa-input');
  const strip = page.getByTestId('lines-scheduled-strip');
  const when = page.getByRole('dialog', { name: 'Send later' });

  // Sin texto no hay reloj; el menú + explica qué falta.
  await expect(page.getByTestId('lines-send-later')).toHaveCount(0);
  await page.getByRole('button', { name: 'Attach' }).click();
  await page.getByRole('menuitem', { name: 'Send later' }).click();
  await expect(page.locator('.ui-toast', { hasText: 'Write the message first.' })).toBeVisible();

  // El reloj abre el selector; el atajo 3 es "Tomorrow morning". El aviso trae Deshacer.
  await field.fill('te confirmo mañana');
  await page.getByTestId('lines-send-later').click();
  await expect(when).toBeVisible();
  await expect(when.getByText('te confirmo mañana')).toBeVisible();
  await expect(when.getByRole('button', { name: /Tomorrow morning/ })).toBeVisible();
  await page.keyboard.press('3');
  await expect(when).toBeHidden();
  const toast = page.locator('.ui-toast', { hasText: 'Scheduled for' });
  await expect(toast).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(strip.getByTestId('lines-scheduled-item')).toHaveCount(1);
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(strip).toHaveCount(0);
  await expect(field).toHaveValue('te confirmo mañana');

  // Clic derecho en Enviar hace lo mismo; una fecha pasada no se acepta.
  await page.getByRole('button', { name: 'Send', exact: true }).click({ button: 'right' });
  await expect(when).toBeVisible();
  await when.getByLabel('Pick a date and time').fill('2020-01-01T10:00');
  await when.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(when.getByRole('alert')).toHaveText('Pick a time in the future.');
  await when.getByRole('button', { name: /Tomorrow morning/ }).click();
  const item = strip.getByTestId('lines-scheduled-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Scheduled for');
  await expect(item).toContainText('te confirmo mañana');
  // No salió todavía: no está entre los mensajes.
  await expect(page.locator('.gr-messages').getByText('te confirmo mañana')).toHaveCount(0);

  // Editar el texto.
  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit the scheduled message' });
  await edit.getByLabel('Message').fill('te confirmo el lunes');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(item).toContainText('te confirmo el lunes');

  // Cambiar la hora con el mismo selector.
  await item.getByRole('button', { name: 'Change time' }).click();
  const change = page.getByRole('dialog', { name: 'Change the time' });
  await expect(change).toBeVisible();
  await change.getByRole('button', { name: /In a week/ }).click();
  await expect(change).toBeHidden();
  await expect(page.locator('.ui-toast', { hasText: 'Scheduled for' })).toBeVisible();
  await expect(item).toHaveCount(1);

  // La vista de todos los programados, desde la lista de chats.
  await page.getByTestId('lines-scheduled-all').click();
  const all = page.getByRole('dialog', { name: 'Scheduled messages' });
  await expect(all).toBeVisible();
  await expect(all.getByRole('checkbox', { name: 'Only mine' })).toBeChecked();
  const mine = all.getByTestId('lines-scheduled-item').filter({ hasText: 'te confirmo el lunes' });
  await expect(mine).toHaveCount(1);
  await expect(mine.getByRole('link', { name: `Open the chat with ${name}` })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(all).toBeHidden();

  // Cancelar pide confirmación.
  await item.getByRole('button', { name: 'Cancel', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Cancel this scheduled message?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel the message' }).click();
  await expect(page.locator('.ui-toast', { hasText: 'Scheduled message cancelled.' })).toBeVisible();
  await expect(strip).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('"enviar ahora" lo manda, y Repetir sigue a un clic con el atajo de teclado', async ({ page, request }) => {
  const errors = watchErrors(page);
  const name = `Now${uid()}`;
  await openChat(page, request, name);
  const field = page.locator('textarea.wa-input');
  const strip = page.getByTestId('lines-scheduled-strip');
  const when = page.getByRole('dialog', { name: 'Send later' });

  // Ctrl+Shift+Enter abre el selector desde el campo.
  await field.fill('va el presupuesto');
  await field.press('Control+Shift+Enter');
  await expect(when).toBeVisible();
  await when.getByRole('button', { name: /Next week/ }).click();
  const item = strip.getByTestId('lines-scheduled-item');
  await expect(item).toContainText('va el presupuesto');
  await item.getByRole('button', { name: 'Send now' }).click();
  await expect(page.locator('.gr-messages').getByText('va el presupuesto')).toBeVisible({ timeout: 20_000 });
  await expect(strip).toHaveCount(0, { timeout: 20_000 });

  // Repetir: desde el mismo selector se llega al formulario de mensajes recurrentes.
  await field.fill('recordatorio semanal');
  await page.getByTestId('lines-send-later').click();
  await when.getByRole('button', { name: 'Repeat…' }).click();
  await expect(when).toBeHidden();
  const repeat = page.getByRole('dialog', { name: 'Schedule this message' });
  await expect(repeat).toBeVisible();
  await expect(repeat.getByRole('checkbox').first()).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(repeat).toBeHidden();
  await expect(field).toHaveValue('recordatorio semanal');
  expect(errors).toEqual([]);
});

test.describe('en el teléfono', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la tira entra en 390px y sus botones miden al menos 40px', async ({ page, request }) => {
    const errors = watchErrors(page);
    const name = `Phone${uid()}`;
    await openChat(page, request, name);
    await page.locator('textarea.wa-input').fill('mañana a primera hora te escribo con todos los detalles del pedido');
    await page.getByTestId('lines-send-later').click();
    const when = page.getByRole('dialog', { name: 'Send later' });
    await expect(when).toBeVisible();
    for (const opt of await when.locator('.ui-when-opt').all()) expect((await opt.boundingBox())!.height).toBeGreaterThanOrEqual(39.5);
    await when.getByRole('button', { name: /Tomorrow morning/ }).click();
    const item = page.getByTestId('lines-scheduled-strip').getByTestId('lines-scheduled-item');
    await expect(item).toHaveCount(1);
    for (const label of ['Send now', 'Change time', 'Edit', 'Cancel']) {
      const box = await item.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box!.height, label).toBeGreaterThanOrEqual(39.5);
      expect(box!.x + box!.width, label).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
