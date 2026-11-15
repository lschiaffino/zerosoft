import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Contactos en Lines y en Inbox, contra el WhatsApp y el HubSpot falsos: cada
 * persona una vez aunque esté en un grupo y en un chat 1:1, con sus líneas o
 * cuentas, sus grupos y su contacto de HubSpot. Crear en HubSpot la asocia a
 * la empresa de su grupo; al volver a vincular aparece el contacto que ya
 * existe (no se crea otro). Los menús de filtro cierran con un clic afuera,
 * con Esc y al elegir; nada scrollea de costado en el teléfono. Nada sale a
 * internet ni a WhatsApp.
 *
 * Nombres y teléfonos inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const TOKEN = 'pat-na1-e2e-wa-contacts';
/** Con SHOTS=<carpeta>, capturas para revisar a ojo. */
const SHOTS = process.env.SHOTS;

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function connectHubspot(request: APIRequestContext) {
  await request.delete('/api/groups/hubspot');
  const res = await request.post('/api/groups/hubspot', { data: { token: TOKEN } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.afterAll(async ({ request }) => {
  // El workspace compartido queda sin HubSpot, pase lo que pase.
  await request.delete('/api/groups/hubspot').catch(() => null);
});

// ---------- Lines ----------

async function fakeLine(request: APIRequestContext, name: string): Promise<{ id: string; webhookPath: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookPath: new URL(info.webhookUrl).pathname };
}

async function lineEvent(request: APIRequestContext, line: { webhookPath: string }, ev: Record<string, unknown>) {
  const res = await request.post(line.webhookPath, { data: { events: [{ type: 'message', fromMe: false, providerMessageId: `wc-${uid()}`, body: 'Hola', ...ev }] } });
  expect(res.ok(), await res.text()).toBe(true);
}

async function chatIdOf(request: APIRequestContext, numberId: string, kind: 'dm' | 'group', name: string): Promise<string> {
  let id = '';
  await expect
    .poll(async () => {
      const found = (await (await request.get(`/api/groups/chats?kind=${kind}&number=${numberId}&q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string; name: string }> };
      id = found.rows.find((r) => r.name === name)?.id ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

// ---------- Compuertas de interacción (las mismas en las dos apps y en los dos anchos) ----------

async function noSideScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${label}: scroll de costado`).toBeLessThanOrEqual(0);
}

async function menuGates(page: Page, label: string) {
  const btn = page.getByTestId('contacts-chat-filter');
  const menu = page.getByRole('menu');
  // Clic afuera.
  await btn.click();
  await expect(menu).toBeVisible();
  await noSideScroll(page, `${label} menú abierto`);
  await page.getByRole('heading', { level: 1 }).click();
  await expect(menu).toBeHidden();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  // Esc: cierra y el foco vuelve al botón.
  await btn.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(btn).toBeFocused();
  // Elegir: cierra y queda marcada.
  await btn.click();
  await menu.getByRole('menuitemradio').nth(1).click();
  await expect(menu).toBeHidden();
  await btn.click();
  await expect(menu.getByRole('menuitemradio').nth(1)).toHaveAttribute('aria-checked', 'true');
  // Volver a "Todos" (y cerrar al elegir).
  await menu.getByRole('menuitemradio').nth(0).click();
  await expect(menu).toBeHidden();
}

/** El nombre no se mueve ni desaparece con el mouse encima (ni al pasar a la fila de abajo y volver). */
async function hoverStable(page: Page, row: ReturnType<Page['locator']>) {
  const name = row.getByTestId('contact-open');
  const before = await name.boundingBox();
  await name.hover();
  await expect(name).toBeVisible();
  const during = await name.boundingBox();
  expect(during).toEqual(before);
  await page.mouse.move(5, 5);
  await name.hover();
  await expect(name).toBeVisible();
}

async function dialogGates(page: Page, row: ReturnType<Page['locator']>, label: string) {
  const dialog = page.getByRole('dialog');
  await row.getByTestId('contact-open').click();
  await expect(dialog.getByTestId('contact-detail')).toBeVisible();
  await noSideScroll(page, `${label} ficha`);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await row.getByTestId('contact-open').click();
  await expect(dialog.getByTestId('contact-detail')).toBeVisible();
  await dialog.getByTestId('contact-close').click();
  await expect(dialog).toBeHidden();
}

async function phonePass(browser: Browser, baseURL: string, url: string, search: string, label: string) {
  const ctx = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await ctx.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(ctx, baseURL, theme);
      await mobile.goto(url, { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await mobile.getByTestId('contacts-search').fill(search);
      const row = mobile.getByTestId('contact-row');
      await expect(row).toHaveCount(1);
      await noSideScroll(mobile, `${label} 390 ${theme}`);
      await check(mobile, `${label} 390 ${theme}`);
      if (SHOTS) await mobile.screenshot({ path: `${SHOTS}/${label}-390-${theme}.png`, fullPage: true });
      await menuGates(mobile, `${label} 390 ${theme}`);
      await row.getByTestId('contact-open').click();
      await expect(mobile.getByTestId('contact-detail')).toBeVisible();
      await check(mobile, `${label} ficha 390 ${theme}`);
      if (SHOTS) await mobile.screenshot({ path: `${SHOTS}/${label}-ficha-390-${theme}.png` });
      await noSideScroll(mobile, `${label} ficha 390 ${theme}`);
      await mobile.keyboard.press('Escape');
      await expect(mobile.getByRole('dialog')).toBeHidden();
    }
  } finally {
    await ctx.close();
  }
}

test('Lines › Contactos: una fila por persona, crear en HubSpot con la empresa del grupo y volver a vincular sin duplicar', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  const tag = uid();
  const ventas = await fakeLine(request, `Ventas ${tag}`);
  const soporte = await fakeLine(request, `Soporte ${tag}`);
  const person = phone();
  const jid = `1203631${String(Date.now()).slice(-8)}1@g.us`;
  const groupName = `Obra ${tag}`;
  // La misma persona en un grupo (en las dos líneas) y en un chat 1:1 de Ventas.
  await lineEvent(request, ventas, { chatId: jid, isGroup: true, chatName: groupName, senderPhone: person, senderName: `Rita ${tag}` });
  await lineEvent(request, soporte, { chatId: jid, isGroup: true, chatName: groupName, senderPhone: person, senderName: `Rita ${tag}` });
  await lineEvent(request, ventas, { chatId: `${person}@s.whatsapp.net`, isGroup: false, chatName: `Rita ${tag}`, senderPhone: person, senderName: `Rita ${tag}` });
  const groupChat = await chatIdOf(request, ventas.id, 'group', groupName);
  // HubSpot con el grupo vinculado a una empresa.
  await connectHubspot(request);
  const linked = await request.post('/api/groups/hubspot/links', { data: { chatId: groupChat, type: 'company', objectId: '9003' } });
  expect(linked.ok(), await linked.text()).toBe(true);

  // Con `next dev` cada ruta compila en su primer pedido (puede tardar más que un expect): se piden antes.
  await page.request.get('/api/groups/people', { timeout: 120_000 });
  await page.request.get('/api/groups/people/person?id=0', { timeout: 120_000 });
  await page.goto('/en/app/lines/contacts', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('contacts-view')).toBeVisible();
  // En el sidebar, Contactos marcado.
  await expect(page.locator('a[href$="/app/lines/contacts"][aria-current="page"]').first()).toBeVisible();
  await page.getByTestId('contacts-search').fill(person.slice(-8));
  const row = page.getByTestId('contact-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`Rita ${tag}`);
  await expect(row).toContainText(groupName);
  // Dos líneas: la primera y "+1".
  await expect(row.locator('.wc-chip')).toHaveCount(1);
  await expect(row.locator('.wc-more').first()).toContainText('+1');
  await noSideScroll(page, 'lines 1280');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lines-1280-light.png`, fullPage: true });

  // Filtro por línea: Soporte la tiene (por el grupo).
  await page.getByTestId('contacts-line-filter').click();
  await page.getByRole('menuitemradio', { name: `Soporte ${tag}` }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(row).toHaveCount(1);
  await menuGates(page, 'lines 1280');
  await hoverStable(page, row);

  // Ficha: sin contacto en HubSpot con ese teléfono → Crear (asociado a la empresa del grupo).
  const dialog = page.getByRole('dialog');
  await row.getByTestId('contact-open').click();
  await expect(dialog.getByTestId('contact-groups')).toContainText(groupName);
  // La búsqueda por teléfono en HubSpot.
  await expect(dialog.getByTestId('contact-hs-create')).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lines-ficha-1280-light.png` });
  await dialog.getByTestId('contact-hs-create').click();
  await expect(dialog.getByTestId('contact-hs-contact')).toContainText(`Rita ${tag}`);
  await expect(dialog.getByTestId('contact-hs-company')).toContainText('Initech Foods');
  await expect(dialog.getByTestId('contact-hs-company')).toHaveAttribute('href', /\/record\/0-2\/9003$/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row.getByTestId('contact-hubspot')).toContainText(`Rita ${tag}`);

  // Filtro de HubSpot: vinculados sí, sin vincular no.
  await page.getByTestId('contacts-hubspot-filter').click();
  await page.getByRole('menuitemradio').nth(2).click();
  await expect(page.getByTestId('contact-row')).toHaveCount(0);
  await page.getByTestId('contacts-hubspot-filter').click();
  await page.getByRole('menuitemradio').nth(1).click();
  await expect(row).toHaveCount(1);

  // Desvincular y volver: aparece el contacto que ya existe (no se ofrece crear otro).
  await row.getByTestId('contact-open').click();
  await dialog.getByTestId('contact-hs-unlink').click();
  await expect(dialog.getByTestId('contact-hs-matches')).toContainText(`Rita ${tag}`, { timeout: 30_000 });
  await expect(dialog.getByTestId('contact-hs-create')).toHaveCount(0);
  await dialog.getByTestId('contact-hs-link').click();
  await expect(dialog.getByTestId('contact-hs-contact')).toBeVisible();
  // Un solo contacto con ese teléfono en el HubSpot falso.
  const links = await sql('SELECT contact_id FROM groups_contact_links WHERE phone = ?', [person]);
  expect(links).toHaveLength(1);
  // "Abrir chat" va al 1:1.
  await dialog.getByTestId('contact-message').click();
  await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?]+/);

  // ---------- Compuertas en la computadora, oscuro, y en el teléfono ----------
  await page.goto('/en/app/lines/contacts', { waitUntil: 'networkidle' });
  await page.getByTestId('contacts-search').fill(person.slice(-8));
  await dialogGates(page, page.getByTestId('contact-row'), 'lines 1280');
  if (SHOTS) {
    await setTheme(page.context(), baseURL!, 'dark');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('contacts-search').fill(person.slice(-8));
    await expect(page.getByTestId('contact-row')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/lines-1280-dark.png`, fullPage: true });
    await page.getByTestId('contact-open').click();
    await page.screenshot({ path: `${SHOTS}/lines-ficha-1280-dark.png` });
    await page.keyboard.press('Escape');
    await setTheme(page.context(), baseURL!, 'light');
  }
  await phonePass(browser, baseURL!, '/en/app/lines/contacts', person.slice(-8), 'lines');
  expect(errors, errors.join('\n')).toEqual([]);
});

// ---------- Inbox ----------

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

async function inboxEvent(request: APIRequestContext, acc: { id: string; secret: string }, ev: Record<string, unknown>) {
  const chatId = String(ev.chatId);
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [{ type: 'message', isGroup: chatId.endsWith('@g.us'), fromMe: false, providerMessageId: `wc-${uid()}`, body: 'hola', timestamp: new Date().toISOString(), ...ev }],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test('Inbox › Contactos: una fila por persona entre grupo y chat, su grupo en la ficha y HubSpot del workspace', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const person = phone();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const groupName = `Club ${tag}`;
  await inboxEvent(request, acc, { type: 'fake_contacts', contacts: [{ phone: person, name: `Tomás ${tag}`, groups: [gid] }] });
  await inboxEvent(request, acc, { chatId: gid, chatName: groupName, senderPhone: person, senderName: `Tomás ${tag}` });
  await inboxEvent(request, acc, { chatId: `${person}@s.whatsapp.net`, senderPhone: person, senderName: `Tomás ${tag}` });
  await connectHubspot(request);

  await page.request.get('/api/inbox/people', { timeout: 120_000 });
  await page.request.get('/api/inbox/people/person?id=0', { timeout: 120_000 });
  await page.goto('/en/app/inbox/contacts', { waitUntil: 'networkidle' });
  await expect(page.locator('a[href$="/app/inbox/contacts"][aria-current="page"]').first()).toBeVisible();
  await page.getByTestId('contacts-search').fill(person.slice(-8));
  const row = page.getByTestId('contact-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`Tomás ${tag}`);
  await noSideScroll(page, 'inbox 1280');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/inbox-1280-light.png`, fullPage: true });
  await menuGates(page, 'inbox 1280');
  await hoverStable(page, row);
  await dialogGates(page, row, 'inbox 1280');

  // La ficha: el grupo (con su link al chat) y HubSpot del workspace.
  const dialog = page.getByRole('dialog');
  await row.getByTestId('contact-open').click();
  // El grupo sale si WhatsApp ya dio sus participantes (fake_contacts lo pone en el grupo).
  await expect(dialog.getByTestId('contact-hs-create')).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/inbox-ficha-1280-light.png` });
  await dialog.getByTestId('contact-hs-create').click();
  await expect(dialog.getByTestId('contact-hs-contact')).toContainText(`Tomás ${tag}`);
  await dialog.getByTestId('contact-hs-unlink').click();
  await expect(dialog.getByTestId('contact-hs-matches')).toContainText(`Tomás ${tag}`, { timeout: 30_000 });
  await expect(dialog.getByTestId('contact-hs-create')).toHaveCount(0);
  await dialog.getByTestId('contact-message').click();
  await expect(page).toHaveURL(/\/app\/inbox\?t=ibt_/);

  if (SHOTS) {
    await setTheme(page.context(), baseURL!, 'dark');
    await page.goto('/en/app/inbox/contacts', { waitUntil: 'networkidle' });
    await page.getByTestId('contacts-search').fill(person.slice(-8));
    await expect(page.getByTestId('contact-row')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/inbox-1280-dark.png`, fullPage: true });
    await setTheme(page.context(), baseURL!, 'light');
  }
  await phonePass(browser, baseURL!, '/en/app/inbox/contacts', person.slice(-8), 'inbox');
  expect(errors, errors.join('\n')).toEqual([]);
});
