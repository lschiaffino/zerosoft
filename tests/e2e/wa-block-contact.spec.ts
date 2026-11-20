import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines con el WhatsApp falso (GROUPS_FAKE=1): "Bloquear a X" como en
 * WhatsApp, desde la ficha de una persona de un grupo y desde la info de su
 * chat 1:1. Bloquear pide confirmación (Esc la cancela) y desbloquear no.
 * Contra WhatsApp real no se prueba: el falso anota el pedido. Nombres y
 * números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${Math.floor(Math.random() * 10)}`;
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

async function fakeNumber(request: APIRequestContext): Promise<{ id: string; webhookUrl: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Block ${uid()}` } });
  const id = ((await created.json()) as { id: string }).id;
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

for (const size of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`Lines: bloquear y desbloquear un contacto (${size.name})`, async ({ page, request }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    const errors = watchErrors(page);
    const n = await fakeNumber(request);
    const send = async (list: unknown[]) => expect((await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
    const tag = uid();
    const ana = phone();
    const gid = groupId();
    const title = `Compras ${tag}`;
    const who = `Ana ${tag}`;
    // Ana escribe en el grupo y por privado (la línea tiene su chat 1:1).
    await send([message(`${ana}@s.whatsapp.net`, { senderName: who, chatName: who, body: `hola ${tag}` })]);
    await send([message(gid, { chatName: title, senderPhone: ana, senderName: who, body: `precios ${tag}` })]);

    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('.gr-row', { hasText: title }).click({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 30_000 });

    // Ficha de la persona: Bloquear pide confirmar; Esc lo cancela (la ficha sigue abierta).
    const bubble = page.locator('.gr-msg', { hasText: `precios ${tag}` });
    await bubble.getByTestId('wa-sender-name').click();
    const sheet = page.getByTestId('wa-contact-sheet');
    await expect(sheet.getByTestId('wa-sheet-name')).toHaveText(who);
    const row = sheet.getByTestId('wa-sheet-block');
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await expect(sheet.getByRole('alertdialog')).toBeVisible();
    await sheet.getByTestId('wa-sheet-block-confirm').click();
    await expect(sheet.getByTestId('wa-sheet-block')).toHaveAttribute('data-blocked', 'true', { timeout: 15_000 });
    // Desbloquear va directo, sin confirmar.
    await sheet.getByTestId('wa-sheet-block').click();
    await expect(sheet.getByTestId('wa-sheet-block')).not.toHaveAttribute('data-blocked', 'true', { timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // Info del chat 1:1: el mismo bloqueo, con el diálogo de confirmar.
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('.gr-row', { hasText: who }).first().click({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 2, name: who })).toBeVisible({ timeout: 30_000 });
    // La foto del encabezado abre la info (en todos los anchos), como en WhatsApp.
    const head = page.locator('.wa-head-avatar');
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('.gr-details');
    const block = panel.getByTestId('chat-block');
    await block.scrollIntoViewIfNeeded();
    await block.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(block).not.toHaveAttribute('data-blocked', 'true');
    await block.click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(block).toHaveAttribute('data-blocked', 'true', { timeout: 15_000 });
    await block.click();
    await expect(block).not.toHaveAttribute('data-blocked', 'true', { timeout: 15_000 });

    // Sin scroll lateral en el teléfono.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
