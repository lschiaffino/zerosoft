import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';

/**
 * Buscar mensajes dentro de un chat (la lupa de la cabecera), en Lines y en
 * Inbox, con el WhatsApp falso. El panel busca solo en ese chat, marca lo
 * encontrado y un clic lleva al mensaje aunque sea más viejo que lo cargado.
 * Esc y la X lo cierran. A 390 tapa la conversación y se cierra al elegir un
 * resultado, sin scroll lateral. Con CS_SHOTS=<carpeta> guarda capturas en los
 * cinco aspectos, claro y oscuro, a 1280 y 390.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

ownWorkspace('wa-chat-search');

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  const ctx = await playwright.request.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT) || 3210}` });
  try {
    for (const url of ['/api/inbox/threads/warm', '/api/inbox/search?q=x', '/api/groups/chats/warm', '/api/groups/chats/warm/messages']) await ctx.get(url, { timeout: 280_000 }).catch(() => null);
  } finally {
    await ctx.dispose();
  }
});

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${Math.floor(Math.random() * 10)}`;

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

/** `count` mensajes de la última hora y algo; el primero (el más viejo) y uno reciente dicen "presupuesto". */
function history(chatId: string, from: string, name: string, tag: string, count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: i % 4 === 3,
    senderPhone: i % 4 === 3 ? '' : from,
    senderName: i % 4 === 3 ? '' : name,
    providerMessageId: `cs${i}-${tag}`,
    body: i === 0 ? `El presupuesto viejo ${tag}` : i === count - 5 ? `El presupuesto nuevo ${tag}` : `Mensaje ${i} ${tag}`,
    timestamp: new Date(Date.now() - 2 * 3_600_000 + i * 20_000).toISOString(),
  }));
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Abre la búsqueda: la lupa de la cabecera o, en el teléfono (donde la cabecera deja solo el nombre), el menú ⋯. */
async function openSearch(page: Page, thread: Locator, narrow: boolean) {
  if (!narrow) {
    await thread.getByTestId('chat-search-open').click();
    return;
  }
  await expect(thread.getByTestId('chat-search-open')).toBeHidden();
  await thread.locator('.wa-head [aria-haspopup="menu"]').last().click();
  await page.getByTestId('menu-search').click();
}

/** Lo mismo en las dos apps: abrir, buscar, ir al viejo, sin resultados, Esc. */
async function searchFlow(page: Page, thread: Locator, tag: string, narrow: boolean) {
  await openSearch(page, thread, narrow);
  const panel = page.getByTestId('chat-search');
  await expect(panel).toBeVisible();
  const input = panel.getByTestId('chat-search-input');
  await expect(input).toBeFocused();
  await input.fill(`presupuesto ${tag}`);
  const hits = panel.getByTestId('chat-search-hit');
  await expect(hits).toHaveCount(2, { timeout: 30_000 });
  await expect(hits.first().locator('mark').first()).toBeVisible();
  if (narrow) expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  // El viejo (el último resultado) no está cargado: se trae y queda a la vista.
  await hits.last().click();
  const old = thread.locator('.gr-msg', { hasText: `El presupuesto viejo ${tag}` });
  await expect(old).toBeInViewport({ timeout: 30_000 });
  if (narrow) await expect(panel).toBeHidden();
  else await expect(panel).toBeVisible();

  // Sin resultados: lo dice.
  if (narrow) await openSearch(page, thread, narrow);
  await input.fill(`nada-${uid()}`);
  await expect(panel.getByRole('status')).toBeVisible({ timeout: 30_000 });
  await expect(hits).toHaveCount(0);
  // Esc lo cierra y la conversación sigue abierta.
  await input.press('Escape');
  await expect(panel).toBeHidden();
  await expect(thread).toBeVisible();
}

async function linesChat(request: APIRequestContext, count: number) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Buscar ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const tag = uid();
  const from = phone();
  const chatId = `${from}@s.whatsapp.net`;
  const events = history(chatId, from, `Olga Busca ${tag}`, tag, count);
  for (let i = 0; i < events.length; i += 60) {
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events: events.slice(i, i + 60) } });
    expect(res.ok(), await res.text()).toBe(true);
  }
  // Otro chat de la línea con la misma palabra: no aparece al buscar en el primero.
  const other = phone();
  await request.post(new URL(webhookUrl).pathname, { data: { events: history(`${other}@s.whatsapp.net`, other, `Omar ${tag}`, `o${tag}`, 3).map((e) => ({ ...e, body: `presupuesto ${tag}` })) } });
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, chatId]);
  return { numberId, chatId: String(chat.id), tag };
}

for (const size of [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Lines: buscar en el chat y llegar a un mensaje viejo (${size.name})`, async ({ page, request, playwright, baseURL }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = watchErrors(page);
    // Más de lo que carga el chat al abrirse (200, y 100 más al subir): el viejo hay que traerlo.
    const { numberId, chatId, tag } = await linesChat(request, 420);
    try {
      // La API: solo ese chat, y nadie de otro workspace.
      const api = (await (await request.get(`/api/groups/chats/${chatId}/messages?q=${encodeURIComponent(`presupuesto ${tag}`)}`)).json()) as { hits: Array<{ chatId: string }> };
      expect(api.hits).toHaveLength(2);
      expect(api.hits.every((h) => h.chatId === chatId)).toBe(true);
      const ctx = await playwright.request.newContext({
        baseURL,
        storageState: { cookies: [{ name: 'zs_e2e_as', value: `otra-${uid()}@own-e2e.test`, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] },
      });
      try {
        await ctx.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Otra', locale: 'en' } }).catch(() => null);
        expect([403, 404]).toContain((await ctx.get(`/api/groups/chats/${chatId}/messages?q=presupuesto`)).status());
      } finally {
        await ctx.dispose();
      }

      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
      const thread = page.locator('.wa-thread');
      await expect(thread.locator('.gr-msg', { hasText: `El presupuesto nuevo ${tag}` })).toBeVisible({ timeout: 45_000 });
      await searchFlow(page, thread, tag, size.width < 720);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
    }
  });
}

for (const size of [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Inbox: buscar en el chat y llegar a un mensaje viejo (${size.name})`, async ({ page, request }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = watchErrors(page);
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
    const { account } = (await (await request.get('/api/inbox/whatsapp')).json()) as { account: { id: string } };
    const [acc] = await sql('SELECT id, webhook_secret FROM inbox_accounts WHERE id = ?', [account.id]);
    const post = async (events: unknown[]) => {
      const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
      expect(res.ok(), await res.text()).toBe(true);
    };
    const tag = uid();
    const from = phone();
    const name = `Olga Busca ${tag}`;
    const events = history(`${from}@s.whatsapp.net`, from, name, tag, 160);
    for (let i = 0; i < events.length; i += 60) await post(events.slice(i, i + 60));
    const other = phone();
    await post(history(`${other}@s.whatsapp.net`, other, `Omar ${tag}`, `o${tag}`, 2).map((e) => ({ ...e, body: `presupuesto ${tag}` })));

    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
    const thread = page.locator('.ib-wa-thread');
    await expect(thread.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 45_000 });
    await expect(thread.locator('.gr-msg', { hasText: `El presupuesto nuevo ${tag}` })).toBeVisible({ timeout: 30_000 });
    await searchFlow(page, thread, tag, size.width < 720);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

test('Capturas del panel en los cinco aspectos (solo con CS_SHOTS)', async ({ page, request, context, baseURL }) => {
  const dir = process.env.CS_SHOTS;
  test.skip(!dir, 'Solo para mirar a mano');
  const { numberId, chatId, tag } = await linesChat(request, 40);
  try {
    for (const look of LOOKS) {
      expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      for (const theme of ['light', 'dark'] as const) {
        await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 860 });
          await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
          const thread = page.locator('.wa-thread');
          await openSearch(page, thread, width < 720);
          await page.getByTestId('chat-search-input').fill(`presupuesto ${tag}`);
          await expect(page.getByTestId('chat-search-hit')).toHaveCount(2, { timeout: 30_000 });
          if (width === 390) expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
          await page.screenshot({ path: `${dir}/lines-${look}-${theme}-${width}.png` });
        }
      }
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
    await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
  }
});
