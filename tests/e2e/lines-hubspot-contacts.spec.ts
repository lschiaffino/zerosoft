import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * HubSpot en Lines e Inbox, contra el HubSpot falso en memoria
 * (GROUPS_INTEGRATIONS_FAKE): crear el contacto de un chat 1:1 desde el chat,
 * el alta automática (ajuste), elegir qué propiedades de la empresa ve cada
 * persona y el panel de HubSpot fijado al costado del chat, que sigue al chat
 * abierto. Nada sale a internet ni a WhatsApp.
 *
 * El workspace del e2e es uno solo: cada test conecta HubSpot como lo necesita
 * y el spec lo deja desconectado (y el panel sin fijar) al terminar.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const randomPhone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const TOKEN = 'pat-na1-e2e-lines-hubspot-contacts';
const DANA_PHONE = '5491155550142';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function connect(request: APIRequestContext) {
  await request.delete('/api/groups/hubspot');
  await request.post('/api/groups/hubspot/fake', { data: { rateLimit: 0 } });
  const res = await request.post('/api/groups/hubspot', { data: { token: TOKEN } });
  expect(res.ok(), await res.text()).toBe(true);
  await request.post('/api/groups/hubspot/properties', { data: { pinned: [] } });
  await request.post('/api/groups/hubspot/properties', { data: { mine: null } });
}

async function fakeNumber(request: APIRequestContext, name: string): Promise<{ id: string; webhookUrl: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

/** Un chat 1:1 nuevo de Lines con un mensaje entrante; devuelve su id. */
async function linesDm(request: APIRequestContext, n: { webhookUrl: string }, phone: string, name: string): Promise<string> {
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId: `${phone}@c.us`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `hsc-${uid()}`, body: 'Hola' }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const found = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string }> };
  expect(found.rows.length, `chat ${name}`).toBeGreaterThan(0);
  return found.rows[0].id;
}

const hubspotRegion = (page: Page) => page.getByRole('region', { name: 'HubSpot', exact: true });
const dock = (page: Page) => page.getByTestId('hubspot-dock');

async function openLinesDetails(page: Page) {
  // A 1280 los detalles van detrás del botón; a 1440 o más están siempre a la vista.
  const toggle = page.getByRole('button', { name: 'Details', exact: true });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(hubspotRegion(page)).toBeVisible();
}

test.afterAll(async ({ request }) => {
  await request.post('/api/groups/hubspot/properties', { data: { mine: null } }).catch(() => null);
  await request.post('/api/inbox/hubspot', { data: { autoCreate: false } }).catch(() => null);
  await request.delete('/api/groups/hubspot').catch(() => null);
});

test('Lines: crear el contacto desde el chat, elegir propiedades y fijar el panel de HubSpot', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  await connect(request);
  const tag = uid();
  const n = await fakeNumber(request, `HubSpot contactos ${tag}`);
  const nora = await linesDm(request, n, randomPhone(), `Nora ${tag}`);
  const otro = await linesDm(request, n, randomPhone(), `Omar ${tag}`);

  // ---------- Crear el contacto desde los detalles del chat ----------
  await page.goto(`/en/app/lines/inbox/${nora}`, { waitUntil: 'networkidle' });
  await openLinesDetails(page);
  const create = hubspotRegion(page).getByTestId('hs-create-contact');
  await expect(create).toBeVisible();
  await create.click();
  await expect(hubspotRegion(page).getByTestId('hs-create-contact')).toHaveCount(0);
  const links = (await (await request.get(`/api/groups/hubspot/links?chat=${nora}`)).json()) as { links: Array<{ type: string }> };
  expect(links.links.map((l) => l.type)).toContain('contact');

  // ---------- Elegir propiedades (de esta persona) ----------
  const linked = await request.post('/api/groups/hubspot/links', { data: { chatId: nora, type: 'company', objectId: '9001' } });
  expect(linked.ok(), await linked.text()).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await openLinesDetails(page);
  await expect(hubspotRegion(page).locator('[data-prop="domain"]')).toBeVisible();
  await hubspotRegion(page).getByTestId('hubspot-choose-props').click();
  const picker = page.getByRole('dialog').filter({ has: page.getByTestId('hubspot-my-props') });
  await expect(picker).toBeVisible();
  await picker.getByRole('combobox').selectOption('plan_tier');
  await expect(picker.getByTestId('hubspot-my-props-reset')).toBeVisible();
  expect(((await (await request.get('/api/groups/hubspot/properties')).json()) as { mine: string[] }).mine).toEqual(['domain', 'hubspot_owner_id', 'lifecyclestage', 'plan_tier']);
  await check(page, 'lines hubspot elegir propiedades 1280');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(hubspotRegion(page).locator('[data-prop="plan_tier"]')).toBeVisible();
  // Las del workspace no cambiaron.
  expect(((await (await request.get('/api/groups/hubspot/properties')).json()) as { pinned: string[] }).pinned).toEqual(['domain', 'hubspot_owner_id', 'lifecyclestage']);

  // ---------- Fijar el panel al costado ----------
  await hubspotRegion(page).getByTestId('hubspot-open-screen').click();
  const screen = page.getByRole('dialog', { name: 'HubSpot', exact: true });
  await expect(screen).toBeVisible();
  await screen.getByTestId('hubspot-pin-panel').click();
  await expect(screen).toBeHidden();
  await expect(dock(page)).toBeVisible();
  await expect(dock(page).getByTestId('hubspot-pin-panel')).toHaveAttribute('aria-pressed', 'true');
  await expect(dock(page).locator('[data-prop="plan_tier"]').first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-hubspot-pinned', '');
  // El panel no tapa la conversación: el composer queda a la izquierda del panel.
  const dockBox = (await dock(page).boundingBox())!;
  const composer = (await page.locator('.gr-composer').first().boundingBox())!;
  expect(composer.x + composer.width).toBeLessThanOrEqual(dockBox.x + 1);
  // Con el panel a la vista, "Todas las propiedades" no hace falta en los detalles.
  await expect(hubspotRegion(page).getByTestId('hubspot-open-screen')).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page.context(), baseURL!, theme);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(dock(page)).toBeVisible();
    await check(page, `lines hubspot panel fijo 1280 ${theme}`);
  }
  await setTheme(page.context(), baseURL!, 'light');

  // Sigue al chat que se abre (otro chat, sin empresa).
  await page.goto(`/en/app/lines/inbox/${otro}`, { waitUntil: 'networkidle' });
  await expect(dock(page)).toBeVisible();
  await expect(dock(page).locator('[data-prop="plan_tier"]')).toHaveCount(0);
  // En el teléfono no se fija: el panel es una hoja.
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    await phone.addInitScript(() => window.localStorage.setItem('zs.hubspot.panel', 'pinned'));
    const mobile = await phone.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(phone, baseURL!, theme);
      await mobile.goto(`/en/app/lines/inbox/${nora}`, { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await expect(mobile.getByTestId('hubspot-dock')).toHaveCount(0);
      await check(mobile, `lines hubspot chat 390 ${theme}`);
    }
  } finally {
    await phone.close();
  }

  // Desfijar lo saca y la app recupera el ancho.
  await dock(page).getByTestId('hubspot-pin-panel').click();
  await expect(dock(page)).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-hubspot-pinned', '');

  // ---------- Alta automática (ajuste del workspace) ----------
  await page.goto('/en/app/lines/settings?tab=integrations', { waitUntil: 'networkidle' });
  const on = await request.post('/api/groups/hubspot', { data: { autoCreate: true } });
  expect(on.ok(), await on.text()).toBe(true);
  expect(((await on.json()) as { autoCreate: boolean }).autoCreate).toBe(true);
  const off = await request.post('/api/groups/hubspot', { data: { autoCreate: false } });
  expect(((await off.json()) as { autoCreate: boolean }).autoCreate).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: el contacto y la empresa en la info del chat, propiedades elegidas, panel fijo y alta automática', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  await connect(request);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const tag = uid();
  const name = `Dana ${tag}`;
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
    data: { events: [{ type: 'message', chatId: `${DANA_PHONE}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: DANA_PHONE, senderName: name, providerMessageId: `in-${tag}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok()).toBe(true);
  const [th] = await sql("SELECT id FROM inbox_threads WHERE account_id = ? AND handle = ? AND kind = 'dm'", [String(acc.id), DANA_PHONE]);
  // Dana arranca sin vincular (otro test pudo haberla vinculado en el workspace compartido).
  const who = (await (await request.get(`/api/inbox/people/person?thread=${th.id}`)).json()) as { row: { id: string; hubspot: { contact: unknown } | null } };
  if (who.row.hubspot?.contact) await request.post('/api/inbox/people/person', { data: { id: who.row.id, action: 'unlink' } });

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  await page.locator('.ib-wa-thread .wa-head-who').click();
  const card = page.getByTestId('inbox-chat-hubspot');
  await expect(card).toBeVisible();
  // Su teléfono ya está en HubSpot: se propone vincular (no se crea otro).
  await expect(card.getByTestId('contact-hs-matches')).toBeVisible();
  await card.getByTestId('contact-hs-link').first().click();
  await expect(card.getByTestId('contact-hs-contact')).toBeVisible();
  await expect(card.getByTestId('inbox-hs-company')).toBeVisible();
  await expect(card.locator('[data-prop="domain"]')).toBeVisible();

  // Elegir propiedades: la misma elección que en Lines.
  await card.getByTestId('hubspot-choose-props').click();
  const picker = page.getByRole('dialog').filter({ has: page.getByTestId('hubspot-my-props') });
  await picker.getByRole('combobox').selectOption('plan_tier');
  await expect(picker.getByTestId('hubspot-my-props-reset')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card.locator('[data-prop="plan_tier"]')).toBeVisible();

  // El panel con todas las propiedades (solo lectura) y fijarlo.
  await card.getByTestId('inbox-hs-open').click();
  const screen = page.getByRole('dialog', { name: 'HubSpot', exact: true });
  await expect(screen).toBeVisible();
  await expect(screen.locator('[data-prop="plan_tier"]').first()).toBeVisible();
  await expect(screen.locator('.gr-hsx-edit')).toHaveCount(0);
  await screen.getByTestId('hubspot-pin-panel').click();
  await expect(dock(page)).toBeVisible();
  await expect(card.getByTestId('inbox-hs-open')).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page.context(), baseURL!, theme);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(dock(page)).toBeVisible();
    await check(page, `inbox hubspot panel fijo 1280 ${theme}`);
  }
  await setTheme(page.context(), baseURL!, 'light');
  await dock(page).getByTestId('hubspot-pin-panel').click();
  await expect(dock(page)).toHaveCount(0);

  // En el teléfono: la info del chat con la tarjeta de HubSpot, sin scroll lateral.
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await phone.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(phone, baseURL!, theme);
      await mobile.goto('/en/app/inbox', { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await mobile.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
      await mobile.locator('.ib-wa-thread .wa-head-who').click();
      await expect(mobile.getByTestId('inbox-chat-hubspot')).toBeVisible();
      await check(mobile, `inbox hubspot info 390 ${theme}`);
    }
  } finally {
    await phone.close();
  }

  // Alta automática de Inbox: el ajuste de cada persona.
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  const toggle = page.getByTestId('inbox-hs-auto-create');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  expect(((await (await request.get('/api/inbox/hubspot')).json()) as { autoCreate: boolean }).autoCreate).toBe(true);
  await check(page, 'inbox ajustes hubspot 1280');
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  expect(errors, errors.join('\n')).toEqual([]);
});
