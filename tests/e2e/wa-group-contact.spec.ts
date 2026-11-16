import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Inbox y Lines con el WhatsApp falso (GROUPS_FAKE=1), en un grupo:
 * - la foto de perfil de quien escribe (se pide al abrir el grupo; el falso
 *   tiene foto para los números que terminan en par);
 * - su foto o su nombre abre "Info del contacto", y Mensaje abre el chat 1:1;
 * - el menú del mensaje tiene "Responder en privado" (el 1:1 se abre
 *   respondiendo con la cita del grupo) y "Mensaje a <persona>".
 * Nombres y números inventados.
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
const groupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function message(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message',
    chatId,
    isGroup: chatId.endsWith('@g.us'),
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
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

test.describe('Inbox', () => {
  async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    return { id: String(row.id), secret: String(row.webhook_secret) };
  }

  test('foto de quien escribe, su ficha, Mensaje y responder en privado', async ({ page, request }) => {
    test.setTimeout(150_000);
    const errors = watchErrors(page);
    const acc = await linkWhatsapp(request);
    const send = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: list } })).ok()).toBe(true);
    const tag = uid();
    const ana = evenPhone();
    const gid = groupId();
    const title = `Asado ${tag}`;
    await send([{ type: 'fake_contacts', contacts: [{ phone: ana, name: `Ana ${tag}`, groups: [gid] }] }]);
    await send([message(gid, { chatName: title, senderPhone: ana, senderName: `Ana ${tag}`, body: `traigo hielo ${tag}` })]);

    // Con `next dev`, la primera vez que se abre un chat compila su ruta: se compila antes (un 404 alcanza).
    await request.get('/api/inbox/threads/ibt_warmup');
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
    const thread = page.locator('.ib-wa-thread');
    await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 45_000 });

    // Abrir el grupo pide la foto de Ana (después de responder) y queda guardada.
    await expect
      .poll(async () => String((await sql("SELECT picture FROM wa_contacts WHERE app = 'inbox' AND account_id = ? AND phone = ?", [acc.id, ana]))[0]?.picture ?? ''), { timeout: 30_000 })
      .toMatch(/^data:image\//);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
    const bubble = thread.locator('.gr-msg', { hasText: `traigo hielo ${tag}` });
    await expect(bubble.getByTestId('wa-sender-avatar').locator('img')).toBeVisible({ timeout: 20_000 });

    // Su nombre abre la ficha, con la foto y Mensaje.
    await bubble.getByTestId('wa-sender-name').click();
    const sheet = page.getByTestId('wa-contact-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('wa-sheet-name')).toHaveText(`Ana ${tag}`);
    await expect(sheet.getByTestId('wa-sheet-photo').locator('img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // Menú del mensaje: Responder en privado abre el 1:1 respondiendo con la cita del grupo.
    await bubble.hover();
    await bubble.locator('.wa-chevron').click();
    await expect(page.getByTestId('menu-messageSender')).toBeVisible();
    await page.getByTestId('menu-replyPrivately').click();
    await expect(thread.getByRole('heading', { level: 2, name: `Ana ${tag}` })).toBeVisible({ timeout: 20_000 });
    await expect(thread.locator('.wa-replying')).toContainText(title);
    const box = thread.getByRole('textbox').last();
    await box.fill(`yo llevo carbón ${tag}`);
    await box.press('Enter');
    const reply = thread.locator('.gr-msg', { hasText: `yo llevo carbón ${tag}` });
    await expect(reply.getByTestId('wa-private-quote')).toBeVisible({ timeout: 20_000 });
    await expect(reply.getByTestId('wa-private-quote')).toContainText(title);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('Lines', () => {
  async function fakeNumber(request: APIRequestContext): Promise<{ id: string; webhookUrl: string }> {
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Contact ${uid()}` } });
    const id = ((await created.json()) as { id: string }).id;
    await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
    await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
    const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
    return { id, webhookUrl: info.webhookUrl };
  }

  test('foto de quien escribe, su ficha, Mensaje y responder en privado', async ({ page, request }) => {
    test.setTimeout(150_000);
    const errors = watchErrors(page);
    const n = await fakeNumber(request);
    const send = async (list: unknown[]) => expect((await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
    const tag = uid();
    const ana = evenPhone();
    const gid = groupId();
    const title = `Proveedores ${tag}`;
    await send([message(gid, { chatName: title, senderPhone: ana, senderName: `Ana ${tag}`, body: `precios nuevos ${tag}` })]);

    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('.gr-row', { hasText: title }).click({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => String((await sql("SELECT picture FROM wa_contacts WHERE app = 'lines' AND account_id = ? AND phone = ?", [n.id, ana]))[0]?.picture ?? ''), { timeout: 30_000 })
      .toMatch(/^data:image\//);
    await page.reload({ waitUntil: 'networkidle' });
    const groupUrl = page.url();
    const bubble = page.locator('.gr-msg', { hasText: `precios nuevos ${tag}` });
    await expect(bubble.getByTestId('wa-sender-avatar').locator('img')).toBeVisible({ timeout: 20_000 });

    // La foto abre la ficha; Mensaje abre el 1:1 en la misma línea.
    await bubble.getByTestId('wa-sender-avatar').click();
    const sheet = page.getByTestId('wa-contact-sheet');
    await expect(sheet.getByTestId('wa-sheet-name')).toHaveText(`Ana ${tag}`);
    await sheet.getByTestId('wa-sheet-message').click();
    await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?#]+/);
    await expect(sheet).toBeHidden();
    const dmUrl = page.url();
    expect(dmUrl).not.toContain(encodeURIComponent(gid));

    // De vuelta al grupo: Responder en privado.
    await page.goto(groupUrl, { waitUntil: 'networkidle' });
    const again = page.locator('.gr-msg', { hasText: `precios nuevos ${tag}` });
    await again.hover();
    await again.locator('.wa-chevron').click();
    await expect(page.getByTestId('menu-messageSender')).toBeVisible();
    await page.getByTestId('menu-replyPrivately').click();
    await expect(page.locator('.wa-replying')).toContainText(title, { timeout: 20_000 });
    const box = page.getByRole('textbox').last();
    await box.fill(`te paso la lista ${tag}`);
    await box.press('Enter');
    const reply = page.locator('.gr-msg', { hasText: `te paso la lista ${tag}` });
    await expect(reply.getByTestId('wa-private-quote')).toContainText(title, { timeout: 20_000 });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
