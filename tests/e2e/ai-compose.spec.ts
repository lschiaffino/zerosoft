import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * "Help me write" (components/ai/AiComposeBar): lo que no cubren los specs de
 * cada producto (groups-inbox, inbox, inbox-wa). La barra en el teléfono, en
 * el diálogo de mensaje nuevo de Inbox y en modo oscuro (cortando un pedido
 * a medias). El estilo de chat no se cambia acá: es un ajuste de la persona y
 * lo comparten los specs que corren en paralelo (lo prueba lines-chat-style).
 * Corre contra los modelos falsos (GROUPS_AI_FAKE=1, INBOX_FAKE=1): se sabe
 * qué texto sale de cada pedido y nada se manda a un proveedor.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function linesChat(page: Page, request: APIRequestContext, name: string) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Write ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const chatId = `549${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}@c.us`;
  const res = await request.post(new URL(info.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: name, providerMessageId: `e2e-${uid()}`, body: 'Hi, when will the quote be ready?' }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: name }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('en el teléfono', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Lines: la barra se abre desde el menú +, entra en 390px y todo lo que se toca mide 40px', async ({ page, request }) => {
    const errors = watchErrors(page);
    await linesChat(page, request, `Phone${uid()}`);
    const composer = page.locator('textarea.wa-input');
    // En el teléfono no hay lugar para el lápiz en la fila: está en el menú +.
    await page.getByRole('button', { name: 'Attach', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Help me write', exact: true }).click();
    const bar = page.getByTestId('ai-compose');
    const ask = bar.getByRole('textbox', { name: 'Describe your message' });
    await expect(ask).toBeFocused();
    await ask.fill('tell them the quote goes out tomorrow morning, friendly tone');
    await ask.press('Enter');
    const draft = bar.getByTestId('ai-compose-draft');
    await expect(draft).toHaveText('Draft: tell them the quote goes out tomorrow morning, friendly tone');
    await bar.getByRole('button', { name: 'More formal' }).click();
    await expect(draft).toHaveText(/\(formal\)$/);

    // Con la vista previa, los chips y las acciones a la vista: nada se sale de la pantalla ni queda chico para el dedo.
    const controls = await bar.locator('button, select, .aic-field').all();
    expect(controls.length).toBeGreaterThanOrEqual(12);
    for (const el of controls) {
      const box = (await el.boundingBox())!;
      const what = (await el.getAttribute('aria-label')) || (await el.innerText()) || 'field';
      expect(box.height, what).toBeGreaterThanOrEqual(39.5);
      expect(box.width, what).toBeGreaterThanOrEqual(39.5);
      expect(box.x, what).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, what).toBeLessThanOrEqual(390);
    }
    const preview = (await draft.boundingBox())!;
    expect(preview.x + preview.width).toBeLessThanOrEqual(390);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // iOS no hace zoom al enfocar el campo.
    expect(await ask.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

    await bar.getByRole('button', { name: 'Insert' }).click();
    await expect(bar).toBeHidden();
    await expect(composer).toHaveValue(/^Draft: tell them the quote goes out tomorrow morning/);
    await expect(page.locator('.gr-msg-out')).toHaveCount(0);
    const undo = page.getByTestId('ai-compose-undo').getByRole('button', { name: 'Undo' });
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(39.5);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await undo.click();
    await expect(composer).toHaveValue('');
    expect(errors).toEqual([]);
  });
});

test('Lines en oscuro: la barra se lee y Esc corta lo que se está escribiendo antes de cerrar', async ({ page, request, context, baseURL }) => {
  const errors = watchErrors(page);
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await linesChat(page, request, `Dark${uid()}`);
  const composer = page.locator('textarea.wa-input');
  await page.getByTestId('ai-compose-open').click();
  const bar = page.getByTestId('ai-compose');
  await expect(bar).toBeVisible();
  // El texto del campo se lee sobre su fondo (los dos salen de los tokens del tema).
  const colors = await bar.locator('.aic-field').evaluate((el) => {
    const input = el.querySelector('input')!;
    return { bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(input).color };
  });
  expect(colors.bg).not.toBe(colors.ink);

  // Un pedido lento: Esc lo corta (la barra sigue abierta, sin error); otro Esc cierra y devuelve el foco.
  await page.route('**/api/groups/chats/*/draft', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => {});
  });
  const ask = bar.getByRole('textbox', { name: 'Describe your message' });
  await ask.fill('say thanks');
  await ask.press('Enter');
  await expect(bar.getByTestId('ai-compose-draft')).toHaveAttribute('aria-busy', 'true');
  await expect(bar.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar.getByTestId('ai-compose-draft')).toHaveCount(0);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('alert')).toHaveCount(0);
  // Lo descripto sigue en el campo para volver a intentarlo.
  await expect(ask).toHaveValue('say thanks');
  await page.unroute('**/api/groups/chats/*/draft');
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('');
  expect(errors).toEqual([]);
});

test('Inbox, mensaje nuevo: describe el mensaje, lo inserta en el campo y no manda nada', async ({ page, request }) => {
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-compose-btn').click();
  const dialog = page.getByRole('dialog', { name: 'New message' });
  await expect(dialog).toBeVisible();
  const message = dialog.getByLabel('Message', { exact: true });
  await dialog.getByTestId('ai-compose-open').click();
  const bar = dialog.getByTestId('ai-compose');
  const ask = bar.getByRole('textbox', { name: 'Describe your message' });
  await expect(ask).toBeFocused();
  // Sin chat todavía no hay respuesta que sugerir.
  await expect(bar.getByRole('button', { name: 'Suggest a reply' })).toHaveCount(0);
  await ask.fill('avisale que llego a las 8');
  await ask.press('Enter');
  await expect(bar.getByTestId('ai-compose-draft')).toHaveText('Borrador: avisale que llego a las 8');
  // Enter en la barra no manda el formulario.
  await expect(dialog).toBeVisible();
  await expect(message).toHaveValue('');
  await bar.getByRole('button', { name: 'Insert' }).click();
  await expect(bar).toBeHidden();
  await expect(message).toHaveValue('Borrador: avisale que llego a las 8');
  await expect(message).toBeFocused();
  // Con texto en el campo, la barra lo mejora; Esc cierra la barra y deja el diálogo abierto.
  await dialog.getByTestId('ai-compose-open').click();
  await expect(bar.getByRole('textbox', { name: 'Describe a change' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(message).toHaveValue('Borrador: avisale que llego a las 8');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
