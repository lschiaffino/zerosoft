import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * "Cargar mensajes anteriores" en Inbox y en Lines, con el WhatsApp falso: un
 * chat cuyo número empieza con 1777 tiene 70 mensajes anteriores en "el
 * teléfono" (uno con 1778, el teléfono no responde). La ficha aparece arriba
 * cuando lo guardado se termina; al tocarla entran los anteriores sin mover lo
 * que se estaba leyendo; cuando el teléfono no tiene más, lo dice; si falla,
 * se puede reintentar; con la línea desvinculada no se puede tocar y dice por
 * qué. En Lines, solo quien ve el chat puede pedirlo. Con LO_SHOTS=<carpeta>
 * guarda capturas a 1280 y 390, claro y oscuro.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

/** Con `next dev` la primera vez que se pide una ruta se compila: se piden una vez antes, con margen. */
test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  const ctx = await playwright.request.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT) || 3210}` });
  try {
    for (const url of ['/api/inbox/threads/warm', '/api/inbox/threads/warm/messages', '/api/groups/chats/warm/messages']) await ctx.get(url, { timeout: 280_000 }).catch(() => null);
  } finally {
    await ctx.dispose();
  }
});

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function shot(page: Page, name: string) {
  const dir = process.env.LO_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** Lo que ya está guardado del chat: 30 mensajes de la última hora. */
function stored(chatId: string, phone: string, name: string, tag: string): Array<Record<string, unknown>> {
  return Array.from({ length: 30 }, (_, i) => ({
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: i % 3 === 2,
    senderPhone: i % 3 === 2 ? '' : phone,
    senderName: i % 3 === 2 ? '' : name,
    providerMessageId: `s${i}-${tag}`,
    body: i === 0 ? `Primero guardado ${tag}` : `Guardado ${i} ${tag}`,
    timestamp: new Date(Date.now() - 3_600_000 + i * 60_000).toISOString(),
  }));
}

const chip = (thread: Locator) => thread.getByTestId('wa-older-history');

/** Lo mismo en las dos apps. `scroller`: la caja que se desplaza. */
async function loadsOlder(page: Page, thread: Locator, scroller: Locator, tag: string, app: string) {
  const c = chip(thread);
  await expect(c).toHaveAttribute('data-state', 'idle', { timeout: 30_000 });
  await expect(c.getByRole('button')).toHaveText('Load older messages');
  // Arriba de todo, leyendo el primero guardado.
  const first = thread.locator('.gr-msg', { hasText: `Primero guardado ${tag}` });
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await expect(first).toBeInViewport();
  await shot(page, `${app}-chip`);
  const before = (await first.boundingBox())!.y;

  // 1. Tocar: entran 50 anteriores y lo que se estaba leyendo queda donde estaba.
  await c.getByRole('button').click();
  await expect(thread.locator('.gr-msg', { hasText: /^Mensaje anterior 50/ }).or(thread.getByText('Mensaje anterior 50', { exact: true })).first()).toBeAttached({ timeout: 90_000 });
  await expect(c).toHaveAttribute('data-state', 'idle', { timeout: 30_000 });
  await expect(first).toBeInViewport();
  expect(Math.abs((await first.boundingBox())!.y - before)).toBeLessThan(60);
  // Están en orden: el 1 es el más cercano a lo guardado, arriba suyo los más viejos.
  await expect(thread.getByText('Mensaje anterior 1', { exact: true })).toBeAttached();

  // 2. Otra vez (enseguida, como dos toques seguidos): los 20 que quedan.
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await c.getByRole('button').click();
  await expect(c).toHaveAttribute('data-state', 'loading');
  await shot(page, `${app}-loading`);
  await expect(thread.getByText('Mensaje anterior 70', { exact: true })).toBeAttached({ timeout: 90_000 });
  await expect(c).toHaveAttribute('data-state', 'idle', { timeout: 30_000 });

  // 3. El teléfono no tiene más: lo dice, y ya no es un botón.
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await c.getByRole('button').click();
  await expect(c).toHaveAttribute('data-state', 'none', { timeout: 90_000 });
  await expect(c).toHaveText('No older messages on WhatsApp');
  await expect(c.getByRole('button')).toHaveCount(0);
  // Nada repetido.
  await expect(thread.getByText('Mensaje anterior 50', { exact: true })).toHaveCount(1);
  await shot(page, `${app}-none`);
}

async function themes(page: Page, context: BrowserContext, baseURL: string, name: string, open: () => Promise<Locator>) {
  if (!process.env.LO_SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 860 });
      const c = await open();
      await expect(c).toBeVisible({ timeout: 30_000 });
      await c.scrollIntoViewIfNeeded();
      if (width === 390) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `${name}-${width}-${theme}`);
    }
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL }]);
  await page.setViewportSize({ width: 1280, height: 860 });
}

test('Inbox: la ficha carga los mensajes anteriores del teléfono, dice cuando no hay más, y sin línea no se puede', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const post = async (events: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const tag = uid();
  const phone = `1777${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const name = `Olga Historial ${uid()}`;
  await post(stored(`${phone}@s.whatsapp.net`, phone, name, tag));
  // Un chat cuyo teléfono no responde.
  const badPhone = `1778${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const badName = `Omar Sin Respuesta ${uid()}`;
  await post(stored(`${badPhone}@s.whatsapp.net`, badPhone, badName, `b${tag}`).slice(0, 3));

  const open = async (who: string) => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: who }).locator('.ib-row-btn').click();
    const heading = page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name: who });
    const again = page.getByRole('button', { name: 'Try again' });
    for (let i = 0; i < 6; i++) {
      await expect(heading.or(again).first()).toBeVisible({ timeout: 40_000 });
      if (await heading.isVisible()) break;
      await again.click();
    }
    return page.locator('.ib-wa-thread');
  };
  const thread = await open(name);
  await loadsOlder(page, thread, thread.locator('.wa-messages'), tag, 'inbox');
  const [t] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), `${phone}@s.whatsapp.net`]);
  expect(Number((await sql('SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ?', [String(t.id)]))[0].n)).toBe(100);

  // El teléfono falla: error, y se puede reintentar.
  const bad = await open(badName);
  await chip(bad).getByRole('button').click();
  await expect(chip(bad)).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
  await expect(chip(bad).getByRole('button')).toBeEnabled();
  await shot(page, 'inbox-error');

  await themes(page, context, baseURL!, 'inbox-idle', async () => chip(await open(badName)));

  // Con la línea desvinculada: la ficha no se puede tocar y dice por qué.
  await sql("UPDATE inbox_accounts SET status = 'disconnected' WHERE id = ?", [String(acc.id)]);
  try {
    const off = await open(badName);
    await expect(chip(off)).toHaveAttribute('data-state', 'offline', { timeout: 30_000 });
    await expect(chip(off).getByRole('button')).toBeDisabled();
    await expect(chip(off)).toContainText('Line disconnected');
    await themes(page, context, baseURL!, 'inbox-offline', async () => chip(await open(badName)));
  } finally {
    await sql("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?", [String(acc.id)]);
  }
});

test('Lines: la ficha carga los mensajes anteriores del teléfono, y solo quien ve el chat puede pedirlo', async ({ page, request, context, baseURL, playwright }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Historial ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 })
      .toBe('connected');
    const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const tag = uid();
    const phone = `1777${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const chatId = `${phone}@s.whatsapp.net`;
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events: stored(chatId, phone, `Olga Historial ${uid()}`, tag) } });
    expect(res.ok(), await res.text()).toBe(true);
    const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, chatId]);

    const open = async () => {
      await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
      return page.locator('.wa-thread');
    };
    const thread = await open();
    await loadsOlder(page, thread, thread.locator('.wa-messages'), tag, 'lines');
    expect(Number((await sql('SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ?', [String(chat.id)]))[0].n)).toBe(100);

    // Otra persona, de otro workspace, no puede pedir el historial de este chat.
    const ctx = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [{ name: 'zs_e2e_as', value: `otra-${uid()}@own-e2e.test`, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
    });
    try {
      expect((await ctx.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Otra', locale: 'en' } })).ok()).toBe(true);
      expect([403, 404]).toContain((await ctx.post(`/api/groups/chats/${chat.id}`, { data: { action: 'loadOlder' } })).status());
    } finally {
      await ctx.dispose();
    }

    // Con la línea desvinculada: no se puede tocar y dice por qué.
    await sql("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?", [numberId]);
    // Otro chat de la misma línea, sin pedidos anteriores.
    const phone2 = `1777${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    await sql("UPDATE groups_numbers SET status = 'connected' WHERE id = ?", [numberId]);
    const res2 = await request.post(new URL(webhookUrl).pathname, { data: { events: stored(`${phone2}@s.whatsapp.net`, phone2, `Omar Historial ${uid()}`, `c${tag}`).slice(0, 4) } });
    expect(res2.ok()).toBe(true);
    const [chat2] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, `${phone2}@s.whatsapp.net`]);
    const open2 = async () => {
      await page.goto(`/en/app/lines/inbox/${chat2.id}`, { waitUntil: 'networkidle' });
      return chip(page.locator('.wa-thread'));
    };
    await themes(page, context, baseURL!, 'lines-idle', open2);
    await sql("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?", [numberId]);
    const off = await open2();
    await expect(off).toHaveAttribute('data-state', 'offline', { timeout: 30_000 });
    await expect(off.getByRole('button')).toBeDisabled();
    await themes(page, context, baseURL!, 'lines-offline', open2);
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
