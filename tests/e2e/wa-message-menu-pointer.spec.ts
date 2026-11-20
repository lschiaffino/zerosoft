import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * El menú de un mensaje (Responder, Reaccionar, Destacar, Reenviar, Copiar, Eliminar…) en Inbox y en Lines,
 * a 1280 y 390, como WhatsApp en la compu:
 * - el clic derecho lo abre en el puntero (la esquina de arriba a la izquierda en el clic), no en la flecha;
 * - cerca de la esquina de abajo a la derecha se da vuelta (hacia la izquierda y arriba) y queda entero en la
 *   ventana: cada ítem se puede tocar (antes "Eliminar" quedaba cortado abajo);
 * - la flecha sigue abriéndolo pegado a la burbuja;
 * - Esc y un clic afuera lo cierran; al abrir, el foco va al primer ítem.
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 180_000 });

const FIRST_MS = 60_000;
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

interface App {
  send: (events: unknown[]) => Promise<void>;
  chatOf: (jid: string) => Promise<string>;
  open: (page: Page, chatId: string, name: string) => Promise<Locator>;
}

async function inboxApp(request: APIRequestContext): Promise<App> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return {
    send: async (events) => {
      const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
      expect(res.ok(), await res.text()).toBe(true);
    },
    chatOf: async (jid) => String((await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), jid]))[0]?.id ?? ''),
    open: async (page, id, name) => {
      await page.goto(`/en/app/inbox?t=${id}`, { waitUntil: 'networkidle' });
      const thread = page.locator('.ib-wa-thread');
      await expect(thread.locator('.gr-thread-head')).toContainText(name, { timeout: FIRST_MS });
      return thread;
    },
  };
}

async function linesApp(request: APIRequestContext): Promise<App> {
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Menú ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  return {
    send: async (events) => {
      const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
      expect(res.ok(), await res.text()).toBe(true);
    },
    chatOf: async (jid) => String((await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, jid]))[0]?.id ?? ''),
    open: async (page, id, name) => {
      await page.goto(`/en/app/lines/inbox/${id}`, { waitUntil: 'networkidle' });
      const thread = page.locator('.gr-thread').first();
      await expect(thread.locator('.gr-thread-head')).toContainText(name, { timeout: FIRST_MS });
      return thread;
    },
  };
}

const apps = { inbox: inboxApp, lines: linesApp } as const;

const LONG =
  'Te cuento cómo quedó todo para el sábado: llegamos a las diez, armamos las mesas del patio y la parrilla, ' +
  'después vamos a buscar las sillas que faltan al depósito y a la tarde probamos el sonido con la banda. ' +
  'Si llueve pasamos todo al salón de adentro, que ya está reservado, y avisamos en el grupo con tiempo.';

function textEvent(jid: string, name: string, body: string, at: Date, fromMe = false) {
  return {
    type: 'message',
    chatId: jid,
    isGroup: false,
    fromMe,
    senderPhone: fromMe ? '' : jid.replace(/@.*/, ''),
    senderName: fromMe ? '' : name,
    providerMessageId: `mm-${uid()}`,
    body,
    timestamp: at.toISOString(),
    ...(fromMe ? { status: 'sent' } : {}),
  };
}

const menuOf = (page: Page) => page.locator('.gr-menu-list.is-portal[role="menu"]');

/** Cada ítem se puede tocar: el punto del medio de cada uno cae en ese ítem (nada lo tapa ni lo corta). */
async function everyItemReachable(menu: Locator) {
  const misses = await menu.evaluate((list) =>
    [...list.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .filter((it) => {
        const r = it.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !hit || !it.contains(hit);
      })
      .map((it) => it.textContent),
  );
  expect(misses).toEqual([]);
}

async function insideViewport(page: Page, el: Locator) {
  const b = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(8 - 1);
  expect(b.y).toBeGreaterThanOrEqual(8 - 1);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width - 8 + 1);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height - 8 + 1);
}

for (const width of [1280, 390]) {
  for (const appName of ['inbox', 'lines'] as const) {
    test(`${appName} ${width}px: el clic derecho abre el menú del mensaje en el puntero; la flecha, en la burbuja`, async ({ page, request }, info) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
      const app = await apps[appName](request);
      const jid = `${phone()}@s.whatsapp.net`;
      const name = `Puntero ${uid()}`;
      // El largo arriba, después varios cortos y al final uno mío (a la derecha, abajo de todo).
      const now = Date.now();
      const fillers = Array.from({ length: 12 }, (_, i) => textEvent(jid, name, `corto ${i + 1}`, new Date(now - (20 - i) * 1000)));
      await app.send([textEvent(jid, name, LONG, new Date(now - 30_000)), ...fillers, textEvent(jid, name, `listo, nos vemos ${uid()}`, new Date(now - 2_000), true)]);
      const id = await app.chatOf(jid);
      expect(id).not.toBe('');
      const thread = await app.open(page, id, name);
      const longMsg = thread.locator('[data-testid="wa-message"]', { hasText: 'Te cuento cómo quedó' });
      const lastMsg = thread.locator('[data-testid="wa-message"].gr-msg-out').last();
      await expect(longMsg).toBeVisible({ timeout: FIRST_MS });
      await expect(lastMsg).toBeVisible();
      const menu = menuOf(page);

      // 1) Clic derecho cerca del borde izquierdo del mensaje largo, con el mensaje arriba en la lista: el menú
      // abre con su esquina de arriba a la izquierda en el clic.
      await longMsg.evaluate((el) => {
        const box = el.closest('.wa-messages') as HTMLElement;
        box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
      });
      const lb = (await longMsg.locator('.gr-bubble').first().boundingBox())!;
      const p1 = { x: Math.round(lb.x + 10), y: Math.round(lb.y + 14) };
      await page.mouse.click(p1.x, p1.y, { button: 'right' });
      await expect(menu).toBeVisible();
      const m1 = (await menu.boundingBox())!;
      // Que entre abajo es la condición de esta parte (si no entrara, se daría vuelta: eso es la parte 2).
      expect(p1.y + m1.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8);
      expect(Math.abs(m1.x - p1.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(m1.y - p1.y)).toBeLessThanOrEqual(3);
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      await expect(menu.getByRole('menuitem', { name: 'Reply', exact: true })).toBeVisible();
      await everyItemReachable(menu);
      await page.screenshot({ path: info.outputPath(`${appName}-${width}-pointer.png`) });

      // Esc lo cierra y el foco queda en el mensaje (en su flecha).
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect.poll(() => longMsg.evaluate((el) => el.contains(document.activeElement))).toBe(true);

      // Otro clic derecho en otro punto del mismo mensaje: el menú va a ese punto.
      const p1b = { x: Math.round(lb.x + Math.min(lb.width - 10, 60)), y: Math.round(lb.y + Math.min(lb.height - 6, 40)) };
      await page.mouse.click(p1b.x, p1b.y, { button: 'right' });
      await expect(menu).toBeVisible();
      const m1b = (await menu.boundingBox())!;
      expect(Math.abs(m1b.x - p1b.x) <= 3 || Math.abs(m1b.x + m1b.width - p1b.x) <= 3).toBe(true);
      expect(Math.abs(m1b.y - p1b.y)).toBeLessThanOrEqual(3);

      // Un clic afuera lo cierra.
      const fb = (await thread.locator('[data-testid="wa-message"]', { hasText: 'corto 6' }).locator('.gr-bubble').first().boundingBox())!;
      await page.mouse.click(fb.x + 6, fb.y + fb.height / 2);
      await expect(menu).toHaveCount(0);

      // 2) Abajo a la derecha (el último mensaje, mío): se da vuelta hacia la izquierda y arriba y queda entero.
      await thread.locator('.wa-messages').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await expect(lastMsg).toBeInViewport();
      const ob = (await lastMsg.locator('.gr-bubble').first().boundingBox())!;
      const p2 = { x: Math.round(ob.x + ob.width - 6), y: Math.round(ob.y + ob.height - 5) };
      await page.mouse.click(p2.x, p2.y, { button: 'right' });
      await expect(menu).toBeVisible();
      const m2 = (await menu.boundingBox())!;
      await insideViewport(page, menu);
      // Hacia arriba: su borde de abajo en el clic (o más arriba si no entra entero).
      expect(m2.y + m2.height).toBeLessThanOrEqual(p2.y + 3);
      if (p2.x + m2.width > page.viewportSize()!.width - 8) expect(m2.x + m2.width).toBeLessThanOrEqual(p2.x + 3);
      await expect(menu.getByRole('menuitem').last()).toBeInViewport({ ratio: 1 });
      await everyItemReachable(menu);
      await page.screenshot({ path: info.outputPath(`${appName}-${width}-flipped.png`) });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);

      // 3) La flecha sigue abriéndolo pegado a la burbuja (arriba o abajo de la flecha, a su lado).
      await longMsg.evaluate((el) => {
        const box = el.closest('.wa-messages') as HTMLElement;
        box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
      });
      await longMsg.locator('.gr-bubble').first().hover();
      const chevron = longMsg.locator('.wa-chevron').first();
      await chevron.click();
      await expect(menu).toBeVisible();
      const c = (await chevron.boundingBox())!;
      const m3 = (await menu.boundingBox())!;
      const vGap = Math.max(0, m3.y - (c.y + c.height), c.y - (m3.y + m3.height));
      expect(vGap).toBeLessThanOrEqual(6);
      // Alineado a la flecha: la cubre de costado (borde izquierdo de un mensaje recibido).
      expect(m3.x).toBeLessThanOrEqual(c.x + c.width);
      expect(m3.x + m3.width).toBeGreaterThanOrEqual(c.x);
      await insideViewport(page, menu);
      await everyItemReachable(menu);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(chevron).toBeFocused();

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
}
