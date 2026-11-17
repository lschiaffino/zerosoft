import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * HubSpot en Lines e Inbox, contra el HubSpot falso en memoria
 * (GROUPS_INTEGRATIONS_FAKE): crear el contacto de un chat 1:1 desde el chat,
 * el alta automática (ajuste), elegir qué propiedades de la empresa, del
 * contacto y del negocio ve cada persona, editarlas desde el panel, y el
 * panel de HubSpot fijado al costado del chat, que sigue al chat abierto. El
 * último test recorre los cinco aspectos (Ajustes › Apariencia) en claro y
 * oscuro, a 1280 y a 390. Nada sale a internet ni a WhatsApp.
 *
 * El workspace del e2e es uno solo: cada test conecta HubSpot como lo necesita
 * y el spec lo deja desconectado (y el panel sin fijar) al terminar.
 */

// Con `next dev` (fuera de CI) cada ruta se compila la primera vez que se pide: más margen.
const expect = baseExpect.configure({ timeout: process.env.CI ? 15_000 : 60_000 });
const uid = () => Math.random().toString(36).slice(2, 8);
const randomPhone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const TOKEN = 'pat-na1-e2e-lines-hubspot-contacts';
const DANA_PHONE = '5491155550142';

test.describe.configure({ mode: 'serial' });
test.setTimeout(process.env.CI ? 240_000 : 900_000);

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
  for (const type of ['company', 'contact', 'deal']) {
    await request.post('/api/groups/hubspot/properties', { data: { type, pinned: [] } });
    await request.post('/api/groups/hubspot/properties', { data: { type, mine: null } });
  }
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

/** Fuera de CI deja capturas en la carpeta del test, para la pasada visual. */
async function shot(page: Page, name: string) {
  if (!process.env.CI) await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

const hubspotRegion = (page: Page) => page.getByRole('region', { name: 'HubSpot', exact: true });
const dock = (page: Page) => page.getByTestId('hubspot-dock');

async function openLinesDetails(page: Page) {
  // A 1280 los detalles van detrás del botón (como en lines-hubspot.spec.ts).
  // Hasta que la página hidrata, el botón todavía no abre nada: se reintenta.
  await expect(async () => {
    if (!(await hubspotRegion(page).isVisible())) await page.getByRole('button', { name: 'Details', exact: true }).click();
    await baseExpect(hubspotRegion(page)).toBeVisible({ timeout: 3_000 });
  }).toPass();
}

test.afterAll(async ({ request }) => {
  // El usuario demo es compartido: vuelve al aspecto por defecto.
  await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
  for (const type of ['company', 'contact', 'deal']) await request.post('/api/groups/hubspot/properties', { data: { type, mine: null } }).catch(() => null);
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
  const created = page.waitForResponse((r) => r.url().endsWith('/api/groups/people/person') && r.request().method() === 'POST', { timeout: 90_000 });
  await create.click();
  const createdRes = await created;
  expect(createdRes.status(), await createdRes.text()).toBe(201);
  await expect(hubspotRegion(page).getByTestId('hs-create-contact')).toHaveCount(0);
  const links = (await (await request.get(`/api/groups/hubspot/links?chat=${nora}`)).json()) as { links: Array<{ type: string }> };
  expect(links.links.map((l) => l.type)).toContain('contact');

  // ---------- Elegir propiedades (de esta persona) ----------
  const linked = await request.post('/api/groups/hubspot/links', { data: { chatId: nora, type: 'company', objectId: '9001' } });
  expect(linked.ok(), await linked.text()).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await openLinesDetails(page);
  await expect(hubspotRegion(page).locator('[data-prop="domain"]')).toBeVisible();
  await shot(page, 'lines-details-1280');
  await hubspotRegion(page).getByTestId('hubspot-choose-props').click();
  const picker = page.getByRole('dialog').filter({ has: page.getByTestId('hubspot-my-props') });
  await expect(picker).toBeVisible();
  await picker.getByRole('combobox').selectOption('plan_tier');
  await expect(picker.getByTestId('hubspot-my-props-reset')).toBeVisible();
  expect(((await (await request.get('/api/groups/hubspot/properties')).json()) as { mine: string[] }).mine).toEqual(['domain', 'hubspot_owner_id', 'lifecyclestage', 'plan_tier']);
  await check(page, 'lines hubspot elegir propiedades 1280', { tap: false });
  await shot(page, 'lines-picker-1280');
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
    await expect(dock(page).locator('[data-prop="plan_tier"]').first()).toBeVisible();
    await check(page, `lines hubspot panel fijo 1280 ${theme}`, { tap: false });
    await shot(page, `lines-dock-1280-${theme}`);
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
      await shot(mobile, `lines-chat-390-${theme}`);
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

  await page.goto(`/en/app/inbox?t=${th.id}`, { waitUntil: 'networkidle' });
  const card = page.getByTestId('inbox-chat-hubspot');
  // Abre la info del contacto (reintenta hasta que la página hidrata).
  await expect(async () => {
    if (!(await card.isVisible())) await page.locator('.ib-wa-thread .wa-head-who').click({ timeout: 5_000 });
    await baseExpect(card).toBeVisible({ timeout: 5_000 });
  }).toPass();
  await expect(card).toBeVisible();
  // Su teléfono ya está en HubSpot: se propone vincular (no se crea otro).
  await expect(card.getByTestId('contact-hs-matches')).toBeVisible();
  await card.getByTestId('contact-hs-link').first().click();
  await expect(card.getByTestId('contact-hs-contact')).toBeVisible();
  await expect(card.getByTestId('inbox-hs-company')).toBeVisible();
  await expect(card.locator('[data-prop="domain"]')).toBeVisible();
  await shot(page, 'inbox-card-1280');

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
    await expect(dock(page).locator('[data-prop="plan_tier"]').first()).toBeVisible();
    await check(page, `inbox hubspot panel fijo 1280 ${theme}`, { tap: false });
    await shot(page, `inbox-dock-1280-${theme}`);
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
      await mobile.goto(`/en/app/inbox?t=${th.id}`, { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await mobile.locator('.ib-wa-thread .wa-head-who').click();
      await expect(mobile.getByTestId('inbox-chat-hubspot').getByTestId('contact-hs-contact')).toBeVisible();
      await expect(mobile.getByTestId('inbox-hs-company')).toBeVisible();
      // La cabecera del chat queda debajo de la hoja de info (no es parte de este cambio).
      await check(mobile, `inbox hubspot info 390 ${theme}`, { ignore: /wa-head-who/ });
      await shot(mobile, `inbox-info-390-${theme}`);
    }
  } finally {
    await phone.close();
  }

  // Alta automática de Inbox: el ajuste de cada persona.
  await page.goto('/en/app/inbox/settings', { waitUntil: 'networkidle' });
  const toggle = page.getByTestId('inbox-hs-auto-create');
  await expect(toggle).not.toBeChecked();
  // El interruptor cambia cuando el servidor guardó (no antes): click y esperar el estado.
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(((await (await request.get('/api/inbox/hubspot')).json()) as { autoCreate: boolean }).autoCreate).toBe(true);
  await check(page, 'inbox ajustes hubspot 1280', { tap: false });
  await shot(page, 'inbox-settings-1280');
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(errors, errors.join('\n')).toEqual([]);
});

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
/** El aspecto es de la cuenta (users.ui_look, que manda sobre la cookie); el spec la deja en current al terminar. */
async function setLook(request: APIRequestContext, look: (typeof LOOKS)[number]) {
  const res = await request.put('/api/profile/look', { data: { look } });
  expect(res.ok(), await res.text()).toBe(true);
}

test('Lines e Inbox: propiedades del contacto y del negocio, elegirlas, editarlas y verlas en los cinco aspectos', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 860 });
  await connect(request);
  const tag = uid();
  const n = await fakeNumber(request, `HubSpot objetos ${tag}`);
  const chat = await linesDm(request, n, randomPhone(), `Rita ${tag}`);
  for (const [type, objectId] of [['company', '9001'], ['contact', '7001'], ['deal', '8001']]) {
    const res = await request.post('/api/groups/hubspot/links', { data: { chatId: chat, type, objectId } });
    expect(res.ok(), await res.text()).toBe(true);
  }
  // Valores de partida (otro test pudo haberlos cambiado en el HubSpot falso compartido).
  await request.patch('/api/groups/hubspot/company', { data: { chatId: chat, type: 'contact', property: 'jobtitle', value: 'Operations lead' } });

  // ---------- Los detalles del chat: las de siempre del contacto y del negocio ----------
  await page.goto(`/en/app/lines/inbox/${chat}`, { waitUntil: 'networkidle' });
  await openLinesDetails(page);
  const contactProps = hubspotRegion(page).getByTestId('hubspot-props-contact');
  const dealProps = hubspotRegion(page).getByTestId('hubspot-props-deal');
  await expect(contactProps.locator('[data-prop="jobtitle"]')).toBeVisible();
  await expect(dealProps.locator('[data-prop="dealstage"]')).toBeVisible();

  // ---------- Elegir propiedades: una pestaña por objeto, con el teclado ----------
  await hubspotRegion(page).getByTestId('hubspot-choose-props').click();
  const picker = page.getByRole('dialog').filter({ has: page.getByRole('tablist') });
  await expect(picker.getByTestId('hubspot-kind-company')).toHaveAttribute('aria-selected', 'true');
  await picker.getByTestId('hubspot-kind-company').focus();
  await page.keyboard.press('ArrowRight');
  await expect(picker.getByTestId('hubspot-kind-contact')).toHaveAttribute('aria-selected', 'true');
  await expect(picker.getByTestId('hubspot-kind-contact')).toBeFocused();
  await expect(picker.getByTestId('hubspot-my-props')).toHaveAttribute('data-kind', 'contact');
  await picker.getByTestId('hubspot-my-props-add').selectOption('hs_lead_status');
  await expect(picker.getByTestId('hubspot-my-props-reset')).toBeVisible();
  await expect(picker.locator('[data-prop="hs_lead_status"]')).toBeVisible();
  await check(page, 'lines hubspot elegir propiedades contacto 1280', { tap: false });
  await shot(page, 'objects-picker-contact-1280');
  await picker.getByTestId('hubspot-kind-deal').click();
  await expect(picker.getByTestId('hubspot-my-props')).toHaveAttribute('data-kind', 'deal');
  await picker.getByTestId('hubspot-my-props-add').selectOption('dealtype');
  await expect(picker.locator('[data-prop="dealtype"]')).toBeVisible();
  const mine = async (type: string) => ((await (await request.get(`/api/groups/hubspot/properties?type=${type}`)).json()) as { mine: string[] | null }).mine;
  expect(await mine('contact')).toEqual(['email', 'jobtitle', 'lifecyclestage', 'hubspot_owner_id', 'hs_lead_status']);
  expect(await mine('deal')).toEqual(['dealstage', 'amount', 'closedate', 'hubspot_owner_id', 'dealtype']);
  expect(await mine('company')).toBeNull();
  // Esc cierra el selector y los detalles muestran lo elegido.
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(contactProps.locator('[data-prop="hs_lead_status"]')).toBeVisible();
  await expect(dealProps.locator('[data-prop="dealtype"]')).toBeVisible();

  // ---------- El panel: pestaña por registro, editar el contacto ----------
  await hubspotRegion(page).getByTestId('hubspot-open-screen').click();
  const screen = page.getByRole('dialog', { name: 'HubSpot', exact: true });
  await expect(screen).toBeVisible();
  await expect(screen.getByTestId('hubspot-kind-company')).toHaveAttribute('aria-selected', 'true');
  await screen.getByTestId('hubspot-kind-contact').click();
  await expect(screen.getByTestId('hubspot-record-name')).not.toBeEmpty();
  const row = screen.locator('.gr-hsx-body[data-kind="contact"] [data-prop="jobtitle"]').first();
  await expect(row).toBeVisible();
  await row.getByRole('button').first().click();
  const field = row.getByRole('textbox');
  await expect(field).toBeFocused();
  // Esc cierra el editor, no el panel.
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(screen).toBeVisible();
  await row.getByRole('button').first().click();
  await row.getByRole('textbox').fill(`Head of ops ${tag}`);
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/groups/hubspot/company') && r.request().method() === 'PATCH');
  await page.keyboard.press('Enter');
  expect((await saved).status()).toBe(200);
  const contact = (await (await request.get(`/api/groups/hubspot/company?chat=${chat}&type=contact`)).json()) as { values: Record<string, string> };
  expect(contact.values.jobtitle).toBe(`Head of ops ${tag}`);
  // Un valor que HubSpot no acepta: no se guarda y el panel dice por qué.
  const amount = screen.getByTestId('hubspot-kind-deal');
  await amount.click();
  const amountRow = screen.locator('.gr-hsx-body[data-kind="deal"] [data-prop="amount"]').first();
  await amountRow.getByRole('button').first().click();
  await amountRow.getByRole('textbox').fill('mucho');
  await page.keyboard.press('Enter');
  await expect(amountRow.getByRole('alert')).toBeVisible();
  await check(page, 'lines hubspot panel negocio 1280', { tap: false });
  await shot(page, 'objects-panel-deal-1280');
  await page.keyboard.press('Escape');
  await expect(screen).toBeHidden();

  // ---------- Inbox: el contacto, su empresa y su negocio ----------
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: process.env.CI ? 10_000 : 60_000 }).toBe('connected');
  const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
    data: { events: [{ type: 'message', chatId: `${DANA_PHONE}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: DANA_PHONE, senderName: `Dana ${tag}`, providerMessageId: `obj-${tag}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok()).toBe(true);
  const [th] = await sql("SELECT id FROM inbox_threads WHERE account_id = ? AND handle = ? AND kind = 'dm'", [String(acc.id), DANA_PHONE]);
  const who = (await (await request.get(`/api/inbox/people/person?thread=${th.id}`)).json()) as { row: { id: string; hubspot: { contact: { id: string } | null } | null } };
  if (who.row.hubspot?.contact?.id !== '7001') {
    const linked = await request.post('/api/inbox/people/person', { data: { id: who.row.id, action: 'link', contactId: '7001' } });
    expect(linked.ok(), await linked.text()).toBe(true);
  }
  const card = page.getByTestId('inbox-chat-hubspot');
  const openInbox = async (p: Page) => {
    await p.goto(`/en/app/inbox?t=${th.id}`, { waitUntil: 'networkidle' });
    await expect(async () => {
      if (!(await p.getByTestId('inbox-chat-hubspot').isVisible())) await p.locator('.ib-wa-thread .wa-head-who').click({ timeout: 5_000 });
      await baseExpect(p.getByTestId('inbox-chat-hubspot')).toBeVisible({ timeout: 5_000 });
    }).toPass();
  };
  await openInbox(page);
  await expect(card.getByTestId('inbox-hs-props-contact').locator('[data-prop="hs_lead_status"]')).toBeVisible();
  await expect(card.getByTestId('inbox-hs-deal').locator('[data-prop="dealtype"]')).toBeVisible();
  await card.getByTestId('inbox-hs-open').click();
  await expect(screen).toBeVisible();
  await screen.getByTestId('hubspot-kind-deal').click();
  await expect(screen.locator('.gr-hsx-body[data-kind="deal"] [data-prop="dealstage"]').first()).toBeVisible();
  // En Inbox es solo lectura, como la empresa.
  await expect(screen.locator('.gr-hsx-edit')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(screen).toBeHidden();

  // ---------- Los cinco aspectos, claro y oscuro, a 1280 (panel fijo) y a 390 ----------
  await page.goto(`/en/app/lines/inbox/${chat}`, { waitUntil: 'networkidle' });
  await openLinesDetails(page);
  await hubspotRegion(page).getByTestId('hubspot-open-screen').click();
  await screen.getByTestId('hubspot-pin-panel').click();
  await expect(dock(page)).toBeVisible();
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await phone.newPage();
    for (const look of LOOKS) {
      for (const theme of ['light', 'dark'] as const) {
        await setLook(request, look);
        await setTheme(page.context(), baseURL!, theme);
        await page.goto(`/en/app/lines/inbox/${chat}`, { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await dock(page).getByTestId('hubspot-kind-contact').click();
        await expect(dock(page).locator('[data-kind="contact"] [data-prop="hs_lead_status"]').first()).toBeVisible();
        await check(page, `lines hubspot contacto fijo 1280 ${look} ${theme}`, { tap: false });
        await shot(page, `objects-dock-1280-${look}-${theme}`);
        await openInbox(page);
        await expect(card.getByTestId('inbox-hs-deal')).toBeVisible();
        await check(page, `inbox hubspot negocio 1280 ${look} ${theme}`, { tap: false });
        await shot(page, `objects-inbox-1280-${look}-${theme}`);

        await setTheme(phone, baseURL!, theme);
        await mobile.goto(`/en/app/lines/inbox/${chat}`, { waitUntil: 'domcontentloaded' });
        await settle(mobile);
        await expect(async () => {
          if (!(await hubspotRegion(mobile).isVisible())) await mobile.locator('.gr-thread-head .wa-head-avatar').click();
          await baseExpect(hubspotRegion(mobile)).toBeVisible({ timeout: 3_000 });
        }).toPass();
        await hubspotRegion(mobile).getByTestId('hubspot-props-deal').scrollIntoViewIfNeeded();
        // La cabecera del chat queda debajo de la hoja de detalles (no es parte de este cambio, como en Inbox).
        await check(mobile, `lines hubspot detalles 390 ${look} ${theme}`, { ignore: /wa-head/ });
        await shot(mobile, `objects-details-390-${look}-${theme}`);
        await hubspotRegion(mobile).getByTestId('hubspot-open-screen').click();
        const sheet = mobile.getByRole('dialog', { name: 'HubSpot', exact: true });
        await expect(sheet).toBeVisible();
        await sheet.getByTestId('hubspot-kind-deal').click();
        await expect(sheet.locator('[data-kind="deal"] [data-prop="dealtype"]').first()).toBeVisible();
        await check(mobile, `lines hubspot panel 390 ${look} ${theme}`);
        await shot(mobile, `objects-sheet-390-${look}-${theme}`);
        await mobile.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
      }
    }
  } finally {
    await phone.close();
    await setLook(request, 'current');
    await setTheme(page.context(), baseURL!, 'light');
  }
  await page.goto(`/en/app/lines/inbox/${chat}`, { waitUntil: 'networkidle' });
  await dock(page).getByTestId('hubspot-pin-panel').click();
  await expect(dock(page)).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
