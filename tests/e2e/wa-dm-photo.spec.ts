import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Inbox y Lines con el WhatsApp falso (GROUPS_FAKE=1): un chat 1:1 que quedó
 * sin foto (los datos del chat ya se pidieron y la foto no vino) la pide al
 * abrirlo, y la lista y el encabezado del chat la muestran. El falso tiene
 * foto para los números que terminan en par. Nombres y números inventados.
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
/** Teléfono inventado que termina en par: el proveedor falso le da foto. */
const evenPhone = () => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${[0, 2, 4, 6, 8][Math.floor(Math.random() * 5)]}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function message(phone: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message',
    chatId: `${phone}@s.whatsapp.net`,
    isGroup: false,
    fromMe: false,
    senderPhone: phone,
    senderName: '',
    providerMessageId: `e2e-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Inbox: un 1:1 sin foto la pide al abrirlo', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const phone = evenPhone();
  const name = `Vera ${tag}`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: [message(phone, { senderName: name, body: `hola ${tag}` })] } });
  expect(res.ok()).toBe(true);
  await expect.poll(async () => (await sql("SELECT id FROM inbox_threads WHERE account_id = ? AND kind = 'dm' AND handle = ?", [String(acc.id), phone])).length, { timeout: 10_000 }).toBe(1);
  // Como el caso del bug: los datos del chat ya se pidieron y la foto no vino.
  await sql("UPDATE inbox_threads SET avatar_url = '', info_at = ? WHERE account_id = ? AND kind = 'dm' AND handle = ?", [new Date().toISOString(), String(acc.id), phone]);

  await request.get('/api/inbox/threads/ibt_warmup');
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.ib-item', { hasText: name });
  await expect(row.locator('img')).toHaveCount(0);
  await row.locator('.ib-row-btn').click();
  const head = page.locator('.ib-wa-thread header.wa-head');
  await expect(head.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 45_000 });

  // Abrir el chat pide la foto de la persona (después de responder) y queda guardada.
  await expect
    .poll(async () => String((await sql("SELECT picture FROM wa_contacts WHERE app = 'inbox' AND account_id = ? AND phone = ?", [String(acc.id), phone]))[0]?.picture ?? ''), { timeout: 30_000 })
    .toMatch(/^data:image\//);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.ib-item', { hasText: name }).locator('img').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  await expect(head.locator('.wa-head-who img')).toBeVisible({ timeout: 20_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

async function fakeNumber(request: APIRequestContext): Promise<{ id: string; webhookUrl: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Photo ${uid()}` } });
  const id = ((await created.json()) as { id: string }).id;
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

test('Lines: un 1:1 sin foto la pide al abrirlo', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const phone = evenPhone();
  const name = `Vera ${tag}`;
  const res = await request.post(new URL(n.webhookUrl).pathname, { data: { events: [message(phone, { senderName: name, body: `hola ${tag}` })] } });
  expect(res.ok()).toBe(true);
  await sql("UPDATE groups_chats SET picture_url = '' WHERE number_id = ? AND phone = ?", [n.id, phone]);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.gr-row', { hasText: name });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.locator('img')).toHaveCount(0);
  await row.click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => String((await sql("SELECT picture FROM wa_contacts WHERE app = 'lines' AND account_id = ? AND phone = ?", [n.id, phone]))[0]?.picture ?? ''), { timeout: 30_000 })
    .toMatch(/^data:image\//);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.wa-head-avatar img')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.gr-row', { hasText: name }).locator('img').first()).toBeVisible({ timeout: 20_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

/** "+54 9 11 xxxx-xxxx", como el resto de la pantalla. */
const formatted = (phone: string) => `+54 9 11 ${phone.slice(5, 9)}-${phone.slice(9)}`;

test('Inbox: una tarjeta de contacto muestra la foto de la persona y Enviar mensaje abre su chat', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const sender = evenPhone();
  const shared = evenPhone();
  const name = `Bruno ${tag}`;
  const card = { name: `Carla ${tag}`, phones: [shared] };
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: [message(sender, { senderName: name, body: '', contacts: [card] })] } });
  expect(res.ok()).toBe(true);

  await request.get('/api/inbox/threads/ibt_warmup');
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  const head = page.locator('.ib-wa-thread header.wa-head');
  await expect(head.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 45_000 });
  const cardEl = page.getByTestId('wa-contact-card');
  await expect(cardEl).toContainText(card.name);
  await expect(cardEl).toContainText(formatted(shared));

  // Abrir el chat pide la foto de la persona de la tarjeta; la tarjeta la muestra en lugar del ícono.
  await expect
    .poll(async () => String((await sql("SELECT picture FROM wa_contacts WHERE app = 'inbox' AND account_id = ? AND phone = ?", [String(acc.id), shared]))[0]?.picture ?? ''), { timeout: 30_000 })
    .toMatch(/^data:image\//);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  await expect(page.getByTestId('wa-contact-card').locator('img')).toBeVisible({ timeout: 20_000 });

  // Enviar mensaje abre (o crea) el 1:1 con ese número en la misma cuenta.
  await page.getByTestId('wa-contact-message').click();
  await expect(head.getByRole('heading', { level: 2 })).toHaveText(formatted(shared), { timeout: 20_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Lines: una tarjeta de contacto muestra la foto de la persona y Enviar mensaje abre su chat', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const sender = evenPhone();
  const shared = evenPhone();
  const name = `Bruno ${tag}`;
  const card = { name: `Carla ${tag}`, phones: [shared] };
  const res = await request.post(new URL(n.webhookUrl).pathname, { data: { events: [message(sender, { senderName: name, body: '', contacts: [card] })] } });
  expect(res.ok()).toBe(true);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: name }).click({ timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 30_000 });
  const cardEl = page.getByTestId('wa-contact-card');
  await expect(cardEl).toContainText(card.name);
  await expect(cardEl).toContainText(formatted(shared));
  await expect
    .poll(async () => String((await sql("SELECT picture FROM wa_contacts WHERE app = 'lines' AND account_id = ? AND phone = ?", [n.id, shared]))[0]?.picture ?? ''), { timeout: 30_000 })
    .toMatch(/^data:image\//);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('wa-contact-card').locator('img')).toBeVisible({ timeout: 20_000 });

  const before = page.url();
  await page.getByTestId('wa-contact-message').click();
  await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(before);
  await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?#]+/);
  expect(errors, errors.join('\n')).toEqual([]);
});
