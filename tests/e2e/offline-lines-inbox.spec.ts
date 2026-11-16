import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test';

/**
 * Lines e Inbox sin conexión (como WhatsApp): un texto escrito sin red queda en el chat con el reloj ("en cola"),
 * sobrevive a recargar, se puede borrar antes de que salga y sale solo al volver la red, en orden y una sola vez
 * (también con dos pestañas abiertas). Si el servidor lo rechaza, queda como no enviado con reintentar. Los archivos
 * necesitan conexión. Contra el WhatsApp falso (GROUPS_FAKE=1); nombres y números inventados.
 *
 * La caída de la red se simula con context.setOffline(true). Recargar sin red necesita el service worker (build de
 * producción en CI, o NEXT_PUBLIC_SW_DEV=1 con E2E_SW=1 local).
 */

const SHOTS = process.env.E2E_SHOTS_DIR;
const uid = () => Math.random().toString(36).slice(2, 8);
const OPEN_MS = 90_000;
const withSw = Boolean(process.env.CI || process.env.E2E_SW);

test.describe.configure({ timeout: 240_000 });

/** Los POST de envío de mensajes de las pestañas, con su clientId. */
function watchSends(pages: Page[], path: RegExp): Array<{ body: string; clientId: string }> {
  const sends: Array<{ body: string; clientId: string }> = [];
  const onRequest = (r: Request) => {
    if (r.method() !== 'POST' || !path.test(new URL(r.url()).pathname)) return;
    const data = (r.postDataJSON() ?? {}) as { body?: string; clientId?: string };
    sends.push({ body: String(data.body ?? ''), clientId: String(data.clientId ?? '') });
  };
  for (const p of pages) p.on('request', onRequest);
  return sends;
}

const bubble = (page: Page, text: string): Locator => page.getByTestId('wa-message').filter({ hasText: text });

/** Espera a que el service worker controle la página y tenga guardada la vista actual. */
async function cacheCurrentView(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload({ waitUntil: 'networkidle' });
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          for (const name of await caches.keys()) {
            if (!name.includes('-pages-')) continue;
            if (await (await caches.open(name)).match(location.href)) return true;
          }
          return false;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Sin scroll lateral en el ancho actual. */
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

// ---------------------------------------------------------------- Lines

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Offline ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

const linesDm = () => `549${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}@c.us`;

async function linesInbound(request: APIRequestContext, n: NumberInfo, chatId: string, body: string, senderName: string) {
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName, providerMessageId: `of-${uid()}`, body, timestamp: new Date().toISOString() }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function openLinesChat(page: Page, name: string) {
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: name }).click({ timeout: OPEN_MS });
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: OPEN_MS });
  await expect(linesComposer(page)).toBeVisible({ timeout: OPEN_MS });
  await page.waitForLoadState('networkidle');
}

const linesComposer = (page: Page) => page.getByRole('textbox', { name: 'WhatsApp', exact: true });
const LINES_SEND = /^\/api\/groups\/chats\/[^/]+\/messages$/;

async function lineChat(request: APIRequestContext): Promise<string> {
  const n = await fakeNumber(request);
  const name = `Vera${uid()}`;
  await linesInbound(request, n, linesDm(), 'hola', name);
  return name;
}

test.describe('Lines sin conexión', () => {
  test('sin red: dos textos en cola, uno se borra antes de salir; al volver la red salen en orden y una vez, también con otra pestaña abierta', async ({ page, context, request }) => {
    const name = await lineChat(request);
    await openLinesChat(page, name);
    // Otra pestaña con el mismo chat.
    const other = await context.newPage();
    await openLinesChat(other, name);
    const sends = watchSends([page, other], LINES_SEND);

    await context.setOffline(true);
    const one = `uno ${uid()}`;
    const drop = `borrar ${uid()}`;
    const two = `dos ${uid()}`;
    for (const text of [one, drop, two]) {
      await linesComposer(page).fill(text);
      await linesComposer(page).press('Enter');
      await expect(bubble(page, text)).toHaveAttribute('data-status', 'queued');
    }
    await expect(bubble(page, one).locator('.wa-ticks.is-queued')).toBeVisible();
    // La otra pestaña también los ve en cola.
    await expect(bubble(other, two)).toHaveAttribute('data-status', 'queued');
    // Sin red los textos no piden nada al servidor.
    expect(sends).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-lines-queued.png` });

    // Borrar uno antes de que salga: menú de la burbuja (clic derecho), Esc lo cierra y un clic afuera también.
    await bubble(page, drop).click({ button: 'right' });
    await expect(page.getByTestId('menu-remove')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-remove')).toHaveCount(0);
    await bubble(page, drop).click({ button: 'right' });
    await expect(page.getByTestId('menu-remove')).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.getByTestId('menu-remove')).toHaveCount(0);
    await bubble(page, drop).click({ button: 'right' });
    await page.getByTestId('menu-remove').click();
    await expect(bubble(page, drop)).toHaveCount(0);
    await expect(bubble(other, drop)).toHaveCount(0);

    // Vuelve la red: salen solos, en orden, una vez cada uno (entre las dos pestañas).
    await context.setOffline(false);
    await expect(bubble(page, one)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
    await expect(bubble(page, two)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
    await expect(bubble(page, two)).not.toHaveAttribute('data-status', /queued|pending/);
    expect(sends.map((s) => s.body)).toEqual([one, two]);
    expect(new Set(sends.map((s) => s.clientId)).size).toBe(2);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(bubble(page, one)).toHaveCount(1);
    await expect(bubble(page, two)).toHaveCount(1);
    await expect(bubble(page, drop)).toHaveCount(0);
    await other.close();
  });

  test('si el servidor lo rechaza al volver la red, queda como no enviado con reintentar', async ({ page, context, request }) => {
    const name = await lineChat(request);
    await openLinesChat(page, name);
    await context.setOffline(true);
    const text = `rechazado ${uid()}`;
    await linesComposer(page).fill(text);
    await linesComposer(page).press('Enter');
    await expect(bubble(page, text)).toHaveAttribute('data-status', 'queued');
    let reject = true;
    await page.route('**/api/groups/chats/*/messages', (route) =>
      route.request().method() === 'POST' && reject ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_input' }) }) : route.continue(),
    );
    await context.setOffline(false);
    await expect(bubble(page, text)).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
    const retry = bubble(page, text).locator('.wa-retry');
    await expect(retry).toBeVisible();
    reject = false;
    await retry.click();
    await expect(bubble(page, text)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
    await page.unroute('**/api/groups/chats/*/messages');
  });

  test('recargar sin red: la bandeja y el chat abren, los textos en cola siguen ahí y salen al volver la red', async ({ page, context, request }) => {
    test.skip(!withSw, 'Recargar sin red necesita el service worker (CI=1, o E2E_SW=1 con NEXT_PUBLIC_SW_DEV=1).');
    const name = await lineChat(request);
    await openLinesChat(page, name);
    await cacheCurrentView(page);
    const sends = watchSends([page], LINES_SEND);

    await context.setOffline(true);
    const one = `uno ${uid()}`;
    const two = `dos ${uid()}`;
    for (const text of [one, two]) {
      await linesComposer(page).fill(text);
      await linesComposer(page).press('Enter');
      await expect(bubble(page, text)).toHaveAttribute('data-status', 'queued');
    }
    await page.reload();
    // Nada de "necesita conexión" a pantalla completa: el chat abre con lo guardado.
    await expect(page.locator('main[data-zs-offline]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 30_000 });
    await expect(bubble(page, one)).toHaveAttribute('data-status', 'queued');
    await expect(bubble(page, two)).toHaveAttribute('data-status', 'queued');
    await expect(page.getByTestId('offline-status')).toBeVisible({ timeout: 20_000 });
    await noSideScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-lines-reload.png` });

    await context.setOffline(false);
    await expect(bubble(page, two)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
    await expect(bubble(page, one)).not.toHaveAttribute('data-unsent', 'true');
    expect(sends.map((s) => s.body)).toEqual([one, two]);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(bubble(page, one)).toHaveCount(1);
    await expect(bubble(page, two)).toHaveCount(1);
    const texts = await page.getByTestId('wa-message').allInnerTexts();
    expect(texts.findIndex((t) => t.includes(one))).toBeLessThan(texts.findIndex((t) => t.includes(two)));
  });
});

// ---------------------------------------------------------------- Inbox

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
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

const inboxDm = () => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}2@s.whatsapp.net`;

async function inboxChat(request: APIRequestContext): Promise<string> {
  const acc = await linkWhatsapp(request);
  const name = `Ana ${uid()}`;
  const chatId = inboxDm();
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: name, providerMessageId: `of-${uid()}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok()).toBe(true);
  return name;
}

const inboxComposer = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const INBOX_SEND = /^\/api\/inbox\/threads\/[^/]+\/messages$/;

async function openInboxChat(page: Page, name: string) {
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click({ timeout: OPEN_MS });
  await expect(inboxComposer(page)).toBeVisible({ timeout: OPEN_MS });
  await page.waitForLoadState('networkidle');
}

test.describe('Inbox sin conexión', () => {
  test('sin red: dos textos en cola, uno se borra antes de salir; al volver la red salen en orden y una vez, también con otra pestaña abierta', async ({ page, context, request }) => {
    const name = await inboxChat(request);
    await openInboxChat(page, name);
    const other = await context.newPage();
    await openInboxChat(other, name);
    const sends = watchSends([page, other], INBOX_SEND);

    await context.setOffline(true);
    const one = `uno ${uid()}`;
    const drop = `borrar ${uid()}`;
    const two = `dos ${uid()}`;
    for (const text of [one, drop, two]) {
      await inboxComposer(page).fill(text);
      await inboxComposer(page).press('Enter');
      await expect(bubble(page, text)).toHaveAttribute('data-status', 'queued');
    }
    await expect(bubble(page, one).locator('.wa-ticks.is-queued')).toBeVisible();
    await expect(bubble(other, two)).toHaveAttribute('data-status', 'queued');
    expect(sends).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-inbox-queued.png` });

    await bubble(page, drop).click({ button: 'right' });
    await expect(page.getByTestId('menu-remove')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu-remove')).toHaveCount(0);
    await bubble(page, drop).click({ button: 'right' });
    await expect(page.getByTestId('menu-remove')).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.getByTestId('menu-remove')).toHaveCount(0);
    await bubble(page, drop).click({ button: 'right' });
    await page.getByTestId('menu-remove').click();
    await expect(bubble(page, drop)).toHaveCount(0);
    await expect(bubble(other, drop)).toHaveCount(0);

    await context.setOffline(false);
    await expect(bubble(page, one)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
    await expect(bubble(page, two)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
    await expect(bubble(page, two)).not.toHaveAttribute('data-status', /queued|pending/);
    expect(sends.map((s) => s.body)).toEqual([one, two]);
    expect(new Set(sends.map((s) => s.clientId)).size).toBe(2);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click({ timeout: OPEN_MS });
    await expect(bubble(page, one)).toHaveCount(1);
    await expect(bubble(page, two)).toHaveCount(1);
    await expect(bubble(page, drop)).toHaveCount(0);
    await other.close();
  });

  test('si el servidor lo rechaza al volver la red, queda como no enviado con reintentar', async ({ page, context, request }) => {
    const name = await inboxChat(request);
    await openInboxChat(page, name);
    await context.setOffline(true);
    const text = `rechazado ${uid()}`;
    await inboxComposer(page).fill(text);
    await inboxComposer(page).press('Enter');
    await expect(bubble(page, text)).toHaveAttribute('data-status', 'queued');
    let reject = true;
    await page.route('**/api/inbox/threads/*/messages', (route) =>
      route.request().method() === 'POST' && reject ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_input' }) }) : route.continue(),
    );
    await context.setOffline(false);
    await expect(bubble(page, text)).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
    const retry = bubble(page, text).locator('.wa-retry');
    await expect(retry).toBeVisible();
    reject = false;
    await retry.click();
    await expect(bubble(page, text)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
    await page.unroute('**/api/inbox/threads/*/messages');
  });

  test('recargar sin red: Inbox abre el chat, los textos en cola siguen ahí y salen al volver la red', async ({ page, context, request }) => {
    test.skip(!withSw, 'Recargar sin red necesita el service worker (CI=1, o E2E_SW=1 con NEXT_PUBLIC_SW_DEV=1).');
    const name = await inboxChat(request);
    await openInboxChat(page, name);
    await cacheCurrentView(page);
    // La vista guardada abre con el chat elegido (?t=...): se vuelve a elegir si no quedó abierto.
    if (!(await inboxComposer(page).isVisible())) await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
    await expect(inboxComposer(page)).toBeVisible();
    const sends = watchSends([page], INBOX_SEND);

    await context.setOffline(true);
    const one = `uno ${uid()}`;
    const two = `dos ${uid()}`;
    for (const text of [one, two]) {
      await inboxComposer(page).fill(text);
      await inboxComposer(page).press('Enter');
      await expect(bubble(page, text)).toHaveAttribute('data-status', 'queued');
    }
    await page.reload();
    await expect(page.locator('main[data-zs-offline]')).toHaveCount(0);
    if (!(await inboxComposer(page).isVisible())) await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click({ timeout: 30_000 });
    await expect(bubble(page, one)).toHaveAttribute('data-status', 'queued', { timeout: 30_000 });
    await expect(bubble(page, two)).toHaveAttribute('data-status', 'queued');
    await expect(page.getByTestId('offline-status')).toBeVisible({ timeout: 20_000 });
    await noSideScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-inbox-reload.png` });

    await context.setOffline(false);
    await expect(bubble(page, two)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
    await expect(bubble(page, one)).not.toHaveAttribute('data-unsent', 'true');
    expect(sends.map((s) => s.body)).toEqual([one, two]);
  });
});

// ---------------------------------------------------------------- Mobile y archivos

test.describe('390 de ancho', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Lines: la cola sin red se ve bien y sin scroll lateral', async ({ page, context, request }) => {
    const name = await lineChat(request);
    await openLinesChat(page, name);
    await context.setOffline(true);
    const text = `en cola ${uid()}`;
    await linesComposer(page).fill(text);
    await linesComposer(page).press('Enter');
    await expect(bubble(page, text)).toHaveAttribute('data-status', 'queued');
    await noSideScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-lines-390.png` });
    await context.setOffline(false);
    await expect(bubble(page, text)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
  });

  test('Inbox: la cola sin red se ve bien y sin scroll lateral', async ({ page, context, request }) => {
    const name = await inboxChat(request);
    await openInboxChat(page, name);
    await context.setOffline(true);
    const text = `en cola ${uid()}`;
    await inboxComposer(page).fill(text);
    await inboxComposer(page).press('Enter');
    await expect(bubble(page, text)).toHaveAttribute('data-status', 'queued');
    await noSideScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-inbox-390.png` });
    await context.setOffline(false);
    await expect(bubble(page, text)).not.toHaveAttribute('data-unsent', 'true', { timeout: 30_000 });
  });
});

