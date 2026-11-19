import path from 'path';
import sharp from 'sharp';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Detalles de chat pedidos juntos, en Inbox y en Lines, a 1280 y 390 (WhatsApp falso):
 * - la pestaña Stickers corre con la rueda cuando hay muchos (antes se veían los primeros y nada más);
 * - deslizar a la derecha muestra Posponer junto a No leído y Fijar, y abre el diálogo de cuándo;
 * - deslizar hasta el fondo para archivar: la fila se va enseguida (no queda la franja a la vista);
 * - una foto angosta con texto: la burbuja guarda el ancho de media y el texto se lee en renglones normales;
 * - el sidebar colapsado muestra las carpetas sin scroll de costado (1280);
 * - el aviso de versión nueva dice qué trae y enlaza al changelog;
 * - la ficha del contacto muestra el teléfono (también de un chat guardado por lid, si la libreta lo conoce; si no,
 *   nada) y un toque lo copia.
 * Nombres, números y textos inventados. Con POLISH_SHOTS=<carpeta> deja capturas.
 */

test.describe.configure({ timeout: 240_000 });

const FIRST_MS = 60_000;
const SHOTS = process.env.POLISH_SHOTS;
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

async function shot(page: Page, name: string, width: number) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`) });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(SHOTS, `${name}-${width}-dark.png`) });
  await page.emulateMedia({ colorScheme: 'light' });
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

function textEvent(chatId: string, body: string, senderName: string, extra: Record<string, unknown> = {}) {
  return { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.endsWith('@lid') ? '' : chatId.replace(/@.*/, ''), senderName, providerMessageId: `cp-${uid()}`, body, timestamp: new Date().toISOString(), ...extra };
}

/** Foto angosta y alta (medidas de captura de pantalla) con un texto largo. */
function narrowPhoto(app: 'inbox' | 'lines', chatId: string, senderName: string) {
  const pid = `img-${uid()}`;
  return textEvent(chatId, 'Te paso la captura del pedido con las medidas de la mesa y el color que elegimos para las sillas del patio', senderName, {
    providerMessageId: pid,
    media: { url: app === 'lines' ? `evo:${pid}` : '', type: 'image/png', name: '', fetchRef: { providerMessageId: pid, chatId, fromMe: false }, info: { kind: 'image', width: 140, height: 700 } },
  });
}

// ---------- Inbox y Lines: cómo llegar a cada cosa ----------

interface App {
  name: 'inbox' | 'lines';
  /** Manda eventos de WhatsApp a la cuenta o el número. */
  send: (events: unknown[]) => Promise<void>;
  /** Id del chat guardado para ese jid. */
  chatOf: (jid: string) => Promise<string>;
  listUrl: string;
  open: (page: Page, chatId: string, name: string) => Promise<Locator>;
  row: (page: Page, name: string) => Locator;
  openInfo: (page: Page, thread: Locator) => Promise<Locator>;
  stickersApi: string;
  accountId: string;
}

async function inboxApp(request: APIRequestContext): Promise<App> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return {
    name: 'inbox',
    accountId: String(acc.id),
    send: async (events) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } })).ok()).toBe(true),
    chatOf: async (jid) => String((await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), jid]))[0]?.id ?? ''),
    listUrl: '/en/app/inbox',
    open: async (page, id, name) => {
      await page.goto(`/en/app/inbox?t=${id}`, { waitUntil: 'networkidle' });
      const thread = page.locator('.ib-wa-thread');
      await expect(thread.locator('.gr-thread-head')).toContainText(name, { timeout: FIRST_MS });
      return thread;
    },
    row: (page, name) => page.locator('[data-chat-row]', { hasText: name }),
    openInfo: async (page, thread) => {
      await thread.locator('.gr-thread-actions').getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Contact info' }).click();
      const panel = page.getByRole('complementary', { name: 'Contact info' });
      await expect(panel).toBeVisible({ timeout: FIRST_MS });
      return panel;
    },
    stickersApi: '/api/inbox/stickers',
  };
}

async function linesApp(request: APIRequestContext): Promise<App> {
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Pulido ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  return {
    name: 'lines',
    accountId: numberId,
    send: async (events) => {
      const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
      expect(res.ok(), await res.text()).toBe(true);
    },
    chatOf: async (jid) => String((await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, jid]))[0]?.id ?? ''),
    listUrl: '/en/app/lines/inbox',
    open: async (page, id, name) => {
      await page.goto(`/en/app/lines/inbox/${id}`, { waitUntil: 'networkidle' });
      const thread = page.locator('.gr-thread').first();
      await expect(thread.locator('.gr-thread-head')).toContainText(name, { timeout: FIRST_MS });
      return thread;
    },
    row: (page, name) => page.locator('[data-chat-row]', { hasText: name }),
    openInfo: async (page) => {
      await page.getByRole('button', { name: 'More chat actions' }).click();
      await page.getByRole('menuitem', { name: 'Contact info' }).click();
      const head = page.locator('.gr-details.is-open .wa-details-head');
      await expect(head).toBeVisible({ timeout: FIRST_MS });
      return head;
    },
    stickersApi: '/api/groups/stickers',
  };
}

/** Desliza una fila con el mouse. */
async function swipe(page: Page, row: Locator, dir: 'left' | 'right', amount: number) {
  await row.scrollIntoViewIfNeeded();
  const b = (await row.boundingBox())!;
  const y = b.y + b.height / 2;
  const from = dir === 'right' ? b.x + 40 : b.x + b.width - 40;
  const dist = amount < 1 ? b.width * amount : amount;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(from + (dir === 'right' ? dist : -dist), y, { steps: 12 });
  await page.mouse.up();
}

const apps = { inbox: inboxApp, lines: linesApp } as const;

for (const width of [1280, 390]) {
  for (const appName of ['inbox', 'lines'] as const) {
    test.describe(`${appName} ${width}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
      });

      test('stickers: la pestaña corre con muchos', async ({ page, request }) => {
        const errors = watchErrors(page);
        const app = await apps[appName](request);
        if ((await sql("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wa_stickers'")).length) {
          await sql("DELETE FROM wa_stickers WHERE user_id IN (SELECT id FROM users WHERE email = 'demo@zerosoft.ai')");
        }
        // 36 stickers distintos (uno por color), creados desde una imagen como lo hace "Crear".
        for (let i = 0; i < 36; i++) {
          const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: (i * 53) % 256, g: (i * 97) % 256, b: (i * 31) % 256, alpha: 1 } } }).png().toBuffer();
          const res = await request.post(app.stickersApi, { multipart: { file: { name: `s${i}.png`, mimeType: 'image/png', buffer: png } } });
          expect(res.ok(), await res.text()).toBe(true);
        }
        const jid = `${phone()}@s.whatsapp.net`;
        const name = `Sticky ${uid()}`;
        await app.send([textEvent(jid, 'hola', name)]);
        const thread = await app.open(page, await app.chatOf(jid), name);
        await thread.locator('.wa-bar').getByRole('button', { name: 'Emoji', exact: true }).evaluate((b) => (b as HTMLButtonElement).click());
        const panel = page.locator('.wa-emoji');
        await panel.getByRole('tab', { name: 'Stickers' }).click();
        const scroller = panel.locator('.wa-stk-scroll');
        await expect(panel.locator('section[aria-label="Your stickers"] .wa-stk')).toHaveCount(36, { timeout: FIRST_MS });
        // Las imágenes se ven (bajan perezosas: las de arriba primero, las de abajo al llegar).
        const loaded = (i: Locator) => i.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
        await expect.poll(() => loaded(panel.locator('.wa-stk-send img').first()), { timeout: FIRST_MS }).toBe(true);
        const dims = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
        expect(dims.sh).toBeGreaterThan(dims.ch);
        await shot(page, `${appName}-stickers-top`, width);
        const b = (await scroller.boundingBox())!;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.wheel(0, 600);
        await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
        // El último se ve al llegar al fondo, y la página no corre de costado.
        await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
        await expect(panel.locator('.wa-stk').last()).toBeInViewport();
        await expect.poll(() => loaded(panel.locator('.wa-stk-send img').last()), { timeout: FIRST_MS }).toBe(true);
        await noSideScroll(page);
        await shot(page, `${appName}-stickers-scrolled`, width);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        expect(errors, errors.join('\n')).toEqual([]);
      });

      test('deslizar: Posponer junto a No leído y Fijar; archivar se va enseguida', async ({ page, request }) => {
        const errors = watchErrors(page);
        const app = await apps[appName](request);
        const tag = uid();
        const name = `Deslizo ${tag}`;
        const jid = `${phone()}@s.whatsapp.net`;
        await app.send([textEvent(jid, `buenas ${tag}`, name)]);
        await page.goto(app.listUrl, { waitUntil: 'networkidle' });
        const row = app.row(page, name);
        await expect(row).toBeVisible({ timeout: FIRST_MS });
        const actions = row.getByTestId('swipe-actions');

        await swipe(page, row, 'right', 180);
        await expect(actions.locator('[data-action]')).toHaveCount(3);
        await expect(actions.locator('[data-action="unread"]')).toBeVisible();
        await expect(actions.locator('[data-action="pin"]')).toBeVisible();
        const snooze = actions.locator('[data-action="snooze"]');
        await expect(snooze).toHaveText('Snooze');
        await shot(page, `${appName}-swipe-snooze`, width);
        await snooze.click();
        const dialog = page.getByRole('dialog', { name: 'Snooze until' });
        await expect(dialog).toBeVisible();
        await shot(page, `${appName}-swipe-snooze-dialog`, width);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(actions).toHaveCount(0);

        // Hasta el fondo a la izquierda: archiva y la fila se va enseguida (no se queda con la franja).
        const t0 = Date.now();
        await swipe(page, row, 'left', 0.8);
        await expect(row).toHaveCount(0, { timeout: 2_000 });
        expect(Date.now() - t0).toBeLessThan(2_000);
        await expect(page.locator('.ui-toast, .ib-toast').filter({ hasText: /archived/i }).first()).toBeVisible({ timeout: FIRST_MS });
        await expect.poll(async () => {
          const id = await app.chatOf(jid);
          const table = appName === 'inbox' ? 'inbox_threads' : 'groups_chats';
          return (await sql(`SELECT archived_at FROM ${table} WHERE id = ?`, [id]))[0]?.archived_at ?? null;
        }, { timeout: FIRST_MS }).not.toBeNull();
        await noSideScroll(page);
        expect(errors, errors.join('\n')).toEqual([]);
      });

      test('foto angosta con texto: la burbuja guarda el ancho y el texto se lee normal', async ({ page, request }) => {
        const errors = watchErrors(page);
        const app = await apps[appName](request);
        const name = `Foto ${uid()}`;
        const jid = `${phone()}@s.whatsapp.net`;
        await app.send([textEvent(jid, 'hola', name), narrowPhoto(appName, jid, name)]);
        const thread = await app.open(page, await app.chatOf(jid), name);
        const image = thread.locator('.wa-image').last();
        await expect(image).toBeVisible({ timeout: FIRST_MS });
        const box = (await image.boundingBox())!;
        // 300 en el escritorio; en el teléfono el tope es 70vw (273 a 390).
        expect(box.width).toBeGreaterThanOrEqual(width < 600 ? 260 : 290);
        expect(box.height).toBeLessThanOrEqual(box.width * 1.4);
        await noSideScroll(page);
        await shot(page, `${appName}-narrow-photo`, width);
        expect(errors, errors.join('\n')).toEqual([]);
      });

      test('ficha del contacto: el teléfono (también por lid) y un toque lo copia', async ({ page, request, context }) => {
        const errors = watchErrors(page);
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const app = await apps[appName](request);
        const num = phone();
        const name = `Ficha ${uid()}`;
        const jid = `${num}@s.whatsapp.net`;
        await app.send([textEvent(jid, 'hola', name)]);
        let thread = await app.open(page, await app.chatOf(jid), name);
        let info = await app.openInfo(page, thread);
        const tel = info.getByTestId('contact-phone');
        await expect(tel).toContainText(num.slice(-4));
        await shot(page, `${appName}-contact-phone`, width);
        await tel.click();
        await expect(page.getByText('Number copied')).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`+${num}`);
        await noSideScroll(page);

        // Un chat guardado por lid: sin teléfono conocido no muestra nada (nunca el lid); cuando la libreta lo sabe, sí.
        const lid = `${Math.floor(1e14 + Math.random() * 8e14)}`;
        const lidName = `Anonimo ${uid()}`;
        await app.send([textEvent(`${lid}@lid`, 'hola desde lid', lidName)]);
        const lidChat = await app.chatOf(`${lid}@lid`);
        expect(lidChat).not.toBe('');
        thread = await app.open(page, lidChat, lidName);
        info = await app.openInfo(page, thread);
        await expect(info.getByTestId('contact-phone')).toHaveCount(0);
        await expect(info).not.toContainText(lid);
        const known = phone();
        await sql("INSERT INTO wa_contacts (id, app, account_id, user_id, phone, lid, updated_at) SELECT ?, ?, ?, id, ?, ?, ? FROM users WHERE email = 'demo@zerosoft.ai'", [
          `e2e-${uid()}`,
          appName,
          app.accountId,
          known,
          lid,
          new Date().toISOString(),
        ]);
        thread = await app.open(page, lidChat, lidName);
        info = await app.openInfo(page, thread);
        await expect(info.getByTestId('contact-phone')).toContainText(known.slice(-4));
        expect(errors, errors.join('\n')).toEqual([]);
      });

      test('aviso de versión nueva: dice qué trae y enlaza al changelog', async ({ page }) => {
        const errors = watchErrors(page);
        await page.addInitScript(() => window.sessionStorage.setItem('zs-app-build', 'build-vieja'));
        await page.route('**/api/version**', async (route) => {
          const res = await route.fetch();
          const body = (await res.json()) as Record<string, unknown>;
          await route.fulfill({ response: res, json: { ...body, build: 'build-nueva' } });
        });
        await page.goto(appName === 'inbox' ? '/en/app/inbox' : '/en/app/lines/inbox', { waitUntil: 'networkidle' });
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        const banner = page.getByTestId('app-update-banner');
        await expect(banner).toBeVisible({ timeout: FIRST_MS });
        const news = banner.getByTestId('app-update-news');
        await expect(news).toContainText('New:');
        const link = banner.getByRole('link', { name: 'See what’s new' });
        await expect(link).toHaveAttribute('href', /\/changelog#/);
        // El pie: el enlace y los botones en una fila, debajo del texto; los botones terminan contra el borde derecho.
        const box = async (l: Locator) => (await l.boundingBox())!;
        const [bb, nb, lb, rb, db] = await Promise.all([box(banner), box(news), box(link), box(banner.getByRole('button', { name: 'Reload' })), box(banner.getByRole('button', { name: 'Not now' }))]);
        expect(rb.y).toBeGreaterThanOrEqual(nb.y + nb.height - 1);
        expect(Math.abs(rb.y + rb.height / 2 - (db.y + db.height / 2))).toBeLessThan(2);
        expect(Math.abs(lb.y + lb.height / 2 - (rb.y + rb.height / 2))).toBeLessThan(8);
        expect(lb.x + lb.width).toBeLessThanOrEqual(rb.x);
        expect(bb.x + bb.width - (db.x + db.width)).toBeLessThan(24);
        // Sigue el aspecto elegido: en Líneas, esquinas chicas y sin sombra, como los menús.
        const lookStyle = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('[data-testid="app-update-banner"]')!;
          const prev = document.documentElement.dataset.look;
          document.documentElement.dataset.look = 'lines';
          const cs = getComputedStyle(el);
          const out = { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow };
          if (prev === undefined) delete document.documentElement.dataset.look;
          else document.documentElement.dataset.look = prev;
          return out;
        });
        expect(lookStyle).toEqual({ radius: '2px', shadow: 'none' });
        // Dos líneas como mucho.
        const lines = await news.locator('.zs-app-update-news-text').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
        expect(lines).toBeLessThanOrEqual(2);
        await noSideScroll(page);
        await shot(page, `${appName}-version-news`, width);
        await banner.getByRole('button', { name: 'Not now' }).click();
        await expect(banner).toHaveCount(0);
        expect(errors, errors.join('\n')).toEqual([]);
      });

      if (width >= 1024) {
        test('sidebar colapsado: carpetas sin scroll de costado', async ({ page, request }) => {
          const errors = watchErrors(page);
          await apps[appName](request);
          const tag = uid();
          for (const n of ['Pedidos mayoristas', 'Facturación pendiente', 'Amigos del club', 'Proveedores de la zona']) {
            const res = await request.post(appName === 'inbox' ? '/api/inbox/folders' : '/api/groups/folders', { data: { name: `${n} ${tag}` } });
            expect(res.ok(), await res.text()).toBe(true);
          }
          await page.goto(appName === 'inbox' ? '/en/app/inbox' : '/en/app/lines/inbox', { waitUntil: 'networkidle' });
          if (!(await page.locator('.app-frame').evaluate((el) => el.classList.contains('sidebar-collapsed')))) await page.locator('.side-handle').click();
          await expect(page.locator('.app-frame')).toHaveClass(/sidebar-collapsed/);
          // Termina la transición del ancho (el riel mide 56px).
          await expect.poll(() => page.locator('.side').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(80);
          const rail = page.locator('.folder-rail');
          await expect(rail).toBeVisible({ timeout: FIRST_MS });
          await expect(rail.locator('.folder-rail-btn').first()).toBeVisible();
          // La tira no corre de costado (antes era más angosta que las carpetas y tenía scroll horizontal).
          const over = await rail.evaluate((el) => ({ rail: el.scrollWidth - el.clientWidth, ox: getComputedStyle(el).overflowX }));
          expect(over.rail).toBeLessThanOrEqual(1);
          expect(over.ox).toBe('hidden');
          // Cada carpeta entra entera en el riel y el nombre completo sale al pasar el mouse.
          const railBox = (await rail.boundingBox())!;
          for (const btn of await rail.locator('.folder-rail-btn').all()) {
            const bb = (await btn.boundingBox())!;
            expect(bb.x).toBeGreaterThanOrEqual(railBox.x - 1);
            expect(bb.x + bb.width).toBeLessThanOrEqual(railBox.x + railBox.width + 1);
          }
          // El nombre completo va en la etiqueta (y en el tooltip al pasar el mouse).
          await expect(rail.locator(`.folder-rail-btn[aria-label*="Facturación pendiente ${tag}"]`)).toHaveCount(1);
          await shot(page, `${appName}-rail`, width);
          await page.locator('.side-handle').click();
          expect(errors, errors.join('\n')).toEqual([]);
        });
      }
    });
  }
}
