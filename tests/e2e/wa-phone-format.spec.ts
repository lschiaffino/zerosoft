import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Teléfonos como los muestra WhatsApp Web ("+54 9 11 0000-0001"), en Lines y en Inbox, contra el WhatsApp falso
 * (GROUPS_FAKE=1): la línea de abajo del nombre en un chat 1:1, quien escribió en un grupo sin nombre guardado
 * (en la burbuja y en la vista previa de la lista) y el número al lado de un nombre. Números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
// 54 9 11 0000-XXXX: un rango sin asignar, con la forma de un celular de Buenos Aires.
const phone = () => `5491100${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
const pretty = (p: string) => `+54 9 11 ${p.slice(5, 9)}-${p.slice(9)}`;
const groupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function message(chatId: string, over: Record<string, unknown>) {
  return { type: 'message', chatId, isGroup: chatId.endsWith('@g.us'), fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName: '', providerMessageId: `ph-${uid()}`, body: 'hola', ...over };
}

async function linesNumber(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Phones ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return new URL(info.webhookUrl).pathname;
}

async function inboxAccount(request: APIRequestContext): Promise<string> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const { rows } = await db.execute("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    return `/api/inbox/webhook/${String(rows[0].id)}/${String(rows[0].webhook_secret)}`;
  } finally {
    db.close();
  }
}

async function send(request: APIRequestContext, hook: string, events: unknown[]) {
  const res = await request.post(hook, { data: { events } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Lines: el número del chat y de quien escribe en un grupo, con formato', async ({ page, request }) => {
  const errors = watchErrors(page);
  const hook = await linesNumber(request);
  const tag = uid();
  const dm = phone();
  const named = phone();
  const unnamed = phone();
  const gid = groupId();
  await send(request, hook, [message(`${dm}@c.us`, { senderName: `Dm ${tag}`, body: `privado ${tag}` })]);
  await send(request, hook, [message(gid, { chatName: `Club ${tag}`, senderPhone: named, senderName: `Named ${tag}`, body: 'primero' })]);
  await send(request, hook, [message(gid, { chatName: `Club ${tag}`, senderPhone: unnamed, body: `segundo ${tag}` })]);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  // Vista previa del grupo: quien escribió último, sin nombre, va como teléfono con formato.
  const groupRow = page.locator('a.gr-row', { hasText: `segundo ${tag}` });
  await expect(groupRow.locator('.gr-row-sender')).toHaveText(`${pretty(unnamed)}:`);

  await groupRow.click();
  const bubbles = page.getByTestId('wa-message');
  await expect(bubbles.getByTestId('wa-sender-name').last()).toHaveText(pretty(unnamed));
  // Con nombre: el número al lado, también con formato.
  await expect(bubbles.filter({ hasText: 'primero' }).locator('.wa-phone')).toHaveText(pretty(named));

  await page.locator('a.gr-row', { hasText: `privado ${tag}` }).click();
  await expect(page.locator('.wa-head-sub')).toHaveText(pretty(dm));
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: quien escribe en un grupo sin nombre guardado, con formato en la lista', async ({ page, request }) => {
  const errors = watchErrors(page);
  const hook = await inboxAccount(request);
  const tag = uid();
  const unnamed = phone();
  await send(request, hook, [message(groupId(), { chatName: `Club ${tag}`, senderPhone: unnamed, body: `nuevo ${tag}`, timestamp: new Date().toISOString() })]);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.locator('.ib-item', { hasText: `nuevo ${tag}` });
  await expect(row.locator('.wa-row-sender')).toHaveText(`${pretty(unnamed)}:`);
  expect(errors, errors.join('\n')).toEqual([]);
});
