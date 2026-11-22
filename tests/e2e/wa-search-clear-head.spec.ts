import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';

/**
 * Lines e Inbox, con el WhatsApp falso:
 * - Los buscadores (la lista de chats y Buscar mensajes) llevan la × propia en
 *   vez de la nativa del navegador: aparece al escribir, vacía el campo y le
 *   deja el foco.
 * - Un grupo con un nombre muy largo: en el encabezado del chat el nombre se
 *   corta con "…" en una línea, sin empujar los botones ni dar scroll lateral,
 *   a 1280 y a 390.
 * Con SC_SHOTS=<carpeta> guarda capturas en los cinco aspectos, claro y oscuro,
 * a 1280 y 390.
 *
 * Nombres y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

ownWorkspace('wa-search-clear');

const uid = () => Math.random().toString(36).slice(2, 8);
const LONG = 'Equipo de coordinación de entregas y logística de la región norte con proveedores';

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
    if (res.status() >= 400 && /\/api\/(groups|inbox)\//.test(res.url())) console.log(`[api ${res.status()}] ${new URL(res.url()).pathname}`);
  });
  return errors;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

function groupEvents(gid: string, title: string, tag: string) {
  return Array.from({ length: 3 }, (_, i) => ({
    type: 'message',
    chatId: gid,
    isGroup: true,
    chatName: title,
    fromMe: false,
    senderPhone: `1555000${1100 + i}`,
    senderName: `Persona ${i} ${tag}`,
    providerMessageId: `sc${i}-${tag}`,
    body: `Mensaje ${i} ${tag}`,
    timestamp: new Date(Date.now() - (3 - i) * 60_000).toISOString(),
  }));
}

async function linesGroup(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Linea ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `${LONG} ${tag}`;
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: groupEvents(gid, title, tag) } });
  expect(res.ok(), await res.text()).toBe(true);
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [numberId, gid]);
  return { numberId, chatId: String(chat.id), title, tag };
}

async function inboxGroup(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const { account } = (await (await request.get('/api/inbox/whatsapp')).json()) as { account: { id: string } };
  const [acc] = await sql('SELECT id, webhook_secret FROM inbox_accounts WHERE id = ?', [account.id]);
  const tag = uid();
  const gid = `1203631${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `${LONG} ${tag}`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: groupEvents(gid, title, tag) } });
  expect(res.ok(), await res.text()).toBe(true);
  return { title, tag };
}

/** El nombre entra en una línea con "…" y los botones de la cabecera siguen adentro de la pantalla. */
async function expectTruncatedHead(page: Page, thread: Locator) {
  const h2 = thread.locator('.wa-head h2');
  await expect(h2).toBeVisible();
  const m = await h2.evaluate((el) => {
    const cs = getComputedStyle(el);
    const head = el.closest('.wa-head')!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    return { overflow: cs.textOverflow, wrap: cs.whiteSpace, hidden: cs.overflowX, cut: el.scrollWidth > el.clientWidth, oneLine: box.height <= lineHeight * 1.5, inside: box.right <= head.right + 0.5 };
  });
  expect(m).toEqual({ overflow: 'ellipsis', wrap: 'nowrap', hidden: 'hidden', cut: true, oneLine: true, inside: true });
  // El menú ⋯ de la cabecera queda a la vista (el nombre no lo empuja afuera).
  await expect(thread.locator('.wa-head [aria-haspopup="menu"]').last()).toBeInViewport();
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
}

/**
 * La × propia: aparece al escribir, vacía el campo y le deja el foco; sin la nativa. `list`: el pedido de la lista
 * que dispara buscar (se espera la respuesta, como la espera quien mira la lista).
 */
async function expectClear(page: Page, input: Locator, list?: (url: string) => boolean) {
  const box = input.locator('xpath=..');
  const clear = box.getByTestId('search-clear');
  await expect(clear).toHaveCount(0);
  // Con next dev el campo puede llegar antes que React: se escribe de nuevo hasta que la × responde.
  const searched = list ? page.waitForResponse((r) => list(r.url()) && r.url().includes('presupuesto'), { timeout: 120_000 }) : null;
  await expect(async () => {
    await input.fill('');
    await input.fill('presupuesto');
    await expect(clear).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000 });
  if (searched) expect((await searched).ok()).toBe(true);
  await expect(input).toHaveAttribute('data-clearable', '');
  const back = list ? page.waitForResponse((r) => list(r.url()) && !r.url().includes('presupuesto'), { timeout: 60_000 }) : null;
  await clear.click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(clear).toHaveCount(0);
  if (back) expect((await back).ok()).toBe(true);
}

async function openSearch(page: Page, thread: Locator, narrow: boolean) {
  if (!narrow) {
    await thread.getByTestId('chat-search-open').click();
    return;
  }
  await thread.locator('.wa-head [aria-haspopup="menu"]').last().click();
  await page.getByTestId('menu-search').click();
}

for (const size of [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Lines: × propia en los buscadores y nombre largo con … (${size.name})`, async ({ page, request }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = watchErrors(page);
    const { numberId, chatId, title } = await linesGroup(request);
    try {
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await expectClear(page, page.locator('.wa-search-row input[type="search"]'), (u) => u.includes('/api/groups/chats?'));
      // Con la búsqueda vacía la lista vuelve a mostrar el grupo.
      await expect(page.locator('.gr-row', { hasText: title }).first()).toBeVisible({ timeout: 30_000 });

      await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
      const thread = page.locator('.wa-thread');
      await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 45_000 });
      await expectTruncatedHead(page, thread);
      await openSearch(page, thread, size.width < 720);
      await expectClear(page, page.getByTestId('chat-search-input'));
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await request.delete(`/api/groups/numbers/${numberId}`).catch(() => null);
    }
  });

  test(`Inbox: × propia en los buscadores y nombre largo con … (${size.name})`, async ({ page, request }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = watchErrors(page);
    const { title } = await inboxGroup(request);
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expectClear(page, page.locator('#ib-search'), (u) => u.includes('/api/inbox/threads?'));
    const row = page.locator('.ib-item', { hasText: title });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator('.ib-row-btn').click();
    const thread = page.locator('.ib-wa-thread');
    await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 45_000 });
    await expectTruncatedHead(page, thread);
    await openSearch(page, thread, size.width < 720);
    await expectClear(page, page.getByTestId('chat-search-input'));
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

test('Capturas en los cinco aspectos (solo con SC_SHOTS)', async ({ page, request, context, baseURL }) => {
  const dir = process.env.SC_SHOTS;
  test.skip(!dir, 'Solo para mirar a mano');
  test.setTimeout(3_600_000);
  const lines = await linesGroup(request);
  const inbox = await inboxGroup(request);
  try {
    for (const look of LOOKS) {
      await expect(async () => expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true)).toPass({ timeout: 300_000 });
      // SC_ALL=1: claro y oscuro a 1280 y 390; si no, la cobertura del gauntlet (oscuro 1280 y claro 390).
      const combos = process.env.SC_ALL ? (['light', 'dark'] as const).flatMap((th) => [1280, 390].map((w) => [th, w] as const)) : ([['dark', 1280], ['light', 390]] as const);
      for (const [theme, width] of combos) {
        await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
        {
          await page.setViewportSize({ width, height: 860 });
          await expect(async () => {
            await page.goto(`/en/app/lines/inbox/${lines.chatId}`, { waitUntil: 'networkidle' });
            await expect(page.locator('.wa-thread .wa-head h2')).toBeVisible({ timeout: 60_000 });
          }).toPass({ timeout: 600_000 });
          await page.screenshot({ path: `${dir}/lines-head-${look}-${theme}-${width}.png` });
          await openSearch(page, page.locator('.wa-thread'), width < 720);
          await page.getByTestId('chat-search-input').fill('presupuesto');
          await page.screenshot({ path: `${dir}/lines-search-${look}-${theme}-${width}.png` });
          await expect(async () => {
            await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
            await expect(async () => {
              await page.locator('#ib-search').fill('');
              await page.locator('#ib-search').fill(inbox.tag);
              await expect(page.getByTestId('search-clear')).toBeVisible({ timeout: 2_000 });
            }).toPass({ timeout: 120_000 });
          }).toPass({ timeout: 600_000 });
          await page.screenshot({ path: `${dir}/inbox-list-${look}-${theme}-${width}.png` });
          await page.locator('.ib-item', { hasText: inbox.title }).locator('.ib-row-btn').click();
          // Solo capturas con next dev: la primera vez la ruta del chat compila y puede pasarse del tiempo del pedido.
          await expect(async () => {
            const retry = page.locator('.ib-convo-pane [role="alert"] button').first();
            if (await retry.isVisible()) await retry.click();
            await expect(page.locator('.ib-wa-thread .wa-head h2')).toBeVisible({ timeout: 20_000 });
          }).toPass({ timeout: 300_000 });
          await page.screenshot({ path: `${dir}/inbox-head-${look}-${theme}-${width}.png` });
        }
      }
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
    await request.delete(`/api/groups/numbers/${lines.numberId}`).catch(() => null);
  }
});
