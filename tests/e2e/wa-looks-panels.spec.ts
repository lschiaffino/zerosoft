import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Los paneles del chat siguen el aspecto (Lines, con el WhatsApp falso): con Líneas y con Clásico el panel de
 * emojis tiene el borde, la esquina y la sombra de los menús del chat (antes, su recuadro gris de WhatsApp en
 * cualquier aspecto), y Esc lo cierra. En Clásico, los segmentos de Ajustes › Visualización son una sola placa:
 * solo las esquinas de afuera redondeadas. Cuenta propia: el aspecto se cambia en la cuenta y no toca al resto.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

ownWorkspace('wa-looks-panels');

const uid = () => Math.random().toString(36).slice(2, 8);

async function chatId(page: Page): Promise<string> {
  const request = page.request;
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Aspectos ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const from = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}5`;
  const jid = `${from}@s.whatsapp.net`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId: jid, isGroup: false, fromMe: false, senderPhone: from, senderName: `Paula ${uid()}`, providerMessageId: `lp-${uid()}`, body: 'Hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const db = e2eDb();
  try {
    const { rows } = await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [numberId, jid] });
    return String(rows[0].id);
  } finally {
    db.close();
  }
}

const box = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { radius: s.borderTopLeftRadius, right: s.borderTopRightRadius, border: s.borderTopWidth, shadow: s.boxShadow };
  });

test('Lines: el panel de emojis y los segmentos de Ajustes siguen los aspectos Líneas y Clásico', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const id = await chatId(page);
  try {
    for (const [look, radius] of [
      ['lines', '2px'],
      ['classic', '12px'],
    ] as const) {
      expect((await page.request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      await page.goto(`/en/app/lines/inbox/${id}`, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      const thread = page.locator('.wa-thread');
      await expect(thread.locator('.gr-msg').first()).toBeVisible({ timeout: 45_000 });
      await thread.getByRole('button', { name: 'Emoji', exact: true }).click();
      const panel = page.locator('.wa-emoji');
      await expect(panel).toBeVisible();
      const s = await box(page, '.wa-emoji');
      expect(s.radius).toBe(radius);
      expect(s.border).toBe('1px');
      if (look === 'lines') expect(s.shadow).toBe('none');
      else expect(s.shadow).not.toBe('none');
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }

    // Clásico: los segmentos de Visualización van pegados, con esquina solo afuera.
    await page.goto('/en/app/lines/settings?tab=appearance', { waitUntil: 'networkidle' });
    const seg = page.locator('.wa-display-seg').first().locator('.btn');
    await expect(seg.first()).toBeVisible({ timeout: 45_000 });
    expect(await seg.count()).toBeGreaterThan(2);
    const radii = (i: number) => seg.nth(i).evaluate((el) => [getComputedStyle(el).borderTopLeftRadius, getComputedStyle(el).borderTopRightRadius]);
    expect(await radii(0)).toEqual(['8px', '0px']);
    expect(await radii(1)).toEqual(['0px', '0px']);
    expect((await radii((await seg.count()) - 1))[1]).toBe('8px');
    expect(errors).toEqual([]);
  } finally {
    await page.request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
  }
});
