import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Inbox con la cara de WhatsApp (WhatsApp falso, GROUPS_FAKE=1): el menú de
 * una nota de voz ofrece Reenviar, el modal muestra lo que se reenvía y la
 * copia llega al otro chat como nota de voz, marcada "Forwarded". Con
 * INBOX_SHOTS=<carpeta> guarda capturas del menú y del modal.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = (end: string) => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${end}`;

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [row] = (
      await db.execute("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'")
    ).rows as unknown as Array<Record<string, unknown>>;
    return { id: String(row.id), secret: String(row.webhook_secret) };
  } finally {
    db.close();
  }
}

test('Inbox: reenviar una nota de voz a otro chat', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const acc = await linkWhatsapp(request);
  const dm = `${phone('3')}@s.whatsapp.net`;
  const other = `${phone('4')}@s.whatsapp.net`;
  const name = `Rocío ${uid()}`;
  const otherName = `Tomás ${uid()}`;
  const audioId = `aud-${uid()}`;
  const base = { type: 'message', isGroup: false, fromMe: false, timestamp: new Date().toISOString() };
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        { ...base, chatId: other, senderPhone: other.replace(/@.*/, ''), senderName: otherName, providerMessageId: `in-${uid()}`, body: 'Mandame el audio' },
        { ...base, chatId: dm, senderPhone: dm.replace(/@.*/, ''), senderName: name, providerMessageId: `in-${uid()}`, body: 'Te grabo un audio' },
        {
          ...base,
          chatId: dm,
          senderPhone: dm.replace(/@.*/, ''),
          senderName: name,
          providerMessageId: audioId,
          body: '',
          media: { url: '', type: 'audio/ogg', name: '', fetchRef: { providerMessageId: audioId, chatId: dm, fromMe: false }, info: { kind: 'voice', ptt: true, duration: 4 } },
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  const voice = thread.locator('.gr-msg-in', { has: page.locator('.wa-voice') });
  await expect(voice).toBeVisible({ timeout: 30_000 });
  await voice.hover();
  await voice.locator('.wa-chevron').click();
  await expect(page.getByRole('menuitem', { name: 'Forward' })).toBeVisible();
  if (process.env.INBOX_SHOTS) await page.screenshot({ path: `${process.env.INBOX_SHOTS}/inbox-forward-menu.png` });
  await page.getByRole('menuitem', { name: 'Forward' }).click();
  const fwd = page.getByRole('dialog', { name: 'Forward to' });
  await expect(fwd.locator('.ib-wa-fwd-preview')).toHaveText('Voice message');
  await fwd.getByRole('textbox').fill(otherName.slice(0, 6));
  await fwd.getByText(otherName).click();
  if (process.env.INBOX_SHOTS) await page.screenshot({ path: `${process.env.INBOX_SHOTS}/inbox-forward-modal.png` });
  await fwd.getByRole('button', { name: 'Send to 1 chat' }).click();
  await expect(page.locator('.ib-toast', { hasText: 'Forwarded to 1 chat' })).toBeVisible();

  // En el otro chat: la nota de voz, como nota de voz y marcada "Forwarded".
  await page.locator('.ib-item', { hasText: otherName }).locator('.ib-row-btn').click();
  const copy = thread.locator('.gr-msg-out', { has: page.locator('.wa-voice') });
  await expect(copy).toBeVisible({ timeout: 30_000 });
  await expect(copy.locator('.gr-forwarded')).toHaveText(/Forwarded/);
  expect(errors).toEqual([]);
});
