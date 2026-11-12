import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/**
 * Lines e Inbox: recibir y mandar por WhatsApp sin demoras, con el WhatsApp
 * falso (GROUPS_FAKE=1). El mensaje que llega aparece en el chat abierto por
 * el aviso en vivo (stream, o consulta de respaldo), y el que se manda aparece
 * al apretar Enter, sin esperar al servidor. Nombres y números inventados.
 *
 * El stream está apagado salvo que WA_LIVE_WORKSPACES lo prenda (un stream abierto no deja llegar a
 * "networkidle"); las pruebas del stream lo piden con la cookie wa_live=sse.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Con stream: del webhook a la burbuja. Holgado para un runner cargado; antes de este cambio el piso eran 3 a 4 s. */
const STREAM_BOUND_MS = 2000;
/** Sin stream (consulta cada 3 s y la relectura). */
const POLL_BOUND_MS = 5500;
/** La burbuja de lo que mando, con la respuesta del servidor demorada a propósito. */
const OPTIMISTIC_BOUND_MS = 700;
const SERVER_DELAY_MS = 2500;
/** Abrir la app y el chat (con `next dev` cada pantalla se compila la primera vez): fuera de lo que se mide. */
const OPEN_MS = 90_000;

test.describe.configure({ timeout: 240_000 });

/** Deja la medición en el reporte y en el log de la corrida (así se lee también en CI). */
function note(what: string, value: string) {
  test.info().annotations.push({ type: what, description: value });
  // eslint-disable-next-line no-console
  console.log(`[wa-speed] ${test.info().titlePath.slice(1).join(' › ')} · ${what}: ${value}`);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function useStream(context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([{ name: 'wa_live', value: 'sse', url: baseURL ?? 'http://localhost:3000' }]);
}

/** Espera a que la conexión del aviso esté abierta (el stream respondió). */
async function streamOpen(page: Page, app: 'groups' | 'inbox') {
  await page.waitForResponse((res) => res.url().includes(`/api/${app}/live`) && res.status() === 200 && (res.headers()['content-type'] ?? '').includes('text/event-stream'), { timeout: OPEN_MS });
}

// ---------------------------------------------------------------- Lines

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Speed ${uid()}` } });
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
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName, providerMessageId: `sp-${uid()}`, body, timestamp: new Date().toISOString() }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function openLinesChat(page: Page, name: string, wait: 'networkidle' | 'domcontentloaded') {
  await page.goto('/en/app/lines/inbox', { waitUntil: wait });
  await page.locator('.gr-row', { hasText: name }).click({ timeout: OPEN_MS });
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: OPEN_MS });
  await expect(page.getByLabel('WhatsApp', { exact: true })).toBeVisible({ timeout: OPEN_MS });
}

test.describe('Lines', () => {
  test('sin stream, llega igual por la consulta de respaldo', async ({ page, request }) => {
    const n = await fakeNumber(request);
    const name = `Vera${uid()}`;
    const chat = linesDm();
    await linesInbound(request, n, chat, 'primer mensaje', name);
    await openLinesChat(page, name, 'networkidle');
    // El stream está apagado (204): la pantalla pasa a consultar el aviso.
    await page.waitForResponse((res) => res.url().includes('/api/groups/live') && res.status() === 200 && (res.headers()['content-type'] ?? '').includes('json'), { timeout: OPEN_MS });
    await linesInbound(request, n, chat, 'calentamiento', name);
    await expect(page.locator('.gr-msg-in', { hasText: 'calentamiento' })).toBeVisible({ timeout: OPEN_MS });
    await sleep(500);
    const text = `por consulta ${uid()}`;
    const t0 = Date.now();
    await linesInbound(request, n, chat, text, name);
    await expect(page.locator('.gr-msg-in', { hasText: text })).toBeVisible({ timeout: POLL_BOUND_MS });
    note('webhook→burbuja (consulta) ms', String(Date.now() - t0));
  });

  test('lo que mando aparece al apretar Enter, aunque el servidor tarde; dos seguidos salen en orden', async ({ page, request }) => {
    const errors = watchErrors(page);
    const n = await fakeNumber(request);
    const name = `Vera${uid()}`;
    await linesInbound(request, n, linesDm(), 'hola', name);
    await openLinesChat(page, name, 'networkidle');
    // El servidor tarda 2,5 s en cada envío: la burbuja no puede depender de su respuesta.
    const posts: string[] = [];
    await page.route('**/api/groups/chats/*/messages', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts.push(String((route.request().postDataJSON() as { body?: string }).body));
      await sleep(SERVER_DELAY_MS);
      await route.continue();
    });
    const composer = page.getByLabel('WhatsApp', { exact: true });
    const one = `uno ${uid()}`;
    const two = `dos ${uid()}`;
    await composer.fill(one);
    const t0 = Date.now();
    await composer.press('Enter');
    const first = page.locator('.gr-msg-out', { hasText: one });
    await expect(first).toBeVisible({ timeout: OPTIMISTIC_BOUND_MS });
    const shownIn = Date.now() - t0;
    note('Enter→burbuja ms', String(shownIn));
    expect(shownIn).toBeLessThan(OPTIMISTIC_BOUND_MS);
    // Sale con el reloj de "enviando" y el campo queda libre para el próximo, sin esperar.
    await expect(first.locator('.wa-ticks')).toContainText('Sending');
    await expect(composer).toHaveValue('');
    await composer.fill(two);
    await composer.press('Enter');
    await expect(page.locator('.gr-msg-out', { hasText: two })).toBeVisible({ timeout: OPTIMISTIC_BOUND_MS });
    // Cuando el servidor responde quedan enviados, una vez cada uno y en el orden en que se escribieron.
    await expect(first.locator('.wa-ticks')).not.toContainText('Sending', { timeout: 10_000 });
    await expect(page.locator('.gr-msg-out', { hasText: two }).locator('.wa-ticks')).not.toContainText('Sending', { timeout: 10_000 });
    expect(posts).toEqual([one, two]);
    await expect(page.locator('.gr-msg-out', { hasText: one })).toHaveCount(1);
    await expect(page.locator('.gr-msg-out', { hasText: two })).toHaveCount(1);
    const texts = await page.locator('.gr-msg-out').allInnerTexts();
    expect(texts.findIndex((t) => t.includes(one))).toBeLessThan(texts.findIndex((t) => t.includes(two)));
    // Y siguen ahí al recargar (están guardados de verdad).
    await page.unroute('**/api/groups/chats/*/messages');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.gr-msg-out', { hasText: one })).toHaveCount(1);
    await expect(page.locator('.gr-msg-out', { hasText: two })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('si el envío no sale, la burbuja queda como no enviada y se puede reintentar sin duplicar', async ({ page, request }) => {
    const n = await fakeNumber(request);
    const name = `Vera${uid()}`;
    await linesInbound(request, n, linesDm(), 'hola', name);
    await openLinesChat(page, name, 'networkidle');
    let fail = true;
    await page.route('**/api/groups/chats/*/messages', async (route) => {
      if (route.request().method() === 'POST' && fail) return route.abort('failed');
      return route.continue();
    });
    const composer = page.getByLabel('WhatsApp', { exact: true });
    const text = `sin red ${uid()}`;
    await composer.fill(text);
    await composer.press('Enter');
    const bubble = page.locator('.gr-msg-out', { hasText: text });
    await expect(bubble.locator('.wa-ticks.is-failed')).toBeVisible();
    await expect(bubble).toHaveCount(1);
    // Vuelve la red: reintentar desde la burbuja la manda (una sola vez).
    fail = false;
    await bubble.locator('.wa-retry').click();
    await expect(bubble.locator('.wa-ticks.is-failed')).toHaveCount(0, { timeout: 10_000 });
    await expect(bubble.locator('.wa-ticks')).not.toContainText('Sending', { timeout: 10_000 });
    await expect(bubble).toHaveCount(1);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.gr-msg-out', { hasText: text })).toHaveCount(1);
  });

  test('con el stream, el mensaje que llega aparece en el chat abierto en menos de 2 s', async ({ page, request, context, baseURL }) => {
    const errors = watchErrors(page);
    await useStream(context, baseURL);
    const n = await fakeNumber(request);
    const name = `Vera${uid()}`;
    const chat = linesDm();
    await linesInbound(request, n, chat, 'primer mensaje', name);
    const open = streamOpen(page, 'groups');
    await openLinesChat(page, name, 'domcontentloaded');
    await open;
    await expect(page.locator('.gr-msg-in', { hasText: 'primer mensaje' })).toBeVisible({ timeout: OPEN_MS });
    // Uno de calentamiento, sin medir: la primera relectura del chat (y, con `next dev`, compilar su ruta).
    await linesInbound(request, n, chat, 'calentamiento', name);
    await expect(page.locator('.gr-msg-in', { hasText: 'calentamiento' })).toBeVisible({ timeout: OPEN_MS });
    await sleep(600);

    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const text = `llega ${i} ${uid()}`;
      const t0 = Date.now();
      await linesInbound(request, n, chat, text, name);
      await expect(page.locator('.gr-msg-in', { hasText: text })).toBeVisible({ timeout: STREAM_BOUND_MS });
      samples.push(Date.now() - t0);
      await sleep(300);
    }
    note('webhook→burbuja (stream) ms', samples.join(', '));
    expect(Math.max(...samples)).toBeLessThan(STREAM_BOUND_MS);
    // La lista también: la vista previa de la fila es el último.
    await expect(page.locator('.gr-row', { hasText: name })).toContainText('llega 2');
    expect(errors).toEqual([]);
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

async function inboxInbound(request: APIRequestContext, acc: { id: string; secret: string }, chatId: string, body: string, senderName: string) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName, providerMessageId: `sp-${uid()}`, body, timestamp: new Date().toISOString() }] },
  });
  expect(res.ok()).toBe(true);
}

async function openInboxChat(page: Page, name: string, wait: 'networkidle' | 'domcontentloaded') {
  await page.goto('/en/app/inbox', { waitUntil: wait });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click({ timeout: OPEN_MS });
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: OPEN_MS });
}

test.describe('Inbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('sin stream, llega igual por la consulta de respaldo', async ({ page, request }) => {
    const acc = await linkWhatsapp(request);
    const name = `Ana ${uid()}`;
    const chat = inboxDm();
    await inboxInbound(request, acc, chat, 'primer mensaje', name);
    await openInboxChat(page, name, 'networkidle');
    await page.waitForResponse((res) => res.url().includes('/api/inbox/live') && res.status() === 200 && (res.headers()['content-type'] ?? '').includes('json'), { timeout: OPEN_MS });
    await inboxInbound(request, acc, chat, 'calentamiento', name);
    await expect(page.locator('.gr-msg-in', { hasText: 'calentamiento' })).toBeVisible({ timeout: OPEN_MS });
    await sleep(500);
    const text = `por consulta ${uid()}`;
    const t0 = Date.now();
    await inboxInbound(request, acc, chat, text, name);
    await expect(page.locator('.gr-msg-in', { hasText: text })).toBeVisible({ timeout: POLL_BOUND_MS });
    note('webhook→burbuja (consulta) ms', String(Date.now() - t0));
  });

  test('lo que mando aparece al apretar Enter, aunque el servidor tarde; dos seguidos salen en orden', async ({ page, request }) => {
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const name = `Ana ${uid()}`;
    await inboxInbound(request, acc, inboxDm(), 'hola', name);
    await openInboxChat(page, name, 'networkidle');
    const posts: string[] = [];
    await page.route('**/api/inbox/threads/*/messages', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts.push(String((route.request().postDataJSON() as { body?: string }).body));
      await sleep(SERVER_DELAY_MS);
      await route.continue();
    });
    const field = page.getByRole('textbox', { name: 'Message' });
    const one = `uno ${uid()}`;
    const two = `dos ${uid()}`;
    await field.fill(one);
    const t0 = Date.now();
    await field.press('Enter');
    const first = page.locator('.gr-msg-out', { hasText: one });
    await expect(first).toBeVisible({ timeout: OPTIMISTIC_BOUND_MS });
    const shownIn = Date.now() - t0;
    note('Enter→burbuja ms', String(shownIn));
    expect(shownIn).toBeLessThan(OPTIMISTIC_BOUND_MS);
    await expect(first.locator('.wa-ticks')).toContainText('Sending');
    await expect(field).toHaveValue('');
    await field.fill(two);
    await field.press('Enter');
    await expect(page.locator('.gr-msg-out', { hasText: two })).toBeVisible({ timeout: OPTIMISTIC_BOUND_MS });
    await expect(first.locator('.wa-ticks')).not.toContainText('Sending', { timeout: 10_000 });
    await expect(page.locator('.gr-msg-out', { hasText: two }).locator('.wa-ticks')).not.toContainText('Sending', { timeout: 10_000 });
    expect(posts).toEqual([one, two]);
    await expect(page.locator('.gr-msg-out', { hasText: one })).toHaveCount(1);
    await expect(page.locator('.gr-msg-out', { hasText: two })).toHaveCount(1);
    const texts = await page.locator('.gr-msg-out').allInnerTexts();
    expect(texts.findIndex((t) => t.includes(one))).toBeLessThan(texts.findIndex((t) => t.includes(two)));
    await page.unroute('**/api/inbox/threads/*/messages');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.gr-msg-out', { hasText: one })).toHaveCount(1);
    await expect(page.locator('.gr-msg-out', { hasText: two })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('si el envío no sale, la burbuja se va, el texto vuelve al campo y se avisa', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text().slice(0, 300)}`));
    page.on('requestfinished', (r) => r.method() === 'POST' && errors.push(`POST ${new URL(r.url()).pathname}`));
    const acc = await linkWhatsapp(request);
    const name = `Ana ${uid()}`;
    await inboxInbound(request, acc, inboxDm(), 'hola', name);
    await openInboxChat(page, name, 'networkidle');
    let fail = true;
    await page.route('**/api/inbox/threads/*/messages', async (route) => {
      if (route.request().method() === 'POST' && fail) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'send_failed' }) });
      return route.continue();
    });
    const field = page.getByRole('textbox', { name: 'Message' });
    const text = `sin red ${uid()}`;
    await field.fill(text);
    await field.press('Enter');
    // No salió: nada queda como si se hubiera mandado, y el texto no se pierde.
    await expect(page.locator('.ib-toast'), errors.join(' | ')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.gr-msg-out', { hasText: text })).toHaveCount(0);
    await expect(field).toHaveValue(text);
    // Vuelve la red: Enter de nuevo lo manda, una sola vez.
    fail = false;
    await field.press('Enter');
    await expect(page.locator('.gr-msg-out', { hasText: text })).toHaveCount(1);
    await expect(page.locator('.gr-msg-out', { hasText: text }).locator('.wa-ticks')).not.toContainText('Sending', { timeout: 10_000 });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.gr-msg-out', { hasText: text })).toHaveCount(1);
  });

  test('con el stream, el mensaje que llega aparece en el chat abierto en menos de 2 s', async ({ page, request, context, baseURL }) => {
    const errors = watchErrors(page);
    await useStream(context, baseURL);
    const acc = await linkWhatsapp(request);
    const name = `Ana ${uid()}`;
    const chat = inboxDm();
    await inboxInbound(request, acc, chat, 'primer mensaje', name);
    const open = streamOpen(page, 'inbox');
    await openInboxChat(page, name, 'domcontentloaded');
    await open;
    await expect(page.locator('.gr-msg-in', { hasText: 'primer mensaje' })).toBeVisible({ timeout: OPEN_MS });
    await inboxInbound(request, acc, chat, 'calentamiento', name);
    await expect(page.locator('.gr-msg-in', { hasText: 'calentamiento' })).toBeVisible({ timeout: OPEN_MS });
    await sleep(600);

    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const text = `llega ${i} ${uid()}`;
      const t0 = Date.now();
      await inboxInbound(request, acc, chat, text, name);
      await expect(page.locator('.gr-msg-in', { hasText: text })).toBeVisible({ timeout: STREAM_BOUND_MS });
      samples.push(Date.now() - t0);
      await sleep(300);
    }
    note('webhook→burbuja (stream) ms', samples.join(', '));
    expect(Math.max(...samples)).toBeLessThan(STREAM_BOUND_MS);
    await expect(page.locator('.ib-item', { hasText: name })).toContainText('llega 2');
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------- Con el stream prendido, varias pestañas y personas

/** Anota en la página cada lote que llega por el stream (solo ids y tipo): así la prueba ve lo que el servidor manda. */
async function recordFrames(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __frames: Array<{ chatId: string; kind?: string }>; EventSource: typeof EventSource };
    w.__frames = [];
    const Native = w.EventSource;
    class Recording extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener('events', (ev) => {
          try {
            for (const e of (JSON.parse((ev as MessageEvent).data) as { events: Array<{ chatId: string; kind?: string }> }).events) w.__frames.push(e);
          } catch {
            /* frame roto */
          }
        });
      }
    }
    w.EventSource = Recording as unknown as typeof EventSource;
  });
}
const framesOf = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Array<{ chatId: string; kind?: string }> }).__frames.slice());

test.describe('con el stream prendido', () => {
  test('Lines, dos pestañas: lo que mando en una aparece en la otra en menos de 2 s', async ({ browser, request, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    await useStream(context, baseURL);
    const n = await fakeNumber(request);
    const name = `Vera${uid()}`;
    await linesInbound(request, n, linesDm(), 'hola', name);
    const a = await context.newPage();
    const b = await context.newPage();
    const openA = streamOpen(a, 'groups');
    await openLinesChat(a, name, 'domcontentloaded');
    await openA;
    const openB = streamOpen(b, 'groups');
    await openLinesChat(b, name, 'domcontentloaded');
    await openB;
    const errors = watchErrors(b);
    // Uno de calentamiento (compilar en dev, la primera relectura).
    const composer = a.getByLabel('WhatsApp', { exact: true });
    await composer.fill('calentamiento');
    await composer.press('Enter');
    await expect(b.locator('.gr-msg-out', { hasText: 'calentamiento' })).toBeVisible({ timeout: OPEN_MS });
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const text = `de la otra pestaña ${i} ${uid()}`;
      await composer.fill(text);
      const t0 = Date.now();
      await composer.press('Enter');
      await expect(b.locator('.gr-msg-out', { hasText: text })).toBeVisible({ timeout: STREAM_BOUND_MS });
      samples.push(Date.now() - t0);
      // Una vez en cada pestaña, sin burbujas repetidas.
      await expect(a.locator('.gr-msg-out', { hasText: text })).toHaveCount(1);
      await expect(b.locator('.gr-msg-out', { hasText: text })).toHaveCount(1);
    }
    note('Enter en una pestaña→burbuja en la otra (stream) ms', samples.join(', '));
    expect(errors).toEqual([]);
    await context.close();
  });

  test('Lines, un miembro: por el stream le llegan solo los chats de las líneas que ve; el de una línea restringida, ni el id', async ({ browser, request, baseURL }) => {
    const seen = await fakeNumber(request);
    const hidden = await fakeNumber(request);
    await sql("UPDATE groups_numbers SET visibility = 'restricted' WHERE id = ?", [hidden.id]);
    const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
    const email = `lines-live-${uid()}@darwin-e2e.io`;
    const context = await browser.newContext({ baseURL });
    await context.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
    await useStream(context, baseURL);
    await recordFrames(context);
    const page = await context.newPage();
    await page.goto('/en/app', { waitUntil: 'domcontentloaded', timeout: OPEN_MS });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);
    const open = streamOpen(page, 'groups');
    await page.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded', timeout: OPEN_MS });
    await open;
    await sleep(800);
    const visibleName = `Visible${uid()}`;
    const hiddenName = `Oculto${uid()}`;
    // Primero el chat de la línea que no ve, después el de la que sí.
    await linesInbound(request, hidden, linesDm(), 'no lo tenés que ver', hiddenName);
    await linesInbound(request, seen, linesDm(), 'este sí', visibleName);
    await expect(page.locator('.gr-row', { hasText: visibleName })).toBeVisible({ timeout: 5000 });
    const ids = Object.fromEntries((await sql("SELECT name, id FROM groups_chats WHERE name IN (?, ?)", [visibleName, hiddenName])).map((r) => [String(r.name), String(r.id)]));
    await sleep(1500);
    const frames = await framesOf(page);
    expect(frames.map((f) => f.chatId)).toContain(ids[visibleName]);
    expect(frames.map((f) => f.chatId)).not.toContain(ids[hiddenName]);
    await expect(page.locator('.gr-row', { hasText: hiddenName })).toHaveCount(0);
    // Solo ids y tipo: nada del texto, el nombre ni el teléfono viaja por el stream.
    for (const f of frames) expect(Object.keys(f).sort()).toEqual(['chatId', 'id', 'kind']);
    await context.close();
  });

  test('Inbox, dos pestañas: lo que mando en una aparece en la otra en menos de 2 s', async ({ browser, request, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
    await useStream(context, baseURL);
    const acc = await linkWhatsapp(request);
    const name = `Ana ${uid()}`;
    await inboxInbound(request, acc, inboxDm(), 'hola', name);
    const a = await context.newPage();
    const b = await context.newPage();
    const openA = streamOpen(a, 'inbox');
    await openInboxChat(a, name, 'domcontentloaded');
    await openA;
    const openB = streamOpen(b, 'inbox');
    await openInboxChat(b, name, 'domcontentloaded');
    await openB;
    const field = a.getByRole('textbox', { name: 'Message' });
    await field.fill('calentamiento');
    await field.press('Enter');
    await expect(b.locator('.gr-msg-out', { hasText: 'calentamiento' })).toBeVisible({ timeout: OPEN_MS });
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const text = `de la otra pestaña ${i} ${uid()}`;
      await field.fill(text);
      const t0 = Date.now();
      await field.press('Enter');
      await expect(b.locator('.gr-msg-out', { hasText: text })).toBeVisible({ timeout: STREAM_BOUND_MS });
      samples.push(Date.now() - t0);
      await expect(a.locator('.gr-msg-out', { hasText: text })).toHaveCount(1);
      await expect(b.locator('.gr-msg-out', { hasText: text })).toHaveCount(1);
    }
    note('Enter en una pestaña→burbuja en la otra (stream) ms', samples.join(', '));
    await context.close();
  });

  test('Inbox: Enter y enseguida otro chat: la respuesta del envío no se pinta en el chat que está a la vista', async ({ page, request, context, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useStream(context, baseURL);
    const acc = await linkWhatsapp(request);
    const nameA = `Ana ${uid()}`;
    const nameB = `Beto ${uid()}`;
    await inboxInbound(request, acc, inboxDm(), 'hola de A', nameA);
    await inboxInbound(request, acc, inboxDm(), 'hola de B', nameB);
    await openInboxChat(page, nameA, 'domcontentloaded');
    // El envío tarda: la persona ya abrió otro chat cuando vuelve la respuesta.
    await page.route('**/api/inbox/threads/*/messages', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await sleep(SERVER_DELAY_MS);
      await route.continue();
    });
    const text = `para A ${uid()}`;
    const field = page.getByRole('textbox', { name: 'Message' });
    await field.fill(text);
    await field.press('Enter');
    await page.locator('.ib-item', { hasText: nameB }).locator('.ib-row-btn').click();
    await expect(page.locator('.gr-msg-in', { hasText: 'hola de B' })).toBeVisible({ timeout: OPEN_MS });
    await sleep(SERVER_DELAY_MS + 1500);
    // En B, nada de A.
    await expect(page.locator('.gr-msg-in', { hasText: 'hola de A' })).toHaveCount(0);
    await expect(page.locator('.gr-msg-out', { hasText: text })).toHaveCount(0);
    // Y en A está, una vez.
    await page.locator('.ib-item', { hasText: nameA }).locator('.ib-row-btn').click();
    await expect(page.locator('.gr-msg-out', { hasText: text })).toHaveCount(1, { timeout: 10_000 });
  });
});
