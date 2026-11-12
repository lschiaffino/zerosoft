import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox de punta a punta con los proveedores falsos (GROUPS_FAKE=1 para
 * WhatsApp, INBOX_FAKE=1 para Gmail y la IA): vincular por QR, llegan
 * mensajes por el webhook, se ordena todo con el teclado, se responde,
 * se programa, se pospone, snippets, carpetas, Gmail e importación.
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
  await expect(row.locator('.wa-unread')).toHaveText('1');
  await row.locator('.ib-row-btn').click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.locator('.gr-msg', { hasText: 'me mandás el contrato' })).toBeVisible();
  // Abrir lo deja leído.
  await expect(row.locator('.wa-unread')).toHaveCount(0);

  // R enfoca el campo; Enter manda (WhatsApp Web).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('r');
  const field = page.getByRole('textbox', { name: 'Message' });
  await expect(field).toBeFocused();
  await field.fill('Sí, ya te lo mando');
  await field.press('Enter');
  await expect(page.locator('.gr-msg-out', { hasText: 'Sí, ya te lo mando' })).toBeVisible();
  await expect(field).toHaveValue('');

  // E: hecho, sale de la bandeja; Z: vuelve.
  await field.press('Escape');
  await page.keyboard.press('e');
  await expect(page.locator('.ib-toast', { hasText: 'Archived' })).toBeVisible();
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

  // ⌘J abre "Help me write" con el foco en el campo. Con el chat a la vista, sugiere la respuesta.
  await field.fill('');
  await field.press('ControlOrMeta+j');
  const bar = page.getByTestId('ai-compose');
  const draft = bar.getByTestId('ai-compose-draft');
  const ask = bar.getByRole('textbox', { name: 'Describe your message' });
  await expect(ask).toBeFocused();
  await bar.getByRole('button', { name: 'Suggest a reply' }).click();
  await expect(draft).toHaveText(/Lo veo y te respondo hoy/);
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(draft).toHaveCount(0);
  await expect(ask).toBeFocused();

  // Describir el mensaje: el borrador llega de a pedazos (modelo falso) y no toca el campo hasta insertarlo.
  await ask.fill('que llego tarde');
  await ask.press('Enter');
  await expect(draft).toHaveText('Borrador: que llego tarde');
  await expect(field).toHaveValue('');
  // Ajustar con un chip y con un cambio propio; volver a la versión anterior; otra versión.
  await bar.getByRole('button', { name: 'More formal' }).click();
  await expect(draft).toHaveText('Borrador: que llego tarde (formal)');
  const change = bar.getByRole('textbox', { name: 'Describe a change' });
  await change.fill('sin emojis');
  await change.press('Enter');
  await expect(draft).toHaveText('Borrador: que llego tarde (formal) (sin emojis)');
  await bar.getByRole('button', { name: 'Previous version' }).click();
  await expect(draft).toHaveText('Borrador: que llego tarde (formal)');
  await bar.getByRole('button', { name: 'Another version' }).click();
  await expect(draft).toHaveText('Borrador: que llego tarde (formal)');
  await expect(draft).not.toHaveAttribute('aria-busy', 'true');
  // Insertar: va al campo (no se manda), la barra se cierra y el foco vuelve al campo. Deshacer devuelve lo que había.
  await bar.getByRole('button', { name: 'Insert' }).click();
  await expect(bar).toBeHidden();
  await expect(field).toHaveValue('Borrador: que llego tarde (formal)');
  await expect(field).toBeFocused();
  await expect(page.locator('.gr-msg-out', { hasText: 'que llego tarde' })).toHaveCount(0);
  const undo = page.getByTestId('ai-compose-undo');
  await expect(undo).toContainText('Nothing was sent');
  await undo.getByRole('button', { name: 'Undo' }).click();
  await expect(field).toHaveValue('');
  await expect(undo).toHaveCount(0);

  // Con texto en el campo, la barra mejora ese texto: el campo de la barra describe el cambio.
  await field.fill('Hola. Te aviso mañana.');
  await page.getByTestId('ai-compose-open').click();
  await expect(bar.getByRole('textbox', { name: 'Describe a change' })).toBeFocused();
  await bar.getByRole('button', { name: 'Shorter' }).click();
  await expect(draft).toHaveText('Hola.');
  await expect(field).toHaveValue('Hola. Te aviso mañana.');
  await bar.getByLabel('Translate to').selectOption('en');
  await expect(draft).toHaveText('Hola. (Translate the message to English. Keep the meaning, the tone and the formatting.)');
  // ⌘Enter inserta; deshacer devuelve lo escrito a mano.
  await bar.getByRole('textbox', { name: 'Describe a change' }).press('ControlOrMeta+Enter');
  await expect(field).toHaveValue(/^Hola\. \(Translate/);
  await undo.getByRole('button', { name: 'Undo' }).click();
  await expect(field).toHaveValue('Hola. Te aviso mañana.');
  // Esc cierra la barra sin tocar el campo y le devuelve el foco.
  await page.getByTestId('ai-compose-open').click();
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Hola. Te aviso mañana.');
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

test('más tarde con varios mensajes: cada uno su burbuja, editar, enviar ya y cancelar', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const name = `Juli ${uid()}`;
  await inbound(request, acc, { phone: phone(), name, body: 'Mañana me pasás los datos?' });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  const field = page.getByRole('textbox', { name: 'Message' });
  await field.fill('Buen día!');
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send later' });
  await expect(dialog.getByRole('textbox', { name: 'Message 1' })).toHaveValue('Buen día!');
  await dialog.getByRole('button', { name: 'Add another message' }).click();
  await dialog.getByRole('textbox', { name: 'Message 2' }).fill('CBU 0000003100000000000001');
  await dialog.getByLabel('After the previous one').selectOption('0');
  await dialog.getByRole('button', { name: /Tomorrow morning/ }).click();
  await expect(page.locator('.ib-toast', { hasText: 'Scheduled for' })).toBeVisible();
  await expect(field).toHaveValue('');
  const sched = page.locator('.ib-sched', { hasText: 'Buen día!' });
  await expect(sched).toContainText('2 messages');
  await expect(sched).toContainText('CBU 0000003100000000000001');

  // Editar: se suma un tercero y se guarda a la misma hora.
  await sched.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit scheduled send' });
  await expect(edit.getByRole('textbox', { name: 'Message 2' })).toHaveValue('CBU 0000003100000000000001');
  await edit.getByRole('button', { name: 'Add another message' }).click();
  await edit.getByRole('textbox', { name: 'Message 3' }).fill('Avisame cuando llegue');
  await edit.getByLabel('After the previous one').nth(1).selectOption('0');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(sched).toContainText('3 messages');

  // Enviar ya: salen los tres, cada uno su burbuja y en orden.
  await sched.getByRole('button', { name: 'Send now' }).click();
  await expect(page.locator('.ib-sched')).toHaveCount(0);
  const mine = page.locator('.gr-msg-out');
  await expect(mine.filter({ hasText: 'Avisame cuando llegue' })).toBeVisible();
  const texts = await mine.allInnerTexts();
  const order = ['Buen día!', 'CBU 0000003100000000000001', 'Avisame cuando llegue'].map((x) => texts.findIndex((t) => t.includes(x)));
  expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true);

  // Otra secuencia y cancelarla entera.
  await field.fill('uno');
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add another message' }).click();
  await dialog.getByRole('textbox', { name: 'Message 2' }).fill('dos');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(field).toHaveValue('uno');
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add another message' }).click();
  await dialog.getByRole('textbox', { name: 'Message 2' }).fill('dos');
  await dialog.getByRole('button', { name: /Later today/ }).click();
  await expect(page.locator('.ib-sched', { hasText: 'dos' })).toBeVisible();
  await page.locator('.ib-sched', { hasText: 'dos' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.ib-sched')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('carpetas anidadas: subcarpeta, arrastrar chats con deshacer, no leídos que suben, renombrar y borrar', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const lu = `Lu ${uid()}`;
  const mati = `Mati ${uid()}`;
  await inbound(request, acc, { phone: phone(), name: lu, body: 'Salimos el viernes?' });
  await inbound(request, acc, { phone: phone(), name: mati, body: 'Reservé el hotel' });
  const parent = `Viajes ${uid()}`;
  const child = `Hotel ${uid()}`;
  await request.post('/api/inbox/folders', { data: { name: parent } });

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const side = page.locator('#side-branch');
  const parentRow = side.locator('.docs-tree-row', { hasText: parent });
  await parentRow.hover();
  await side.getByRole('button', { name: `Actions for ${parent}` }).click();
  await page.getByRole('menuitem', { name: 'New subfolder' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await expect(dialog.getByLabel('Inside')).toHaveValue(/ibf/);
  await dialog.getByLabel('Name', { exact: true }).fill(child);
  await dialog.getByRole('button', { name: 'Create folder' }).click();
  await expect(page).toHaveURL(/\/app\/inbox\/f\//);
  const childRow = side.locator('.docs-tree-row', { hasText: child });
  await expect(childRow.getByRole('link', { name: child })).toHaveAttribute('aria-current', 'page');
  await expect(side.getByRole('button', { name: `Collapse ${parent}` })).toHaveAttribute('aria-expanded', 'true');

  // Arrastrar un chat a la subcarpeta: se resalta, se suma y se puede deshacer.
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: lu }).dragTo(childRow);
  await expect(page.locator('.ib-toast', { hasText: `Added to ${child}` })).toBeVisible();
  await page.locator('.ib-toast', { hasText: `Added to ${child}` }).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await sql('SELECT COUNT(*) AS n FROM inbox_thread_folders tf JOIN inbox_folders f ON f.id = tf.folder_id WHERE f.name = ?', [child]))[0].n).toBe(0);

  // Varios seleccionados a la vez.
  await page.locator('.ib-item', { hasText: lu }).locator('.ib-row-btn').click({ modifiers: ['Shift'] });
  await page.locator('.ib-item', { hasText: mati }).locator('.ib-row-btn').click({ modifiers: ['Shift'] });
  await expect(page.locator('.ib-item.is-selected')).toHaveCount(2);
  await page.locator('.ib-item', { hasText: mati }).dragTo(childRow);
  await expect(page.locator('.ib-toast', { hasText: `2 chats added to ${child}` })).toBeVisible();

  // Los no leídos de la subcarpeta suben al padre cuando está plegado; el padre muestra los chats de sus subcarpetas.
  await expect(childRow.getByLabel('2 unread chats')).toBeVisible();
  await side.getByRole('button', { name: `Collapse ${parent}` }).click();
  await expect(childRow).toBeHidden();
  await expect(parentRow.getByLabel('2 unread chats')).toBeVisible();
  await parentRow.getByRole('link', { name: parent }).click();
  await expect(page.getByRole('heading', { level: 1, name: parent })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: lu })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: mati })).toBeVisible();
  await side.getByRole('button', { name: `Expand ${parent}` }).click();

  // Teclado: F2 renombra, Alt+← la saca al primer nivel.
  const renamed = `${child} 2`;
  await childRow.getByRole('link').focus();
  await page.keyboard.press('F2');
  await side.getByRole('textbox', { name: `Name of ${child}` }).fill(renamed);
  await page.keyboard.press('Enter');
  const renamedRow = side.locator('.docs-tree-row', { hasText: renamed });
  await expect(renamedRow).toBeVisible();
  await renamedRow.getByRole('link').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => (await sql('SELECT parent_id FROM inbox_folders WHERE name = ?', [renamed]))[0].parent_id).toBeNull();
  await expect(side.getByRole('button', { name: `Collapse ${parent}` })).toHaveCount(0);

  // Borrar desde el menú (con confirmación); los chats siguen.
  await renamedRow.hover();
  await side.getByRole('button', { name: `Actions for ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete folder' }).getByRole('button', { name: 'Delete folder' }).click();
  await expect(side.locator('.docs-tree-row', { hasText: renamed })).toHaveCount(0);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: lu })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
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

  // "Help me write" en el correo: el botón lleva su nombre; el borrador se inserta (no se manda) y se puede deshacer.
  const open = page.getByTestId('ai-compose-open');
  await expect(open).toHaveText('Help me write');
  await open.click();
  const bar = page.getByTestId('ai-compose');
  const ask = bar.getByRole('textbox', { name: 'Describe your message' });
  await expect(ask).toBeFocused();
  await ask.fill('decile que llevo el postre');
  await ask.press('Enter');
  await expect(bar.getByTestId('ai-compose-draft')).toHaveText('Borrador: decile que llevo el postre');
  await bar.getByRole('button', { name: 'Insert' }).click();
  await expect(bar).toBeHidden();
  await expect(field).toHaveValue('Borrador: decile que llevo el postre');
  await expect(page.locator('.ib-mail.is-me', { hasText: 'postre' })).toHaveCount(0);
  await page.getByTestId('ai-compose-undo').getByRole('button', { name: 'Undo' }).click();
  await expect(field).toHaveValue('');
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
  await page.getByLabel(/Exported file/).setInputFiles({ name: 'inbox-zero-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByText(/1 folders, 1 chats/)).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported 1 folders/)).toBeVisible();
  await expect(page.locator('#folders').getByRole('link', { name: `Trabajo ${tag}` })).toBeVisible();
  await page.locator('#folders').getByRole('link', { name: `Trabajo ${tag}` }).click();
  const row = page.locator('.ib-item', { hasText: `Jefa ${tag}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText('borrador importado');
});

test('importar un .ndjson grande desde el navegador (por líneas, con avance) y un programado de varios mensajes', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  const tag = uid();
  const chat = `54911888${Math.floor(10000 + Math.random() * 89999)}@c.us`;
  const meta = {
    part: 'meta',
    format: 'inbox-zero-export',
    version: 2,
    folders: [],
    chatFolders: [],
    chats: [{ chatId: chat, name: `Prima ${tag}`, isGroup: false }],
    scheduled: [{ chatId: chat, chatName: `Prima ${tag}`, text: 'Feliz cumple!\u001eTe dejé algo en la puerta', sendAt: Date.now() + 3 * 86_400_000, status: 'pending' }],
    drafts: [],
    snoozes: [],
    notes: [],
  };
  const lines = [JSON.stringify(meta)];
  for (let i = 0; i < 6; i++) {
    lines.push(JSON.stringify({ part: 'messages', messages: Array.from({ length: 300 }, (_, j) => ({ id: `nd-${tag}-${i}-${j}`, chatId: chat, ts: 1_750_000_000 + i * 1000 + j, fromMe: j % 2 === 0, sender: `Prima ${tag}`, type: 'chat', text: `línea ${i} mensaje ${j} ${'·'.repeat(400)}` })) }));
  }
  const buffer = Buffer.from(`${lines.join('\n')}\n`);
  expect(buffer.length).toBeGreaterThan(1024 * 1024);
  await page.getByLabel(/Exported file/).setInputFiles({ name: `export-${tag}.ndjson`, mimeType: 'application/x-ndjson', buffer });
  await expect(page.locator('.ib-import-summary')).toContainText(`export-${tag}.ndjson`);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported 0 folders, 1 chats, 1 scheduled, 0 drafts, 0 snoozes, 0 notes and 1800 messages/)).toBeVisible({ timeout: 30_000 });
  await page.goto('/en/app/inbox/v/scheduled', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: `Prima ${tag}` }).locator('.ib-row-btn').click();
  const sched = page.locator('.ib-sched', { hasText: 'Feliz cumple!' });
  await expect(sched).toContainText('2 messages');
  await expect(sched).toContainText('Te dejé algo en la puerta');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('traer todo el historial de WhatsApp (servidor falso): espera, pagina, avanza y no duplica', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  // WhatsApp ya terminó de mandar el historial de la vinculación.
  await sql('UPDATE inbox_accounts SET sync_cursor = ? WHERE id = ?', [JSON.stringify({ phase: 'done', page: 0 }), acc.id]);
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  const start = page.getByRole('button', { name: 'Bring the full history' });
  await expect(start).toBeEnabled();
  await start.click();
  const job = page.locator('.ib-job', { hasText: 'Full WhatsApp history' }).first();
  await expect(job).toContainText('Done', { timeout: 60_000 });
  await expect(job).toContainText('3 of 3 chats');
  await expect(job.getByRole('progressbar')).toHaveAttribute('value', '100');
  await page.goto('/en/app/inbox/v/whatsapp', { waitUntil: 'networkidle' });
  const ana = page.locator('.ib-item', { hasText: 'Historial Ana' });
  await expect(ana).toBeVisible();
  await ana.locator('.ib-row-btn').click();
  await expect(page.locator('.gr-msg', { hasText: 'Historial Ana mensaje 230' })).toBeVisible();
  const n = await sql("SELECT COUNT(*) AS n FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.account_id = ? AND t.external_id = '5491170000001@s.whatsapp.net'", [acc.id]);
  expect(Number(n[0].n)).toBe(230);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('buscar en el texto de los mensajes: resaltado, filtros, ir al mensaje y Cmd+K', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const name = `Seba ${tag}`;
  const p = phone();
  await inbound(request, acc, { phone: p, name, body: `El presupuesto de la cocina ${tag} es de 3 millones` });
  // Muchos mensajes después, para que el buscado quede lejos del final.
  for (let i = 0; i < 6; i++) await inbound(request, acc, { phone: p, name, body: `otra cosa ${i}` });
  await inbound(request, acc, { phone: phone(), name: `Otro ${tag}`, body: `Mirá esto https://example.com/${tag}` });

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const search = page.getByLabel('Search chats and messages');
  await search.first().fill(`presupuesto ${tag}`);
  const hit = page.getByTestId('inbox-search-hit').filter({ hasText: name });
  await expect(hit).toBeVisible();
  await expect(hit.locator('mark').first()).toHaveText(/presupuesto/i);
  await hit.click();
  const target = page.locator('.ib-msg-hit');
  await expect(target).toBeVisible();
  await expect(target).toContainText(`El presupuesto de la cocina ${tag}`);

  // Filtros: has:link trae solo el del link; from:me no trae nada.
  await search.first().fill(`${tag} has:link`);
  await expect(page.getByTestId('inbox-search-hit')).toHaveCount(1);
  await expect(page.getByTestId('inbox-search-hit')).toContainText(`Otro ${tag}`);
  await search.first().fill(`presupuesto ${tag} from:me`);
  await expect(page.getByTestId('inbox-search-hit')).toHaveCount(0);

  // Cmd+K también encuentra el mensaje y abre el chat en él.
  await search.first().fill('');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox').fill(`cocina ${tag}`);
  const option = palette.getByRole('option', { name: new RegExp(`presupuesto de la cocina ${tag}`) });
  await expect(option.first()).toBeVisible();
  await option.first().click();
  await expect(page).toHaveURL(/m=ibm_/);
  await expect(page.locator('.ib-msg-hit')).toContainText(`presupuesto de la cocina ${tag}`);
  expect(errors, errors.join('\n')).toEqual([]);
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
