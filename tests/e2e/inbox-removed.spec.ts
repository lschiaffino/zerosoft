import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox: "Remove from Inbox" deja el chat en Archived › Removed from Inbox
 * (deshacer en el aviso, recuperar, borrar definitivamente con confirmación).
 * Con el WhatsApp falso, a 1280 y 390, claro y oscuro. Con INBOX_SHOTS=<carpeta>
 * guarda capturas para la pasada visual. Nombres y números inventados.
 */

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.INBOX_SHOTS;
  if (!dir) return;
  // Un diálogo recién abierto entra con animación: la captura espera a que termine.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  await page.screenshot({ path: `${dir}/removed-${name}.png` });
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

/** Un chat 1:1 nuevo con un mensaje; devuelve su nombre y su id. */
async function seedChat(request: APIRequestContext, acc: { id: string; secret: string }, name: string): Promise<string> {
  const chatId = `${phone()}@s.whatsapp.net`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        {
          type: 'message',
          chatId,
          isGroup: false,
          fromMe: false,
          senderPhone: chatId.replace(/@.*/, ''),
          senderName: name,
          providerMessageId: `in-${uid()}`,
          body: 'hola',
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  const [row] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [acc.id, chatId]);
  return String(row.id);
}

const overflow = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

test('sacar de Inbox, deshacer, recuperar desde Sacados y borrar definitivamente (1280)', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const name = `Sacado ${uid()}`;
  const id = await seedChat(request, acc, name);
  // La ruta del chat compila en frío con next dev: se pide una vez antes de abrirlo en pantalla.
  expect((await request.get(`/api/inbox/threads/${id}`, { timeout: 60_000 })).ok()).toBe(true);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.ib-item', { hasText: name });
  await row.locator('.ib-row-btn').click();
  const more = page.locator('.ib-wa-thread .gr-thread-actions').getByRole('button', { name: 'More actions' });

  // El menú cierra con Esc y con un clic afuera.
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Remove from Inbox' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Remove from Inbox' })).toHaveCount(0);
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Remove from Inbox' })).toBeVisible();
  await page.locator('.ib-wa-thread .wa-messages').click({ position: { x: 40, y: 40 } });
  await expect(page.getByRole('menuitem', { name: 'Remove from Inbox' })).toHaveCount(0);

  // Sacar: confirma, sale de la lista y el aviso tiene Deshacer.
  await more.click();
  await page.getByRole('menuitem', { name: 'Remove from Inbox' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(/Removed from Inbox/)).toBeVisible();
  const removedRes = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/api/inbox/threads/${id}`));
  await confirm.getByRole('button', { name: 'Remove from Inbox' }).click();
  expect((await removedRes).ok()).toBe(true);
  await expect(row).toHaveCount(0);
  const toast = page.locator('.ib-toast', { hasText: 'Chat removed from Inbox' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(row).toBeVisible();

  // Otra vez, sin deshacer: queda en Archived › Removed from Inbox.
  await row.locator('.ib-row-btn').click();
  await expect(page.locator('.ib-wa-thread .gr-thread-head')).toContainText(name);
  await more.click();
  await page.getByRole('menuitem', { name: 'Remove from Inbox' }).click();
  const again = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/api/inbox/threads/${id}`));
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from Inbox' }).click();
  expect((await again).ok()).toBe(true);
  await expect(row).toHaveCount(0);
  expect((await sql('SELECT removed_at FROM inbox_threads WHERE id = ?', [id]))[0].removed_at).toBeTruthy();
  await page.goto('/en/app/inbox/v/archived', { waitUntil: 'networkidle' });
  await page.getByTestId('inbox-removed-entry').click();
  await expect(page).toHaveURL(/\/app\/inbox\/v\/removed$/);
  const item = page.getByTestId('inbox-removed-item').filter({ hasText: name });
  await expect(item).toBeVisible();
  await shot(page, 'list-1280');

  // Recuperar: vuelve a la bandeja.
  await item.getByTestId('inbox-removed-restore').click();
  await expect(page.locator('.ib-toast', { hasText: 'Chat restored' })).toBeVisible();
  await expect(item).toHaveCount(0);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(row).toBeVisible();

  // Borrar definitivamente: pide confirmación (Esc la cierra sin borrar).
  const removed = await request.post('/api/inbox/threads', { data: { ids: [id], action: 'remove' } });
  expect(removed.ok()).toBe(true);
  await page.goto('/en/app/inbox/v/removed', { waitUntil: 'networkidle' });
  await item.getByTestId('inbox-removed-purge').click();
  const purge = page.getByRole('dialog', { name: new RegExp(`Delete the chat with ${name}`) });
  await expect(purge).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(purge).toBeHidden();
  await expect(item).toBeVisible();
  await item.getByTestId('inbox-removed-purge').click();
  await page.getByTestId('inbox-removed-purge-yes').click();
  await expect(page.locator('.ib-toast', { hasText: 'Chat deleted' })).toBeVisible();
  await expect(item).toHaveCount(0);
  expect(await sql('SELECT id FROM inbox_threads WHERE id = ?', [id])).toHaveLength(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Sacados de Inbox a 390 y 1280, claro y oscuro, sin scroll horizontal', async ({ page, context, baseURL, request }) => {
  test.setTimeout(150_000);
  const acc = await linkWhatsapp(request);
  const name = `Sacado con un nombre bastante largo para ver el corte ${uid()}`;
  const id = await seedChat(request, acc, name);
  expect((await request.post('/api/inbox/threads', { data: { ids: [id], action: 'remove' } })).ok()).toBe(true);
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      await page.goto('/en/app/inbox/v/archived', { waitUntil: 'networkidle' });
      await expect(page.getByTestId('inbox-removed-entry')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await shot(page, `entry-${width}-${theme}`);
      await page.getByTestId('inbox-removed-entry').click();
      const item = page.getByTestId('inbox-removed-item').filter({ hasText: name });
      await expect(item).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await shot(page, `view-${width}-${theme}`);
      await item.getByTestId('inbox-removed-purge').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await shot(page, `purge-${width}-${theme}`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      expect(errors, errors.join('\n')).toEqual([]);
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);
  // A 390: recuperar desde el teléfono.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/inbox/v/removed', { waitUntil: 'networkidle' });
  await page.getByTestId('inbox-removed-item').filter({ hasText: name }).getByTestId('inbox-removed-restore').click();
  await expect(page.getByTestId('inbox-removed-item').filter({ hasText: name })).toHaveCount(0);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: name })).toBeVisible();
});

test('Lines: eliminar chat, deshacer, Archivados › Eliminados y recuperar (1280 y 390)', async ({ page, context, baseURL, request }) => {
  // Cuatro pasadas de pantalla (claro, oscuro, 1280, 390).
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Linea ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const name = `Grupo eliminado ${uid()}`;
  const chatId = `1203630${Math.floor(1_000_000 + Math.random() * 8_999_999)}@g.us`;
  const sent = await request.post(new URL(info.webhookUrl).pathname, {
    data: {
      events: [
        { type: 'message', chatId, isGroup: true, chatName: name, fromMe: false, senderPhone: phone(), senderName: 'Ana Prueba', providerMessageId: `ln-${uid()}`, body: 'hola' },
      ],
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);

  // La lista compila en frío con next dev: se pide una vez (y ya trae el chat) antes de abrirla en pantalla.
  await expect
    .poll(async () => JSON.stringify(await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`, { timeout: 60_000 })).json()), { timeout: 60_000 })
    .toContain(name);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('[data-chat-row]', { hasText: name });
  await expect(row).toBeVisible({ timeout: 30_000 });
  // El menú de la fila cierra con Esc.
  await row.getByRole('button', { name: `Options for ${name}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete chat' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Delete chat' })).toHaveCount(0);
  // Eliminar (confirma), deshacer, y eliminar otra vez.
  const remove = async () => {
    await row.getByRole('button', { name: `Options for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete chat' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete chat' }).click();
    await expect(row).toHaveCount(0);
  };
  await remove();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row).toBeVisible();
  await remove();

  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await page.locator('.wa-archived-row').first().click();
      await page.getByTestId('lines-deleted-entry').click();
      await expect(row).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await shot(page, `lines-${width}-${theme}`);
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);
  // Recuperar desde el menú de la fila (a 390): vuelve a la lista.
  await row.getByRole('button', { name: `Options for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Restore chat' }).click();
  await expect(row).toHaveCount(0);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await expect(row).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
