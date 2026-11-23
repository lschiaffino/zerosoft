import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * "@all" en un grupo de WhatsApp (Lines e Inbox), con el WhatsApp falso
 * (GROUPS_FAKE=1): "@" ofrece "Todos" primero, elegirlo escribe "@all" (o
 * "@todos" en español), se pinta como mención y sale con la marca de todos
 * (el falso devuelve los JIDs de cada participante y "~all" en el id). La
 * lista cierra con Esc y tocando afuera, y en el teléfono entra en la
 * pantalla. Nombres y números inventados.
 * Con WA_MENTION_ALL_SHOTS=<carpeta> guarda capturas para la pasada visual.
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
const groupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.WA_MENTION_ALL_SHOTS;
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

async function fakeLinesNumber(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `All ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const post = async (list: unknown[]) => {
    const res = await request.post(new URL(info.webhookUrl).pathname, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  return { id, post };
}

async function inboxAccount(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return async (list: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: list } });
    expect(res.ok()).toBe(true);
  };
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [1280, 390]) {
  test.describe(`a ${width}`, () => {
    // En el teléfono, con pantalla táctil: elegir Todos con un toque no puede cerrar la lista antes de tiempo.
    test.use({ hasTouch: width < 500 });
    test(`Lines: @all en un grupo menciona a todos (${width})`, async ({ page, request }) => {
      test.setTimeout(300_000);
      const errors = watchErrors(page);
      const n = await fakeLinesNumber(request);
      const tag = uid();
      const one = phone();
      const two = phone();
      const gid = groupId();
      const title = `Todos ${tag}`;
      await n.post([
        {
          type: 'fake_contacts',
          contacts: [
            { phone: one, name: `Persona Uno ${tag}`, groups: [gid] },
            { phone: two, name: `Persona Dos ${tag}`, groups: [gid] },
          ],
        },
      ]);
      await n.post([message(gid, { chatName: title, senderPhone: two, senderName: `Persona Dos ${tag}`, body: 'hola' })]);

      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await page.locator('.gr-row', { hasText: title }).click({ timeout: 90_000 });
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 120_000 });
      await expect(page.locator('.wa-head-sub')).toContainText(`Persona Uno ${tag}`, { timeout: 20_000 });

      const input = page.getByRole('textbox', { name: 'WhatsApp' });
      await input.click();
      await input.pressSequentially('Mañana a las 9 @');
      const pop = page.getByRole('listbox', { name: 'Mention someone' });
      await expect(pop).toBeVisible();
      // "Everyone" va primero, con cuántos avisa.
      const all = pop.getByRole('option').first();
      await expect(all.getByTestId('mention-all')).toBeVisible();
      await expect(all).toContainText('Everyone (@all)');
      await expect(all).toContainText('Notifies all 2 members');
      await expect(all).toHaveAttribute('aria-selected', 'true');
      const box = (await all.getByTestId('mention-all').boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(40);
      const popBox = (await pop.boundingBox())!;
      expect(popBox.x).toBeGreaterThanOrEqual(0);
      expect(popBox.x + popBox.width).toBeLessThanOrEqual(width);
      await noSideScroll(page);
      await shot(page, `lines-all-list-${width}`);

      // Esc la cierra; tocar afuera también.
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
      await page.keyboard.press('Backspace');
      await input.pressSequentially('@');
      await expect(pop).toBeVisible();
      await page.getByRole('heading', { level: 2, name: title }).click();
      await expect(pop).toBeHidden();
      await input.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Backspace');
      await input.pressSequentially('@al');
      await expect(pop).toBeVisible();
      await expect(pop.getByRole('option').first().getByTestId('mention-all')).toBeVisible();
      // En el teléfono se toca (el campo no pierde el foco); en la computadora, Enter.
      if (width < 500) await pop.getByTestId('mention-all').tap();
      else await page.keyboard.press('Enter');
      await expect(pop).toBeHidden();
      await expect(input).toHaveValue('Mañana a las 9 @all ');
      await expect(page.locator('.wa-input-mirror .wa-input-mention')).toHaveText('@all');
      await shot(page, `lines-all-field-${width}`);

      const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/groups\/chats\/[^/]+\/messages$/.test(r.url()));
      await page.keyboard.press('Enter');
      const payload = (await sent).postDataJSON() as { body: string; mentions?: string[] };
      expect(payload.body).toBe('Mañana a las 9 @all');
      expect(payload.mentions).toEqual(['all']);
      // Salió con la marca: el falso avisó a cada participante.
      await expect
        .poll(async () => String((await sql("SELECT provider_message_id FROM groups_messages WHERE number_id = ? AND direction = 'out'", [n.id]))[0]?.provider_message_id ?? ''), {
          timeout: 30_000,
        })
        .toMatch(/~all$/);
      const [out] = await sql("SELECT provider_message_id, meta FROM groups_messages WHERE number_id = ? AND direction = 'out'", [n.id]);
      const jids = String(out.provider_message_id).split('~')[1].split(',');
      expect(jids).toEqual(expect.arrayContaining([`${one}@s.whatsapp.net`, `${two}@s.whatsapp.net`]));
      expect(JSON.parse(String(out.meta)).mentions).toEqual(['all']);
      await expect(page.locator('.gr-msg', { hasText: 'Mañana a las 9 @all' })).toBeVisible();
      await noSideScroll(page);
      expect(errors).toEqual([]);
    });

    test(`Inbox: @todos en un grupo menciona a todos (${width})`, async ({ page, request }) => {
      test.setTimeout(300_000);
      const errors = watchErrors(page);
      const post = await inboxAccount(request);
      const tag = uid();
      const one = phone();
      const two = phone();
      const gid = groupId();
      const title = `Grupo todos ${tag}`;
      await post([
        {
          type: 'fake_contacts',
          contacts: [
            { phone: one, name: `Persona Uno ${tag}`, groups: [gid] },
            { phone: two, name: `Persona Dos ${tag}`, groups: [gid] },
          ],
        },
      ]);
      await post([message(gid, { chatName: title, senderPhone: one, senderName: `Persona Uno ${tag}`, body: 'buenas' })]);

      await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
      // En español: la palabra es "todos" (y "@all" también vale).
      await page.goto('/es/app/inbox', { waitUntil: 'networkidle' });
      await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click({ timeout: 90_000 });
      const input = page.locator('.ib-wa-composer textarea.wa-input');
      await expect(async () => {
        const retry = page.getByRole('button', { name: 'Reintentar' });
        if (await retry.isVisible()) await retry.click();
        await expect(input).toBeVisible({ timeout: 15_000 });
      }).toPass({ timeout: 180_000 });
      await input.click();
      await input.pressSequentially('Reunión @');
      const pop = page.locator('.ib-wa-mentions');
      await expect(pop).toBeVisible({ timeout: 20_000 });
      const all = pop.getByRole('option').first();
      await expect(all.getByTestId('mention-all')).toBeVisible();
      await expect(all).toContainText('Todos (@todos)');
      await expect(all).toContainText('Avisa a los 2 miembros');
      expect((await all.getByTestId('mention-all').boundingBox())!.height).toBeGreaterThanOrEqual(40);
      const popBox = (await pop.boundingBox())!;
      expect(popBox.x).toBeGreaterThanOrEqual(0);
      expect(popBox.x + popBox.width).toBeLessThanOrEqual(width);
      await noSideScroll(page);
      await shot(page, `inbox-all-list-${width}`);

      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();
      await page.keyboard.press('Backspace');
      await input.pressSequentially('@');
      await expect(pop).toBeVisible();
      await page.locator('.ib-wa-thread').click({ position: { x: 10, y: 10 } });
      await expect(pop).toBeHidden();
      await input.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Backspace');
      await input.pressSequentially('@to');
      await expect(pop.getByRole('option').first().getByTestId('mention-all')).toBeVisible();
      if (width < 500) await pop.getByTestId('mention-all').tap();
      else await page.keyboard.press('Enter');
      await expect(input).toHaveValue('Reunión @todos ');
      await expect(page.locator('.wa-input-mirror .wa-input-mention')).toHaveText('@todos');
      await shot(page, `inbox-all-field-${width}`);

      const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/inbox\/threads\/[^/]+\/messages$/.test(r.url()));
      await page.keyboard.press('Enter');
      const payload = (await sent).postDataJSON() as { body: string; mentions?: string[] };
      expect(payload.body).toBe('Reunión @todos');
      expect(payload.mentions).toEqual(['all']);
      const sentRow = async () =>
        (
          await sql('SELECT m.external_id FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.external_id = ? AND m.from_me = 1 AND m.body = ?', [
            gid,
            'Reunión @todos',
          ])
        )[0] ?? null;
      await expect.poll(async () => String((await sentRow())?.external_id ?? ''), { timeout: 30_000 }).toMatch(/~all$/);
      const jids = String((await sentRow())!.external_id)
        .split('~')[1]
        .split(',');
      expect(jids).toEqual(expect.arrayContaining([`${one}@s.whatsapp.net`, `${two}@s.whatsapp.net`]));
      await noSideScroll(page);
      expect(errors).toEqual([]);
    });
  });
}

test('Lines: en una nota interna no se ofrece @all', async ({ page, request }) => {
  test.setTimeout(300_000);
  const n = await fakeLinesNumber(request);
  const tag = uid();
  const gid = groupId();
  const title = `Nota ${tag}`;
  await n.post([message(gid, { chatName: title, senderPhone: phone(), senderName: `Persona ${tag}`, body: 'hola' })]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: title }).click({ timeout: 90_000 });
  await page.getByRole('tab', { name: 'Internal note' }).click();
  const input = page.getByRole('textbox', { name: 'Internal note' });
  await input.click();
  await input.pressSequentially('@');
  const pop = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(pop).toBeVisible();
  await expect(pop.getByTestId('mention-all')).toHaveCount(0);
});
