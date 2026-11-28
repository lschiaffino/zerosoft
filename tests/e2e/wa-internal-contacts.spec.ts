import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Contactos internos (lib/internal-contacts.ts) en Lines e Inbox, con el
 * WhatsApp falso: el admin los marca en Ajustes o desde la ficha de una
 * persona; lo que escriben lleva "Interno" al lado del nombre, también en los
 * miembros; el filtro de Lines y la vista Internos de Inbox los separan, y
 * "Por responder" de Inbox no los muestra. A 1280 y a 390, sin scroll
 * lateral y con objetivos de 40 px. Nombres y números inventados.
 * Con WA_INTERNAL_SHOTS=<carpeta> guarda capturas para la pasada visual.
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
  const dir = process.env.WA_INTERNAL_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
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
  // Si algo se sale del ancho, el error dice qué (clase y ancho).
  const wide = await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth
      ? []
      : [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && el.getBoundingClientRect().width > 0)
          .slice(0, 8)
          .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)} ${Math.round(el.getBoundingClientRect().right)}`),
  );
  expect(wide).toEqual([]);
}

/** Lo que se toca en la pantalla mide al menos 40 px de alto. */
async function tapTargets(page: Page, scope: string) {
  const small = await page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} select, ${sel} input[type="checkbox"]`)) {
      const box = (el.closest('label') ?? el).getBoundingClientRect();
      if (box.width > 0 && box.height < 40) out.push(`${el.tagName} ${el.textContent?.trim().slice(0, 20)} ${Math.round(box.height)}`);
    }
    return out;
  }, scope);
  expect(small).toEqual([]);
}

async function fakeLinesNumber(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Internos ${uid()}` } });
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
  test(`Lines: marcar a alguien del equipo como interno (${width})`, async ({ page, request }) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    const n = await fakeLinesNumber(request);
    const tag = uid();
    const teammate = phone();
    const customer = phone();
    const gid = groupId();
    const title = `Cliente ${tag}`;
    await n.post([{ type: 'fake_contacts', contacts: [{ phone: teammate, name: `Equipo ${tag}`, groups: [gid] }, { phone: customer, name: `Cliente ${tag}`, groups: [gid] }] }]);
    // El admin marca al del equipo (la misma ruta que Ajustes) antes de que escriba.
    expect((await request.post('/api/groups/internal', { data: { handle: teammate, internal: true, name: `Equipo ${tag}` } })).ok()).toBe(true);
    await n.post([
      message(gid, { chatName: title, senderPhone: customer, senderName: `Cliente ${tag}`, body: `pregunta ${tag}`, timestamp: new Date(Date.now() - 120_000).toISOString() }),
      message(gid, { chatName: title, senderPhone: teammate, senderName: `Equipo ${tag}`, body: `respuesta ${tag}`, timestamp: new Date(Date.now() - 60_000).toISOString() }),
      message(`${teammate}@s.whatsapp.net`, { senderPhone: teammate, senderName: `Equipo ${tag}`, body: `privado ${tag}` }),
    ]);
    await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });

    // Ajustes › Contactos internos: el del equipo está; se suma otro con el formulario y se lo pasa a "no interno".
    await page.goto('/en/app/lines/settings?tab=internal', { waitUntil: 'networkidle' });
    const panel = page.getByTestId('internal-contacts');
    await expect(panel.getByTestId('internal-lines')).toBeChecked({ timeout: 60_000 });
    await expect(panel.getByTestId('internal-row').filter({ hasText: `Equipo ${tag}` })).toHaveAttribute('data-state', 'internal');
    const extra = phone();
    await panel.getByTestId('internal-handle').fill(`+${extra}`);
    await panel.getByTestId('internal-name').fill(`Otro ${tag}`);
    await panel.getByTestId('internal-add').click();
    const row = panel.getByTestId('internal-row').filter({ hasText: `Otro ${tag}` });
    await expect(row).toHaveAttribute('data-state', 'internal');
    await expect(panel.getByTestId('internal-handle')).toHaveValue('');
    await row.getByRole('combobox').selectOption('external');
    await expect(row).toHaveAttribute('data-state', 'external');
    await noSideScroll(page);
    await tapTargets(page, '[data-testid="internal-contacts"]');
    await shot(page, `lines-settings-${width}`);

    // En el grupo: "Internal" al lado del nombre de quien es del equipo, y no al lado del cliente.
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('.gr-row', { hasText: title }).click({ timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 120_000 });
    const mine = page.locator('.gr-msg', { hasText: `respuesta ${tag}` });
    const theirs = page.locator('.gr-msg', { hasText: `pregunta ${tag}` });
    await expect(mine.getByTestId('wa-internal-tag')).toBeVisible({ timeout: 30_000 });
    await expect(theirs.getByTestId('wa-internal-tag')).toHaveCount(0);
    await noSideScroll(page);
    await shot(page, `lines-thread-${width}`);
    // Respondió alguien del equipo: el chat no espera respuesta.
    const [chat] = await sql('SELECT id, awaiting_since FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [n.id, gid]);
    expect(chat.awaiting_since).toBeNull();

    // Desde la ficha del cliente: marcarlo y desmarcarlo (es un admin).
    await theirs.getByTestId('wa-sender-name').click();
    const sheet = page.getByTestId('wa-contact-sheet');
    const toggle = sheet.getByTestId('wa-sheet-internal');
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.getByText(`Cliente ${tag} is now internal`)).toBeVisible();
    await shot(page, `lines-sheet-${width}`);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // Los miembros del grupo (página del grupo): "Internal" en el del equipo.
    await page.goto(`/en/app/lines/list/${chat.id}`, { waitUntil: 'networkidle' });
    const member = page.locator(`[data-testid="group-member"][data-phone="${teammate}"]`);
    await expect(member.getByTestId('group-internal-badge')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(`[data-testid="group-member"][data-phone="${customer}"]`).getByTestId('group-internal-badge')).toHaveCount(0);
    await noSideScroll(page);
    await shot(page, `lines-members-${width}`);

    // El filtro "Internal contact": solo el 1:1 del equipo. En la computadora desde el panel; en el teléfono, guardado.
    if (width > 500) {
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await page.getByTestId('lines-filter-button').click();
      const dlg = page.getByRole('dialog', { name: 'Filters' });
      await dlg.getByRole('navigation', { name: 'Filter fields' }).getByRole('button', { name: /^Internal contact/ }).click();
      await dlg.getByRole('group', { name: 'Internal contact' }).getByRole('button', { name: 'Yes', exact: true }).click();
      await dlg.getByRole('button', { name: 'Apply' }).click();
    } else {
      await page.evaluate(() => sessionStorage.setItem('zs-groups-inbox', JSON.stringify({ internal: 'yes' })));
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    }
    await expect(page.locator('.gr-row', { hasText: `Equipo ${tag}` })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.gr-row', { hasText: title })).toHaveCount(0);
    await shot(page, `lines-filter-${width}`);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test(`Inbox: lo interno fuera de Por responder y en su vista (${width})`, async ({ page, request }) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    const post = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: list } })).ok()).toBe(true);
    const tag = uid();
    const teammate = phone();
    const customer = phone();
    const gid = groupId();
    const title = `Obra ${tag}`;
    await post([{ type: 'fake_contacts', contacts: [{ phone: teammate, name: `Equipo ${tag}`, groups: [gid] }, { phone: customer, name: `Cliente ${tag}`, groups: [gid] }] }]);
    await post([
      message(gid, { chatName: title, senderPhone: customer, senderName: `Cliente ${tag}`, body: `pregunta ${tag}` }),
      message(gid, { chatName: title, senderPhone: teammate, senderName: `Equipo ${tag}`, body: `respuesta ${tag}` }),
      message(`${teammate}@s.whatsapp.net`, { senderPhone: teammate, senderName: `Equipo ${tag}`, body: `privado ${tag}` }),
      message(`${customer}@s.whatsapp.net`, { senderPhone: customer, senderName: `Cliente ${tag}`, body: `consulta ${tag}` }),
    ]);
    // El admin lo marca (Ajustes de Inbox usa la misma ruta).
    expect((await request.post('/api/inbox/internal', { data: { handle: teammate, internal: true, name: `Equipo ${tag}` } })).ok()).toBe(true);
    await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });

    // Por responder: el cliente sí, el del equipo no. La vista Internos: al revés.
    await page.goto('/en/app/inbox/v/reply', { waitUntil: 'networkidle' });
    await expect(page.locator('.ib-item', { hasText: `consulta ${tag}` })).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.ib-item', { hasText: `privado ${tag}` })).toHaveCount(0);
    await page.goto('/en/app/inbox/v/internal', { waitUntil: 'networkidle' });
    await expect(page.locator('.ib-item', { hasText: `privado ${tag}` })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.ib-item', { hasText: `consulta ${tag}` })).toHaveCount(0);
    await noSideScroll(page);
    await shot(page, `inbox-view-${width}`);

    // En el grupo: "Internal" al lado del nombre del equipo.
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click({ timeout: 90_000 });
    const thread = page.locator('.ib-wa-thread');
    await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 120_000 });
    await expect(thread.locator('.gr-msg', { hasText: `respuesta ${tag}` }).getByTestId('wa-internal-tag')).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('.gr-msg', { hasText: `pregunta ${tag}` }).getByTestId('wa-internal-tag')).toHaveCount(0);
    await noSideScroll(page);
    await shot(page, `inbox-thread-${width}`);

    // La ficha del cliente: el admin lo marca desde ahí.
    await thread.locator('.gr-msg', { hasText: `pregunta ${tag}` }).getByTestId('wa-sender-name').click();
    const sheet = page.getByTestId('wa-contact-sheet');
    const toggle = sheet.getByTestId('wa-sheet-internal');
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(thread.locator('.gr-msg', { hasText: `pregunta ${tag}` }).getByTestId('wa-internal-tag')).toBeVisible({ timeout: 30_000 });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // Ajustes de Inbox: el mismo panel, con el contacto marcado.
    await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
    const panel = page.getByTestId('internal-contacts');
    await expect(panel.getByTestId('internal-row').filter({ hasText: `Equipo ${tag}` })).toHaveAttribute('data-state', 'internal', { timeout: 60_000 });
    await panel.scrollIntoViewIfNeeded();
    await noSideScroll(page);
    await tapTargets(page, '[data-testid="internal-contacts"]');
    await shot(page, `inbox-settings-${width}`);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
