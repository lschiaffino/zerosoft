import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Lines e Inbox, como WhatsApp:
 * - clic derecho sobre un chat abre su menú en el puntero (también con la
 *   tecla de menú o Shift+F10), con submenú para silenciar, dentro de la
 *   ventana, y se cierra con Esc, un clic afuera o el scroll;
 * - la conversación no se mueve sola mientras se lee (mensajes que llegan,
 *   fotos que cargan, anteriores que se suman arriba);
 * - el borrador aparece en la fila del chat que se deja al instante, y
 *   desaparece al instante cuando se borra.
 */

test.describe.configure({ timeout: 180_000 });

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

// ---------- Inbox ----------

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

type Ev = Record<string, unknown>;

async function events(request: APIRequestContext, acc: { id: string; secret: string }, list: Ev[]) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } });
  expect(res.ok(), await res.text()).toBe(true);
}

function dm(chat: string, name: string, body: string, at = new Date()): Ev {
  return { type: 'message', chatId: `${chat}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: chat, senderName: name, providerMessageId: `m-${uid()}`, body, timestamp: at.toISOString() };
}

const inboxRow = (page: Page, name: string) => page.locator('[data-chat-row]', { hasText: name });
const menu = (page: Page) => page.getByTestId('context-menu');

async function rightClick(page: Page, row: Locator, at: 'center' | 'corner' = 'center'): Promise<{ x: number; y: number }> {
  await row.scrollIntoViewIfNeeded();
  const b = (await row.boundingBox())!;
  const x = at === 'center' ? b.x + b.width / 2 : b.x + b.width - 4;
  const y = at === 'center' ? b.y + b.height / 2 : b.y + b.height - 4;
  await page.mouse.click(x, y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  return { x, y };
}

async function insideViewport(page: Page, el: Locator) {
  const b = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
}

test('Inbox: clic derecho en un chat abre el menú de WhatsApp en el puntero, con teclado, submenú y dentro de la ventana', async ({ page, request, context, baseURL }, info) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const name = `Menú ${uid()}`;
  const other = `Otro ${uid()}`;
  await events(request, acc, [dm(phone(), other, 'hola'), dm(phone(), name, 'hola, ¿cómo va?')]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = inboxRow(page, name);
  await expect(row).toBeVisible({ timeout: 30_000 });

  // En el puntero: arriba a la izquierda del menú, donde se hizo clic.
  const at = await rightClick(page, row);
  const box = (await menu(page).boundingBox())!;
  expect(Math.abs(box.x - at.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y - at.y)).toBeLessThanOrEqual(2);
  await expect(menu(page).getByRole('menuitem')).toHaveText(['Open in new window', 'Mark read', 'Archive chat', 'Pin chat', 'Mute notifications', 'Add to folder', 'Contact info', 'Remove from Inbox']);
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused();
  await page.screenshot({ path: info.outputPath('inbox-menu-1280-light.png') });

  // Silenciar abre su submenú (con el mouse encima o con →); elegir 8 horas lo silencia.
  await menu(page).getByRole('menuitem', { name: 'Mute notifications' }).hover();
  const sub = page.getByTestId('context-submenu');
  await expect(sub.getByRole('menuitem')).toHaveText(['Mute for 8 hours', 'Mute for a week']);
  await insideViewport(page, sub);
  await page.screenshot({ path: info.outputPath('inbox-submenu-1280-light.png') });
  await sub.getByRole('menuitem', { name: 'Mute for 8 hours' }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(row.locator('.wa-row-icons').getByLabel('Muted')).toBeVisible({ timeout: 30_000 });
  await rightClick(page, row);
  await expect(menu(page).getByRole('menuitem', { name: 'Unmute notifications' })).toBeVisible();
  await menu(page).getByRole('menuitem', { name: 'Unmute notifications' }).click();

  // Marcar como no leído, desde el menú: no abre el chat.
  await rightClick(page, row);
  await menu(page).getByRole('menuitem', { name: 'Mark read' }).click();
  await rightClick(page, row);
  await expect(menu(page).getByRole('menuitem', { name: 'Mark unread' })).toBeVisible();
  await expect(row).not.toHaveClass(/is-open/);

  // Esc cierra y el foco vuelve a la fila; un clic afuera y el scroll también cierran.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await rightClick(page, row);
  await page.mouse.click(5, 790);
  await expect(menu(page)).toHaveCount(0);
  await rightClick(page, row);
  await page.locator('[data-chat-list], .ib-list').first().dispatchEvent('scroll');
  await expect(menu(page)).toHaveCount(0);

  // Teclado: con el foco en la fila, Shift+F10 abre el menú; flechas, → abre el submenú, ← vuelve, Esc cierra.
  await row.locator('.ib-row-btn').focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await expect(menu(page).getByRole('menuitem', { name: 'Mute notifications' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(sub.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(sub).toHaveCount(0);
  await expect(menu(page).getByRole('menuitem', { name: 'Mute notifications' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menu(page).getByRole('menuitem', { name: 'Pin chat' })).toBeFocused();
  // Una letra con el menú abierto no dispara los atajos de Inbox (E = Hecho).
  await page.keyboard.press('e');
  await expect(row).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(row.locator('.ib-row-btn')).toBeFocused();
  await page.keyboard.press('ContextMenu');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');

  // Info del contacto: abre el chat con el panel de info.
  await rightClick(page, row);
  await menu(page).getByRole('menuitem', { name: 'Contact info' }).click();
  await expect(row).toHaveClass(/is-open/);
  await expect(page.getByRole('complementary', { name: 'Contact info' })).toBeVisible();

  // Abrir en otra ventana: una pestaña nueva con ese chat.
  await rightClick(page, inboxRow(page, other));
  const [popup] = await Promise.all([context.waitForEvent('page'), menu(page).getByRole('menuitem', { name: 'Open in new window' }).click()]);
  await popup.waitForLoadState('domcontentloaded');
  expect(new URL(popup.url()).searchParams.get('t')).toBeTruthy();
  await popup.close();

  // Sacar de Inbox pide confirmación.
  await rightClick(page, inboxRow(page, other));
  await menu(page).getByRole('menuitem', { name: 'Remove from Inbox' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Remove from Inbox' })).toBeVisible();
  await page.keyboard.press('Escape');

  // En la esquina de abajo a la derecha, y en un teléfono, el menú no sale de la ventana. Claro y oscuro.
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await expect(row).toBeVisible();
      await rightClick(page, row, 'corner');
      await insideViewport(page, menu(page));
      await menu(page).getByRole('menuitem', { name: 'Mute notifications' }).hover();
      await insideViewport(page, page.getByTestId('context-submenu'));
      await page.screenshot({ path: info.outputPath(`inbox-menu-${width}-${theme}.png`) });
      const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: la conversación no se mueve sola mientras se lee', async ({ page, request }, info) => {
  const errors = watchErrors(page);
  page.on('console', (m) => { if (m.text().startsWith('[anchor]')) console.log(m.text().slice(0, 300)); });
  const acc = await linkWhatsapp(request);
  const name = `Lectura ${uid()}`;
  const chat = phone();
  const t0 = Date.now() - 2 * 86_400_000;
  // 200 mensajes: la conversación abre con los últimos 150 y tiene anteriores para cargar.
  const many = Array.from({ length: 200 }, (_, i) => dm(chat, name, `mensaje ${i} ${'texto '.repeat(1 + (i % 5) * 4)}`, new Date(t0 + i * 60_000)));
  for (let i = 0; i < many.length; i += 50) await events(request, acc, many.slice(i, i + 50));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await inboxRow(page, name).locator('.ib-row-btn').click({ timeout: 30_000 });
  const list = page.locator('.ib-wa-thread .wa-messages');
  await expect(list.getByText('mensaje 199', { exact: false })).toBeVisible({ timeout: 30_000 });

  /** El primer mensaje a la vista y a cuántos px del borde de arriba está. */
  const anchor = () =>
    list.evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      for (const m of Array.from(el.querySelectorAll<HTMLElement>('[id^="m-"]'))) {
        const r = m.getBoundingClientRect();
        if (r.bottom > top + 1) return { id: m.id, off: Math.round(r.top - top), scroll: el.scrollTop, end: el.scrollHeight - el.scrollTop - el.clientHeight };
      }
      return null;
    });
  const expectStill = async (before: { id: string; off: number } | null) => {
    await expect
      .poll(async () => {
        const now = await anchor();
        if (!now || !before) return 'none';
        if (now.id !== before.id) {
          const off = await list.evaluate((el, id) => Math.round(document.getElementById(id)!.getBoundingClientRect().top - el.getBoundingClientRect().top), before.id);
          return Math.abs(off - before.off) <= 1 ? 'ok' : `moved ${off - before.off}`;
        }
        return Math.abs(now.off - before.off) <= 1 ? 'ok' : `moved ${now.off - before.off}`;
      })
      .toBe('ok');
  };

  // Leyendo más arriba (a mitad de la conversación).
  await list.evaluate((el) => el.scrollBy(0, -900));
  await page.waitForTimeout(200);
  const reading = await anchor();
  expect(reading!.end).toBeGreaterThan(300);

  // 1) Llegan mensajes nuevos (la consulta periódica): lo que se lee no se mueve.
  await events(request, acc, [dm(chat, name, 'llegó uno nuevo', new Date())]);
  await expect(list.getByText('llegó uno nuevo')).toHaveCount(1, { timeout: 20_000 });
  await expectStill(reading);

  // 2) Algo arriba crece (una foto que termina de cargar): se compensa.
  const before2 = await anchor();
  await list.evaluate((el) => {
    const first = el.querySelector<HTMLElement>('[id^="m-"]')!;
    first.style.paddingTop = '260px';
  });
  await expectStill(before2);
  await page.screenshot({ path: info.outputPath('inbox-scroll-anclado.png') });

  // 3) Algo arriba se achica: también.
  const before3 = await anchor();
  await list.evaluate((el) => {
    el.querySelector<HTMLElement>('[id^="m-"]')!.style.paddingTop = '';
  });
  await expectStill(before3);

  // 4) Cargar anteriores (se suman arriba): lo que se leía queda donde estaba.
  await list.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(150);
  const older = list.locator('.wa-older button');
  await expect(older).toBeVisible();
  const before4 = await anchor();
  await older.click();
  await expect(list.getByText('mensaje 0 ', { exact: false })).toHaveCount(1, { timeout: 15_000 });
  await expectStill(before4);

  // 5) Abajo de todo, lo nuevo sí se ve: la conversación sigue al final.
  await page.getByRole('button', { name: 'Scroll to the latest message' }).click();
  await expect.poll(async () => (await anchor())!.end).toBeLessThan(5);
  await events(request, acc, [dm(chat, name, 'y otro más al final', new Date(Date.now() + 1000))]);
  await expect(list.getByText('y otro más al final')).toBeInViewport({ timeout: 20_000 });
  await expect.poll(async () => (await anchor())!.end).toBeLessThan(5);

  // 6) Una foto que termina de cargar abajo de todo: sigue abajo de todo.
  await list.evaluate((el) => {
    const all = el.querySelectorAll<HTMLElement>('[id^="m-"]');
    all[all.length - 1].style.paddingBottom = '200px';
  });
  await expect.poll(async () => (await anchor())!.end).toBeLessThan(5);

  // 7) Lo que mando yo: abajo de todo aunque estuviera leyendo arriba.
  await list.evaluate((el) => el.scrollBy(0, -800));
  await page.getByRole('textbox', { name: 'Message' }).fill('respuesta mía');
  await page.keyboard.press('Enter');
  await expect(list.getByText('respuesta mía')).toBeInViewport();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: el borrador aparece y desaparece de la fila al instante', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const a = `Borra ${uid()}`;
  const b = `Bnext ${uid()}`;
  await events(request, acc, [dm(phone(), a, 'hola A'), dm(phone(), b, 'hola B')]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const rowA = inboxRow(page, a);
  const rowB = inboxRow(page, b);
  await rowA.locator('.ib-row-btn').click({ timeout: 30_000 });
  const field = page.getByRole('textbox', { name: 'Message' });

  // Escribir y pasar enseguida a otro chat: la fila del que se deja dice "Draft" ya (antes de cualquier guardado o consulta).
  await field.fill('nos vemos el lunes');
  await expect(rowA.locator('.wa-row-draft')).toBeVisible({ timeout: 300 });
  await rowB.locator('.ib-row-btn').click();
  await expect(rowA.locator('.wa-row-draft')).toBeVisible({ timeout: 300 });
  await expect(rowA).toContainText('nos vemos el lunes', { timeout: 300 });

  // Lo escrito en el último instante antes de cambiar no se pierde: después de recargar sigue ahí
  // (el guardado sale con keepalive; si el servidor tarda, lo trae la consulta siguiente).
  await page.reload({ waitUntil: 'networkidle' });
  await expect(rowA).toContainText('nos vemos el lunes', { timeout: 20_000 });

  // Volver al chat: el campo trae el borrador. Borrarlo saca la etiqueta de la fila ya.
  await rowA.locator('.ib-row-btn').click();
  await expect(field).toHaveValue('nos vemos el lunes');
  await field.fill('');
  await expect(rowA.locator('.wa-row-draft')).toHaveCount(0, { timeout: 300 });
  // La consulta periódica (con el valor viejo del servidor) no la hace volver.
  await page.waitForTimeout(9000);
  await expect(rowA.locator('.wa-row-draft')).toHaveCount(0);
  await rowB.locator('.ib-row-btn').click();
  await expect(rowA.locator('.wa-row-draft')).toHaveCount(0);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(rowA.locator('.wa-row-draft')).toHaveCount(0);

  // Mandar el mensaje: tampoco queda un borrador fantasma.
  await rowA.locator('.ib-row-btn').click();
  await field.fill('mensaje que sale');
  await expect(rowA.locator('.wa-row-draft')).toBeVisible({ timeout: 300 });
  await page.keyboard.press('Enter');
  await expect(rowA.locator('.wa-row-draft')).toHaveCount(0);
  await page.waitForTimeout(9000);
  await expect(rowA.locator('.wa-row-draft')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

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
  // Un teléfono por chat: el nombre de un contacto se guarda por teléfono.
  const tel = phone();
  const res = await request.post(new URL(url).pathname, {
    data: { events: [{ type: 'message', chatId: `${tel}@c.us`, isGroup: false, fromMe: false, senderPhone: tel, senderName: name, providerMessageId: `rm-${uid()}`, body: `hola ${name}` }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test('Lines: clic derecho en un chat abre su menú en el puntero, con exportar, info y teclado', async ({ page, request }, info) => {
  const errors = watchErrors(page);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  const tag = uid();
  const n = await fakeNumber(request, `Menú ${tag}`);
  const name = `Lmenu ${tag}`;
  await linesInbound(request, n.webhookUrl, name);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('[data-chat-row]', { hasText: name });
  // En `next dev` la primera carga compila la ruta (lenta en una máquina cargada).
  await expect(row).toBeVisible({ timeout: 90_000 });

  const at = await rightClick(page, row);
  const box = (await menu(page).boundingBox())!;
  expect(Math.abs(box.x - at.x)).toBeLessThanOrEqual(2);
  const labels = await menu(page).getByRole('menuitem').allTextContents();
  expect(labels[0]).toBe('Open in new window');
  for (const l of ['Archive chat', 'Mute notifications', 'Contact info', 'Export chat', 'Delete chat']) expect(labels).toContain(l);
  await expect(page).toHaveURL(/\/app\/lines\/inbox(\?|$)/);
  await page.screenshot({ path: info.outputPath('lines-menu-1280-light.png') });

  // Exportar baja el CSV de ese chat.
  const [download] = await Promise.all([page.waitForEvent('download'), menu(page).getByRole('menuitem', { name: 'Export chat' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);

  // Silenciar desde el menú.
  await rightClick(page, row);
  await menu(page).getByRole('menuitem', { name: 'Mute notifications' }).click();
  // La primera acción sobre el chat compila su ruta en `next dev`.
  await expect(row).toHaveClass(/is-muted/, { timeout: 30_000 });
  await rightClick(page, row);
  await menu(page).getByRole('menuitem', { name: 'Unmute notifications' }).click();
  await expect(row).not.toHaveClass(/is-muted/, { timeout: 30_000 });

  // Teclado: Shift+F10 en la fila, Esc devuelve el foco.
  await row.getByRole('link').first().focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(row.getByRole('link').first()).toBeFocused();

  // Info del contacto: abre el chat con los detalles a la vista.
  await rightClick(page, row);
  await menu(page).getByRole('menuitem', { name: 'Contact info' }).click();
  await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?]+/, { timeout: 90_000 });
  await expect(page.locator('.gr-details-toggle')).toHaveAttribute('aria-expanded', 'true');

  // Borrar pide confirmación.
  await rightClick(page, row);
  await menu(page).getByRole('menuitem', { name: 'Delete chat' }).click();
  await expect(page.getByRole('dialog').or(page.getByRole('alertdialog'))).toBeVisible();
  await page.keyboard.press('Escape');

  // Teléfono y oscuro: dentro de la ventana.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await expect(row).toBeVisible();
  await rightClick(page, row, 'corner');
  await insideViewport(page, menu(page));
  await page.screenshot({ path: info.outputPath('lines-menu-390.png') });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: el borrador aparece en la fila del chat que se deja al instante, y borrarlo lo saca', async ({ page, request }) => {
  const errors = watchErrors(page);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  const tag = uid();
  const n = await fakeNumber(request, `Borr ${tag}`);
  const a = `Lbor ${tag}`;
  const b = `Lnext ${tag}`;
  await linesInbound(request, n.webhookUrl, b);
  await linesInbound(request, n.webhookUrl, a);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const rowA = page.locator('[data-chat-row]', { hasText: a });
  const rowB = page.locator('[data-chat-row]', { hasText: b });
  await rowA.getByRole('link').first().click({ timeout: 90_000 });
  await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?]+/, { timeout: 90_000 });
  const field = page.locator('textarea.wa-input');
  await field.fill('te mando el presupuesto');

  // Al hacer clic en otro chat, la fila del que se deja muestra el borrador ya (sin esperar a que el otro abra).
  await rowB.getByRole('link').first().click();
  await expect(rowA.locator('.gr-row-draft')).toBeVisible({ timeout: 300 });
  await expect(rowA).toContainText('te mando el presupuesto');
  const hrefB = (await rowB.getByRole('link').first().getAttribute('href'))!;
  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/^\/en/, '')}`), { timeout: 90_000 });

  // Volver: el campo lo trae, la fila (la abierta) ya no lo muestra. Borrarlo y salir: la fila queda sin borrador.
  await rowA.getByRole('link').first().click();
  await expect(rowA.locator('.gr-row-draft')).toHaveCount(0, { timeout: 300 });
  await expect(field).toHaveValue('te mando el presupuesto');
  await field.fill('');
  await rowB.getByRole('link').first().click();
  await expect(rowA.locator('.gr-row-draft')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(rowA.locator('.gr-row-draft')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
