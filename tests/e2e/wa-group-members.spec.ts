import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { detailsTab } from './helpers/details-tab';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * Miembros de un grupo desde su info, en Lines y en Inbox (1280 y 390, WhatsApp
 * falso): "Agregar miembros" se ve sin pasar el mouse; se agregan dos personas
 * a la vez (una escrita y otra de los contactos), una se hace admin (aparece la
 * insignia), se le quita y se la quita del grupo; si el número conectado no es
 * admin, las acciones se ven deshabilitadas con la explicación. Grupos con
 * nombre único, abiertos por id; números inventados.
 * Con WA_SHOTS=<carpeta> guarda capturas para la pasada visual.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1e6 + Math.random() * 8e6)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function shot(page: Page, name: string) {
  const dir = process.env.WA_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

async function fakeLine(request: APIRequestContext): Promise<{ id: string; webhook: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `GM ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhook: new URL(info.webhookUrl).pathname };
}

/** Abre los detalles del chat de Lines (el botón "Details" o, si no está a la vista, la foto del chat). */
async function openLinesInfo(page: Page): Promise<Locator> {
  const aside = page.locator('aside.gr-details');
  await expect(page.locator('.wa-head-avatar')).toBeVisible({ timeout: 20_000 });
  if (!(await aside.isVisible())) {
    const details = page.getByRole('button', { name: 'Details', exact: true });
    if (await details.isVisible()) await details.click();
    else await page.locator('.wa-head-avatar').click();
  }
  await expect(aside).toBeVisible();
  // Los miembros van en su pestaña del panel.
  await detailsTab(page, 'members');
  return aside.getByTestId('group-members');
}

async function linkInbox(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  const status = async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state?: { status: string } }).state?.status;
  if ((await status()) !== 'connected') {
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(status, { timeout: 30_000 }).toBe('connected');
  }
  const db = e2eDb();
  try {
    const rows = (await db.execute("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'"))
      .rows as unknown as Array<{ id: string; webhook_secret: string }>;
    return { id: String(rows[0].id), secret: String(rows[0].webhook_secret) };
  } finally {
    db.close();
  }
}

/** Agrega dos personas a la vez: un número escrito y otro escrito y confirmado con Enter. */
async function addTwo(page: Page, panel: Locator, a: string, b: string) {
  const add = panel.getByTestId('group-add-members');
  await expect(add).toBeVisible();
  await expect(add).toBeEnabled();
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Add members' });
  const search = dialog.getByTestId('group-add-search');
  await search.fill(`+${a}`);
  await search.press('Enter');
  await search.fill(`+${b}`);
  await dialog.getByTestId('group-add-typed').check();
  await expect(dialog.getByTestId('group-add-confirm')).toHaveText('Add 2');
  expect(await noSideScroll(page)).toBe(true);
  await dialog.getByTestId('group-add-confirm').click();
  await expect(dialog).toBeHidden();
  await expect(panel.locator(`[data-testid="group-member"][data-phone="${a}"]:not(.is-pending)`)).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator(`[data-testid="group-member"][data-phone="${b}"]:not(.is-pending)`)).toBeVisible({ timeout: 30_000 });
}

async function memberMenu(page: Page, row: Locator, item: 'promote' | 'demote' | 'remove' | 'message') {
  const more = row.getByRole('button', { name: /^Options for / });
  await expect(more).toBeVisible();
  await more.click();
  await page.getByTestId(`menu-${item}`).click();
}

/** Hacer admin, quitar como admin y quitar del grupo a `a`. */
async function adminCycle(page: Page, panel: Locator, a: string) {
  const row = () => panel.locator(`[data-testid="group-member"][data-phone="${a}"]`);
  await memberMenu(page, row(), 'promote');
  await expect(row().getByTestId('group-admin-badge')).toBeVisible();
  await expect(row()).toHaveAttribute('data-role', 'admin');
  await memberMenu(page, row(), 'demote');
  await expect(row().getByTestId('group-admin-badge')).toHaveCount(0);
  // Esc cierra el menú sin hacer nada.
  await row().getByRole('button', { name: /^Options for / }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await memberMenu(page, row(), 'remove');
  await expect(row()).toHaveCount(0);
}

async function notAdminCase(page: Page, panel: Locator) {
  await expect(panel.getByTestId('group-not-admin')).toBeVisible();
  await expect(panel.getByTestId('group-not-admin')).toContainText('Only group admins');
  await expect(panel.getByTestId('group-add-members')).toBeVisible();
  await expect(panel.getByTestId('group-add-members')).toBeDisabled();
  // Una persona común: su ⋯ se abre y muestra "Hacer admin" y "Quitar" deshabilitados.
  const others = panel.locator('[data-testid="group-member"][data-role="member"]:not([data-me])');
  if (await others.count()) {
    await others.first().getByRole('button', { name: /^Options for / }).click();
    await expect(page.getByTestId('menu-promote')).toBeDisabled();
    await expect(page.getByTestId('menu-remove')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
}

for (const width of [1280, 390]) {
  test(`Lines: miembros del grupo desde su info (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const line = await fakeLine(request);
    const name = `Miembros ${uid()}`;
    const res = await request.post('/api/groups/create', { data: { numberId: line.id, name, phones: [phone()] } });
    expect(res.ok(), await res.text()).toBe(true);
    const chatId = ((await res.json()) as { results: Array<{ chatId: string }> }).results[0].chatId;

    await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
    const panel = await openLinesInfo(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('group-not-admin')).toHaveCount(0);
    const [a, b] = [phone(), phone()];
    await addTwo(page, panel, a, b);
    await shot(page, `lines-members-${width}`);
    await adminCycle(page, panel, a);
    expect(await noSideScroll(page)).toBe(true);

    // Actualizar: una fila de acción como Agregar miembros (misma columna, alto tocable) que vuelve a pedir los miembros.
    const sync = page.locator('aside.gr-details').getByTestId('group-sync-members');
    await sync.scrollIntoViewIfNeeded();
    const [syncBox, addBox] = [await sync.boundingBox(), await panel.getByTestId('group-add-members').boundingBox()];
    expect(syncBox && addBox && Math.abs(syncBox.x - addBox.x)).toBeLessThanOrEqual(1);
    expect(syncBox!.height).toBeGreaterThanOrEqual(40);
    const synced = page.waitForResponse((r) => r.url().endsWith(`/api/groups/chats/${chatId}/members`) && r.request().method() === 'POST');
    await sync.click();
    expect((await synced).ok()).toBe(true);
    await expect(sync).toBeEnabled();

    // Con el estilo zerosoft (puesto en la página) el ícono de Agregar miembros se ve: no es del mismo color que su círculo.
    const icon = await page.evaluate(() => {
      document.querySelector('.gr-inbox')?.setAttribute('data-chat-style', 'zerosoft');
      const el = document.querySelector<HTMLElement>('aside.gr-details [data-testid="group-add-members"] .wa-gm-action-icon')!;
      const cs = getComputedStyle(el);
      return { color: cs.color, background: cs.backgroundColor };
    });
    expect(icon.color, JSON.stringify(icon)).not.toBe(icon.background);

    // Un grupo donde la línea entró con un link: no es admin.
    const join = await request.post('/api/groups/join', { data: { numberId: line.id, invite: `https://chat.whatsapp.com/E2eNoAdmin${uid()}` } });
    expect(join.ok(), await join.text()).toBe(true);
    const joined = (await join.json()) as { id?: string; chat?: { id: string } };
    const joinedId = joined.chat?.id ?? joined.id!;
    await page.goto(`/en/app/lines/inbox/${joinedId}`, { waitUntil: 'networkidle' });
    const panel2 = await openLinesInfo(page);
    await notAdminCase(page, panel2);
    await shot(page, `lines-not-admin-${width}`);
    expect(await noSideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`Inbox: miembros del grupo desde su info (${width})`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 844 });
    const acc = await linkInbox(request);
    const title = `Asado ${uid()}`;
    const res = await request.post('/api/inbox/groups', { data: { name: title, phones: [phone()] } });
    expect(res.ok(), await res.text()).toBe(true);
    const { thread } = (await res.json()) as { thread: { id: string } };

    await page.goto(`/en/app/inbox?t=${thread.id}`, { waitUntil: 'networkidle' });
    await page.locator('.ib-wa-thread .wa-head-who').click({ timeout: 20_000 });
    await detailsTab(page, 'members');
    const panel = page.getByRole('complementary', { name: 'Group info' }).getByTestId('group-members');
    await panel.getByTestId('group-add-members').scrollIntoViewIfNeeded();
    await expect(panel.getByTestId('group-add-members')).toBeVisible();
    const [a, b] = [phone(), phone()];
    await addTwo(page, panel, a, b);
    await shot(page, `inbox-members-${width}`);
    await adminCycle(page, panel, a);
    expect(await noSideScroll(page)).toBe(true);

    // Un grupo donde la cuenta es miembro común (armado en el WhatsApp falso) con un mensaje para que aparezca.
    const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
    const other = `Vecinos ${uid()}`;
    const hook = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
      data: {
        events: [
          { type: 'fake_group', chatId: gid, name: other, participants: [{ phone: '15550009000', role: 'superadmin' }, { phone: '15550000001', role: 'member' }, { phone: '15550009001', role: 'member' }] },
          { type: 'message', chatId: gid, isGroup: true, chatName: other, fromMe: false, senderPhone: '15550009000', senderName: 'Admin Prueba', providerMessageId: `gm-${uid()}`, body: 'hola', timestamp: new Date().toISOString() },
        ],
      },
    });
    expect(hook.ok(), await hook.text()).toBe(true);
    const db = e2eDb();
    let otherId = '';
    try {
      const rows = (await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE external_id = ? AND account_id = ?', args: [gid, acc.id] })).rows as unknown as Array<{ id: string }>;
      otherId = String(rows[0].id);
    } finally {
      db.close();
    }
    await page.goto(`/en/app/inbox?t=${otherId}`, { waitUntil: 'networkidle' });
    await page.locator('.ib-wa-thread .wa-head-who').click();
    await detailsTab(page, 'members');
    const panel2 = page.getByRole('complementary', { name: 'Group info' }).getByTestId('group-members');
    // Los participantes llegan de WhatsApp al abrir el chat.
    await expect(panel2.getByTestId('group-not-admin')).toBeVisible({ timeout: 20_000 });
    await panel2.getByTestId('group-not-admin').scrollIntoViewIfNeeded();
    await notAdminCase(page, panel2);
    await shot(page, `inbox-not-admin-${width}`);
    expect(await noSideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}
