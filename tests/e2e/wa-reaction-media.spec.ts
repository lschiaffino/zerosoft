import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Inbox y Lines con el WhatsApp falso: el globito de reacciones de una foto
 * (entrante y saliente), un sticker y un texto, como WhatsApp Web. El globito
 * se monta sobre el borde de abajo de la burbuja (mitad adentro, mitad afuera),
 * del lado de quien escribe, entero a la vista y sin pisar el mensaje que
 * sigue. La foto conserva el marquito de la burbuja. A 1280 y 390. Con
 * RX_MEDIA_SHOTS=<carpeta> guarda capturas en el aspecto actual (claro) y en
 * Retro (oscuro). Nombres y números inventados.
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
const phone = () => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${Math.floor(Math.random() * 10)}`;
const groupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
const SHOTS = process.env.RX_MEDIA_SHOTS ?? '';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

type Seed = { gid: string; title: string; tag: string };

/** Texto, foto entrante, foto saliente y sticker, cada uno con una reacción y un mensaje de texto después. */
function seedEvents(app: 'inbox' | 'lines'): { seed: Seed; messages: unknown[]; reactions: unknown[] } {
  const tag = uid();
  const gid = groupId();
  const title = `Fotos ${tag}`;
  const ana = phone();
  const t0 = Date.now() - 60 * 60_000;
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const base = { type: 'message', chatId: gid, isGroup: true, fromMe: false, senderPhone: ana, senderName: `Ana ${tag}`, body: '' };
  const ref = (id: string, fromMe = false) => ({ providerMessageId: id, chatId: gid, fromMe });
  // Lines guarda el archivo como "evo:<id>" y lo baja del proveedor al abrirlo; Inbox lo baja con fetchRef.
  const src = (id: string) => (app === 'lines' ? `evo:${id}` : '');
  const image = (id: string, fromMe = false) => ({ url: src(id), type: 'image/png', name: '', fetchRef: ref(id, fromMe), info: { kind: 'image', width: 480, height: 320 } });
  const out = { fromMe: true, senderPhone: '', senderName: '', status: 'read' };
  const messages = [
    { ...base, chatName: title, providerMessageId: `txt-${tag}`, body: `texto ${tag}`, timestamp: at(0) },
    { ...base, providerMessageId: `after-txt-${tag}`, body: `despues del texto ${tag}`, timestamp: at(1) },
    { ...base, providerMessageId: `img-in-${tag}`, media: image(`img-in-${tag}`), timestamp: at(2) },
    { ...base, providerMessageId: `after-in-${tag}`, body: `despues de la foto ${tag}`, timestamp: at(3) },
    { ...base, ...out, providerMessageId: `img-out-${tag}`, media: image(`img-out-${tag}`, true), timestamp: at(4) },
    { ...base, ...out, providerMessageId: `after-out-${tag}`, body: `despues de mi foto ${tag}`, timestamp: at(5) },
    { ...base, providerMessageId: `stk-${tag}`, media: { url: src(`stk-${tag}`), type: 'image/webp', name: '', fetchRef: ref(`stk-${tag}`), info: { kind: 'sticker' } }, timestamp: at(6) },
    { ...base, providerMessageId: `after-stk-${tag}`, body: `despues del sticker ${tag}`, timestamp: at(7) },
  ];
  const reaction = (target: string, emoji: string) => ({ type: 'reaction', chatId: gid, targetProviderMessageId: target, emoji, senderPhone: ana, senderName: `Ana ${tag}`, fromMe: false });
  const reactions = [reaction(`txt-${tag}`, '👍'), reaction(`img-in-${tag}`, '🔥'), reaction(`img-out-${tag}`, '🔥'), reaction(`stk-${tag}`, '😂')];
  return { seed: { gid, title, tag }, messages, reactions };
}

type Geo = { chip: DOMRect; bubble: DOMRect; next: DOMRect; visible: boolean };

/** Dónde quedó el globito respecto de su burbuja y del mensaje que sigue. */
async function geometry(msg: Locator): Promise<Geo> {
  return msg.evaluate((el) => {
    const r = (x: Element) => x.getBoundingClientRect().toJSON() as DOMRect;
    const chip = el.querySelector('[data-testid="wa-reactions-chip"]')!;
    const bubble = el.querySelector('.gr-bubble')!;
    let next = el.nextElementSibling;
    while (next && !next.classList.contains('gr-msg')) next = next.nextElementSibling;
    const c = chip.getBoundingClientRect();
    // Entero a la vista: arriba, abajo y los dos extremos (dentro de la curva) son el globito, nada lo tapa ni lo recorta.
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    const pts = [
      [cx, c.top + 2],
      [cx, c.bottom - 2],
      [c.left + c.height / 2, cy],
      [c.right - c.height / 2, cy],
    ];
    const visible = pts.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === chip || chip.contains(hit));
    });
    return { chip: r(chip), bubble: r(bubble), next: r(next!), visible };
  });
}

function checkChip(g: Geo, side: 'in' | 'out', label: string) {
  const center = g.chip.top + g.chip.height / 2;
  // Sobre el borde de abajo de la burbuja: la mitad adentro, la mitad afuera.
  expect(Math.abs(center - g.bubble.bottom), `${label}: centro ${center} vs borde ${g.bubble.bottom}`).toBeLessThanOrEqual(6);
  // Del lado de quien escribe y dentro del ancho de la burbuja.
  expect(g.chip.left, `${label}: izquierda`).toBeGreaterThanOrEqual(g.bubble.left - 0.5);
  expect(g.chip.right, `${label}: derecha`).toBeLessThanOrEqual(g.bubble.right + 0.5);
  if (side === 'in') expect(g.chip.left - g.bubble.left, `${label}: cerca del borde izquierdo`).toBeLessThanOrEqual(16);
  else expect(g.bubble.right - g.chip.right, `${label}: cerca del borde derecho`).toBeLessThanOrEqual(16);
  expect(g.visible, `${label}: el globito se ve entero`).toBe(true);
  // No pisa el mensaje que sigue.
  expect(g.chip.bottom, `${label}: no pisa el siguiente`).toBeLessThanOrEqual(g.next.top);
}

async function checkThread(page: Page, scope: Locator, tag: string, prefix: string) {
  const byText = (text: string) => scope.locator('.gr-msg', { has: page.getByText(text, { exact: true }) });
  const text = byText(`texto ${tag}`);
  const photoIn = scope.locator('.gr-msg-in:not(.is-bare)', { has: page.locator('.wa-image img') }).filter({ has: page.getByTestId('wa-reactions-chip') });
  const photoOut = scope.locator('.gr-msg-out:not(.is-bare)', { has: page.locator('.wa-image img') }).filter({ has: page.getByTestId('wa-reactions-chip') });
  const sticker = scope.locator('.gr-msg.is-bare', { has: page.locator('.wa-image.is-sticker') });
  await expect(text.getByTestId('wa-reactions-chip')).toContainText('👍', { timeout: 30_000 });
  await expect(photoIn.getByTestId('wa-reactions-chip')).toContainText('🔥', { timeout: 30_000 });
  await expect(photoOut.getByTestId('wa-reactions-chip')).toContainText('🔥', { timeout: 30_000 });
  await expect(sticker.getByTestId('wa-reactions-chip')).toContainText('😂', { timeout: 30_000 });
  // La foto cargada (el alto de la burbuja es el de la foto).
  for (const m of [photoIn, photoOut]) await expect.poll(() => m.locator('.wa-image img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 30_000 }).toBe(true);

  for (const [msg, side, label] of [
    [text, 'in', `${prefix} texto`],
    [photoIn, 'in', `${prefix} foto entrante`],
    [photoOut, 'out', `${prefix} foto saliente`],
  ] as const) {
    // Al centro de la lista (abajo a la derecha está el botón de bajar al final). La lista puede volver al final
    // mientras cargan las fotos: se centra y se mide hasta que el globito se ve entero (o se agota el tiempo y
    // checkChip dice qué falla).
    await page.mouse.move(1, 1);
    const last: { g?: Geo } = {};
    await expect
      .poll(
        async () => {
          await msg.evaluate((el) => {
            const list = el.closest('.wa-messages') as HTMLElement;
            const at = el.getBoundingClientRect().top - list.getBoundingClientRect().top;
            list.scrollTop += at - list.clientHeight / 2 + el.getBoundingClientRect().height / 2;
          });
          last.g = await geometry(msg);
          return last.g.visible;
        },
        { timeout: 15_000 },
      )
      .toBe(true)
      .catch(() => {});
    checkChip(last.g!, side, label);
  }

  // La foto tiene el marquito de la burbuja (como WhatsApp): no llega al borde.
  for (const m of [photoIn, photoOut]) {
    const frame = await m.evaluate((el) => {
      const b = el.querySelector('.gr-bubble')!.getBoundingClientRect();
      const i = el.querySelector('.wa-image')!.getBoundingClientRect();
      return { left: i.left - b.left, right: b.right - i.right, top: i.top - b.top, bottom: b.bottom - i.bottom };
    });
    for (const side of ['left', 'right', 'top', 'bottom'] as const) expect(frame[side], `${prefix} marco ${side}`).toBeGreaterThanOrEqual(2);
    // La hora y los tildes no quedan debajo del globito.
    const clash = await m.evaluate((el) => {
      const chip = el.querySelector('[data-testid="wa-reactions-chip"]')!.getBoundingClientRect();
      return [...el.querySelectorAll('.gr-msg-foot time, .gr-msg-foot .wa-ticks')].some((x) => {
        const r = x.getBoundingClientRect();
        return r.left < chip.right && chip.left < r.right && r.top < chip.bottom && chip.top < r.bottom;
      });
    });
    expect(clash, `${prefix} la hora no queda debajo del globito`).toBe(false);
  }

  // Sticker (sin burbuja): el globito va debajo del sticker, del lado izquierdo, sin pisar lo que sigue.
  await sticker.scrollIntoViewIfNeeded();
  const s = await sticker.evaluate((el) => {
    const img = el.querySelector('.wa-image.is-sticker')!.getBoundingClientRect();
    const chip = el.querySelector('[data-testid="wa-reactions-chip"]')!.getBoundingClientRect();
    let next = el.nextElementSibling;
    while (next && !next.classList.contains('gr-msg')) next = next.nextElementSibling;
    return { img: img.toJSON() as DOMRect, chip: chip.toJSON() as DOMRect, next: next!.getBoundingClientRect().toJSON() as DOMRect };
  });
  expect(s.chip.top, `${prefix} sticker: debajo`).toBeGreaterThanOrEqual(s.img.bottom - 12);
  expect(s.chip.left - s.img.left, `${prefix} sticker: a la izquierda`).toBeLessThanOrEqual(16);
  expect(s.chip.bottom, `${prefix} sticker: no pisa el siguiente`).toBeLessThanOrEqual(s.next.top);
}

async function shots(page: Page, scope: Locator, tag: string, name: string) {
  if (!SHOTS) return;
  // Las dos fotos a la vista: el mensaje de entre las dos, al centro.
  await scope.locator('.gr-msg', { has: page.getByText(`despues de la foto ${tag}`, { exact: true }) }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Una navegación que el cambio de tamaño o de aspecto interrumpe (ERR_ABORTED) se repite una vez. */
async function goto(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
  } catch {
    await page.goto(url, { waitUntil: 'networkidle' });
  }
}

async function setLook(request: APIRequestContext, look: 'current' | 'retro') {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

/** 1280 y 390 en el aspecto actual (claro); con capturas, también Retro oscuro. */
async function eachSize(page: Page, request: APIRequestContext, open: () => Promise<Locator>, tag: string, app: string) {
  const runs: Array<[number, 'light' | 'dark', 'current' | 'retro']> = [
    [1280, 'light', 'current'],
    [390, 'light', 'current'],
  ];
  if (SHOTS) runs.push([1280, 'dark', 'retro'], [390, 'dark', 'retro']);
  try {
    for (const [width, scheme, look] of runs) {
      // Fuera de la app antes de cambiar el aspecto: una página abierta que se entera del cambio se recarga sola y
      // cortaba la navegación siguiente (net::ERR_ABORTED).
      const origin = new URL(page.url()).origin;
      await page.goto('about:blank');
      await setLook(request, look);
      await page.context().addCookies([
        { name: 'zs_theme', value: scheme, url: origin },
        { name: 'zs_look', value: look, url: origin },
      ]);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
      const scope = await open();
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await expect(scope.getByTestId('wa-reactions-chip')).toHaveCount(4, { timeout: 30_000 });
      await checkThread(page, scope, tag, `${app} ${width} ${look}`);
      await shots(page, scope, tag, `${app}-${width}-${look}-${scheme}`);
    }
  } finally {
    await setLook(request, 'current');
  }
}

test.describe('Inbox', () => {
  test('reacción sobre una foto: el globito monta el borde de la burbuja, como en el texto', async ({ page, request }) => {
    test.setTimeout(420_000);
    const errors = watchErrors(page);
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    const hook = `/api/inbox/webhook/${String(row.id)}/${String(row.webhook_secret)}`;
    const { seed, messages, reactions } = seedEvents('inbox');
    expect((await request.post(hook, { data: { events: messages } })).ok()).toBe(true);
    expect((await request.post(hook, { data: { events: reactions } })).ok()).toBe(true);
    await sql('UPDATE inbox_threads SET last_message_at = ? WHERE external_id = ?', [new Date().toISOString(), seed.gid]);

    // Con `next dev`, la primera vez compila cada ruta: se compilan antes (un 404 alcanza).
    await request.get('/api/inbox/threads/ibt_warmup');
    await request.get('/api/inbox/threads/ibt_warmup/wa?part=reactions&messages=x');
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await eachSize(
      page,
      request,
      async () => {
        await goto(page, '/en/app/inbox');
        const thread = page.locator('.ib-wa-thread');
        await page.locator('.ib-item', { hasText: seed.title }).locator('.ib-row-btn').click({ timeout: 60_000 });
        await expect(thread.getByRole('heading', { level: 2, name: seed.title })).toBeVisible({ timeout: 90_000 });
        return thread;
      },
      seed.tag,
      'inbox',
    );
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('Lines', () => {
  test('reacción sobre una foto: el globito monta el borde de la burbuja, como en el texto', async ({ page, request }) => {
    test.setTimeout(420_000);
    const errors = watchErrors(page);
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Media rx ${uid()}` } });
    const id = ((await created.json()) as { id: string }).id;
    await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
    await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
    const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
    const hook = new URL(info.webhookUrl).pathname;
    const { seed, messages, reactions } = seedEvents('lines');
    expect((await request.post(hook, { data: { events: messages } })).ok()).toBe(true);
    expect((await request.post(hook, { data: { events: reactions } })).ok()).toBe(true);

    await request.get('/api/groups/chats/warmup/members?reactions=x');
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await eachSize(
      page,
      request,
      async () => {
        await goto(page, '/en/app/lines/inbox');
        await page.locator('.gr-row', { hasText: seed.title }).click({ timeout: 120_000 });
        await expect(page.getByRole('heading', { level: 2, name: seed.title })).toBeVisible({ timeout: 90_000 });
        return page.locator('.wa-messages');
      },
      seed.tag,
      'lines',
    );
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
