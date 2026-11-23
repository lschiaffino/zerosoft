import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';

/**
 * El asistente (⌘J, modelo falso) actúa sobre Lines e Inbox con tarjeta de aprobación, a 1280 y 390: la tarjeta dice
 * qué, dónde y el texto; Cancelar no hace nada; Confirmar lo hace. Una nota interna, un mensaje programado (botón
 * rojo, queda programado y no sale nada) y un borrador que va al campo del chat abierto. En Inbox, la nota del chat y
 * un programado. WhatsApp falso: nada sale a ningún lado. Cuenta propia; nombres, números y textos inventados.
 */

test.describe.configure({ timeout: 300_000 });

const email = ownWorkspace('assistant-chat-actions');
const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });
  return errors;
}

const dm = (from: string, name: string, tag: string) => ({
  type: 'message',
  chatId: `${from}@s.whatsapp.net`,
  isGroup: false,
  fromMe: false,
  senderPhone: from,
  senderName: name,
  providerMessageId: `aca-${tag}`,
  body: '¿Me mandan el presupuesto?',
  timestamp: new Date(Date.now() - 60_000).toISOString(),
});

async function linesChat(request: APIRequestContext, name: string, tag: string): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Ventas ${tag}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const from = phone();
  expect((await request.post(new URL(webhookUrl).pathname, { data: { events: [dm(from, name, tag)] } })).ok()).toBe(true);
  const db = e2eDb();
  try {
    return String((await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [id, `${from}@s.whatsapp.net`] })).rows[0].id);
  } finally {
    db.close();
  }
}

async function inboxChat(request: APIRequestContext, name: string, tag: string): Promise<string> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = ?", args: [email] })).rows;
    const from = phone();
    expect((await request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, { data: { events: [dm(from, name, tag)] } })).ok()).toBe(true);
    return String((await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [String(acc.id), `${from}@s.whatsapp.net`] })).rows[0].id);
  } finally {
    db.close();
  }
}

async function ask(panel: Locator, text: string) {
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  await expect(panel.locator('.asst-messages')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await input.fill(text);
  await input.press('Enter');
}

/** La tarjeta pendiente del último pedido. */
async function lastCard(panel: Locator): Promise<Locator> {
  const card = panel.getByTestId('assistant-msg-assistant').last().locator('[data-testid="assistant-action"][data-kind="change"]');
  await expect(card).toHaveAttribute('data-status', 'pending', { timeout: 60_000 });
  return card;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const width of [1280, 390]) {
  test(`Lines: nota, programado y borrador con tarjeta (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const name = `Clara ${tag}`;
    const chat = await linesChat(request, name, tag);
    await page.goto(`/en/app/lines/inbox/${chat}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.gr-msg').first()).toBeVisible({ timeout: 45_000 });
    await page.keyboard.press('ControlOrMeta+j');
    const panel = page.getByTestId('assistant-panel');

    // Nota: qué, dónde y el texto. Cancelar no escribe nada.
    await ask(panel, `lines note ${name}: Llamar el lunes ${tag}`);
    let card = await lastCard(panel);
    await expect(card).toContainText('Internal note');
    await expect(card).toContainText(name);
    await expect(card).toContainText(`Llamar el lunes ${tag}`);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toHaveAttribute('data-status', 'cancelled');
    const notes = async () => ((await (await request.get(`/api/groups/chats/${chat}?shared=notes`)).json()) as { items: Array<{ body: string }> }).items.map((n) => n.body);
    expect(await notes()).toEqual([]);
    await ask(panel, `lines note ${name}: Llamar el lunes ${tag}`);
    card = await lastCard(panel);
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(card).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    expect(await notes()).toEqual([`Llamar el lunes ${tag}`]);

    // Programado: la tarjeta avisa que sale por WhatsApp y se confirma con el botón rojo; queda programado.
    await ask(panel, `lines schedule ${name}: Te escribo mañana ${tag}`);
    card = await lastCard(panel);
    await expect(card).toHaveClass(/is-destructive/);
    await expect(card).toContainText('Goes out on WhatsApp');
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(card).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    const scheduled = (await (await request.get(`/api/groups/broadcasts?chat=${chat}&kind=scheduled`)).json()) as { broadcasts: Array<{ body: string; status: string }> };
    expect(scheduled.broadcasts.filter((b) => b.body === `Te escribo mañana ${tag}`).map((b) => b.status)).toEqual(['scheduled']);

    // Borrador: va al campo del chat abierto, con Deshacer; no sale nada.
    await ask(panel, `lines draft ${name}: Hola Clara, sale hoy ${tag}`);
    card = await lastCard(panel);
    await expect(card).toContainText('not sent');
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(card).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    await page.keyboard.press('ControlOrMeta+j');
    await expect(page.getByTestId('composer-input')).toHaveValue(`Hola Clara, sale hoy ${tag}`);
    await expect(page.getByTestId('ai-compose-undo')).toBeVisible();
    const msgs = (await (await request.get(`/api/groups/chats/${chat}/messages?limit=60`)).json()) as { messages: Array<{ direction: string }> };
    expect(msgs.messages.filter((m) => m.direction === 'out')).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`Inbox: nota y programado con tarjeta (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const tag = uid();
    const name = `Ana ${tag}`;
    const thread = await inboxChat(request, name, tag);
    await page.goto(`/en/app/inbox?t=${thread}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.gr-msg').first()).toBeVisible({ timeout: 45_000 });
    await page.keyboard.press('ControlOrMeta+j');
    const panel = page.getByTestId('assistant-panel');

    await ask(panel, `inbox note ${name}: Prefiere la tarde ${tag}`);
    let card = await lastCard(panel);
    await expect(card).toContainText(name);
    await expect(card).toContainText(`Prefiere la tarde ${tag}`);
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(card).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    expect(((await (await request.get(`/api/inbox/threads/${thread}`)).json()) as { notes: string }).notes).toContain(`Prefiere la tarde ${tag}`);

    // Programado: Cancelar no deja nada; Confirmar lo deja pendiente (no sale todavía).
    const pending = async () => ((await (await request.get(`/api/inbox/threads/${thread}`)).json()) as { scheduled: Array<{ body: string }> }).scheduled.filter((s) => s.body === `Te escribo mañana ${tag}`);
    await ask(panel, `inbox schedule ${name}: Te escribo mañana ${tag}`);
    card = await lastCard(panel);
    await expect(card).toHaveClass(/is-destructive/);
    await expect(card).toContainText('Goes out on its own');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toHaveAttribute('data-status', 'cancelled');
    expect(await pending()).toEqual([]);
    await ask(panel, `inbox schedule ${name}: Te escribo mañana ${tag}`);
    card = await lastCard(panel);
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(card).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
    expect(await pending()).toHaveLength(1);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(1);
    const detail = (await (await request.get(`/api/inbox/threads/${thread}`)).json()) as { messages: Array<{ fromMe: boolean }> };
    expect(detail.messages.filter((m) => m.fromMe)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
