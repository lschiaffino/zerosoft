import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Resumen del día (lib/daily-brief.ts) arriba de la bandeja de Lines y de
 * Inbox, con el WhatsApp falso: la tarjeta cuenta lo que espera, cada fila
 * lleva a lo suyo, se cierra hasta mañana (y sigue cerrada al recargar), y el
 * email de la mañana se prende en Ajustes › Avisos. A 1280 y a 390, sin
 * scroll lateral y con objetivos de 40 px. Nombres y números inventados.
 * Con WA_BRIEF_SHOTS=<carpeta> guarda capturas para la pasada visual.
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
const phone = () => `54900${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.WA_BRIEF_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
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

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function tapTargets(page: Page) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="daily-brief"] button')) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height < 40) out.push(`${el.textContent?.trim().slice(0, 20)} ${Math.round(box.height)}`);
    }
    return out;
  });
  expect(small).toEqual([]);
}

async function demo(): Promise<string> {
  const [u] = await sql("SELECT id FROM users WHERE email = 'demo@zerosoft.ai'");
  return String(u.id);
}

async function fakeLinesNumber(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Brief ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const post = async (list: unknown[]) => {
    const res = await request.post(new URL(info.webhookUrl).pathname, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  return { id, post };
}

for (const width of [1280, 390]) {
  test(`Lines: el resumen del día arriba de la bandeja (${width})`, async ({ page, request }) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    const me = await demo();
    await sql("DELETE FROM daily_brief_dismissals WHERE user_id = ? AND app = 'lines'", [me]);
    const n = await fakeLinesNumber(request);
    const tag = uid();
    const customer = phone();
    await n.post([message(`${customer}@s.whatsapp.net`, { senderName: `Cliente ${tag}`, body: `consulta ${tag}` })]);
    const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND kind = ?', [n.id, 'dm']);
    expect((await request.patch(`/api/groups/chats/${chat.id}`, { data: { assignedTo: me } })).ok()).toBe(true);

    await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const card = page.getByTestId('daily-brief');
    await expect(card).toBeVisible({ timeout: 90_000 });
    await expect(card.getByRole('heading', { name: 'Today' })).toBeVisible();
    const waiting = card.locator('[data-kind="waiting"]');
    await expect(waiting).toBeVisible();
    await expect(waiting).toContainText('waiting for your reply');
    await noSideScroll(page);
    await tapTargets(page);
    await shot(page, `lines-brief-${width}`);

    // La fila pone el filtro de los que esperan respuesta (asignados a mí): el nuestro está en la lista.
    await waiting.click();
    await expect(page.getByTestId('lines-tab-unanswered')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.gr-row', { hasText: `Cliente ${tag}` })).toBeVisible({ timeout: 30_000 });

    // Cerrar: queda "Oculto hasta mañana" con Deshacer; deshacer la trae de vuelta.
    await card.getByTestId('daily-brief-dismiss').click();
    const undo = page.getByTestId('daily-brief-undo');
    await expect(undo).toBeVisible();
    await shot(page, `lines-brief-undo-${width}`);
    await undo.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('daily-brief')).toBeVisible();
    // Cerrada otra vez: sigue cerrada al recargar (es por hoy).
    await page.getByTestId('daily-brief-dismiss').click();
    await expect(page.getByTestId('daily-brief')).toBeHidden();
    const answered = page.waitForResponse((r) => r.url().includes('/api/groups/brief'));
    await page.reload({ waitUntil: 'networkidle' });
    expect(((await (await answered).json()) as { dismissed: boolean }).dismissed).toBe(true);
    await expect(page.locator('.gr-row').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('daily-brief')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test(`Inbox: el resumen del día arriba de la bandeja (${width})`, async ({ page, request }) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    const me = await demo();
    await sql("DELETE FROM daily_brief_dismissals WHERE user_id = ? AND app = 'inbox'", [me]);
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a WHERE a.owner_id = ? AND a.kind = 'whatsapp'", [me]);
    const tag = uid();
    const customer = phone();
    expect(
      (await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: [message(`${customer}@s.whatsapp.net`, { senderName: `Cliente ${tag}`, body: `consulta ${tag}` })] } })).ok(),
    ).toBe(true);

    await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const card = page.getByTestId('daily-brief');
    await expect(card).toBeVisible({ timeout: 90_000 });
    const reply = card.locator('[data-kind="reply"]');
    await expect(reply).toContainText('to reply');
    await noSideScroll(page);
    await tapTargets(page);
    await shot(page, `inbox-brief-${width}`);

    // La fila lleva a Por responder.
    await reply.click();
    await expect(page).toHaveURL(/\/app\/inbox\/v\/reply/);
    await expect(page.locator('.ib-item', { hasText: `consulta ${tag}` })).toBeVisible({ timeout: 30_000 });

    // De vuelta en la bandeja: cerrar la deja cerrada por hoy.
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('daily-brief')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('daily-brief-dismiss').click();
    await expect(page.getByTestId('daily-brief')).toBeHidden();
    await expect(page.getByTestId('daily-brief-undo')).toBeVisible();
    const answered = page.waitForResponse((r) => r.url().includes('/api/inbox/brief'));
    await page.reload({ waitUntil: 'networkidle' });
    expect(((await (await answered).json()) as { dismissed: boolean }).dismissed).toBe(true);
    await expect(page.locator('.ib-item').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('daily-brief')).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('Ajustes › Avisos: el email del resumen del día se prende y queda', async ({ page }) => {
  test.setTimeout(180_000);
  const me = await demo();
  await sql('DELETE FROM daily_brief_prefs WHERE user_id = ?', [me]);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
    await page.goto('/en/app/settings/notifications', { waitUntil: 'networkidle' });
    const box = page.getByTestId('daily-brief-email');
    await expect(box).toBeVisible({ timeout: 60_000 });
    await noSideScroll(page);
    await shot(page, `settings-brief-${width}`);
  }
  const box = page.getByTestId('daily-brief-email');
  await expect(box).not.toBeChecked();
  await box.check();
  const section = page.locator('[data-setting="notifications-daily-brief"]');
  await section.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => Number((await sql('SELECT email FROM daily_brief_prefs WHERE user_id = ?', [me]))[0]?.email ?? 0)).toBe(1);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('daily-brief-email')).toBeChecked();
});
