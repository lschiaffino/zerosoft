import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Inbox y Lines con el WhatsApp falso (GROUPS_FAKE=1): el globito de
 * reacciones abre quién reaccionó, como WhatsApp Web. Una reacción de otra
 * persona (por webhook) y la propia (desde la barra de emojis): el cuadro
 * lista las dos, la pestaña de un emoji filtra la lista y un clic en la
 * propia ("Tú") la saca. Con RX_SHOTS=<carpeta> guarda capturas a 1280 y 390,
 * claro y oscuro. Nombres y números inventados.
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
const SHOTS = process.env.RX_SHOTS ?? '';

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

/** El cuadro: las dos personas, el filtro por emoji y sacar la propia. */
async function checkPopover(page: Page, bubble: Locator, who: string, shots: (name: string) => Promise<void>) {
  const chip = bubble.getByTestId('wa-reactions-chip');
  await expect(chip).toContainText('2');
  await chip.click();
  const pop = page.getByTestId('wa-reactions-popover');
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('heading')).toHaveText(/2/);
  await expect(pop.getByTestId('wa-reactor')).toHaveCount(1, { timeout: 15_000 });
  await expect(pop.getByTestId('wa-reactor-me')).toHaveCount(1);
  await expect(pop.getByTestId('wa-reactor-name')).toHaveText(new RegExp(who));
  await expect(pop.getByTestId('wa-reactor-phone')).toHaveText(/^\+54 9 11/);
  // Con el mouse, el foco entra al cuadro mismo.
  await expect(pop).toBeFocused();
  await expect(pop.getByTestId('wa-reactions-tab')).toHaveCount(3);
  await shots('open');

  // La pestaña ❤️ deja solo a la otra persona; con las flechas se vuelve a "Todas".
  await pop.locator('[data-testid="wa-reactions-tab"][data-emoji="❤️"]').click();
  await expect(pop.getByTestId('wa-reactor')).toHaveCount(1);
  await expect(pop.getByTestId('wa-reactor-me')).toHaveCount(0);
  await page.keyboard.press('Home');
  await expect(pop.locator('[data-testid="wa-reactions-tab"][data-emoji=""]')).toHaveAttribute('aria-selected', 'true');
  await expect(pop.getByTestId('wa-reactor-me')).toHaveCount(1);

  // Esc cierra y devuelve el foco al globito.
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await expect(chip).toBeFocused();
  // Desde el teclado: Enter abre con el foco en la pestaña elegida, y las flechas cambian de pestaña.
  await page.keyboard.press('Enter');
  await expect(pop.locator('[role="tab"][aria-selected="true"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(pop.locator('[role="tab"][aria-selected="true"]')).toHaveAttribute('data-emoji', /./);
  await expect(pop.locator('[role="tab"][aria-selected="true"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();

  // Clic en la propia la saca (en WhatsApp también): queda una reacción.
  await chip.click();
  await pop.getByTestId('wa-reactor-me').click();
  await expect(chip).not.toContainText('👍', { timeout: 20_000 });
  await expect(chip).toContainText('❤️');
  await expect(pop.getByTestId('wa-reactor-me')).toHaveCount(0);
  await expect(pop.getByRole('heading')).toHaveText(/1/);
  // Un clic afuera lo cierra.
  await page.mouse.click(5, 5);
  await expect(pop).toBeHidden();
}

/** Capturas del cuadro abierto a 1280 y 390, claro y oscuro (solo con RX_SHOTS). */
async function takeShots(page: Page, app: string, open: () => Promise<void>) {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [1280, 390]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
      await open();
      await expect(page.getByTestId('wa-reactions-popover')).toBeVisible();
      await expect(page.getByTestId('wa-reactions-popover').locator('.is-skeleton')).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/${app}-${width}-${scheme}.png` });
      await page.keyboard.press('Escape');
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 800 });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.describe('Inbox', () => {
  async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
    await request.post('/api/inbox/whatsapp');
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    return { id: String(row.id), secret: String(row.webhook_secret) };
  }

  test('el globito abre quién reaccionó; la pestaña filtra y la propia se saca', async ({ page, request }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const send = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } })).ok()).toBe(true);
    const tag = uid();
    const ana = phone();
    const gid = groupId();
    const title = `Reacciones ${tag}`;
    const msgId = `rx-${tag}`;
    await send([message(gid, { chatName: title, senderPhone: ana, senderName: `Ana ${tag}`, body: `llego tarde ${tag}`, providerMessageId: msgId })]);
    await send([{ type: 'reaction', chatId: gid, targetProviderMessageId: msgId, emoji: '❤️', senderPhone: ana, senderName: `Ana ${tag}`, fromMe: false }]);

    // Con `next dev`, la primera vez compila cada ruta: se compilan antes (un 404 alcanza).
    await request.get('/api/inbox/threads/ibt_warmup');
    await request.get('/api/inbox/threads/ibt_warmup/wa?part=reactions&messages=x');
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
    const thread = page.locator('.ib-wa-thread');
    await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 90_000 });
    const bubble = thread.locator('.gr-msg', { hasText: `llego tarde ${tag}` });
    await expect(bubble.getByTestId('wa-reactions-chip')).toContainText('❤️', { timeout: 20_000 });

    // La propia, desde la barra de emojis.
    await bubble.hover();
    await bubble.getByRole('button', { name: 'React', exact: true }).click();
    await thread.locator('.gr-emoji-picker').getByRole('button', { name: '👍' }).click();
    await expect(bubble.getByTestId('wa-reactions-chip')).toContainText('👍', { timeout: 20_000 });

    await takeShots(page, 'inbox', async () => {
      await thread.locator('.gr-msg', { hasText: `llego tarde ${tag}` }).getByTestId('wa-reactions-chip').click();
    });
    await checkPopover(page, bubble, `Ana ${tag}`, async () => {});
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('Lines', () => {
  async function fakeNumber(request: APIRequestContext): Promise<{ id: string; webhookUrl: string }> {
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Reactions ${uid()}` } });
    const id = ((await created.json()) as { id: string }).id;
    await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
    await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
    const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
    return { id, webhookUrl: info.webhookUrl };
  }

  test('el globito abre quién reaccionó; la pestaña filtra y la propia se saca', async ({ page, request }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const n = await fakeNumber(request);
    const send = async (list: unknown[]) => expect((await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
    const tag = uid();
    const ana = phone();
    const gid = groupId();
    const title = `Reacciones ${tag}`;
    const msgId = `rx-${tag}`;
    await send([message(gid, { chatName: title, senderPhone: ana, senderName: `Ana ${tag}`, body: `llego tarde ${tag}`, providerMessageId: msgId })]);
    await send([{ type: 'reaction', chatId: gid, targetProviderMessageId: msgId, emoji: '❤️', senderPhone: ana, senderName: `Ana ${tag}`, fromMe: false }]);

    // Con `next dev`, la primera vez compila cada ruta: se compila antes (un 404 alcanza).
    await request.get('/api/groups/chats/warmup/members?reactions=x');
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('.gr-row', { hasText: title }).click({ timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 30_000 });
    const bubble = page.locator('.gr-msg', { hasText: `llego tarde ${tag}` });
    await expect(bubble.getByTestId('wa-reactions-chip')).toContainText('❤️', { timeout: 20_000 });

    // La propia, desde la barra de emojis.
    await bubble.hover();
    await bubble.locator('.wa-react-btn').click();
    await bubble.locator('.gr-emoji-picker').getByRole('button', { name: '👍', exact: true }).click();
    await expect(bubble.getByTestId('wa-reactions-chip')).toContainText('👍', { timeout: 20_000 });

    await takeShots(page, 'lines', async () => {
      await page.locator('.gr-msg', { hasText: `llego tarde ${tag}` }).getByTestId('wa-reactions-chip').click();
    });
    await checkPopover(page, bubble, `Ana ${tag}`, async () => {});
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
