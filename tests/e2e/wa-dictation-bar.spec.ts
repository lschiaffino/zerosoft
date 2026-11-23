import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';

/**
 * El botón de dictar (DictationHost, .vc-bar) en el campo de un chat de Inbox va dentro del campo, en la
 * esquina de abajo a la derecha, con el mismo lugar en los dos estilos de chat: antes flotaba encima del campo y
 * tapaba la hora del último mensaje según dónde quedara. Tampoco queda la pestaña de feedback cortada contra el
 * borde del chat. Cuenta propia: el estilo de chat y los ajustes de dictado se cambian en esa cuenta.
 *
 * Nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 240_000 });

const email = ownWorkspace('wa-dictation-bar');
const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

type Ev = Record<string, unknown>;
const events = (from: string, tag: string): Ev[] => [
  { type: 'message', chatId: `${from}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: from, senderName: `Paula ${tag}`, providerMessageId: `vb1-${tag}`, body: 'Hola', timestamp: new Date(Date.now() - 60_000).toISOString() },
  { type: 'message', chatId: `${from}@s.whatsapp.net`, isGroup: false, fromMe: true, senderPhone: '', senderName: '', providerMessageId: `vb2-${tag}`, body: 'Listo', status: 'read', timestamp: new Date().toISOString() },
];

async function seedLines(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Dictado ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const from = phone();
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: events(from, uid()) } });
  expect(res.ok(), await res.text()).toBe(true);
  const db = e2eDb();
  try {
    const { rows } = await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [numberId, `${from}@s.whatsapp.net`] });
    return `/en/app/lines/inbox/${String(rows[0].id)}`;
  } finally {
    db.close();
  }
}

async function seedInbox(request: APIRequestContext): Promise<string> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const { rows } = await db.execute({
      sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = ?",
      args: [email],
    });
    const from = phone();
    const res = await request.post(`/api/inbox/webhook/${String(rows[0].id)}/${String(rows[0].webhook_secret)}`, { data: { events: events(from, uid()) } });
    expect(res.ok(), await res.text()).toBe(true);
    const jid = `${from}@s.whatsapp.net`;
    const { rows: t } = await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [String(rows[0].id), jid] });
    return `/en/app/inbox?t=${String(t[0].id)}`;
  } finally {
    db.close();
  }
}

/** Dónde quedó el botón respecto del campo, y si pisa algún mensaje. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.vc-bar')!.getBoundingClientRect();
    const field = document.querySelector('.wa-composer textarea')!.getBoundingClientRect();
    const hits = [...document.querySelectorAll('.gr-msg, .gr-msg-foot, .wa-day')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && !(r.right <= bar.left || r.left >= bar.right || r.bottom <= bar.top || r.top >= bar.bottom);
    });
    return {
      inside: bar.left >= field.left && bar.right <= field.right && bar.top >= field.top && bar.bottom <= field.bottom,
      fromRight: Math.round(field.right - bar.right),
      fromBottom: Math.round(field.bottom - bar.bottom),
      hits: hits.length,
    };
  });

test('el botón de dictar va dentro del campo del chat en Lines y en Inbox, sin tapar mensajes', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  expect((await request.patch('/api/voice/settings', { data: { showBar: true } })).ok()).toBe(true);
  const chats = { lines: await seedLines(request), inbox: await seedInbox(request) };
  await page.setViewportSize({ width: 1280, height: 800 });
  const seen: Array<{ fromRight: number; fromBottom: number }> = [];
  for (const style of ['whatsapp', 'zerosoft'] as const) {
    expect((await request.put('/api/chat-style', { data: { style } })).ok()).toBe(true);
    for (const [app, url] of Object.entries(chats)) {
      await page.goto(url, { waitUntil: 'networkidle' });
      await expect(page.locator('.gr-msg').last()).toBeVisible({ timeout: 45_000 });
      const input = page.getByTestId('composer-input');
      await input.click();
      if (app === 'lines') {
        // Lines tiene su propio micrófono en el campo (data-voice-off): sin el botón flotante, nada tapa los mensajes.
        await expect(input).toBeFocused();
        await expect(page.locator('.vc-bar')).toHaveCount(0);
        await expect(page.locator('.fl-root')).toBeHidden();
        continue;
      }
      await expect(page.locator('.vc-bar')).toBeVisible();
      const m = await measure(page);
      expect(m.inside, `${app} ${style}`).toBe(true);
      expect(m.hits, `${app} ${style}`).toBe(0);
      seen.push({ fromRight: m.fromRight, fromBottom: m.fromBottom });
      // El campo deja la esquina libre para el botón mientras se ve.
      expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight))).toBeGreaterThanOrEqual(30);
      // Sin la pestaña de feedback contra el borde del chat.
      await expect(page.locator('.fl-root')).toBeHidden();
      // Un mensaje nuevo tampoco queda debajo del botón.
      await input.fill('Te escribo en un rato');
      await input.press('Enter');
      await expect(page.locator('.gr-msg').filter({ hasText: 'Te escribo en un rato' }).last()).toBeVisible();
      await input.click();
      await expect(page.locator('.vc-bar')).toBeVisible();
      expect((await measure(page)).hits, `${app} ${style} después de enviar`).toBe(0);
      // Sin foco en el campo, el botón se va y el campo vuelve a su relleno.
      await input.evaluate((el) => (el as HTMLTextAreaElement).blur());
      await expect(page.locator('.vc-bar')).toHaveCount(0);
      expect(await input.getAttribute('data-vc-bar')).toBeNull();
    }
  }
  // El mismo lugar en los dos estilos de chat (antes cambiaba de lugar según el estilo).
  const spread = (k: 'fromRight' | 'fromBottom') => Math.max(...seen.map((s) => s[k])) - Math.min(...seen.map((s) => s[k]));
  expect(spread('fromRight')).toBeLessThanOrEqual(1);
  expect(spread('fromBottom')).toBeLessThanOrEqual(2);
  await request.put('/api/chat-style', { data: { style: 'whatsapp' } });
  expect(errors).toEqual([]);
});
