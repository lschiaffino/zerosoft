import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox con la cara de WhatsApp Web, con el WhatsApp falso (GROUPS_FAKE=1):
 * nombres reales (el asunto del grupo, nunca el id), fotos, la fila de la
 * lista (quién mandó, tipo de media, tildes), claro y oscuro, 1280 y 390.
 * Con INBOX_SHOTS=<carpeta> guarda capturas para la pasada visual.
 */

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = (end: string) => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${end}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.INBOX_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

type Ev = Record<string, unknown>;

async function events(request: APIRequestContext, acc: { id: string; secret: string }, list: Ev[]) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } });
  expect(res.ok()).toBe(true);
}

function message(chatId: string, over: Ev = {}): Ev {
  const group = chatId.endsWith('@g.us');
  return {
    type: 'message',
    chatId,
    isGroup: group,
    fromMe: false,
    senderPhone: group ? '15550001002' : chatId.replace(/@.*/, ''),
    senderName: group ? 'Beto Prueba' : 'Ana Prueba',
    providerMessageId: `in-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('lista como WhatsApp: asunto real del grupo, foto, quién mandó, tipo de media y tildes', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const dm = `${phone('2')}@s.whatsapp.net`;
  const tag = uid();
  // Un grupo que llega sin asunto (como los del historial): nunca se muestra el id.
  const groupId = `5491149${Math.floor(100000 + Math.random() * 899999)}-14100${Math.floor(10000 + Math.random() * 89999)}@g.us`;
  await events(request, acc, [
    message(dm, { senderName: `Ana ${tag}`, body: 'Te paso la dirección' }),
    message(dm, { fromMe: true, providerMessageId: `out-${tag}`, body: 'Gracias!', status: 'sent', timestamp: new Date(Date.now() + 1000).toISOString() }),
    message(groupId, { body: '', media: { url: '', type: 'audio/ogg', name: '', info: { kind: 'voice', ptt: true, duration: 9 } } }),
  ]);
  await events(request, acc, [{ type: 'status', providerMessageId: `out-${tag}`, status: 'read' }]);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const dmRow = page.locator('.ib-item', { hasText: `Ana ${tag}` });
  await expect(dmRow).toBeVisible();
  await expect(dmRow.locator('.wa-ticks.is-read')).toBeVisible();
  await expect(dmRow.locator('.wa-row-text')).toHaveText('Gracias!');
  // La foto (número par en el WhatsApp falso) llega por /api/inbox/avatar con la sesión.
  await expect(dmRow.locator('img.wa-avatar')).toBeVisible({ timeout: 45_000 });
  expect(await dmRow.locator('img.wa-avatar').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const groupDigits = groupId.replace(/@.*/, '');
  await expect(page.locator('.ib-list')).not.toContainText(groupDigits);
  const groupRow = page.locator('.ib-item', { hasText: `Grupo ${groupDigits.replace(/\D/g, '').slice(-4)}` });
  await expect(groupRow).toBeVisible({ timeout: 45_000 });
  await expect(groupRow.locator('.wa-row-sender')).toHaveText('Beto Prueba:');
  await expect(groupRow.locator('.wa-row-text')).toHaveText('Voice message');
  await expect(groupRow.locator('.wa-unread')).toHaveText('1');
  await shot(page, 'list-1280-light');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('claro y oscuro a 1280 y 390 sin errores ni scroll horizontal', async ({ page, context, baseURL, request }) => {
  const acc = await linkWhatsapp(request);
  await events(request, acc, [message(`${phone('4')}@s.whatsapp.net`, { senderName: `Carla ${uid()} con un nombre bastante largo para ver el corte`, body: 'Un mensaje largo para ver que la vista previa se corta con puntos suspensivos y no desborda' })]);
  for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
    for (const width of [1280, 390]) {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await expect(page.locator('.ib-item').first()).toBeVisible();
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await shot(page, `list-${width}-${theme}`);
      expect(errors, errors.join('\n')).toEqual([]);
    }
  }
});
