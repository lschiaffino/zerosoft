import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Gestos de una fila de chat, los mismos en Lines y en Inbox
 * (components/ui/chat-gestures.tsx): deslizar a los costados como WhatsApp
 * (a mitad de camino deja las acciones abiertas, hasta el fondo ejecuta la
 * principal) y mantener apretado para levantar la conversación y soltarla en
 * una carpeta del sidebar, o en la bandeja de carpetas cuando el sidebar no
 * está a la vista. Todo con el mouse, que es como se usa en el escritorio.
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

/** Desliza una fila con el mouse: `px` de recorrido, o una parte del ancho de la fila si es menor que 1. */
async function swipe(page: Page, row: Locator, dir: 'left' | 'right', amount: number) {
  await row.scrollIntoViewIfNeeded();
  const b = (await row.boundingBox())!;
  const y = b.y + b.height / 2;
  const from = dir === 'right' ? b.x + 60 : b.x + b.width - 60;
  const dist = amount < 1 ? b.width * amount : amount;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(from + (dir === 'right' ? dist : -dist), y, { steps: 12 });
  await page.mouse.up();
}

/** Mantiene apretada una fila hasta que la conversación se levanta (aparece la ficha). */
async function pickUp(page: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded();
  const b = (await row.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('drag-chip')).toBeVisible();
}

async function carryTo(page: Page, target: Locator) {
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
}

async function noSideScroll(page: Page) {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(w.scroll).toBeLessThanOrEqual(w.inner + 1);
}

/** La ficha queda corrida del puntero: lo que está debajo (la carpeta) no se tapa. */
async function chipClearOf(page: Page, target: Locator) {
  const chip = (await page.getByTestId('drag-chip').boundingBox())!;
  const b = (await target.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  expect(x >= chip.x && x <= chip.x + chip.width && y >= chip.y && y <= chip.y + chip.height).toBe(false);
}

// ---------- Lines ----------

async function fakeNumber(request: APIRequestContext, name: string): Promise<{ id: string; webhookUrl: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

async function linesInbound(request: APIRequestContext, url: string, name: string) {
  const res = await request.post(new URL(url).pathname, {
    data: {
      events: [{ type: 'message', chatId: `54911${Math.floor(Math.random() * 1e7)}@c.us`, isGroup: false, fromMe: false, senderPhone: '5491155550000', senderName: name, providerMessageId: `cg-${uid()}`, body: `hola ${name}` }],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function linesFolderChats(request: APIRequestContext, folderId: string): Promise<string[]> {
  const data = (await (await request.get(`/api/groups/chats?folder=${folderId}`)).json()) as { rows: Array<{ id: string }> };
  return data.rows.map((r) => r.id);
}

test.describe('Lines', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await request.put('/api/groups/prefs', { data: { line: 'all' } });
  });

  test('deslizar una conversación: a mitad de camino abre las acciones, hasta el fondo ejecuta, archivar se deshace', async ({ page, request }) => {
    const errors = watchErrors(page);
    const tag = uid();
    const n = await fakeNumber(request, `Gestos ${tag}`);
    const name = `Deslizo ${tag}`;
    await linesInbound(request, n.webhookUrl, name);
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('[data-chat-row]', { hasText: name });
    await expect(row).toBeVisible();
    const actions = row.getByTestId('swipe-actions');

    // Un deslizado corto no hace nada y no abre el chat.
    await swipe(page, row, 'right', 30);
    await expect(actions).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/lines\/inbox(\?|$)/);

    // A la derecha, a mitad de camino: leído y fijar quedan a la vista. Esc las cierra.
    await swipe(page, row, 'right', 130);
    await expect(actions.locator('[data-action="unread"]')).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Pin', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/lines\/inbox(\?|$)/);
    await page.keyboard.press('Escape');
    await expect(actions).toHaveCount(0);

    // Abiertas de nuevo: tocar "Fijar" fija el chat.
    await swipe(page, row, 'right', 130);
    await actions.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(row.locator('.gr-pin-icon')).toBeVisible();
    await expect(actions).toHaveCount(0);

    // Hasta el fondo a la derecha: ejecuta la principal (leído o no leído) sin tocar ningún botón.
    const wasUnread = (await row.locator('.gr-unread').count()) > 0;
    await swipe(page, row, 'right', 0.75);
    await expect(row.locator('.gr-unread')).toHaveCount(wasUnread ? 0 : 1);
    await expect(actions).toHaveCount(0);

    // A la izquierda, a mitad de camino: archivar y más. "Más" abre el menú de la fila, con todo lo demás.
    await swipe(page, row, 'left', 130);
    await expect(actions.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
    await actions.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Move to folder' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Hasta el fondo a la izquierda: archiva, avisa y se puede deshacer.
    await swipe(page, row, 'left', 0.75);
    const toast = page.locator('.ui-toast', { hasText: 'Chat archived' });
    await expect(toast).toBeVisible();
    await expect(row).toHaveCount(0);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toBeVisible();

    // Un clic común sigue abriendo el chat.
    await row.getByRole('link').click();
    await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?]+/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('mantener apretado y soltar en una carpeta: ficha chica, carpeta resaltada, subcarpeta que se abre sola, Esc y deshacer', async ({ page, request }) => {
    const errors = watchErrors(page);
    const tag = uid();
    const n = await fakeNumber(request, `Arrastre ${tag}`);
    const name = `Levanto ${tag}`;
    const other = `Acompaño ${tag}`;
    await linesInbound(request, n.webhookUrl, name);
    await linesInbound(request, n.webhookUrl, other);
    const parentName = `Clientes ${tag}`;
    const childName = `VIP ${tag}`;
    const parent = (await (await request.post('/api/groups/folders', { data: { name: parentName } })).json()) as { id: string };
    const child = (await (await request.post('/api/groups/folders', { data: { name: childName, parentId: parent.id } })).json()) as { id: string };
    const chatId = ((await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string }> }).rows[0].id;

    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('[data-chat-row]', { hasText: name });
    const side = page.locator('#side-branch').getByTestId('lines-folders');
    const parentRow = side.locator(`[data-chat-drop="${parent.id}"]`);
    const childRow = side.locator(`[data-chat-drop="${child.id}"]`);
    await expect(row).toBeVisible();
    await parentRow.scrollIntoViewIfNeeded();
    const chip = page.getByTestId('drag-chip');

    // Levantar: la ficha lleva el nombre, la fila queda apagada en su lugar y no hace falta bandeja (el sidebar está a la vista).
    await pickUp(page, row);
    await expect(chip).toContainText(name);
    await expect(row).toHaveAttribute('data-chat-dragging', '');
    await expect(page.getByTestId('drag-tray')).toHaveCount(0);

    // Sobre la carpeta: se resalta entera y la ficha no la tapa. Esc cancela y no mueve nada.
    await carryTo(page, parentRow);
    await expect(parentRow).toHaveAttribute('data-drop-hover', '');
    await expect(chip).toContainText(parentName);
    await chipClearOf(page, parentRow);
    await page.keyboard.press('Escape');
    await expect(chip).toHaveCount(0);
    await expect(side.locator('[data-drop-hover]')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('.ui-toast')).toHaveCount(0);
    expect(await linesFolderChats(request, parent.id)).toEqual([]);

    // Soltar en la carpeta: aviso con el destino; deshacer lo devuelve a donde estaba.
    await pickUp(page, row);
    await carryTo(page, parentRow);
    await expect(parentRow).toHaveAttribute('data-drop-hover', '');
    await page.mouse.up();
    await expect(chip).toHaveCount(0);
    const moved = page.locator('.ui-toast', { hasText: `1 chat moved to ${parentName}` });
    await expect(moved).toBeVisible();
    await expect.poll(() => linesFolderChats(request, parent.id)).toEqual([chatId]);
    await moved.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => linesFolderChats(request, parent.id)).toEqual([]);

    // Carpeta plegada: quedarse encima la abre sola y se puede soltar en la subcarpeta.
    await side.getByRole('button', { name: `Collapse ${parentName}` }).click();
    await expect(childRow).toHaveCount(0);
    await pickUp(page, row);
    await carryTo(page, parentRow);
    await expect(childRow).toBeVisible();
    await carryTo(page, childRow);
    await expect(childRow).toHaveAttribute('data-drop-hover', '');
    await page.mouse.up();
    await expect(page.locator('.ui-toast', { hasText: `1 chat moved to ${childName}` })).toBeVisible();
    await expect.poll(() => linesFolderChats(request, child.id)).toEqual([chatId]);

    // Donde ya está no se puede soltar: la carpeta queda apagada y no se resalta.
    await pickUp(page, row);
    await carryTo(page, childRow);
    await expect(childRow).toHaveAttribute('data-drop-disabled', '');
    await expect(side.locator('[data-drop-hover]')).toHaveCount(0);
    await page.mouse.up();

    // Varios a la vez: con dos elegidos, levantar uno lleva los dos ("2 chats").
    const otherRow = page.locator('[data-chat-row]', { hasText: other });
    await page.getByRole('button', { name: 'Select chats' }).click();
    await page.getByLabel(`Select chat ${name}`).check();
    await page.getByLabel(`Select chat ${other}`).check();
    await expect(page.locator('.gr-row-check:checked')).toHaveCount(2);
    await pickUp(page, otherRow);
    await expect(chip).toContainText('2 chats');
    await carryTo(page, parentRow);
    await page.mouse.up();
    await expect(page.locator('.ui-toast', { hasText: `2 chats moved to ${parentName}` })).toBeVisible();
    await expect.poll(async () => (await linesFolderChats(request, parent.id)).length).toBeGreaterThanOrEqual(2);

    await request.delete(`/api/groups/folders?id=${parent.id}`);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('sin el sidebar a la vista aparece la bandeja de carpetas: sidebar colapsado y ancho de teléfono', async ({ page, request }) => {
    const tag = uid();
    const n = await fakeNumber(request, `Bandeja ${tag}`);
    const name = `Bandejeo ${tag}`;
    await linesInbound(request, n.webhookUrl, name);
    const parentName = `Zona ${tag}`;
    const childName = `Sur ${tag}`;
    const parent = (await (await request.post('/api/groups/folders', { data: { name: parentName } })).json()) as { id: string };
    const child = (await (await request.post('/api/groups/folders', { data: { name: childName, parentId: parent.id } })).json()) as { id: string };
    const chatId = ((await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string }> }).rows[0].id;

    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('[data-chat-row]', { hasText: name });
    await expect(row).toBeVisible();
    const tray = page.getByTestId('drag-tray');
    await expect(tray).toHaveCount(0);

    // Sidebar colapsado: la bandeja se acopla al costado de la lista, con las subcarpetas adentro de su carpeta.
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await pickUp(page, row);
    await expect(tray).toBeVisible();
    await expect(tray).toHaveAttribute('data-mode', 'side');
    const childItem = tray.locator(`[data-chat-drop="${child.id}"]`);
    await childItem.scrollIntoViewIfNeeded();
    await carryTo(page, childItem);
    await expect(childItem).toHaveAttribute('data-drop-hover', '');
    await page.mouse.up();
    await expect(tray).toHaveCount(0);
    await expect(page.locator('.ui-toast', { hasText: `1 chat moved to ${childName}` })).toBeVisible();
    await expect.poll(() => linesFolderChats(request, child.id)).toEqual([chatId]);

    // Teléfono: la bandeja va abajo, no agrega scroll horizontal y también se suelta "Sin carpeta".
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await expect(row).toBeVisible();
    await noSideScroll(page);
    await swipe(page, row, 'left', 130);
    await expect(row.getByTestId('swipe-actions')).toBeVisible();
    await noSideScroll(page);
    await page.keyboard.press('Escape');
    await pickUp(page, row);
    await expect(tray).toHaveAttribute('data-mode', 'bottom');
    await noSideScroll(page);
    const unfiled = tray.locator('[data-chat-drop="none"]');
    await unfiled.scrollIntoViewIfNeeded();
    await carryTo(page, unfiled);
    await expect(unfiled).toHaveAttribute('data-drop-hover', '');
    await page.mouse.up();
    await expect(tray).toHaveCount(0);
    await expect.poll(() => linesFolderChats(request, child.id)).toEqual([]);

    await request.delete(`/api/groups/folders?id=${parent.id}`);
  });
});

// ---------- Inbox ----------

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [account] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(account.id), secret: String(account.webhook_secret) };
}

async function inboxInbound(request: APIRequestContext, acc: { id: string; secret: string }, name: string) {
  const phone = `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [{ type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `cg-${uid()}`, body: `hola ${name}`, timestamp: new Date().toISOString() }],
    },
  });
  expect(res.ok()).toBe(true);
}

const inFolder = async (folderId: string) => Number((await sql('SELECT COUNT(*) AS n FROM inbox_thread_folders WHERE folder_id = ?', [folderId]))[0].n);

test.describe('Inbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('deslizar una conversación: a mitad de camino abre las acciones, hasta el fondo ejecuta, archivar se deshace', async ({ page, request }) => {
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const name = `Deslizo ${uid()}`;
    await inboxInbound(request, acc, name);
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.ib-item', { hasText: name });
    await expect(row).toBeVisible();
    const actions = row.getByTestId('swipe-actions');

    // Un deslizado corto no hace nada y no abre el chat.
    await swipe(page, row, 'right', 30);
    await expect(actions).toHaveCount(0);
    await expect(row).not.toHaveClass(/is-open/);

    // A la derecha, a mitad de camino: leído y fijar. Esc las cierra; tocar "Fijar" fija.
    await swipe(page, row, 'right', 130);
    await expect(actions.locator('[data-action="unread"]')).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Pin', exact: true })).toBeVisible();
    await expect(row).not.toHaveClass(/is-open/);
    await page.keyboard.press('Escape');
    await expect(actions).toHaveCount(0);
    await swipe(page, row, 'right', 130);
    await actions.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(page.locator('.ib-toast', { hasText: 'Pinned' })).toBeVisible();
    await expect(actions).toHaveCount(0);

    // Hasta el fondo a la derecha: leído o no leído, sin tocar ningún botón.
    const wasUnread = (await row.locator('.wa-unread').count()) > 0;
    await swipe(page, row, 'right', 0.75);
    await expect(page.locator('.ib-toast', { hasText: wasUnread ? 'Marked read' : 'Marked unread' })).toBeVisible();

    // A la izquierda, a mitad de camino: archivar y más ("Más" abre las acciones de ese chat).
    await swipe(page, row, 'left', 130);
    await expect(actions.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
    await actions.getByRole('button', { name: 'More', exact: true }).click();
    const more = page.getByRole('dialog').filter({ hasText: name });
    await expect(more).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(more).toBeHidden();

    // Hasta el fondo a la izquierda: archiva, avisa y se puede deshacer.
    await swipe(page, row, 'left', 0.75);
    const toast = page.locator('.ib-toast', { hasText: 'Archived' });
    await expect(toast).toBeVisible();
    await expect(row).toHaveCount(0);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toBeVisible();

    // Un clic común sigue abriendo el chat.
    await row.locator('.ib-row-btn').click();
    await expect(row).toHaveClass(/is-open/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('mantener apretado y soltar en una carpeta: resaltado, subcarpeta que se abre sola, Esc, deshacer y bandeja en el teléfono', async ({ page, request }) => {
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const name = `Levanto ${uid()}`;
    await inboxInbound(request, acc, name);
    const parentName = `Viajes ${uid()}`;
    const childName = `Hotel ${uid()}`;
    const parent = ((await (await request.post('/api/inbox/folders', { data: { name: parentName } })).json()) as { folder: { id: string } }).folder;
    const child = ((await (await request.post('/api/inbox/folders', { data: { name: childName, parentId: parent.id } })).json()) as { folder: { id: string } }).folder;

    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('.ib-item', { hasText: name });
    const side = page.locator('#side-branch');
    const parentRow = side.locator(`[data-chat-drop="${parent.id}"]`);
    const childRow = side.locator(`[data-chat-drop="${child.id}"]`);
    await expect(row).toBeVisible();
    await parentRow.scrollIntoViewIfNeeded();
    const chip = page.getByTestId('drag-chip');

    // Esc cancela: nada se mueve y no queda nada resaltado.
    await pickUp(page, row);
    await expect(chip).toContainText(name);
    await expect(row).toHaveAttribute('data-chat-dragging', '');
    await carryTo(page, parentRow);
    await expect(parentRow).toHaveAttribute('data-drop-hover', '');
    await chipClearOf(page, parentRow);
    await page.keyboard.press('Escape');
    await expect(chip).toHaveCount(0);
    await expect(side.locator('[data-drop-hover]')).toHaveCount(0);
    await page.mouse.up();
    expect(await inFolder(parent.id)).toBe(0);

    // Carpeta plegada: quedarse encima la abre; se suelta en la subcarpeta, con aviso y deshacer.
    await side.getByRole('button', { name: `Collapse ${parentName}` }).click();
    await expect(childRow).toHaveCount(0);
    await pickUp(page, row);
    await carryTo(page, parentRow);
    await expect(childRow).toBeVisible();
    await carryTo(page, childRow);
    await expect(childRow).toHaveAttribute('data-drop-hover', '');
    await page.mouse.up();
    const added = page.locator('.ib-toast', { hasText: `Added to ${childName}` });
    await expect(added).toBeVisible();
    await expect.poll(() => inFolder(child.id)).toBe(1);
    await added.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => inFolder(child.id)).toBe(0);

    // Teléfono: el sidebar es un cajón cerrado, así que aparece la bandeja abajo. Sin scroll horizontal.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(row).toBeVisible();
    await swipe(page, row, 'left', 130);
    await expect(row.getByTestId('swipe-actions')).toBeVisible();
    await noSideScroll(page);
    await page.keyboard.press('Escape');
    await pickUp(page, row);
    const tray = page.getByTestId('drag-tray');
    await expect(tray).toHaveAttribute('data-mode', 'bottom');
    await noSideScroll(page);
    const item = tray.locator(`[data-chat-drop="${parent.id}"]`);
    await item.scrollIntoViewIfNeeded();
    await carryTo(page, item);
    await expect(item).toHaveAttribute('data-drop-hover', '');
    await page.mouse.up();
    await expect(tray).toHaveCount(0);
    await expect(page.locator('.ib-toast', { hasText: `Added to ${parentName}` })).toBeVisible();
    await expect.poll(() => inFolder(parent.id)).toBe(1);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

// ---------- Deslizar de vuelta (como iOS Mail y WhatsApp) ----------
//
// Con la fila abierta, arrastrarla de vuelta la cierra: se frena en la fila
// cerrada y nunca pasa al otro lado en el mismo gesto. Tocarla, tocar otra o
// empezar un scroll también la cierra, sin abrir el chat. Con el dedo los
// eventos se arman a mano (pointerType touch, con tiempos de verdad entre
// movimientos) y se anota cómo quedó pintada la fila después de cada uno.

type Step = [dx: number, dy: number, waitMs: number];
interface Seen {
  x: number;
  side: string | null;
}

/** De `from` a `to` en x, en `ms`, con un movimiento cada ~16 ms. */
function glide(from: number, to: number, ms: number): Step[] {
  const steps = Math.max(1, Math.round(ms / 16));
  return Array.from({ length: steps }, (_, i) => [from + ((to - from) * (i + 1)) / steps, 0, ms / steps] as Step);
}

/**
 * Un gesto con el dedo sobre la fila. Arranca a 40 px del borde contrario a
 * donde va el primer movimiento (o en el centro), mueve por `path` y suelta
 * después de `rest` ms. Con `release: false` queda apoyado: la próxima
 * llamada sigue el mismo gesto.
 */
async function touch(row: Locator, path: Step[], o: { rest?: number; release?: boolean; at?: 'center' } = {}): Promise<Seen[]> {
  return row.evaluate(
    async (el, { path, rest, release, at }) => {
      const w = window as unknown as { __zsTouch?: { x: number; y: number; lx: number; ly: number } };
      const fire = (type: string, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, { pointerType: 'touch', pointerId: 21, isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }),
        );
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const seen: Array<{ x: number; side: string | null }> = [];
      let g = w.__zsTouch;
      if (!g) {
        const b = el.getBoundingClientRect();
        const first = path[0]?.[0] ?? 0;
        const x = at === 'center' ? b.left + b.width / 2 : first > 0 ? b.left + 40 : b.right - 40;
        g = { x, y: b.top + b.height / 2, lx: x, ly: b.top + b.height / 2 };
        w.__zsTouch = g;
        fire('pointerdown', g.x, g.y);
      }
      for (const [dx, dy, ms] of path) {
        await wait(ms);
        g.lx = g.x + dx;
        g.ly = g.y + dy;
        fire('pointermove', g.lx, g.ly);
        seen.push({ x: parseFloat((el as HTMLElement).style.getPropertyValue('--swipe-x') || '0'), side: el.getAttribute('data-swipe') });
      }
      if (release !== false) {
        await wait(rest ?? 16);
        fire('pointerup', g.lx, g.ly);
        delete w.__zsTouch;
      }
      return seen;
    },
    { path, rest: o.rest, release: o.release, at: o.at },
  );
}

/** Lo mismo con el mouse de verdad (eventos del navegador). */
async function mouseDrag(page: Page, row: Locator, dx: number, steps = 20): Promise<Seen[]> {
  const b = (await row.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  const seen: Seen[] = [];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y);
    seen.push(await row.evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.getPropertyValue('--swipe-x') || '0'), side: el.getAttribute('data-swipe') })));
  }
  await page.mouse.up();
  return seen;
}

async function settled(row: Locator, side: 'left' | 'right') {
  await expect(row.getByTestId('swipe-actions')).toHaveAttribute('data-side', side);
  await expect(row).not.toHaveAttribute('data-swipe-settling', '');
}

/** La fila abierta a la izquierda con el dedo (aparecen Archivar y Más). */
async function openLeft(row: Locator) {
  await touch(row, glide(0, -140, 200), { rest: 120 });
  await settled(row, 'left');
}

/** La fila abierta a la derecha con el dedo (aparecen Leído y Fijar). */
async function openRight(row: Locator) {
  await touch(row, glide(0, 140, 200), { rest: 120 });
  await settled(row, 'right');
}

const crossedRight = (seen: Seen[]) => seen.filter((s) => s.x > 0 || s.side === 'right');
const crossedLeft = (seen: Seen[]) => seen.filter((s) => s.x < 0 || s.side === 'left');

async function closedRow(row: Locator) {
  await expect(row.getByTestId('swipe-actions')).toHaveCount(0);
  await expect(row).not.toHaveAttribute('data-swipe', /.*/);
}

/** Lo mismo en Lines y en Inbox: la fila abierta y el arrastre de vuelta, de todas las formas. */
async function gauntlet(page: Page, row: Locator, other: Locator, listUrl: RegExp, shots: string) {
  // El caso del dueño: abierta a la izquierda, arrastrar a la derecha lejos y despacio. Se frena en 0 y no abre la derecha.
  await openLeft(row);
  const mid = await touch(row, glide(0, 260, 520), { release: false });
  expect(crossedRight(mid), JSON.stringify(mid)).toEqual([]);
  expect(mid.at(-1)?.x).toBe(0);
  await expect(row.locator('[data-action="unread"], [data-action="read"], [data-action="pin"]')).toHaveCount(0);
  await page.screenshot({ path: `${shots}-1-pasado-del-cero.png` });
  const rest = await touch(row, glide(260, 300, 100));
  expect(crossedRight(rest)).toEqual([]);
  await closedRow(row);
  await page.screenshot({ path: `${shots}-2-soltada.png` });
  await expect(page).toHaveURL(listUrl);

  // A mitad de camino de vuelta, para la captura.
  await openLeft(row);
  await touch(row, glide(0, 70, 200), { release: false });
  await page.screenshot({ path: `${shots}-0-a-mitad-de-vuelta.png` });
  await touch(row, [], { rest: 150 });
  await closedRow(row);

  // Rápido (un envión de vuelta): igual se cierra sin pasar.
  await openLeft(row);
  const flick = await touch(row, glide(0, 220, 60), { rest: 0 });
  expect(crossedRight(flick)).toEqual([]);
  await closedRow(row);

  // Un poco de vuelta y quieto: queda abierta. Un tercio: se cierra.
  await openLeft(row);
  await touch(row, glide(0, 30, 300), { rest: 150 });
  await settled(row, 'left');
  await touch(row, glide(0, 64, 300), { rest: 150 });
  await closedRow(row);

  // Ir y venir unos px sobre la fila abierta: queda abierta.
  await openLeft(row);
  await touch(row, [[-12, 0, 16], [10, 0, 16], [-10, 0, 16], [6, 0, 16]], { rest: 150 });
  await settled(row, 'left');
  await page.keyboard.press('Escape');
  await closedRow(row);

  // Abierta a la derecha, arrastrar a la izquierda: tampoco cruza.
  await openRight(row);
  const back = await touch(row, glide(0, -300, 400));
  expect(crossedLeft(back), JSON.stringify(back)).toEqual([]);
  await closedRow(row);

  // Cerrada: izquierda y después derecha en el mismo gesto. Vuelve a cerrada sin mostrar la derecha.
  const zig = await touch(row, [...glide(0, -100, 200), ...glide(-100, 280, 400)]);
  expect(crossedRight(zig), JSON.stringify(zig)).toEqual([]);
  await closedRow(row);

  // Para el otro lado hay que soltar y empezar de nuevo.
  await openLeft(row);
  await touch(row, glide(0, 260, 300));
  await closedRow(row);
  await openRight(row);
  await touch(row, glide(0, -260, 300));
  await closedRow(row);

  // Tocar la fila abierta la cierra y no abre el chat.
  await openLeft(row);
  const b = (await row.boundingBox())!;
  await page.mouse.click(b.x + 60, b.y + b.height / 2);
  await closedRow(row);
  await expect(page).toHaveURL(listUrl);

  // Tocar otra fila la cierra y tampoco abre nada.
  await openLeft(row);
  const ob = (await other.boundingBox())!;
  await page.mouse.click(ob.x + 60, ob.y + ob.height / 2);
  await closedRow(row);
  await expect(page).toHaveURL(listUrl);

  // Un arrastre que empieza vertical (scroll) sobre la fila abierta la cierra.
  await openLeft(row);
  await touch(row, [[1, 6, 16], [2, 20, 16], [3, 40, 16]], { at: 'center' });
  await closedRow(row);

  // Una sola fila abierta a la vez.
  await openLeft(row);
  await openLeft(other);
  await closedRow(row);
  await touch(other, glide(0, 200, 200));
  await closedRow(other);

  // Con el mouse (o el trackpad): abierta, arrastrar a la derecha. Igual se frena en 0 y no abre el chat.
  await swipe(page, row, 'left', 130);
  await settled(row, 'left');
  const m = await mouseDrag(page, row, 170);
  expect(crossedRight(m), JSON.stringify(m)).toEqual([]);
  await closedRow(row);
  await expect(page).toHaveURL(listUrl);

  // Y un deslizado nuevo desde cerrada sigue abriendo cualquiera de los dos lados.
  await openRight(row);
  await page.keyboard.press('Escape');
  await closedRow(row);
  await openLeft(row);
  await page.keyboard.press('Escape');
  await closedRow(row);
}

test.describe('Deslizar de vuelta', () => {
  // Son muchos gestos seguidos, y en `next dev` la primera carga compila.
  test.describe.configure({ timeout: 180_000 });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Lines: con la fila abierta, volver la cierra y nunca abre el otro lado', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    await request.put('/api/groups/prefs', { data: { line: 'all' } });
    const tag = uid();
    const n = await fakeNumber(request, `Vuelta ${tag}`);
    const name = `Vuelvo ${tag}`;
    const otherName = `Vecino ${tag}`;
    await linesInbound(request, n.webhookUrl, otherName);
    await linesInbound(request, n.webhookUrl, name);
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('[data-chat-row]', { hasText: name });
    const other = page.locator('[data-chat-row]', { hasText: otherName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(other).toBeVisible();
    await gauntlet(page, row, other, /\/app\/lines\/inbox(\?|$)/, info.outputPath('lines'));
    await noSideScroll(page);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Inbox: con la fila abierta, volver la cierra y nunca abre el otro lado', async ({ page, request }, info) => {
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const name = `Vuelvo ${uid()}`;
    const otherName = `Vecino ${uid()}`;
    await inboxInbound(request, acc, otherName);
    await inboxInbound(request, acc, name);
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const row = page.locator('[data-chat-row]', { hasText: name });
    const other = page.locator('[data-chat-row]', { hasText: otherName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(other).toBeVisible();
    await gauntlet(page, row, other, /\/app\/inbox(\?|$)/, info.outputPath('inbox'));
    await expect(row).not.toHaveClass(/is-open/);
    await noSideScroll(page);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
