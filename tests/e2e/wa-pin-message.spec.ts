import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Inbox con el WhatsApp falso (GROUPS_FAKE=1): fijar un mensaje como en
 * WhatsApp (y como Lines). El menú del mensaje tiene Fijar; arriba del chat
 * aparece la franja de fijados, que lleva al mensaje y lo desfija. En 390 la
 * franja entra sin scroll lateral. Nombres y números inventados.
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

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

for (const size of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Inbox: fijar y desfijar un mensaje (${size.name})`, async ({ page, request }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const send = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } })).ok()).toBe(true);
    const tag = uid();
    const ana = phone();
    const who = `Ana ${tag}`;
    const ev = (body: string) => ({ type: 'message', chatId: `${ana}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: ana, senderName: who, providerMessageId: `e2e-${uid()}`, body, timestamp: new Date().toISOString() });
    await send([ev(`la dirección ${tag}`), ev(`a las 9 ${tag}`)]);

    await request.get('/api/inbox/threads/ibt_warmup');
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: who }).locator('.ib-row-btn').click();
    const thread = page.locator('.ib-wa-thread');
    await expect(thread.getByRole('heading', { level: 2, name: who })).toBeVisible({ timeout: 45_000 });
    const bubble = thread.locator('.gr-msg', { hasText: `la dirección ${tag}` });
    await expect(bubble).toBeVisible();

    if (size.width >= 1000) {
      // Menú del mensaje (flecha al pasar): Fijar.
      await bubble.hover();
      await bubble.locator('.wa-chevron').click();
      await page.getByTestId('menu-pin').click();
    } else {
      // En el teléfono el menú es el del toque largo (probado en otros specs): se fija por la API.
      const [m] = await sql('SELECT id FROM inbox_messages WHERE body = ?', [`la dirección ${tag}`]);
      expect((await request.patch(`/api/inbox/messages/${m.id}`, { data: { action: 'pin' } })).ok()).toBe(true);
    }
    const bar = thread.getByTestId('pinned-bar');
    await expect(bar.getByTestId('pinned-row')).toHaveCount(1, { timeout: 15_000 });
    const [row] = await sql('SELECT pinned_at FROM inbox_messages WHERE body = ?', [`la dirección ${tag}`]);
    expect(String(row.pinned_at ?? '')).toMatch(/^\d{4}-/);

    // La franja entra sin scroll lateral y lleva al mensaje.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await bar.getByTestId('pinned-row').locator('button').first().click();
    await expect(bubble).toBeInViewport();

    // × desfija.
    await bar.getByTestId('pinned-unpin').click();
    await expect(thread.getByTestId('pinned-bar')).toHaveCount(0, { timeout: 15_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
