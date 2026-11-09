import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox de punta a punta con los proveedores falsos (GROUPS_FAKE=1 para
 * WhatsApp, INBOX_FAKE=1 para Gmail y la IA): vincular por QR, llegan
 * mensajes por el webhook, se ordena todo con el teclado, se responde,
 * se programa, se pospone, snippets, carpetas, Gmail e importación.
 */

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);

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

/** Vincula WhatsApp (falso) y devuelve la cuenta con su secreto de webhook (leído de la base, como lo tendría el servidor). */
async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

async function inbound(request: APIRequestContext, acc: { id: string; secret: string }, chat: { phone: string; name: string; body: string; group?: boolean }) {
  const chatId = chat.group ? `${chat.phone}@g.us` : `${chat.phone}@s.whatsapp.net`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        {
          type: 'message',
          chatId,
          isGroup: !!chat.group,
          chatName: chat.group ? chat.name : undefined,
          fromMe: false,
          senderPhone: chat.phone,
          senderName: chat.group ? 'Tío Beto' : chat.name,
          providerMessageId: `in-${uid()}`,
          body: chat.body,
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('vincular WhatsApp por QR desde Ajustes', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Inbox settings' })).toBeVisible();
  const card = page.getByTestId('inbox-wa-card');
  const link = card.getByRole('button', { name: 'Link with QR' });
  if (await link.isVisible()) {
    await link.click();
    const dialog = page.getByRole('dialog', { name: 'Link WhatsApp' });
    await expect(dialog).toBeVisible();
    // El QR del proveedor falso y, a los segundos, vinculado.
    await expect(dialog.getByText(/^Linked|Point your phone/).first()).toBeVisible();
    await expect(dialog.getByText(/^Linked/)).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Done' }).click();
  }
  await expect(card.getByText('Linked', { exact: true })).toBeVisible();
  // Volver a sincronizar: explica que hay que escanear de nuevo, Esc cancela y confirmar muestra el QR.
  await card.getByTestId('inbox-wa-resync').click();
  const confirmDialog = page.getByRole('dialog', { name: 'Sync WhatsApp again' });
  await expect(confirmDialog.getByText(/only sends chat history when a device is linked/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmDialog).toBeHidden();
  await card.getByTestId('inbox-wa-resync').click();
  await page.getByTestId('inbox-wa-resync-yes').click();
  const relink = page.getByRole('dialog', { name: 'Link WhatsApp' });
  await expect(relink.getByText(/^Linked/)).toBeVisible({ timeout: 10_000 });
  await relink.getByRole('button', { name: 'Done' }).click();
  await expect(card.getByText('Linked', { exact: true })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('llega un mensaje, se responde con Enter y se marca hecho con E (y Z lo deshace)', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const name = `Ana ${uid()}`;
  const p = phone();
  await inbound(request, acc, { phone: p, name, body: 'Hola, ¿me mandás el contrato?' });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.ib-item', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.locator('.ib-unread')).toHaveText('1');
  await row.locator('.ib-row-btn').click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.locator('.ib-msg', { hasText: 'me mandás el contrato' })).toBeVisible();
  // Abrir lo deja leído.
  await expect(row.locator('.ib-unread')).toHaveCount(0);

  // R enfoca el campo; Enter manda (WhatsApp Web).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('r');
  const field = page.getByRole('textbox', { name: 'Message' });
  await expect(field).toBeFocused();
  await field.fill('Sí, ya te lo mando');
  await field.press('Enter');
  await expect(page.locator('.ib-msg.is-me', { hasText: 'Sí, ya te lo mando' })).toBeVisible();
  await expect(field).toHaveValue('');

  // E: hecho, sale de la bandeja; Z: vuelve.
  await field.press('Escape');
  await page.keyboard.press('e');
  await expect(page.locator('.ib-toast', { hasText: 'Marked done' })).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.keyboard.press('z');
  await expect(page.locator('.ib-item', { hasText: name })).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('posponer con H, recordatorio con F y la vista de pospuestos', async ({ page, request }) => {
  const acc = await linkWhatsapp(request);
  const name = `Bruno ${uid()}`;
  await inbound(request, acc, { phone: phone(), name, body: 'Hablamos la semana que viene' });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.ib-item', { hasText: name });
  await row.locator('.ib-row-btn').focus();
  await page.keyboard.press('h');
  const dialog = page.getByRole('dialog', { name: 'Snooze until' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('3');
  await expect(row).toHaveCount(0);
  await page.goto('/en/app/inbox/v/snoozed', { waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: name })).toBeVisible();
  // F sobre el pospuesto: recordame si no contesta (con fecha propia) y Esc cierra sin cambiar nada.
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').focus();
  await page.keyboard.press('f');
  await expect(page.getByRole('dialog', { name: 'Remind me if there is no reply' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Remind me if there is no reply' })).toBeHidden();
});

test('enviar más tarde, snippets con ; y borrador con IA', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const name = `Caro ${uid()}`;
  await inbound(request, acc, { phone: phone(), name, body: '¿A qué hora es el asado?' });
  await request.post('/api/inbox/snippets', { data: { title: 'Dirección', shortcut: `dir${uid()}`, body: 'Hola {primer_nombre}, es en Av. Siempreviva 742' } });
  const snippets = ((await (await request.get('/api/inbox/snippets')).json()) as { snippets: Array<{ shortcut: string; title: string }> }).snippets;
  const shortcut = snippets.find((s) => s.title === 'Dirección')!.shortcut;

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  const field = page.getByRole('textbox', { name: 'Message' });
  await field.click();
  await field.pressSequentially(`;${shortcut.slice(0, 4)}`);
  await expect(page.getByRole('listbox', { name: 'Snippets' })).toBeVisible();
  await field.press('Enter');
  await expect(field).toHaveValue(`Hola ${name.split(' ')[0]}, es en Av. Siempreviva 742`);

  // Más tarde: queda programado debajo de la conversación y el campo se vacía.
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await page.getByRole('dialog', { name: 'Send later' }).getByRole('button', { name: /Tomorrow morning/ }).click();
  await expect(page.locator('.ib-toast', { hasText: 'Scheduled for' })).toBeVisible();
  await expect(page.locator('.ib-sched', { hasText: 'Siempreviva' })).toBeVisible();
  await expect(field).toHaveValue('');
  await page.goto('/en/app/inbox/v/scheduled', { waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: name })).toBeVisible();
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  await page.locator('.ib-sched', { hasText: 'Siempreviva' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.ib-sched')).toHaveCount(0);

  // ⌘J: borrador con la IA (modelo falso), con lo escrito como instrucción.
  await field.fill('decile que a las 8');
  await field.press('ControlOrMeta+j');
  await expect(field).toHaveValue('Borrador: decile que a las 8');
  await page.getByRole('button', { name: 'Undo AI' }).click();
  await expect(field).toHaveValue('decile que a las 8');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('carpetas: nueva desde el sidebar, V para sumar un chat y la carpeta lo muestra', async ({ page, request }) => {
  const acc = await linkWhatsapp(request);
  const name = `Familia ${uid()}`;
  await inbound(request, acc, { phone: `1203${Math.floor(Math.random() * 1e9)}`, name, body: 'Domingo almuerzo', group: true });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const folder = `Casa ${uid()}`;
  await page.locator('#side-branch').getByRole('button', { name: /New folder/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByLabel('Name', { exact: true }).fill(folder);
  await dialog.getByRole('button', { name: 'Create folder' }).click();
  await expect(page).toHaveURL(/\/app\/inbox\/f\//);
  await expect(page.locator('#side-branch').getByRole('link', { name: folder })).toHaveAttribute('aria-current', 'page');

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').focus();
  await page.keyboard.press('v');
  const move = page.getByRole('dialog', { name: 'Add to folder' });
  await move.getByRole('textbox').fill(folder.slice(0, 6));
  await move.getByRole('textbox').press('Enter');
  await expect(page.locator('.ib-toast', { hasText: 'Added to the folder' })).toBeVisible();
  await page.locator('#side-branch').getByRole('link', { name: folder }).click();
  await expect(page.getByRole('heading', { level: 1, name: folder })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: name })).toBeVisible();
});

test('Gmail (cuenta de prueba): conectar, sincronizar y responder en el hilo', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  const card = page.getByTestId('inbox-gmail-card');
  await card.getByRole('link', { name: /Connect (another )?Gmail/ }).click();
  await expect(page.getByText('Gmail is connected.', { exact: false })).toBeVisible();
  await page.getByTestId('inbox-gmail-card').getByRole('button', { name: 'Sync now' }).first().click();
  await expect(page.getByTestId('inbox-gmail-card').getByText(/Synced/).first()).toBeVisible();
  await page.goto('/en/app/inbox/v/email', { waitUntil: 'networkidle' });
  const row = page.locator('.ib-item', { hasText: 'Martín' }).first();
  await expect(row).toBeVisible();
  await row.locator('.ib-row-btn').click();
  await expect(page.locator('.ib-mail', { hasText: 'Confirmame así compro' })).toBeVisible();
  const field = page.getByRole('textbox', { name: 'Reply' });
  await field.fill('Voy!');
  // En correo Enter baja de línea; ⌘Enter manda.
  await field.press('ControlOrMeta+Enter');
  await expect(page.locator('.ib-mail.is-me', { hasText: 'Voy!' }).last()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('importar una exportación de inbox-zero', async ({ page }) => {
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  const tag = uid();
  const file = {
    format: 'inbox-zero-export',
    version: 1,
    folders: [{ id: 1, name: `Trabajo ${tag}`, color: '#3b82f6', icon: '', position: 0, parentId: null }],
    chatFolders: [{ chatId: '5491177770000@c.us', folderId: 1 }],
    chats: [{ chatId: '5491177770000@c.us', name: `Jefa ${tag}`, isGroup: false }],
    scheduled: [],
    drafts: [{ chatId: '5491177770000@c.us', chatName: `Jefa ${tag}`, text: 'borrador importado' }],
    snoozes: [],
    notes: [{ chatId: '5491177770000@c.us', text: 'Prefiere audios cortos' }],
    messages: [{ id: `imp-${tag}`, chatId: '5491177770000@c.us', ts: Math.floor(Date.now() / 1000) - 3600, fromMe: false, sender: `Jefa ${tag}`, type: 'chat', text: 'Mañana reunión a las 10' }],
  };
  await page.getByLabel('Export file (.json)').setInputFiles({ name: 'inbox-zero-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByText(/1 folders, 1 chats/)).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported 1 folders/)).toBeVisible();
  await expect(page.locator('#folders').getByRole('link', { name: `Trabajo ${tag}` })).toBeVisible();
  await page.locator('#folders').getByRole('link', { name: `Trabajo ${tag}` }).click();
  const row = page.locator('.ib-item', { hasText: `Jefa ${tag}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText('borrador importado');
});

test('390px: un panel por vez, sin scroll horizontal, y vuelve a la lista', async ({ page, request }) => {
  const acc = await linkWhatsapp(request);
  const name = `Dani ${uid()}`;
  await inbound(request, acc, { phone: phone(), name, body: 'Un mensaje bastante largo para ver que no desborde la pantalla del teléfono en ningún momento' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const overflow = () => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.locator('.ib-list-pane')).toBeHidden();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await expect(page.locator('.ib-item', { hasText: name })).toBeVisible();
});

test('la ayuda de atajos abre con ? y cierra con Esc; claro y oscuro sin errores', async ({ page, context, baseURL }) => {
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    const errors = watchErrors(page);
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    expect(errors, errors.join('\n')).toEqual([]);
  }
});
