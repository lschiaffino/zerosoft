import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Reportar un mensaje recibido, como en WhatsApp, en Inbox y en Lines (WhatsApp
 * falso, GROUPS_FAKE=1), a 1280 con mouse y a 390 con el dedo: el menú del
 * mensaje trae Reportar; el modal explica que queda en el chat, Esc y Cancelar
 * no hacen nada, y con la casilla marcada también bloquea al contacto. Después
 * el mensaje lleva la banderita y el menú ya no ofrece Reportar. Nombres y
 * números inventados.
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

function dm(who: { phone: string; name: string }, body: string) {
  return { type: 'message', chatId: `${who.phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: who.phone, senderName: who.name, providerMessageId: `e2e-${uid()}`, body, timestamp: new Date().toISOString() };
}

async function openMenu(page: Page, bubble: Locator, touch: boolean) {
  // Con el dedo el menú lo abre el toque largo, que hace clic en la flecha (no se toca la flecha misma).
  if (touch) await bubble.locator('.wa-chevron').evaluate((b) => (b as HTMLButtonElement).click());
  else {
    await bubble.hover();
    await bubble.locator('.wa-chevron').click();
  }
  await expect(page.getByRole('menu')).toBeVisible();
}

/** El recorrido de las dos apps: abrir, cancelar con Esc, reportar bloqueando y ver la banderita. */
async function reportFlow(page: Page, bubble: Locator, touch: boolean) {
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  await openMenu(page, bubble, touch);
  await press(page.getByTestId('menu-report'));
  const dialog = page.getByTestId('report-dialog');
  await expect(dialog).toBeVisible();
  // Destructivo: el foco arranca en Cancelar. Esc cierra sin reportar.
  await expect(page.getByTestId('report-cancel')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(bubble.getByTestId('msg-reported')).toHaveCount(0);

  await openMenu(page, bubble, touch);
  await press(page.getByTestId('menu-report'));
  await expect(dialog).toBeVisible();
  // La casilla está en el giro del Tab (Cancelar → Reportar → casilla).
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('report-block')).toBeFocused();
  await press(page.getByTestId('report-block'));
  await expect(page.getByTestId('report-block')).toBeChecked();
  await press(page.getByTestId('report-confirm'));
  // Con next dev local la ruta puede estar compilándose; en CI (next start) es al instante.
  await expect(dialog).toBeHidden({ timeout: 90_000 });
  await expect(bubble.getByTestId('msg-reported')).toBeVisible({ timeout: 60_000 });

  // Ya reportado: el menú no lo ofrece de nuevo.
  await openMenu(page, bubble, touch);
  await expect(page.getByTestId('menu-report')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

async function linkInbox(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${row.id}/${row.webhook_secret}`, { data: { events: list } })).ok()).toBe(true);
}

const VIEWS = [
  { label: '1280', viewport: { width: 1280, height: 800 }, touch: false },
  { label: '390 touch', viewport: { width: 390, height: 844 }, touch: true },
];

for (const view of VIEWS) {
  test.describe(`reportar ${view.label}`, () => {
    test.use({ viewport: view.viewport, hasTouch: view.touch, isMobile: view.touch });

    test('Inbox: reportar un mensaje y bloquear al contacto', async ({ page, request }) => {
      test.setTimeout(180_000);
      const errors = watchErrors(page);
      const send = await linkInbox(request);
      const tag = uid();
      const who = { phone: phone(), name: `Rita ${tag}` };
      await send([dm(who, `molesto ${tag}`)]);
      // next dev compila cada ruta la primera vez: se piden antes para que el clic no espere la compilación.
      await request.get('/api/inbox/threads/ibt_warmup');
      await request.patch('/api/inbox/messages/ibm_warmup', { data: { action: 'report' } });
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await page.locator('.ib-item', { hasText: who.name }).locator('.ib-row-btn').click();
      const thread = page.locator('.ib-wa-thread');
      await expect(thread.getByRole('heading', { level: 2, name: who.name })).toBeVisible({ timeout: 60_000 });
      const bubble = thread.locator('.gr-msg', { hasText: `molesto ${tag}` });
      await expect(bubble).toBeVisible();
      await reportFlow(page, bubble, view.touch);

      const [m] = await sql('SELECT meta FROM inbox_messages WHERE body = ?', [`molesto ${tag}`]);
      expect(JSON.parse(String(m.meta)).reported.at).toMatch(/^\d{4}-/);
      const [t] = await sql('SELECT info FROM inbox_threads WHERE handle = ?', [who.phone]);
      expect(JSON.parse(String(t.info || '{}')).blocked).toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    });

    test('Lines: reportar un mensaje y bloquear al contacto', async ({ page, request }) => {
      test.setTimeout(180_000);
      const errors = watchErrors(page);
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Reportes ${uid()}` } });
      const id = ((await created.json()) as { id: string }).id;
      await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
      await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
      const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
      const tag = uid();
      const who = { phone: phone(), name: `Rita ${tag}` };
      expect((await request.post(new URL(info.webhookUrl).pathname, { data: { events: [dm(who, `molesto ${tag}`)] } })).ok()).toBe(true);
      const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND kind = ?', [id, 'dm']);
      await request.post('/api/groups/messages/warmup', { data: { action: 'report' } });
      await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
      const thread = page.locator('.wa-thread');
      await expect(page.getByRole('heading', { level: 2, name: who.name })).toBeVisible({ timeout: 60_000 });
      const bubble = thread.locator('.gr-msg', { hasText: `molesto ${tag}` });
      await expect(bubble).toBeVisible();
      await reportFlow(page, bubble, view.touch);

      const [m] = await sql('SELECT meta FROM groups_messages WHERE chat_id = ?', [String(chat.id)]);
      expect(JSON.parse(String(m.meta)).reported.at).toMatch(/^\d{4}-/);
      const [c] = await sql('SELECT blocked_at FROM groups_chats WHERE id = ?', [String(chat.id)]);
      expect(String(c.blocked_at ?? '')).toMatch(/^\d{4}-/);
      const [a] = await sql("SELECT detail FROM groups_audit WHERE chat_id = ? AND action = 'reported'", [String(chat.id)]);
      expect(JSON.parse(String(a.detail))).toMatchObject({ blocked: true });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}
