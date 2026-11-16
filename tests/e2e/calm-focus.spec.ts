import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Foco tranquilo en Inbox y Lines (lib/kbd-nav.ts, styles/calm-focus.css).
 *
 * El navegador prende :focus-visible en lo último que se tocó con el mouse apenas se aprieta una tecla:
 * quedaba un recuadro negro alrededor de una carpeta del sidebar o de un chat mientras el teclado movía
 * la lista. Acá: un clic nunca deja un recuadro, el cursor de j/k es un fondo de fila, y el anillo aparece
 * solo con Tab (o dentro de un diálogo abierto con un atajo). Los campos de texto conservan su borde.
 */

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

/** Todo lo que tiene un contorno visible en la página, menos los campos de texto. */
const outlined = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter((el) => {
        if (el.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable]')) return false;
        const cs = getComputedStyle(el);
        return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className)}`),
  );

/** El contorno del elemento con foco. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      text: el.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable]'),
      style: cs.outlineStyle,
      width: parseFloat(cs.outlineWidth),
      color: cs.outlineColor,
      ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
      mode: document.documentElement.getAttribute('data-kbd-nav'),
    };
  });

/** Tab hasta caer en un control que no sea un campo de texto; devuelve su contorno. */
async function tabToControl(page: Page) {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f.tag !== 'body' && !f.text) return f;
  }
  throw new Error('Tab no llegó a ningún control');
}

/** El anillo de teclado: visible, fino y nunca el negro del texto. */
function expectRing(f: Awaited<ReturnType<typeof focused>>) {
  expect(f.mode).toBe('1');
  expect(f.style).toBe('solid');
  expect(f.width).toBeGreaterThanOrEqual(1.5);
  expect(f.width).toBeLessThanOrEqual(2);
  expect(f.color).not.toBe('rgb(13, 13, 13)');
  expect(f.color).not.toBe('rgb(0, 0, 0)');
}

async function inboxWithChats(request: APIRequestContext, tag: string): Promise<{ folderName: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const names = [`Chat uno ${tag}`, `Chat dos ${tag}`, `Chat tres ${tag}`];
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
    data: {
      events: names.map((name) => {
        const p = phone();
        return { type: 'message', chatId: `${p}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: p, senderName: name, providerMessageId: `cf-${uid()}`, body: 'Mensaje de prueba', timestamp: new Date().toISOString() };
      }),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const folderName = `Carpeta ${tag}`;
  const folder = ((await (await request.post('/api/inbox/folders', { data: { name: folderName } })).json()) as { folder: { id: string } }).folder;
  const found = (await (await request.get(`/api/inbox/threads?q=${encodeURIComponent(tag)}`)).json()) as { threads: Array<{ id: string }> };
  expect(found.threads.length).toBe(3);
  const added = await request.post('/api/inbox/threads', { data: { ids: found.threads.map((t) => t.id), action: 'addFolder', folderId: folder.id } });
  expect(added.ok(), await added.text()).toBe(true);
  return { folderName };
}

async function linesWithChats(request: APIRequestContext, tag: string): Promise<{ folderName: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Linea ${tag}` } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const names = [`Chat uno ${tag}`, `Chat dos ${tag}`, `Chat tres ${tag}`];
  const res = await request.post(new URL(info.webhookUrl).pathname, {
    data: {
      events: names.map((name, i) => ({
        type: 'message',
        chatId: `54911${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}${String(i).padStart(2, '0')}@c.us`,
        isGroup: false,
        fromMe: false,
        senderPhone: '5491155550000',
        senderName: name,
        providerMessageId: `cf-${uid()}-${i}`,
        body: 'Mensaje de prueba',
      })),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const folderName = `Carpeta ${tag}`;
  const folder = (await (await request.post('/api/groups/folders', { data: { name: folderName } })).json()) as { id: string };
  const chats = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(tag)}`)).json()) as { rows: Array<{ id: string }> };
  expect(chats.rows.length).toBe(3);
  const moved = await request.post('/api/groups/chats/bulk', { data: { ids: chats.rows.map((c) => c.id), action: 'folder', folderId: folder.id } });
  expect(moved.ok(), await moved.text()).toBe(true);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  return { folderName };
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.describe('Inbox', () => {
  test('clic en una carpeta y después una letra y una flecha: ningún recuadro, la carpeta queda con fondo', async ({ page, request }) => {
    const { folderName } = await inboxWithChats(request, uid());
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const link = page.locator('#side-branch').getByRole('link', { name: folderName });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
    await expect(page.locator('.ib-item')).toHaveCount(3, { timeout: 20_000 });

    const before = Number(await page.locator('.ib-item.is-cursor').getAttribute('data-idx'));
    await page.keyboard.press('j');
    await page.keyboard.press('ArrowDown');
    expect(await outlined(page)).toEqual([]);
    // El foco no quedó en la carpeta: el teclado maneja la lista.
    expect(await link.evaluate((el) => el === document.activeElement)).toBe(false);
    await expect(page.locator('.ib-item.is-cursor')).toHaveAttribute('data-idx', String(Math.min(before + 2, 2)));
    // "Actual" es solo un fondo.
    const row = page.locator('#side-branch .docs-tree-row.active');
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    // El cursor del teclado: fondo de fila y una marca al costado, sin contorno.
    const cursor = page.locator('.ib-item.is-cursor .ib-row-btn');
    expect(await cursor.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await cursor.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');

    // Un atajo de una letra tampoco prende nada.
    await page.keyboard.press('g');
    expect(await outlined(page)).toEqual([]);
    expect((await focused(page)).mode).toBe('0');
    // Con el mouse la marca del cursor se va.
    await page.locator('.ib-list-pane h1').click();
    expect(await cursor.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
  });

  test('clic en un chat y j/k: el cursor se mueve con un fondo de fila, sin recuadro', async ({ page, request }) => {
    const { folderName } = await inboxWithChats(request, uid());
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('#side-branch').getByRole('link', { name: folderName }).click();
    await expect(page.locator('.ib-item')).toHaveCount(3, { timeout: 20_000 });
    await page.locator('.ib-item .ib-row-btn').first().click();
    const field = page.getByRole('textbox', { name: 'Message' });
    await expect(field).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.ib-item.is-cursor')).toHaveAttribute('data-idx', '0');
    // Abrir el chat lleva el foco al campo del mensaje; Esc lo suelta y el teclado vuelve a la lista.
    await page.locator('.ib-list-pane h1').click();

    await page.keyboard.press('j');
    await expect(page.locator('.ib-item.is-cursor')).toHaveAttribute('data-idx', '1');
    expect(await outlined(page)).toEqual([]);
    const cursorBg = await page.locator('.ib-item.is-cursor .ib-row-btn').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cursorBg).not.toBe('rgba(0, 0, 0, 0)');
    await page.keyboard.press('k');
    await expect(page.locator('.ib-item.is-cursor')).toHaveAttribute('data-idx', '0');
    expect(await outlined(page)).toEqual([]);

    // Un control que conserva el foco tras el clic (la casilla de una fila): una tecla no le dibuja un recuadro.
    const check = page.locator('.ib-item').nth(2).locator('.ib-check');
    await page.locator('.ib-item').nth(2).hover();
    await check.click();
    await page.keyboard.press('g');
    expect(await check.evaluate((el) => el === document.activeElement && el.matches(':focus-visible'))).toBe(true);
    expect(await outlined(page)).toEqual([]);
  });

  test('Tab muestra un anillo fino en el control enfocado; un clic lo apaga; el campo del mensaje conserva su borde', async ({ page, request }) => {
    const { folderName } = await inboxWithChats(request, uid());
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('#side-branch').getByRole('link', { name: folderName }).click();
    await expect(page.locator('.ib-item')).toHaveCount(3, { timeout: 20_000 });

    // Tab sigue desde la carpeta que se tocó, y ahí sí se ve dónde está el foco.
    expectRing(await tabToControl(page));
    expect((await outlined(page)).length).toBe(1);
    expectRing(await tabToControl(page));

    // Un clic vuelve al mouse: sin anillos.
    await page.locator('.ib-item .ib-row-btn').first().click();
    const field = page.getByRole('textbox', { name: 'Message' });
    await expect(field).toBeVisible({ timeout: 20_000 });
    expect((await focused(page)).mode).toBe('0');
    expect(await outlined(page)).toEqual([]);

    // Escribir: el campo se ve enfocado (su borde), y nada más.
    await field.click();
    await field.pressSequentially('hola');
    expect(await field.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    expect(await outlined(page)).toEqual([]);
  });

  test('un atajo abre un diálogo con el foco visible adentro; Tab no sale del diálogo; Esc vuelve a la lista sin recuadro', async ({ page, request }) => {
    const { folderName } = await inboxWithChats(request, uid());
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('#side-branch').getByRole('link', { name: folderName }).click();
    await expect(page.locator('.ib-item')).toHaveCount(3, { timeout: 20_000 });
    await page.keyboard.press('j');
    await page.keyboard.press('h');
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    // El foco entró al diálogo por un atajo: se ve, sin haber apretado Tab.
    await expect.poll(async () => page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
    expectRing(await focused(page));
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // De vuelta en la lista, el teclado la sigue moviendo sin recuadros.
    await page.keyboard.press('k');
    expect(await outlined(page)).toEqual([]);
  });

  test('un diálogo abierto con un atajo y cerrado con Esc, sin Tab: los anillos se apagan al volver', async ({ page, request }) => {
    const { folderName } = await inboxWithChats(request, uid());
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('#side-branch').getByRole('link', { name: folderName }).click();
    await expect(page.locator('.ib-item')).toHaveCount(3, { timeout: 20_000 });
    await page.keyboard.press('j');
    await page.keyboard.press('h');
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await focused(page)).mode).toBe('1');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('k');
    expect((await focused(page)).mode).toBe('0');
    expect(await outlined(page)).toEqual([]);
  });
});

test.describe('Lines', () => {
  test('clic en una carpeta y después una letra y una flecha: ningún recuadro', async ({ page, request }) => {
    const tag = uid();
    const { folderName } = await linesWithChats(request, tag);
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    // Con un chat abierto, como en el reporte: después se toca la carpeta y el teclado sigue en la lista.
    await page.locator('.gr-row', { hasText: `Chat dos ${tag}` }).first().click();
    await expect(page.locator('textarea.wa-input')).toBeVisible({ timeout: 20_000 });
    const opened = new URL(page.url()).pathname;
    const link = page.locator('#side-branch').getByTestId('lines-folder').filter({ hasText: folderName });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
    await expect(page.locator('.gr-row')).toHaveCount(3, { timeout: 20_000 });

    await page.keyboard.press('j');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).not.toBe(opened);
    await page.keyboard.press('ArrowDown');
    expect(await outlined(page)).toEqual([]);
    expect(await link.evaluate((el) => el === document.activeElement)).toBe(false);
    const row = page.locator('#side-branch .docs-tree-row.active');
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('clic en un chat y j/k: pasa al chat siguiente y al anterior, sin recuadro', async ({ page, request }) => {
    const { folderName } = await linesWithChats(request, uid());
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('#side-branch').getByTestId('lines-folder').filter({ hasText: folderName }).click();
    await expect(page.locator('.gr-row')).toHaveCount(3, { timeout: 20_000 });
    const rows = page.locator('.gr-row');
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
    await expect(page.locator('textarea.wa-input')).toBeVisible({ timeout: 20_000 });
    // El foco no quedó en la fila: Enter no vuelve a abrirla.
    expect(await rows.nth(0).evaluate((el) => el === document.activeElement)).toBe(false);
    // Abrir el chat lleva el foco al campo del mensaje; un clic en los mensajes devuelve el teclado a los atajos.
    await page.locator('.gr-messages').click({ position: { x: 300, y: 300 } });

    await page.keyboard.press('j');
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
    expect(await outlined(page)).toEqual([]);
    await page.keyboard.press('k');
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
    expect(await outlined(page)).toEqual([]);
    expect(await rows.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');

    // Un control que conserva el foco tras el clic (el botón de seleccionar, arriba de la lista): una tecla no le dibuja un recuadro.
    const selectBtn = page.locator('.wa-filter-btn[aria-pressed]');
    await selectBtn.click();
    await expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('g');
    expect(await selectBtn.evaluate((el) => el === document.activeElement && el.matches(':focus-visible'))).toBe(true);
    expect(await outlined(page)).toEqual([]);
  });

  test('Tab muestra un anillo fino en el control enfocado; un clic lo apaga; el campo del mensaje conserva su borde', async ({ page, request }) => {
    const { folderName } = await linesWithChats(request, uid());
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('#side-branch').getByTestId('lines-folder').filter({ hasText: folderName }).click();
    await expect(page.locator('.gr-row')).toHaveCount(3, { timeout: 20_000 });

    expectRing(await tabToControl(page));
    expect((await outlined(page)).length).toBe(1);
    expectRing(await tabToControl(page));

    await page.locator('.gr-row').first().click();
    const field = page.locator('textarea.wa-input');
    await expect(field).toBeVisible({ timeout: 20_000 });
    expect((await focused(page)).mode).toBe('0');
    expect(await outlined(page)).toEqual([]);

    await field.click();
    await field.pressSequentially('hola');
    expect(await field.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    expect(await outlined(page)).toEqual([]);
  });
});
