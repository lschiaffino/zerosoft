import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * "Fetch missing messages" en el menú del chat, Inbox y Lines, con el
 * WhatsApp falso. `fake_dropped` hace que el teléfono se guarde un mensaje
 * sin avisar (como cuando la línea estuvo caída): solo vuelve si se le pide
 * el historial anterior al último mensaje. Un chat cuyo número empieza con
 * 1779 tiene un teléfono que no contesta; con 1776, un gateway que no acepta
 * nuestra ancla (sin el parche 0006). La franja arriba de la conversación dice
 * qué pasó: cuántos trajo, que el teléfono no respondió (con reintentar), que
 * la línea está desconectada o que el gateway necesita la actualización. A
 * 1280 y a 390, sin scroll de costado. Con RM_SHOTS=<carpeta> guarda
 * capturas, claro y oscuro.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 360_000 });

// Una persona y un workspace propios: la prueba desvincula la línea, y eso no puede tocar la cuenta de otras pruebas.
ownWorkspace('wa-refresh');

/** Con `next dev` la primera vez que se pide una ruta se compila: se piden una vez antes, con margen. */
test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  const ctx = await playwright.request.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT) || 3210}` });
  try {
    for (const url of ['/api/inbox/threads/warm', '/api/inbox/threads/warm/messages', '/api/inbox/threads/warm/wa', '/api/groups/chats/warm', '/api/groups/chats/warm/messages']) await ctx.get(url, { timeout: 280_000 }).catch(() => null);
  } finally {
    await ctx.dispose();
  }
});

const uid = () => Math.random().toString(36).slice(2, 8);
const phoneWith = (prefix: string) => `${prefix}${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function shot(page: Page, name: string) {
  const dir = process.env.RM_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

function message(chatId: string, phone: string, name: string, id: string, body: string, minutesAgo: number, fromMe = false) {
  return {
    type: 'message',
    chatId,
    isGroup: false,
    fromMe,
    senderPhone: fromMe ? '' : phone,
    senderName: fromMe ? '' : name,
    providerMessageId: id,
    body,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

/** Un chat con dos mensajes guardados y, entre ellos, uno que solo tiene el teléfono (días antes del último). */
function chat(prefix: string, tag: string) {
  const phone = phoneWith(prefix);
  const jid = `${phone}@s.whatsapp.net`;
  const name = `Rita Prueba ${tag}`;
  return {
    phone,
    jid,
    name,
    stored: [message(jid, phone, name, `a-${tag}`, `primero ${tag}`, 3 * 24 * 60), message(jid, phone, name, `c-${tag}`, `tercero ${tag}`, 10)],
    dropped: { type: 'fake_dropped', message: message(jid, phone, name, `b-${tag}`, `segundo ${tag}`, 2 * 24 * 60, true) },
  };
}

const bar = (page: Page) => page.getByTestId('wa-refresh-missing');

/** Abre el menú del chat, prueba que cierra con Esc y tocando afuera, y elige "Fetch missing messages". */
async function fetchMissing(page: Page, menuName: string, checkClose = false) {
  const trigger = page.locator('.wa-head').getByRole('button', { name: menuName, exact: true });
  const item = page.getByRole('menuitem', { name: 'Fetch missing messages' });
  if (checkClose) {
    await trigger.click();
    await expect(item).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(item).toBeHidden();
    await trigger.click();
    await expect(item).toBeVisible();
    await page.mouse.click(5, (page.viewportSize()?.height ?? 800) - 5);
    await expect(item).toBeHidden();
  }
  await trigger.click();
  await item.click();
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** La misma franja, en claro y en oscuro, para mirarla. */
async function themes(page: Page, context: BrowserContext, baseURL: string, name: string) {
  if (!process.env.RM_SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await shot(page, `${name}-${theme}`);
  }
  await context.addCookies([{ name: 'zs_theme', value: 'light', url: baseURL }]);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
}

/** Lo mismo en las dos apps: trae el que faltaba, en orden y una sola vez. */
async function bringsTheMissingOne(page: Page, thread: Locator, tag: string, menuName: string, shotName: string, context: BrowserContext, baseURL: string, checkClose: boolean) {
  await expect(thread.getByText(`tercero ${tag}`)).toBeVisible({ timeout: 40_000 });
  await expect(thread.getByText(`segundo ${tag}`)).toHaveCount(0);
  await fetchMissing(page, menuName, checkClose);
  await expect(bar(page)).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
  await expect(bar(page)).toContainText('Brought 1 missing message');
  await expect(thread.getByText(`segundo ${tag}`)).toHaveCount(1, { timeout: 30_000 });
  // En su lugar: entre el primero y el tercero.
  const order = await thread.locator('.gr-msg').evaluateAll((els, t) => els.map((e) => e.textContent ?? '').filter((x) => x.includes(t as string)), tag);
  const pos = (w: string) => order.findIndex((x) => x.includes(`${w} ${tag}`));
  expect(pos('primero')).toBeLessThan(pos('segundo'));
  expect(pos('segundo')).toBeLessThan(pos('tercero'));
  await noSideScroll(page);
  await shot(page, shotName);
  await themes(page, context, baseURL, shotName);
  // Se cierra.
  await bar(page).getByRole('button', { name: 'Close' }).click();
  await expect(bar(page)).toHaveCount(0);
}

test('Inbox: trae lo que faltaba antes del último mensaje y dice qué pasó en cada caso', async ({ page, request, context, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const { account } = (await (await request.get('/api/inbox/whatsapp')).json()) as { account: { id: string } };
  const [acc] = await sql('SELECT id, webhook_secret FROM inbox_accounts WHERE id = ?', [account.id]);
  const post = async (events: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const open = async (who: string) => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const thread = page.locator('.ib-wa-thread');
    await expect(async () => {
      await page.locator('.ib-item', { hasText: who }).locator('.ib-row-btn').click();
      await expect(thread.getByRole('heading', { level: 2, name: who })).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    return thread;
  };

  // 1280 y 390: trae el que faltaba.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 860 });
    const tag = uid();
    const c = chat('54911', tag);
    await post([c.stored[0]]);
    await post([c.dropped]);
    await post([c.stored[1]]);
    const thread = await open(c.name);
    await bringsTheMissingOne(page, thread, tag, 'More actions', `inbox-done-${width}`, context, baseURL!, width === 1280);
    const [t] = await sql('SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', [String(acc.id), c.jid]);
    expect(Number((await sql('SELECT COUNT(*) AS n FROM inbox_messages WHERE thread_id = ?', [String(t.id)]))[0].n)).toBe(3);
  }
  await page.setViewportSize({ width: 1280, height: 860 });

  // El teléfono no contesta: lo dice, con reintentar.
  const silent = chat('1779', uid());
  await post(silent.stored);
  await open(silent.name);
  await fetchMissing(page, 'More actions');
  await expect(bar(page)).toHaveAttribute('data-state', 'loading');
  await shot(page, 'inbox-loading');
  await expect(bar(page)).toHaveAttribute('data-state', 'noanswer', { timeout: 90_000 });
  await expect(bar(page)).toContainText("The phone didn't answer");
  await expect(bar(page).getByRole('button', { name: 'Try again' })).toBeVisible();
  await themes(page, context, baseURL!, 'inbox-noanswer');

  // El gateway no acepta nuestra ancla: dice que hace falta actualizarlo.
  const outdated = chat('1776', uid());
  await post(outdated.stored);
  await open(outdated.name);
  await fetchMissing(page, 'More actions');
  await expect(bar(page)).toHaveAttribute('data-state', 'outdated', { timeout: 60_000 });
  await expect(bar(page)).toContainText('needs an update');

  // Con la línea desvinculada.
  await sql("UPDATE inbox_accounts SET status = 'disconnected' WHERE id = ?", [String(acc.id)]);
  try {
    await open(outdated.name);
    await fetchMissing(page, 'More actions');
    await expect(bar(page)).toHaveAttribute('data-state', 'offline', { timeout: 60_000 });
    await expect(bar(page)).toContainText('The line is disconnected');
    await page.setViewportSize({ width: 390, height: 860 });
    await noSideScroll(page);
    await themes(page, context, baseURL!, 'inbox-offline-390');
  } finally {
    await sql("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?", [String(acc.id)]);
  }
});

test('Lines: trae lo que faltaba antes del último mensaje y dice qué pasó en cada caso', async ({ page, request, context, baseURL, playwright }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Faltantes ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  try {
    await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
    await expect
      .poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 })
      .toBe('connected');
    const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
    const post = async (events: unknown[]) => {
      const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
      expect(res.ok(), await res.text()).toBe(true);
    };
    const chatOf = async (jid: string) => String((await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, jid]))[0].id);
    const open = async (id: string) => {
      await page.goto(`/en/app/lines/inbox/${id}`, { waitUntil: 'networkidle' });
      return page.locator('.gr-messages');
    };

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 860 });
      const tag = uid();
      const c = chat('54911', tag);
      await post([c.stored[0]]);
      await post([c.dropped]);
      await post([c.stored[1]]);
      const id = await chatOf(c.jid);
      const thread = await open(id);
      await bringsTheMissingOne(page, thread, tag, 'More chat actions', `lines-done-${width}`, context, baseURL!, width === 1280);
      expect(Number((await sql('SELECT COUNT(*) AS n FROM groups_messages WHERE chat_id = ?', [id]))[0].n)).toBe(3);
    }
    await page.setViewportSize({ width: 1280, height: 860 });

    // Otra persona, de otro workspace, no puede pedirlo ni ver cómo va.
    const anyChat = chat('54911', uid());
    await post(anyChat.stored);
    const anyId = await chatOf(anyChat.jid);
    const ctx = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [{ name: 'zs_e2e_as', value: `otra-${uid()}@own-e2e.test`, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
    });
    try {
      await ctx.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Otra', locale: 'en' } }).catch(() => null);
      expect([403, 404]).toContain((await ctx.post(`/api/groups/chats/${anyId}`, { data: { action: 'fetchMissing' } })).status());
      expect([403, 404]).toContain((await ctx.post(`/api/groups/chats/${anyId}`, { data: { action: 'fetchMissingStatus' } })).status());
    } finally {
      await ctx.dispose();
    }

    // El teléfono no contesta.
    const silent = chat('1779', uid());
    await post(silent.stored);
    await open(await chatOf(silent.jid));
    await fetchMissing(page, 'More chat actions');
    await expect(bar(page)).toHaveAttribute('data-state', 'noanswer', { timeout: 90_000 });
    await expect(bar(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    await shot(page, 'lines-noanswer');
    await page.setViewportSize({ width: 390, height: 860 });
    await noSideScroll(page);
    await themes(page, context, baseURL!, 'lines-noanswer-390');
    await page.setViewportSize({ width: 1280, height: 860 });

    // El gateway no acepta nuestra ancla.
    const outdated = chat('1776', uid());
    await post(outdated.stored);
    const outdatedId = await chatOf(outdated.jid);
    await open(outdatedId);
    await fetchMissing(page, 'More chat actions');
    await expect(bar(page)).toHaveAttribute('data-state', 'outdated', { timeout: 60_000 });
    await themes(page, context, baseURL!, 'lines-outdated');

    // Desvinculada.
    await sql("UPDATE groups_numbers SET status = 'disconnected' WHERE id = ?", [numberId]);
    await open(outdatedId);
    await fetchMissing(page, 'More chat actions');
    await expect(bar(page)).toHaveAttribute('data-state', 'offline', { timeout: 60_000 });
  } finally {
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
