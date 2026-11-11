import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Lines + HubSpot, propiedades de la empresa, contra el HubSpot falso en
 * memoria (GROUPS_INTEGRATIONS_FAKE): la pantalla de HubSpot de un grupo
 * (editar una propiedad y que llegue a HubSpot, un cambio de HubSpot que
 * aparece con "Sync now", fijar, buscar, registro), el filtro de la bandeja
 * por propiedad (también guardado en una lista) y la vista para vincular
 * grupos de a muchos. Nada sale a internet ni a WhatsApp.
 *
 * El workspace del e2e es uno solo y el HubSpot falso vive en la memoria del
 * servidor: cada test arranca dejando las empresas como las necesita y el spec
 * deja HubSpot desconectado al terminar, pase o falle.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const TOKEN = 'pat-na1-e2e-lines-hubspot-sync';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext, name: string): Promise<NumberInfo> {
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

let groupSeq = 0;
/** Un grupo nuevo con un mensaje entrante; devuelve su chat. */
async function newGroup(request: APIRequestContext, n: NumberInfo, name: string): Promise<{ id: string; name: string }> {
  groupSeq += 1;
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: {
      events: [
        {
          type: 'message',
          chatId: `1203638${String(Date.now()).slice(-7)}${groupSeq}@g.us`,
          isGroup: true,
          chatName: name,
          fromMe: false,
          senderPhone: '5491100000078',
          senderName: 'Cliente',
          providerMessageId: `hss-${uid()}`,
          body: 'Hola',
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const found = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string; name: string }> };
  expect(found.rows.length, `chat ${name}`).toBeGreaterThan(0);
  return found.rows[0];
}

/** "Alguien editó en HubSpot": cambia el HubSpot falso del servidor. */
async function fake(request: APIRequestContext, body: Record<string, unknown>) {
  const res = await request.post('/api/groups/hubspot/fake', { data: body });
  expect(res.ok(), await res.text()).toBe(true);
}

async function fakeCompany(request: APIRequestContext, id: string): Promise<Record<string, string>> {
  return ((await (await request.get(`/api/groups/hubspot/fake?company=${id}`)).json()) as { properties: Record<string, string> }).properties;
}

async function link(request: APIRequestContext, chatId: string, companyId: string) {
  const res = await request.post('/api/groups/hubspot/links', { data: { chatId, type: 'company', objectId: companyId } });
  expect(res.ok(), await res.text()).toBe(true);
}

/** HubSpot conectado, con las empresas del falso como al principio y las propiedades fijadas de siempre. */
async function connect(request: APIRequestContext) {
  await request.delete('/api/groups/hubspot');
  await fake(request, { rateLimit: 0 });
  await fake(request, {
    company: '9001',
    properties: {
      name: 'Acme Logistics',
      city: 'Rosario',
      plan_tier: 'growth',
      numberofemployees: '250',
      health_score: '82',
      renewal_date: '2027-03-01',
      is_strategic: 'true',
      products_used: 'inbox;broadcasts',
      hubspot_owner_id: '71',
      csm_notes: '',
    },
  });
  await fake(request, { company: '9002', properties: { name: 'Globex Retail', plan_tier: 'starter', numberofemployees: '40' } });
  await fake(request, { company: '9003', properties: { name: 'Initech Foods', plan_tier: '', numberofemployees: '900' } });
  const res = await request.post('/api/groups/hubspot', { data: { token: TOKEN } });
  expect(res.ok(), await res.text()).toBe(true);
  const pins = await request.post('/api/groups/hubspot/properties', { data: { pinned: [] } });
  expect(pins.ok(), await pins.text()).toBe(true);
  await request.put('/api/groups/prefs', { data: { line: 'all' } });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

const hubspotRegion = (page: Page) => page.getByRole('region', { name: 'HubSpot', exact: true });
const hubspotScreen = (page: Page) => page.getByRole('dialog', { name: 'HubSpot', exact: true });

test.afterAll(async ({ request }) => {
  // Pase lo que pase, el workspace compartido queda sin HubSpot y el falso sin límite.
  await request.post('/api/groups/hubspot/fake', { data: { rateLimit: 0 } }).catch(() => null);
  await request.delete('/api/groups/hubspot').catch(() => null);
});

test('pantalla de HubSpot: todas las propiedades, editar, sincronizar, fijar, buscar y registro', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  const tag = uid();
  await connect(request);
  const n = await fakeNumber(request, `HubSpot sync ${tag}`);
  const group = await newGroup(request, n, `Acme pantalla ${tag}`);
  await link(request, group.id, '9001');

  // ---------- Se llega en un clic desde la página del grupo ----------
  await page.goto(`/en/app/lines/list/${group.id}`, { waitUntil: 'networkidle' });
  // La sección compacta muestra las propiedades fijadas (las de siempre).
  await expect(hubspotRegion(page)).toContainText('acme-logistics.example');
  await expect(hubspotRegion(page)).toContainText('Paula Ortiz');
  await hubspotRegion(page).getByRole('button', { name: 'All properties' }).click();
  const screen = hubspotScreen(page);
  await expect(screen).toBeVisible();
  await expect(screen.locator('.gr-hsx-company')).toHaveText('Acme Logistics');
  await expect(screen.getByText(/^Last synced:/)).toBeVisible();
  await expect(screen.getByRole('link', { name: 'Open in HubSpot' })).toHaveAttribute('href', 'https://app.hubspot.com/contacts/424242/record/0-2/9001');
  await expect(screen.getByRole('link', { name: 'Open in HubSpot' })).toHaveAttribute('target', '_blank');
  const prop = (name: string) => screen.locator(`[data-prop="${name}"]`);

  // Agrupadas como en HubSpot, con las fijadas arriba.
  const pinned = screen.getByRole('region', { name: 'Pinned' });
  await expect(pinned.locator('[data-prop="domain"]')).toContainText('acme-logistics.example');
  await expect(pinned.locator('[data-prop="hubspot_owner_id"]')).toContainText('Paula Ortiz');
  await expect(pinned.locator('[data-prop="lifecyclestage"]')).toContainText('Customer');
  await expect(screen.getByRole('region', { name: 'Company information' }).locator('[data-prop="industry"]')).toContainText('Transportation');
  const health = screen.getByRole('region', { name: 'Account health' });
  await expect(health.locator('[data-prop="plan_tier"]')).toContainText('Growth');
  await expect(health.locator('[data-prop="renewal_date"]')).toContainText('Mar 1, 2027');
  await expect(health.locator('[data-prop="is_strategic"]')).toContainText('Yes');
  await expect(health.locator('[data-prop="products_used"]')).toContainText('Inbox, Broadcasts');
  // Solo lectura y calculadas: se ven y no se editan.
  await expect(prop('createdate')).toContainText('Read only');
  await expect(screen.getByRole('button', { name: 'Edit Create date', exact: true })).toHaveCount(0);
  await expect(prop('seats_per_employee')).toContainText('Calculated');
  await expect(screen.getByRole('button', { name: 'Edit Seats per employee', exact: true })).toHaveCount(0);
  // Las ocultas en HubSpot no se muestran.
  await expect(prop('internal_sync_key')).toHaveCount(0);

  // ---------- Las vacías quedan detrás de "Show empty" ----------
  await expect(prop('csm_notes')).toHaveCount(0);
  await expect(prop('description')).toHaveCount(0);
  await screen.getByRole('checkbox', { name: /^Show empty/ }).check();
  await expect(prop('csm_notes')).toContainText('Empty');
  await expect(prop('description')).toBeVisible();
  await screen.getByRole('checkbox', { name: /^Show empty/ }).uncheck();
  await expect(prop('csm_notes')).toHaveCount(0);

  // ---------- Búsqueda mientras se escribe ----------
  const search = screen.getByRole('searchbox', { name: 'Search properties' });
  await search.fill('plan');
  await expect(prop('plan_tier')).toBeVisible();
  await expect(prop('numberofemployees')).toHaveCount(0);
  await search.fill('zzz-nothing');
  await expect(screen.getByText('No property matches that search.')).toBeVisible();
  // Buscar encuentra también una vacía, para completarla.
  await search.fill('success');
  await expect(prop('csm_notes')).toBeVisible();
  await screen.getByRole('button', { name: 'Edit Success notes', exact: true }).click();
  await screen.getByRole('textbox', { name: 'Value of Success notes' }).fill('Renews in March');
  await prop('csm_notes').getByRole('button', { name: 'Save' }).click();
  await expect(prop('csm_notes')).toContainText('Renews in March');
  await expect.poll(async () => (await fakeCompany(request, '9001')).csm_notes).toBe('Renews in March');
  await search.fill('');

  // ---------- Editar: cada tipo con su editor, y llega a HubSpot ----------
  // Selección.
  await screen.getByRole('button', { name: 'Edit Plan', exact: true }).click();
  await screen.getByRole('combobox', { name: 'Value of Plan' }).selectOption('scale');
  await prop('plan_tier').getByRole('button', { name: 'Save' }).click();
  await expect(prop('plan_tier')).toContainText('Scale');
  await expect(screen.getByText('Plan saved in HubSpot')).toBeVisible();
  await expect.poll(async () => (await fakeCompany(request, '9001')).plan_tier).toBe('scale');
  // Selección múltiple.
  await screen.getByRole('button', { name: 'Edit Products in use', exact: true }).click();
  await prop('products_used').getByRole('checkbox', { name: 'Analytics' }).check();
  await prop('products_used').getByRole('button', { name: 'Save' }).click();
  await expect(prop('products_used')).toContainText('Inbox, Broadcasts, Analytics');
  await expect.poll(async () => (await fakeCompany(request, '9001')).products_used).toBe('inbox;broadcasts;analytics');
  // Fecha.
  await screen.getByRole('button', { name: 'Edit Renewal date', exact: true }).click();
  await screen.getByLabel('Value of Renewal date').fill('2027-06-30');
  await prop('renewal_date').getByRole('button', { name: 'Save' }).click();
  await expect(prop('renewal_date')).toContainText('Jun 30, 2027');
  await expect.poll(async () => (await fakeCompany(request, '9001')).renewal_date).toBe('2027-06-30');
  // Casilla.
  await screen.getByRole('button', { name: 'Edit Strategic account', exact: true }).click();
  await prop('is_strategic').getByRole('checkbox', { name: 'Strategic account' }).uncheck();
  await prop('is_strategic').getByRole('button', { name: 'Save' }).click();
  await expect(prop('is_strategic')).toContainText('No');
  await expect.poll(async () => (await fakeCompany(request, '9001')).is_strategic).toBe('false');
  // Dueño (está fijada: se edita arriba).
  await screen.getByRole('button', { name: 'Edit Company owner', exact: true }).click();
  await screen.getByRole('combobox', { name: 'Value of Company owner' }).selectOption({ label: 'Bruno Lima' });
  await prop('hubspot_owner_id').getByRole('button', { name: 'Save' }).click();
  await expect(prop('hubspot_owner_id')).toContainText('Bruno Lima');
  await expect.poll(async () => (await fakeCompany(request, '9001')).hubspot_owner_id).toBe('72');
  // Texto: Enter guarda.
  await screen.getByRole('button', { name: 'Edit City', exact: true }).click();
  await screen.getByRole('textbox', { name: 'Value of City' }).fill('Salta');
  await screen.getByRole('textbox', { name: 'Value of City' }).press('Enter');
  await expect(prop('city')).toContainText('Salta');
  await expect.poll(async () => (await fakeCompany(request, '9001')).city).toBe('Salta');

  // ---------- Un valor que no va: vuelve el anterior, con el motivo ----------
  await screen.getByRole('button', { name: 'Edit Number of employees', exact: true }).click();
  await screen.getByRole('textbox', { name: 'Value of Number of employees' }).fill('many');
  await prop('numberofemployees').getByRole('button', { name: 'Save' }).click();
  await expect(prop('numberofemployees').getByRole('alert')).toContainText('Number of employees was not saved');
  await expect(screen.getByRole('button', { name: 'Edit Number of employees', exact: true })).toContainText('250');
  expect((await fakeCompany(request, '9001')).numberofemployees).toBe('250');
  // HubSpot no responde (límite de llamadas): tampoco se guarda y lo dice.
  await fake(request, { rateLimit: 6 });
  await screen.getByRole('button', { name: 'Edit City', exact: true }).click();
  await screen.getByRole('textbox', { name: 'Value of City' }).fill('Jujuy');
  await prop('city').getByRole('button', { name: 'Save' }).click();
  await expect(prop('city').getByRole('alert')).toContainText('City was not saved. HubSpot is limiting requests');
  await expect(screen.getByRole('button', { name: 'Edit City', exact: true })).toContainText('Salta');
  await fake(request, { rateLimit: 0 });
  expect((await fakeCompany(request, '9001')).city).toBe('Salta');

  // Esc cierra el editor, no la pantalla.
  await screen.getByRole('button', { name: 'Edit City', exact: true }).click();
  await screen.getByRole('textbox', { name: 'Value of City' }).press('Escape');
  await expect(screen.getByRole('textbox', { name: 'Value of City' })).toHaveCount(0);
  await expect(screen).toBeVisible();

  // ---------- Un cambio hecho en HubSpot aparece con "Sync now" ----------
  await fake(request, { company: '9001', properties: { health_score: '91' } });
  await expect(prop('health_score')).toContainText('82');
  await screen.getByRole('button', { name: 'Sync now' }).click();
  await expect(prop('health_score')).toContainText('91');
  await expect(screen.getByText('Synced with HubSpot')).toBeVisible();

  // ---------- Registro del sync: dirección, de qué a qué ----------
  await screen.getByRole('tab', { name: 'Sync log' }).click();
  const log = screen.getByRole('list', { name: 'Sync log' });
  // El registro va del más nuevo al más viejo (y el workspace del e2e guarda el de corridas anteriores): se mira el primero de cada propiedad.
  await expect(log.locator('li', { hasText: 'Health score' }).first()).toContainText('82 → 91');
  await expect(log.locator('li', { hasText: 'Health score' }).first()).toContainText('From HubSpot');
  // Lo que escribimos no volvió como cambio de HubSpot: lo último de Plan sigue siendo nuestra escritura.
  await expect(log.locator('li', { hasText: 'Plan' }).first()).toContainText('Growth → Scale');
  await expect(log.locator('li', { hasText: 'Plan' }).first()).toContainText('To HubSpot');
  await expect(log.locator('li', { hasText: 'Strategic account' }).first()).toContainText('Yes → No');
  await screen.getByRole('tab', { name: 'Properties' }).click();

  // ---------- Fijar: sube arriba y aparece en los detalles del chat ----------
  await screen.getByRole('button', { name: 'Pin Plan', exact: true }).click();
  await expect(pinned.locator('[data-prop="plan_tier"]')).toContainText('Scale');
  await expect(health.locator('[data-prop="plan_tier"]')).toHaveCount(0);
  await expect(screen.getByRole('button', { name: 'Unpin Plan', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(((await (await request.get('/api/groups/hubspot/properties')).json()) as { pinned: string[] }).pinned).toEqual(['domain', 'hubspot_owner_id', 'lifecyclestage', 'plan_tier']);
  await screen.getByRole('button', { name: 'Close' }).click();
  await expect(screen).toBeHidden();
  await expect(hubspotRegion(page).locator('.gr-hs-props')).toContainText('Plan');
  await expect(hubspotRegion(page).locator('.gr-hs-props')).toContainText('Scale');
  await expect(hubspotRegion(page).locator('.gr-hs-props')).toContainText('Bruno Lima');

  // ---------- También desde los detalles del chat en la bandeja ----------
  await page.goto(`/en/app/lines/inbox/${group.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await hubspotRegion(page).getByRole('button', { name: 'All properties' }).click();
  await expect(hubspotScreen(page).locator('[data-prop="plan_tier"]')).toContainText('Scale');
  await page.keyboard.press('Escape');
  await expect(hubspotScreen(page)).toBeHidden();

  // ---------- Ajustes: las fijadas y "Refresh properties" ----------
  await page.goto('/en/app/lines/settings?tab=integrations', { waitUntil: 'networkidle' });
  const card = page.locator('.gr-integration', { hasText: 'HubSpot' });
  await card.getByRole('button', { name: 'Properties' }).click();
  const propsDialog = page.getByRole('dialog', { name: 'HubSpot properties' });
  await expect(propsDialog.getByRole('list', { name: 'Pinned properties' })).toContainText('Plan');
  await propsDialog.getByRole('button', { name: 'Refresh properties' }).click();
  await expect(page.getByText('Properties updated from HubSpot')).toBeVisible();
  await propsDialog.getByRole('button', { name: 'Unpin Plan', exact: true }).click();
  await expect(propsDialog.getByRole('list', { name: 'Pinned properties' })).not.toContainText('Plan');
  await propsDialog.getByRole('combobox', { name: 'Pin a property' }).selectOption({ label: 'Health score' });
  await expect(propsDialog.getByRole('list', { name: 'Pinned properties' })).toContainText('Health score');
  await propsDialog.getByRole('button', { name: 'Close' }).click();
  // El diálogo de conexión explica los permisos nuevos.
  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'HubSpot', exact: true });
  await expect(edit.getByText('crm.schemas.companies.read', { exact: true })).toBeVisible();
  await expect(edit.getByText('To edit company properties from Lines')).toBeVisible();
  await expect(edit.getByText('/api/groups/hubspot/webhook')).toBeVisible();
  await edit.getByRole('button', { name: 'Cancel' }).click();

  // ---------- Teléfono (390px, táctil), claro y oscuro ----------
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await phone.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(phone, baseURL!, theme);
      await mobile.goto(`/en/app/lines/list/${group.id}`, { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await hubspotRegion(mobile).getByRole('button', { name: 'All properties' }).click();
      const sheet = hubspotScreen(mobile);
      await expect(sheet.locator('[data-prop="plan_tier"]')).toBeVisible();
      await check(mobile, `lines hubspot pantalla 390 ${theme}`);
      await sheet.getByRole('checkbox', { name: /^Show empty/ }).check();
      await sheet.getByRole('button', { name: 'Edit Products in use', exact: true }).click();
      await expect(sheet.locator('[data-prop="products_used"]').getByRole('button', { name: 'Save' })).toBeVisible();
      await check(mobile, `lines hubspot pantalla 390 ${theme} editando`);
      await sheet.locator('[data-prop="products_used"]').getByRole('button', { name: 'Cancel' }).click();
      await sheet.getByRole('tab', { name: 'Sync log' }).click();
      await expect(sheet.getByRole('list', { name: 'Sync log' })).toBeVisible();
      await check(mobile, `lines hubspot pantalla 390 ${theme} registro`);
    }
    await setTheme(phone, baseURL!, 'light');
    await mobile.goto('/en/app/lines/settings?tab=integrations', { waitUntil: 'domcontentloaded' });
    await settle(mobile);
    await mobile.locator('.gr-integration', { hasText: 'HubSpot' }).getByRole('button', { name: 'Properties' }).click();
    await expect(mobile.getByRole('dialog', { name: 'HubSpot properties' })).toBeVisible();
    await check(mobile, 'lines hubspot 390 propiedades fijadas');
  } finally {
    await phone.close();
  }

  expect(errors, errors.join('\n')).toEqual([]);
});

test('bandeja: filtrar por propiedades de HubSpot y guardarlo en una lista', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  const tag = uid();
  await connect(request);
  const n = await fakeNumber(request, `HubSpot filtro ${tag}`);
  const acme = await newGroup(request, n, `Filtro Acme ${tag}`);
  const globex = await newGroup(request, n, `Filtro Globex ${tag}`);
  const initech = await newGroup(request, n, `Filtro Initech ${tag}`);
  const loose = await newGroup(request, n, `Filtro Suelto ${tag}`);
  await link(request, acme.id, '9001');
  await link(request, globex.id, '9002');
  await link(request, initech.id, '9003');

  // ---------- Por la API: se filtra en el servidor ----------
  const byHs = async (filters: unknown[]) => {
    const res = (await (await request.get(`/api/groups/chats?number=${n.id}&hs=${encodeURIComponent(JSON.stringify(filters))}`)).json()) as { rows: Array<{ name: string }>; total: number };
    return res.rows.map((r) => r.name).sort();
  };
  expect(await byHs([{ name: 'plan_tier', op: 'any_of', values: ['starter'] }])).toEqual([globex.name]);
  expect(await byHs([{ name: 'numberofemployees', op: 'gt', value: '100' }])).toEqual([acme.name, initech.name].sort());
  expect(await byHs([{ name: 'plan_tier', op: 'empty' }])).toEqual([initech.name]);
  expect(await byHs([{ name: 'name', op: 'contains', value: 'logistics' }])).toEqual([acme.name]);

  // ---------- En la bandeja ----------
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('searchbox', { name: 'Search chats and messages' }).fill(tag);
  const rowOf = (name: string) => page.locator('.gr-row', { hasText: name });
  await expect(rowOf(loose.name)).toBeVisible();
  await page.getByRole('button', { name: 'Filters and lists' }).click();
  const filters = page.getByRole('group', { name: 'HubSpot property filters' });
  // Selección: "es alguna de", con las opciones de HubSpot.
  const filtered = page.waitForRequest((req) => req.url().includes('/api/groups/chats') && req.url().includes('hs='));
  await filters.getByRole('combobox', { name: 'Filter by a HubSpot property' }).selectOption('plan_tier');
  await expect(filters.getByRole('combobox', { name: 'Condition' })).toHaveValue('any_of');
  await filters.getByRole('combobox', { name: 'Choose a value' }).selectOption('starter');
  // El filtro viaja en la URL del pedido.
  expect(decodeURIComponent((await filtered).url())).toContain('"name":"plan_tier"');
  await expect(rowOf(globex.name)).toBeVisible();
  await expect(rowOf(acme.name)).toHaveCount(0);
  await expect(rowOf(loose.name)).toHaveCount(0);
  await filters.getByRole('combobox', { name: 'Choose a value' }).selectOption('growth');
  await expect(rowOf(acme.name)).toBeVisible();
  await expect(rowOf(globex.name)).toBeVisible();
  await filters.getByRole('button', { name: 'Remove Starter' }).click();
  await expect(rowOf(globex.name)).toHaveCount(0);
  await expect(rowOf(acme.name)).toBeVisible();
  // "Está vacía".
  await filters.getByRole('combobox', { name: 'Condition' }).selectOption('empty');
  await expect(rowOf(initech.name)).toBeVisible();
  await expect(rowOf(acme.name)).toHaveCount(0);
  // Número: mayor que.
  await filters.getByRole('combobox', { name: 'HubSpot property', exact: true }).selectOption('numberofemployees');
  await filters.getByRole('combobox', { name: 'Condition' }).selectOption('gt');
  await filters.getByRole('textbox', { name: 'Value' }).fill('100');
  await expect(rowOf(acme.name)).toBeVisible();
  await expect(rowOf(initech.name)).toBeVisible();
  await expect(rowOf(globex.name)).toHaveCount(0);
  // Una segunda condición se suma.
  await filters.getByRole('combobox', { name: 'Filter by a HubSpot property' }).selectOption('name');
  await filters.getByRole('combobox', { name: 'Condition' }).nth(1).selectOption('contains');
  await filters.getByRole('textbox', { name: 'Value' }).nth(1).fill('initech');
  await expect(rowOf(initech.name)).toBeVisible();
  await expect(rowOf(acme.name)).toHaveCount(0);

  // ---------- Guardado en una lista ----------
  await page.getByRole('button', { name: 'Save as list' }).click();
  const save = page.getByRole('dialog', { name: 'Save as list' });
  const listName = `HubSpot grandes ${tag}`;
  await save.getByLabel('List name').fill(listName);
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\?list=/);
  const listId = new URL(page.url()).searchParams.get('list')!;
  try {
    const lists = (await (await request.get('/api/groups/lists')).json()) as { lists: Array<{ id: string; filters: { hsProps?: unknown[] } }> };
    expect(lists.lists.find((l) => l.id === listId)?.filters.hsProps).toEqual([
      { name: 'numberofemployees', op: 'gt', value: '100' },
      { name: 'name', op: 'contains', value: 'initech' },
    ]);
    // La lista aplica el filtro sola, sin parámetros.
    const viaList = (await (await request.get(`/api/groups/chats?list=${listId}`)).json()) as { rows: Array<{ name: string }> };
    expect(viaList.rows.map((r) => r.name)).toEqual([initech.name]);
    // Al volver a abrirla, la bandeja carga sus condiciones.
    await page.goto(`/en/app/lines/inbox?list=${listId}`, { waitUntil: 'networkidle' });
    const again = page.getByRole('group', { name: 'HubSpot property filters' });
    await expect(again.getByRole('combobox', { name: 'HubSpot property', exact: true }).first()).toHaveValue('numberofemployees');
    await expect(again.getByRole('textbox', { name: 'Value' }).first()).toHaveValue('100');
    await expect(rowOf(initech.name)).toBeVisible();
    await expect(rowOf(acme.name)).toHaveCount(0);

    // ---------- Teléfono ----------
    const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
    try {
      const mobile = await phone.newPage();
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(phone, baseURL!, theme);
        await mobile.goto(`/en/app/lines/inbox?list=${listId}`, { waitUntil: 'domcontentloaded' });
        await settle(mobile);
        await expect(mobile.getByRole('group', { name: 'HubSpot property filters' })).toBeVisible();
        await check(mobile, `lines hubspot filtro 390 ${theme}`);
      }
    } finally {
      await phone.close();
    }
  } finally {
    await request.delete(`/api/groups/lists/${listId}`);
  }

  // "Clear filters" saca también los de HubSpot. (Los filtros quedan guardados en la pestaña: se arranca sin ellos.)
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('searchbox', { name: 'Search chats and messages' }).fill(tag);
  await page.getByRole('button', { name: 'Filters and lists' }).click();
  const fresh = page.getByRole('group', { name: 'HubSpot property filters' });
  await fresh.getByRole('combobox', { name: 'Filter by a HubSpot property' }).selectOption('plan_tier');
  await fresh.getByRole('combobox', { name: 'Choose a value' }).selectOption('starter');
  await expect(rowOf(acme.name)).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rowOf(acme.name)).toBeVisible();
  await expect(fresh.getByRole('combobox', { name: 'HubSpot property', exact: true })).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('grupos sin empresa: sugerencia por nombre, buscador por fila y nada se vincula sin confirmar', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  const tag = uid();
  await connect(request);
  const n = await fakeNumber(request, `HubSpot masivo ${tag}`);
  const suggested = await newGroup(request, n, `Globex Retail ventas ${tag}`);
  const manual = await newGroup(request, n, `Zeta ${tag}`);
  const extra = await newGroup(request, n, `Yota ${tag}`);
  const linkedAlready = await newGroup(request, n, `Acme Logistics ${tag}`);
  await link(request, linkedAlready.id, '9001');

  // ---------- Se llega desde la lista de grupos ----------
  await page.goto('/en/app/lines/list', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Link groups to HubSpot' }).click();
  await expect(page.getByRole('heading', { name: 'Groups without a company' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Filter groups by name' }).fill(tag);
  const rowOf = (name: string) => page.locator('.gr-hsu-row', { hasText: name });
  await expect(rowOf(suggested.name)).toBeVisible();
  await expect(rowOf(manual.name)).toBeVisible();
  // El que ya tiene empresa no está.
  await expect(rowOf(linkedAlready.name)).toHaveCount(0);
  await expect(page.getByText('3 groups without a company')).toBeVisible();

  // ---------- Sugerencia por parecido de nombre: solo propone ----------
  await expect(rowOf(suggested.name)).toContainText('Suggested');
  await expect(rowOf(suggested.name)).toContainText('Globex Retail');
  await expect(rowOf(manual.name)).toContainText('No company with a similar name');
  const before = (await (await request.get(`/api/groups/hubspot/links?chat=${suggested.id}`)).json()) as { links: unknown[] };
  expect(before.links).toEqual([]);
  await page.getByRole('button', { name: `Link ${suggested.name} to Globex Retail`, exact: true }).click();
  await expect(page.getByText(`${suggested.name} linked to Globex Retail`)).toBeVisible();
  await expect(rowOf(suggested.name)).toHaveCount(0);
  const after = (await (await request.get(`/api/groups/hubspot/links?chat=${suggested.id}`)).json()) as { links: Array<{ type: string; id: string }> };
  expect(after.links).toMatchObject([{ type: 'company', id: '9002' }]);

  // ---------- Buscador de empresas en la fila ----------
  await page.getByRole('searchbox', { name: `Search companies in HubSpot for ${manual.name}` }).fill('acme');
  await page.getByRole('button', { name: `Link ${manual.name} to Acme Logistics`, exact: true }).click();
  await expect(rowOf(manual.name)).toHaveCount(0);
  await expect(page.getByText('1 group without a company')).toBeVisible();
  expect(((await (await request.get(`/api/groups/hubspot/links?chat=${manual.id}`)).json()) as { links: Array<{ id: string }> }).links).toMatchObject([{ id: '9001' }]);
  // Quedó con todas las propiedades: el filtro de la bandeja ya lo encuentra.
  const hs = encodeURIComponent(JSON.stringify([{ name: 'name', op: 'is', value: 'Acme Logistics' }]));
  const found = (await (await request.get(`/api/groups/chats?number=${n.id}&hs=${hs}`)).json()) as { rows: Array<{ name: string }> };
  expect(found.rows.map((r) => r.name).sort()).toEqual([linkedAlready.name, manual.name].sort());

  // ---------- Teléfono ----------
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await phone.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(phone, baseURL!, theme);
      await mobile.goto('/en/app/lines/list/unlinked', { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await mobile.getByRole('searchbox', { name: 'Filter groups by name' }).fill(tag);
      await expect(mobile.locator('.gr-hsu-row', { hasText: extra.name })).toBeVisible();
      await expect(mobile.locator('.gr-hsu-row', { hasText: extra.name })).toContainText('No company with a similar name');
      await check(mobile, `lines hubspot sin empresa 390 ${theme}`);
      await mobile.getByRole('searchbox', { name: `Search companies in HubSpot for ${extra.name}` }).fill('re');
      await expect(mobile.getByRole('button', { name: `Link ${extra.name} to Globex Retail`, exact: true })).toBeVisible();
      await check(mobile, `lines hubspot sin empresa 390 ${theme} resultados`);
    }
  } finally {
    await phone.close();
  }

  // Sin HubSpot, la vista lo dice y la lista de grupos no la ofrece.
  await request.delete('/api/groups/hubspot');
  await page.goto('/en/app/lines/list/unlinked', { waitUntil: 'networkidle' });
  await expect(page.getByText('Connect HubSpot to link groups to companies.')).toBeVisible();
  await page.goto('/en/app/lines/list', { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'Link groups to HubSpot' })).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
});
