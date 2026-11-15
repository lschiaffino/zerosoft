import { e2eDb } from './helpers/db';
import { devices, expect, test, type Page } from '@playwright/test';

/**
 * Inbox y Lines en el teléfono (390 y 360, con el dedo): nada flota sobre la lista ni sobre el chat (la pestaña de
 * comentarios), la cabecera del chat deja lugar para el nombre, los botones de ícono miden 44px y la flecha de cada
 * mensaje (cosa del mouse) no aparece al tocar (styles/wa-mobile.css).
 */

test.use({ ...devices['Pixel 7'] });

const uid = () => Math.random().toString(36).slice(2, 8);

async function noSideScroll(page: Page) {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(w.scroll).toBeLessThanOrEqual(w.inner + 1);
}

for (const width of [390, 360]) {
  test(`Inbox a ${width}px con el dedo: sin flotantes, nombre a la vista, botones de 44px`, async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 780 });
    await request.post('/api/inbox/whatsapp');
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const db = e2eDb();
    const [acc] = (await db.execute("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'")).rows as unknown as Array<Record<string, string>>;
    db.close();
    const tag = uid();
    const dm = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}9@s.whatsapp.net`;
    const name = `Cabecera ${tag}`;
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
      data: { events: [{ type: 'message', chatId: dm, isGroup: false, fromMe: false, senderPhone: dm.replace(/@.*/, ''), senderName: name, providerMessageId: `cl-${tag}`, body: `hola ${tag}`, timestamp: new Date().toISOString() }] },
    });
    expect(res.ok()).toBe(true);

    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(page.locator('.ib-item', { hasText: name })).toBeVisible();
    await expect(page.locator('.fl-root')).toBeHidden();
    await noSideScroll(page);

    await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
    const head = page.locator('.ib-wa-thread .wa-head');
    await expect(head.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
    // El nombre tiene lugar (antes, cinco íconos lo dejaban en "A…").
    expect((await head.getByRole('heading', { name }).boundingBox())!.width).toBeGreaterThan(80);
    for (const b of await head.locator('.gr-thread-actions .wa-icon-btn:visible').all()) {
      const box = (await b.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('.fl-root')).toBeHidden();

    // Tocar un mensaje no deja la flecha del mouse pintada.
    const msg = page.locator('.ib-wa-thread .gr-msg', { hasText: `hola ${tag}` });
    await msg.locator('.gr-bubble').tap();
    await expect(msg.locator('.wa-hover')).toHaveCSS('opacity', '0');
    await noSideScroll(page);
  });
}
