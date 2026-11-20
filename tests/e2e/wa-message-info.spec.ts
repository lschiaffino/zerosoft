import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Info del mensaje en Inbox y Lines, con el WhatsApp falso (GROUPS_FAKE=1):
 * en un grupo, el cuadro al lado del mensaje con "Leído por" y "Entregado a"
 * (cada persona con su hora, siete filas y "ver más"), pedido al gateway
 * falso como el parche 0013; en un 1:1, "Leído" y "Entregado" con su hora
 * (las tildes del webhook). Esc y un clic afuera lo cierran; a 390 es una
 * hoja y no hay scroll de costado. Con INFO_SHOTS=<carpeta> guarda capturas
 * en el aspecto actual claro y en retro oscuro. Nombres y números inventados.
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
const SHOTS = process.env.INFO_SHOTS ?? '';
const NAMES = ['Ana', 'Beto', 'Carla', 'Dario', 'Eva', 'Fede', 'Gala', 'Hugo', 'Ines'];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function message(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message',
    chatId,
    isGroup: chatId.endsWith('@g.us'),
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: '',
    providerMessageId: `e2e-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

/** Un grupo con nueve personas que escribieron y un mensaje propio: ocho lo leyeron, una solo lo recibió. */
function groupScene(tag: string) {
  const gid = groupId();
  const title = `Info ${tag}`;
  const people = NAMES.map((n) => ({ name: `${n} ${tag}`, phone: phone() }));
  const outId = `info-out-${tag}`;
  const base = Date.now() - 3600_000;
  const at = (min: number) => new Date(base + min * 60_000).toISOString();
  const events: unknown[] = [
    ...people.map((p, i) => message(gid, { chatName: title, senderPhone: p.phone, senderName: p.name, body: `hola ${i} ${tag}`, timestamp: at(i) })),
    message(gid, { chatName: title, fromMe: true, senderPhone: '', providerMessageId: outId, body: `reunión a las 10 ${tag}`, timestamp: at(12) }),
    {
      type: 'fake_receipts',
      providerMessageId: outId,
      receipts: people.map((p, i) => (i < 8 ? { phone: p.phone, deliveredAt: at(13), readAt: at(14 + i) } : { phone: p.phone, deliveredAt: at(13) })),
    },
  ];
  return { gid, title, people, outId, events, body: `reunión a las 10 ${tag}` };
}

/** Un 1:1 con un mensaje propio entregado y leído (las tildes llegan por el webhook). */
function dmScene(tag: string) {
  const who = phone();
  const chat = `${who}@s.whatsapp.net`;
  const name = `Julia ${tag}`;
  const outId = `info-dm-${tag}`;
  return {
    name,
    first: [message(chat, { senderPhone: who, senderName: name, body: `¿llegaste? ${tag}` }), message(chat, { fromMe: true, senderPhone: '', providerMessageId: outId, body: `sí, ya estoy ${tag}` })],
    ticks: [
      [{ type: 'status', providerMessageId: outId, status: 'delivered' }],
      [{ type: 'status', providerMessageId: outId, status: 'read' }],
    ],
    body: `sí, ya estoy ${tag}`,
  };
}

async function openInfo(page: Page, bubble: Locator) {
  await bubble.scrollIntoViewIfNeeded();
  await bubble.hover();
  await bubble.locator('.wa-chevron').first().click();
  await page.getByTestId('menu-info').click();
  const pop = page.getByTestId('wa-message-info');
  await expect(pop).toBeVisible();
  return pop;
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

/** El cuadro de un grupo: secciones, horas, "ver más", y cierre con Esc y con un clic afuera. */
async function checkGroup(page: Page, bubble: Locator, scene: ReturnType<typeof groupScene>, wide: boolean) {
  const pop = await openInfo(page, bubble);
  await expect(pop.getByTestId('wa-info-read')).toBeVisible({ timeout: 20_000 });
  const read = pop.getByTestId('wa-info-read');
  await expect(read.getByTestId('wa-info-person')).toHaveCount(7);
  // Lo más nuevo arriba: la última que leyó.
  // El nombre de perfil va con "~", como en WhatsApp.
  await expect(read.getByTestId('wa-info-person-name').first()).toHaveText(new RegExp(`${scene.people[7].name}$`));
  await expect(read.getByTestId('wa-info-person-time').first()).toHaveText(/\d/);
  await read.getByTestId('wa-info-more').click();
  await expect(read.getByTestId('wa-info-person')).toHaveCount(8);
  await expect(read.getByTestId('wa-info-more')).toHaveAttribute('aria-expanded', 'true');
  const delivered = pop.getByTestId('wa-info-delivered');
  await expect(delivered.getByTestId('wa-info-person')).toHaveCount(1);
  await expect(delivered.getByTestId('wa-info-person-name')).toHaveText(new RegExp(`${scene.people[8].name}$`));
  await expect(delivered.getByTestId('wa-info-person-time')).toHaveText(/\d/);
  await expect(pop.getByTestId('wa-info-unavailable')).toHaveCount(0);
  await expect(pop).toContainText(scene.body);
  if (wide) {
    // Al lado del mensaje (a su izquierda) y dentro de la ventana.
    const [p, b] = [(await pop.boundingBox())!, (await bubble.locator('.gr-bubble').first().boundingBox())!];
    expect(p.x + p.width).toBeLessThanOrEqual(b.x + 1);
    expect(p.y).toBeGreaterThanOrEqual(0);
  }
  await noSideScroll(page);
  // El foco está adentro: Tab llega a los botones del cuadro.
  await page.keyboard.press('Tab');
  expect(await pop.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  // Un clic afuera también lo cierra.
  await openInfo(page, bubble);
  await expect(pop.getByTestId('wa-info-read')).toBeVisible({ timeout: 20_000 });
  await page.mouse.click(wide ? 5 : 195, wide ? 5 : 60);
  await expect(pop).toBeHidden();
}

/** El cuadro de un 1:1: leído y entregado, cada uno con su hora. */
async function checkDm(page: Page, bubble: Locator) {
  const pop = await openInfo(page, bubble);
  await expect(pop.getByTestId('wa-info-read-time')).toHaveText(/\d/, { timeout: 20_000 });
  await expect(pop.getByTestId('wa-info-delivered-time')).toHaveText(/\d/);
  await expect(pop.getByTestId('wa-info-sent')).toContainText(/\d/);
  await expect(pop.getByTestId('wa-info-person')).toHaveCount(0);
  await noSideScroll(page);
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
}

async function setLook(page: Page, request: APIRequestContext, look: 'current' | 'retro', theme: 'light' | 'dark') {
  expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
  await page.context().addCookies([{ name: 'zs_theme', value: theme, url: page.url() || 'http://localhost' }]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.describe('Lines', () => {
  async function fakeNumber(request: APIRequestContext): Promise<{ id: string; webhookUrl: string }> {
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Info ${uid()}` } });
    const id = ((await created.json()) as { id: string }).id;
    await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
    await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
    const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
    return { id, webhookUrl: info.webhookUrl };
  }

  for (const width of [1280, 390]) {
    test(`grupo y 1:1 a ${width}: leído por, entregado a y horas`, async ({ page, request }) => {
      test.setTimeout(420_000);
      const errors = watchErrors(page);
      const n = await fakeNumber(request);
      const send = async (list: unknown[]) => expect((await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
      const tag = uid();
      const g = groupScene(tag);
      const d = dmScene(tag);
      await send(g.events);
      await send(d.first);
      for (const t of d.ticks) await send(t);

      // Con `next dev`, la primera vez compila cada ruta: se compila antes (un 404 alcanza).
      await request.get('/api/groups/chats/warmup/members?info=x');
      await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await page.locator('.gr-row', { hasText: g.title }).click({ timeout: 60_000 });
      // Con `next dev` la primera apertura de un chat compila la página: se espera el título.
      await expect(page.getByRole('heading', { level: 2, name: g.title })).toBeVisible({ timeout: 150_000 });
      const bubble = page.locator('.gr-msg-out', { hasText: g.body });
      await expect(bubble).toBeVisible({ timeout: 30_000 });
      await checkGroup(page, bubble, g, width > 600);
      if (SHOTS && width > 600) {
        try {
          for (const [look, theme] of [['current', 'light'], ['retro', 'dark']] as const) {
            for (const w of [1280, 390]) {
              await setLook(page, request, look, theme);
              await page.setViewportSize({ width: w, height: w > 600 ? 800 : 844 });
              await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
              await page.locator('.gr-row', { hasText: g.title }).click({ timeout: 60_000 });
              await expect(page.getByRole('heading', { level: 2, name: g.title })).toBeVisible({ timeout: 150_000 });
              const pop = await openInfo(page, page.locator('.gr-msg-out', { hasText: g.body }));
              await expect(pop.getByTestId('wa-info-read')).toBeVisible({ timeout: 20_000 });
              await page.waitForTimeout(250);
              await page.screenshot({ path: `${SHOTS}/lines-group-${look}-${theme}-${w}.png` });
              await page.keyboard.press('Escape');
            }
          }
        } finally {
          await setLook(page, request, 'current', 'light');
        }
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      }

      if (width <= 600) await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      // La fila del 1:1 por su último mensaje (el nombre puede ser el número).
      await page.locator('.gr-row', { hasText: d.body }).click({ timeout: 60_000 });
      const dmBubble = page.locator('.gr-msg-out', { hasText: d.body });
      await expect(dmBubble).toBeVisible({ timeout: 150_000 });
      await checkDm(page, dmBubble);
      if (SHOTS && width > 600) {
        await openInfo(page, dmBubble);
        await expect(page.getByTestId('wa-info-read-time')).toHaveText(/\d/, { timeout: 20_000 });
        await page.screenshot({ path: `${SHOTS}/lines-dm-current-light-1280.png` });
        await page.keyboard.press('Escape');
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('gateway sin el parche: aviso tranquilo en el grupo', async ({ page, request }) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    const n = await fakeNumber(request);
    const send = async (list: unknown[]) => expect((await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
    const tag = uid();
    const g = groupScene(tag);
    await send([{ type: 'fake_receipts_unsupported', on: true }, ...g.events.slice(0, -1)]);
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('.gr-row', { hasText: g.title }).click({ timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 2, name: g.title })).toBeVisible({ timeout: 150_000 });
    const bubble = page.locator('.gr-msg-out', { hasText: g.body });
    await expect(bubble).toBeVisible({ timeout: 30_000 });
    const pop = await openInfo(page, bubble);
    await expect(pop.getByTestId('wa-info-unavailable')).toBeVisible({ timeout: 20_000 });
    await expect(pop.getByTestId('wa-info-person')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('Inbox', () => {
  async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    return { id: String(row.id), secret: String(row.webhook_secret) };
  }

  for (const width of [1280, 390]) {
    test(`grupo y 1:1 a ${width}: leído por, entregado a y horas`, async ({ page, request }) => {
      test.setTimeout(420_000);
      const errors = watchErrors(page);
      const acc = await linkWhatsapp(request);
      const send = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } })).ok()).toBe(true);
      const tag = uid();
      const g = groupScene(tag);
      const d = dmScene(tag);
      await send(g.events);
      await send(d.first);
      for (const t of d.ticks) await send(t);

      await request.get('/api/inbox/threads/ibt_warmup/wa?part=info&message=x');
      await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await page.locator('.ib-item', { hasText: g.title }).locator('.ib-row-btn').click({ timeout: 60_000 });
      const thread = page.locator('.ib-wa-thread');
      const bubble = thread.locator('.gr-msg-out', { hasText: g.body });
      await expect(bubble).toBeVisible({ timeout: 150_000 });
      await checkGroup(page, bubble, g, width > 600);
      if (SHOTS && width > 600) {
        try {
          for (const [look, theme] of [['current', 'light'], ['retro', 'dark']] as const) {
            for (const w of [1280, 390]) {
              await setLook(page, request, look, theme);
              await page.setViewportSize({ width: w, height: w > 600 ? 800 : 844 });
              await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
              await page.locator('.ib-item', { hasText: g.title }).locator('.ib-row-btn').click({ timeout: 60_000 });
              const pop = await openInfo(page, page.locator('.ib-wa-thread .gr-msg-out', { hasText: g.body }));
              await expect(pop.getByTestId('wa-info-read')).toBeVisible({ timeout: 20_000 });
              await page.waitForTimeout(250);
              await page.screenshot({ path: `${SHOTS}/inbox-group-${look}-${theme}-${w}.png` });
              await page.keyboard.press('Escape');
            }
          }
        } finally {
          await setLook(page, request, 'current', 'light');
        }
        await page.setViewportSize({ width, height: 800 });
      }

      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await page.locator('.ib-item', { hasText: d.body }).locator('.ib-row-btn').click({ timeout: 60_000 });
      const dmBubble = page.locator('.ib-wa-thread .gr-msg-out', { hasText: d.body });
      await expect(dmBubble).toBeVisible({ timeout: 150_000 });
      await checkDm(page, dmBubble);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});
