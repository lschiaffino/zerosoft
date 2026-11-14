import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Visualización de los chats (components/chat-style/DisplaySection.tsx), en
 * Lines e Inbox: cada opción cambia la vista previa (lista de chats y chat de
 * grupo con las clases reales), el segmento elegido lleva el color de la app
 * (no la tinta) y el menú ⋯ de un chat lleva a la sección (#chat-display).
 * Con DISPLAY_SHOTS=<carpeta> guarda capturas (1280 y 390, claro y oscuro).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const DEFAULTS = { textSize: 'default', density: 'comfortable', linkPreviews: 'large', mediaSize: 'default', bubbleWidth: 'default', wallpaper: 'pattern', groupAvatars: true };

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string, locator?: Locator) {
  const dir = process.env.DISPLAY_SHOTS;
  if (!dir) return;
  if (locator) await locator.screenshot({ path: `${dir}/${name}.png` });
  else await page.screenshot({ path: `${dir}/${name}.png` });
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

const num = (l: Locator, fn: (el: Element) => number) => l.evaluate(fn);
const width = (el: Element) => el.getBoundingClientRect().width;
const height = (el: Element) => el.getBoundingClientRect().height;

/** Fondo del segmento elegido, el de la tinta y el del botón de la app, resueltos por el navegador. */
async function pressedColors(section: Locator) {
  return section.locator('[data-option="textSize-default"]').evaluate((btn) => {
    const probe = (v: string) => {
      const el = document.createElement('span');
      el.style.background = v;
      btn.closest('.app-frame')!.appendChild(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    };
    const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: string) => {
      const [r, g, b] = rgb(c).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const cs = getComputedStyle(btn);
    const [a, b] = [lum(cs.backgroundColor), lum(cs.color)];
    return { bg: cs.backgroundColor, ink: probe('var(--ink)'), app: probe('var(--app-btn)'), contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
}

/** Un número falso de Lines conectado con un chat. Devuelve el nombre del chat. */
async function linesChat(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Display ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const name = `Marta ${uid()}`;
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `ds-${uid()}`, body: 'Hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok()).toBe(true);
  return name;
}

test('Visualización: cada opción cambia la vista previa (Lines)', async ({ page, request }) => {
  const errors = watchErrors(page);
  await request.put('/api/chat-style', { data: { style: 'whatsapp', display: DEFAULTS } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/en/app/lines/settings?tab=appearance', { waitUntil: 'networkidle' });
  const section = page.locator('#chat-display');
  const sample = section.getByTestId('display-sample');
  const option = (o: string) => section.locator(`[data-option="${o}"]`);
  await expect(section.getByText('Preview', { exact: true })).toBeVisible();
  await expect(sample.locator('.gr-row')).toHaveCount(3);
  await expect(sample.locator('.gr-unread').first()).toBeVisible();
  // La vista previa queda fija al recorrer las opciones (escritorio).
  expect(await section.locator('.wa-display-preview').evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

  // Texto de los mensajes.
  const text = sample.getByTestId('display-sample-text');
  const fs = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
  const fs0 = await num(text, fs);
  await option('textSize-large').click();
  await expect(sample).toHaveAttribute('data-text-size', 'large');
  await expect.poll(() => num(text, fs)).toBeGreaterThan(fs0 + 1);
  await option('textSize-small').click();
  await expect.poll(() => num(text, fs)).toBeLessThan(fs0);
  await option('textSize-default').click();

  // Vista previa de links: grande, compacta, ninguna.
  await option('linkPreviews-compact').click();
  await expect(sample.locator('.wa-linkcard')).toHaveAttribute('data-layout', 'compact');
  await option('linkPreviews-off').click();
  await expect(sample).toHaveAttribute('data-link-previews', 'off');
  await expect(sample.locator('.wa-linkcard')).toHaveCount(0);
  await option('linkPreviews-large').click();
  await expect(sample.locator('.wa-linkcard')).toHaveAttribute('data-layout', 'large');

  // Fotos y videos: chico < normal < grande.
  const photo = sample.getByTestId('display-sample-photo').locator('.wa-image');
  await expect(photo).toBeVisible();
  const w0 = await num(photo, width);
  await option('mediaSize-small').click();
  await expect.poll(() => num(photo, width)).toBeLessThan(w0 - 20);
  await option('mediaSize-large').click();
  await expect.poll(() => num(photo, width)).toBeGreaterThan(w0 + 20);
  await option('mediaSize-default').click();
  await expect.poll(() => num(photo, width)).toBeCloseTo(w0, 0);

  // Lista de chats: compacta = filas más bajas.
  const row = sample.locator('.gr-row').first();
  const h0 = await num(row, height);
  await option('density-compact').click();
  await expect(sample).toHaveAttribute('data-density', 'compact');
  await expect.poll(() => num(row, height)).toBeLessThan(h0 - 6);
  await option('density-comfortable').click();
  await expect.poll(() => num(row, height)).toBeCloseTo(h0, 0);

  // Ancho de los mensajes.
  const bubble = sample.getByTestId('display-sample-in');
  const b0 = await num(bubble, width);
  await option('bubbleWidth-wide').click();
  await expect.poll(() => num(bubble, width)).toBeGreaterThan(b0 + 20);
  await option('bubbleWidth-default').click();

  // Fondo del chat: con dibujo o liso.
  const wall = sample.locator('.wa-messages');
  const bgImage = (el: Element) => getComputedStyle(el).backgroundImage;
  expect(await wall.evaluate(bgImage)).not.toBe('none');
  await option('wallpaper-plain').click();
  await expect.poll(() => wall.evaluate(bgImage)).toBe('none');
  await option('wallpaper-pattern').click();
  await expect.poll(() => wall.evaluate(bgImage)).not.toBe('none');

  // Fotos al lado de los mensajes en grupos.
  const avatars = sample.locator('.wa-sender-avatar');
  await expect(avatars).toHaveCount(2);
  await expect(avatars.first()).toBeVisible();
  await section.getByRole('checkbox', { name: 'Show photos next to messages in groups' }).uncheck();
  await expect(sample).toHaveAttribute('data-group-avatars', 'off');
  await expect(avatars.first()).toBeHidden();
  await section.getByRole('checkbox', { name: 'Show photos next to messages in groups' }).check();
  await expect(avatars.first()).toBeVisible();
  await expect(section.getByRole('status')).toHaveText(/Saved/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Visualización: el segmento elegido lleva el color de la app en Lines e Inbox, claro y oscuro', async ({ page, context, baseURL, request }) => {
  const errors = watchErrors(page);
  await request.put('/api/chat-style', { data: { style: 'whatsapp', display: DEFAULTS } });
  const seen: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const url of ['/en/app/lines/settings?tab=appearance', '/en/app/inbox/settings']) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(url, { waitUntil: 'networkidle' });
      const section = page.locator('#chat-display');
      await expect(section.locator('[data-option="textSize-default"]')).toHaveAttribute('aria-pressed', 'true');
      const c = await pressedColors(section);
      expect(c.bg, `${url} ${theme}`).not.toBe(c.ink);
      expect(c.bg, `${url} ${theme}`).toBe(c.app);
      expect(c.contrast, `${url} ${theme}`).toBeGreaterThanOrEqual(4.5);
      seen.push(c.bg);
      // Al pasar el mouse sigue con color (no vuelve a la tinta ni al gris de la secundaria).
      await section.locator('[data-option="textSize-default"]').hover();
      const hover = await section.locator('[data-option="textSize-default"]').evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(hover).not.toBe(c.ink);
      // Sin elegir: secundaria (no es el color de la app).
      expect(await section.locator('[data-option="textSize-large"]').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(c.app);
    }
  }
  // Lines e Inbox tienen colores distintos.
  expect(seen[0]).not.toBe(seen[1]);
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Visualización: se llega desde el menú ⋯ de un chat de Lines y de Inbox', async ({ page, request }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  // Lines.
  const name = await linesChat(request);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const link = page.getByRole('link', { name: new RegExp(name) }).first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  await page.goto((await link.getAttribute('href'))!, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'More chat actions' }).click();
  await page.getByRole('menuitem', { name: 'Display' }).click();
  await expect(page).toHaveURL(/\/app\/lines\/settings\?tab=appearance#chat-display$/);
  await expect(page.locator('#chat-display').getByRole('heading', { name: 'Display' })).toBeInViewport();

  // Inbox.
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'", args: [] })).rows;
    const tag = uid();
    const phone = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
      data: { events: [{ type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: `Rita ${tag}`, providerMessageId: `ds-in-${tag}`, body: 'Hola', timestamp: new Date().toISOString() }] },
    });
    expect(res.ok()).toBe(true);
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: `Rita ${tag}` }).locator('.ib-row-btn').click();
    await page.locator('.ib-wa-thread').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Display' }).click();
    await expect(page).toHaveURL(/\/app\/inbox\/settings#chat-display$/);
    await expect(page.locator('#chat-display').getByRole('heading', { name: 'Display' })).toBeInViewport();
  } finally {
    db.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Visualización: capturas en 1280 y 390, claro y oscuro, sin scroll horizontal', async ({ page, context, baseURL, request }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await request.put('/api/chat-style', { data: { style: 'whatsapp', display: DEFAULTS } });
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const [app, url] of [
      ['lines', '/en/app/lines/settings?tab=appearance#chat-display'],
      ['inbox', '/en/app/inbox/settings#chat-display'],
    ] as const) {
      for (const w of [1280, 390]) {
        await page.setViewportSize({ width: w, height: w > 500 ? 900 : 844 });
        // Carga nueva (la misma URL con # sería solo un salto dentro de la página ya abierta).
        await page.goto('about:blank');
        await page.goto(url, { waitUntil: 'networkidle' });
        const section = page.locator('#chat-display');
        await expect(section.getByTestId('display-sample').locator('.gr-row')).toHaveCount(3);
        await noHorizontalScroll(page);
        // La sección queda arriba, debajo de la banda (sin hueco arriba de la banda).
        expect(await page.locator('.app-band').evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
        await expect(section.getByRole('heading', { name: 'Display' })).toBeInViewport();
        if (w > 500) {
          // En escritorio la vista previa entra entera en la ventana.
          const box = await section.locator('.wa-display-preview').evaluate((el) => el.getBoundingClientRect().height);
          expect(box).toBeLessThan(900 - 48 - 16);
        }
        await shot(page, `${app}-${w}-${theme}`);
        if (w < 500) await shot(page, `${app}-${w}-${theme}-section`, section);
      }
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL! }]);
  expect(errors, errors.join('\n')).toEqual([]);
});
