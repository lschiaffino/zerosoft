import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { detailsTab } from './helpers/details-tab';
import { waLinkIp } from './helpers/wa-link';

/**
 * Destacados en la info del chat, como WhatsApp, en Lines y en Inbox (con el
 * WhatsApp falso): destacar desde el menú del mensaje, verlo en la info del
 * chat y tocarlo para ir al mensaje. En Lines, "Destacar" de la selección
 * alterna (si ya estaban todos destacados, los saca). Nombres y números
 * inventados.
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

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

const dm = (ana: string, who: string, body: string) => ({
  type: 'message',
  chatId: `${ana}@s.whatsapp.net`,
  isGroup: false,
  fromMe: false,
  senderPhone: ana,
  senderName: who,
  chatName: who,
  providerMessageId: `e2e-${uid()}`,
  body,
  timestamp: new Date().toISOString(),
});

/** Muchos mensajes después del destacado: para que tocarlo tenga que mover la conversación. */
const filler = (ana: string, who: string, tag: string) => Array.from({ length: 30 }, (_, i) => dm(ana, who, `relleno ${i} ${tag}`));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Lines: destacados en la info del chat; Destacar en la selección alterna', async ({ page, request }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Star ${uid()}` } });
  const id = ((await created.json()) as { id: string }).id;
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const send = async (list: unknown[]) => expect((await request.post(new URL(webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
  const tag = uid();
  const ana = phone();
  const who = `Ana ${tag}`;
  await send([dm(ana, who, `la dirección ${tag}`)]);
  await send(filler(ana, who, tag));

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: who }).first().click({ timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 2, name: who })).toBeVisible({ timeout: 30_000 });
  const first = page.locator('.gr-msg', { hasText: `la dirección ${tag}` });
  await first.scrollIntoViewIfNeeded();
  await first.hover();
  await first.locator('.wa-chevron').click();
  await page.getByTestId('menu-star').click();

  // La info del chat (la foto del encabezado) lista el destacado; tocarlo lleva al mensaje.
  const head = page.locator('.wa-head-avatar');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  // Los destacados van en la pestaña Archivos del panel.
  await detailsTab(page, 'media');
  const list = page.locator('.gr-details').getByTestId('chat-starred');
  await expect(list.getByTestId('chat-starred-item')).toHaveCount(1, { timeout: 15_000 });
  await page.locator('.gr-msg', { hasText: `relleno 29 ${tag}` }).scrollIntoViewIfNeeded();
  await list.getByTestId('chat-starred-item').click();
  await expect(first).toBeInViewport();

  // Seleccionar dos (uno ya destacado): Destacar destaca los dos; otra vez, los saca.
  const second = page.locator('.gr-msg', { hasText: `relleno 0 ${tag}` });
  await second.hover();
  await second.locator('.wa-chevron').click();
  await page.getByTestId('menu-select').click();
  const bar = page.getByTestId('selection-bar');
  await first.getByRole('checkbox').click();
  await bar.locator('[data-action="star"]').click();
  await expect(list.getByTestId('chat-starred-item')).toHaveCount(2, { timeout: 15_000 });
  await second.hover();
  await second.locator('.wa-chevron').click();
  await page.getByTestId('menu-select').click();
  await first.getByRole('checkbox').click();
  await bar.locator('[data-action="star"]').click();
  await expect(list.getByTestId('chat-starred-item')).toHaveCount(0, { timeout: 15_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: un destacado de la info del chat lleva al mensaje', async ({ page, request }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const send = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${row.id}/${row.webhook_secret}`, { data: { events: list } })).ok()).toBe(true);
  const tag = uid();
  const ana = phone();
  const who = `Ana ${tag}`;
  await send([dm(ana, who, `la dirección ${tag}`)]);
  await send(filler(ana, who, tag));

  await request.get('/api/inbox/threads/ibt_warmup');
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: who }).locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  await expect(thread.getByRole('heading', { level: 2, name: who })).toBeVisible({ timeout: 45_000 });
  const first = thread.locator('.gr-msg', { hasText: `la dirección ${tag}` });
  await first.scrollIntoViewIfNeeded();
  await first.hover();
  await first.locator('.wa-chevron').click();
  await page.getByTestId('menu-star').click();
  await expect.poll(async () => String((await sql('SELECT starred_at FROM inbox_messages WHERE body = ?', [`la dirección ${tag}`]))[0]?.starred_at ?? '')).toMatch(/^\d{4}-/);

  const who2 = thread.locator('.wa-head-who');
  if ((await who2.getAttribute('aria-expanded')) !== 'true') await who2.click();
  await detailsTab(page, 'media');
  const item = page.getByTestId('chat-starred-item');
  await expect(item).toHaveCount(1, { timeout: 15_000 });
  await thread.locator('.gr-msg', { hasText: `relleno 29 ${tag}` }).scrollIntoViewIfNeeded();
  await item.click();
  await expect(first).toBeInViewport({ timeout: 15_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
