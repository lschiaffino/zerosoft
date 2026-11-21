import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';

/**
 * Programar una foto con @menciones en el pie, desde la vista previa de
 * adjuntos (el reloj junto a Enviar), en Lines e Inbox, con el WhatsApp falso:
 * el programado guarda a quién menciona el pie y, al salir, la foto va con la
 * mención real ("@<teléfono>" y la lista de mencionados). Con SCHEDULE_SHOTS=<carpeta>
 * guarda capturas del reloj y del selector. Nombres y números inventados.
 */

test.describe.configure({ timeout: 300_000 });

ownWorkspace('wa-scheduled-caption');

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const groupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
const shots = process.env.SCHEDULE_SHOTS;

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

function message(chatId: string, over: Record<string, unknown> = {}) {
  return { type: 'message', chatId, isGroup: true, fromMe: false, senderPhone: '', senderName: '', providerMessageId: `e2e-${uid()}`, body: 'hola', timestamp: new Date().toISOString(), ...over };
}

/** Pega una foto chica en el campo del chat: abre la vista previa de adjuntos. */
async function pastePhoto(page: Page, scope: string) {
  await page.evaluate(async (scope) => {
    const file = await new Promise<File>((resolve) => {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 24;
      const g = c.getContext('2d')!;
      g.fillStyle = '#16a085';
      g.fillRect(0, 0, 32, 24);
      c.toBlob((b) => resolve(new File([b!], 'plano.png', { type: 'image/png' })), 'image/png');
    });
    const el = document.querySelector<HTMLElement>(`${scope} [data-testid="composer-input"]`);
    if (!el) throw new Error('no composer');
    el.focus();
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, scope);
}

/** "Mirá @scul" + Enter en el pie: elige a la persona de la lista. */
async function captionWithMention(page: Page, name: string) {
  const pane = page.getByTestId('attach-preview');
  await expect(pane).toBeVisible();
  const caption = pane.getByTestId('attach-caption');
  await caption.click();
  await caption.pressSequentially('Mirá @scul');
  await expect(pane.getByTestId('caption-mentions')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Enter');
  await expect(caption).toHaveValue(`Mirá @${name} `);
  return pane;
}

async function linesGroup(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Prog ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const post = async (events: unknown[]) => {
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const tag = uid();
  const eze = phone();
  const dani = phone();
  const gid = groupId();
  const title = `Plano ${tag}`;
  await post([{ type: 'fake_contacts', contacts: [{ phone: eze, name: `Ezequiel Sculli ${tag}`, groups: [gid] }, { phone: dani, name: `Dani Paz ${tag}`, groups: [gid] }] }]);
  await post([message(gid, { chatName: title, senderPhone: dani, senderName: `Dani Paz ${tag}`, body: 'Pasame el plano' })]);
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, gid]);
  return { numberId: id, chatId: String(chat.id), tag, eze, title };
}

test('Lines: una foto programada desde la vista previa guarda y manda la mención del pie', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const g = await linesGroup(request);
  const name = `Ezequiel Sculli ${g.tag}`;
  try {
    await page.goto(`/en/app/lines/inbox/${g.chatId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 2, name: g.title })).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.wa-head-sub')).toContainText(name, { timeout: 30_000 });
    await pastePhoto(page, '.wa-thread');
    const pane = await captionWithMention(page, name);
    await pane.getByTestId('attach-caption').pressSequentially('va mañana');

    // El reloj junto a Enviar abre el selector de "cuándo".
    await pane.getByTestId('attach-send-later').click();
    const when = page.getByRole('dialog', { name: 'Send later' });
    await expect(when).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/lines-later-1280.png` });
    await when.locator('[data-preset="tomorrow"]').click();
    await expect(when).toBeHidden();
    await expect(pane).toBeHidden({ timeout: 30_000 });
    const item = page.getByTestId('lines-scheduled-strip').getByTestId('lines-scheduled-item');
    await expect(item).toHaveCount(1);

    // Guardado con la foto y a quién menciona el pie.
    const [b] = await sql("SELECT body, media_type, mentions FROM groups_broadcasts WHERE number_id = ? AND kind = 'scheduled'", [g.numberId]);
    expect(b.body).toBe(`Mirá @${name} va mañana`);
    expect(String(b.media_type)).toMatch(/^image\//);
    expect(JSON.parse(String(b.mentions))).toEqual([{ phone: g.eze, label: name }]);

    // "Enviar ahora": la foto sale con la mención real y la burbuja muestra "@Nombre".
    await item.getByRole('button', { name: 'Send now' }).click();
    const row = async () => (await sql("SELECT meta, provider_message_id FROM groups_messages WHERE chat_id = ? AND direction = 'out' AND media_url IS NOT NULL AND media_url <> ''", [g.chatId]))[0] ?? null;
    await expect.poll(async () => String((await row())?.provider_message_id ?? ''), { timeout: 60_000 }).toContain('~');
    const out = (await row())!;
    expect(JSON.parse(String(out.meta)).mentions).toEqual([g.eze]);
    expect(String(out.provider_message_id).split('~')[1]).toBe(`${g.eze}@s.whatsapp.net`);
    const bubble = page.locator('.gr-msg', { hasText: 'va mañana' }).last();
    await expect(bubble.locator('.wa-mention')).toHaveText(`@${name}`, { timeout: 30_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await request.delete(`/api/groups/numbers/${g.numberId}`).catch(() => null);
  }
});

test('Lines: en el teléfono el reloj de la vista previa entra en la pantalla', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const g = await linesGroup(request);
  try {
    await page.goto(`/en/app/lines/inbox/${g.chatId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 2, name: g.title })).toBeVisible({ timeout: 120_000 });
    await pastePhoto(page, '.wa-thread');
    const pane = page.getByTestId('attach-preview');
    await expect(pane).toBeVisible();
    const later = pane.getByTestId('attach-send-later');
    const box = (await later.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(39.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // ⌘⇧Enter en el pie abre el mismo selector, encima de la vista previa.
    await pane.getByTestId('attach-caption').press('Control+Shift+Enter');
    const when = page.getByRole('dialog', { name: 'Send later' });
    await expect(when).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/lines-later-390.png` });
    await page.keyboard.press('Escape');
    await expect(when).toBeHidden();
    await expect(pane).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await request.delete(`/api/groups/numbers/${g.numberId}`).catch(() => null);
  }
});

test('Inbox: una foto programada desde la vista previa guarda la mención del pie', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const { account } = (await (await request.get('/api/inbox/whatsapp')).json()) as { account: { id: string } };
  const [acc] = await sql('SELECT id, webhook_secret FROM inbox_accounts WHERE id = ?', [account.id]);
  const post = async (events: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const tag = uid();
  const eze = phone();
  const gid = groupId();
  const title = `Consorcio ${tag}`;
  const name = `Ezequiel Sculli ${tag}`;
  await post([{ type: 'fake_contacts', contacts: [{ phone: eze, name, groups: [gid] }] }]);
  await post([message(gid, { chatName: title, senderPhone: eze, senderName: name, body: 'Buenas' })]);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click({ timeout: 90_000 });
  const thread = page.locator('.ib-wa-thread');
  const input = thread.getByTestId('composer-input');
  await expect(async () => {
    const retry = page.getByRole('button', { name: 'Try again' });
    if (await retry.isVisible()) await retry.click();
    await expect(input).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 180_000 });
  // Los participantes ya cargaron: el "@" del campo los muestra.
  await input.click();
  await input.pressSequentially('@ezeq');
  await expect(page.locator('.ib-wa-mentions')).toBeVisible({ timeout: 30_000 });
  await input.fill('');

  await pastePhoto(page, '.ib-wa-thread');
  const pane = await captionWithMention(page, name);
  // Clic derecho en Enviar: el diálogo de programar, con el pie como texto y la foto ya adjunta.
  await pane.locator('.wa-attach-send').click({ button: 'right' });
  const dialog = page.getByRole('dialog', { name: 'Send later' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox').first()).toHaveValue(`Mirá @${name}`);
  await expect(dialog.locator('.ib-media-tag')).toBeVisible({ timeout: 60_000 });
  if (shots) await page.screenshot({ path: `${shots}/inbox-later-1280.png` });
  await dialog.locator('[data-preset="tomorrow"]').click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(pane).toBeHidden();

  const [s] = await sql('SELECT s.body, s.media_url, s.mentions FROM inbox_scheduled s JOIN inbox_threads t ON t.id = s.thread_id WHERE t.external_id = ?', [gid]);
  expect(s.body).toBe(`Mirá @${name}`);
  expect(String(s.media_url)).not.toBe('');
  expect(JSON.parse(String(s.mentions))).toEqual([{ phone: eze, label: name }]);
  expect(errors, errors.join('\n')).toEqual([]);
});
