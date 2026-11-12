import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Lines + HubSpot contra el HubSpot falso en memoria (GROUPS_INTEGRATIONS_FAKE):
 * conectar con el token de una private app, vincular un grupo a una empresa y
 * un negocio, aceptar el contacto sugerido por teléfono en un chat 1 a 1,
 * registrar la conversación, filtrar la bandeja y desconectar. Nada sale a
 * internet ni a WhatsApp.
 *
 * El workspace del e2e es uno solo: el spec deja HubSpot desconectado al
 * terminar, pase o falle, para no cambiar lo que ven los demás specs.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const TOKEN = 'pat-na1-e2e-lines-hubspot';
/** Teléfono de "Dana Rivers" en el HubSpot falso (lib/groups-hubspot-fake.ts). */
const DANA_PHONE = '5491155550142';

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

async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, name: string, body: string) {
  const isGroup = chatId.endsWith('@g.us');
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: {
      events: [
        {
          type: 'message',
          chatId,
          isGroup,
          chatName: isGroup ? name : undefined,
          fromMe: false,
          senderPhone: isGroup ? '5491100000077' : chatId.split('@')[0],
          senderName: isGroup ? 'Cliente' : name,
          providerMessageId: `hs-${uid()}`,
          body,
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function chatByName(request: APIRequestContext, q: string): Promise<{ id: string; name: string }> {
  const res = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(q)}`)).json()) as { rows: Array<{ id: string; name: string }> };
  expect(res.rows.length, `chat ${q}`).toBeGreaterThan(0);
  return res.rows[0];
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
const hubspotCard = (page: Page) => page.locator('.gr-integration', { hasText: 'HubSpot' });

test.afterAll(async ({ request }) => {
  // Pase lo que pase, el workspace compartido queda sin HubSpot.
  await request.delete('/api/groups/hubspot').catch(() => null);
});

test('HubSpot: conectar, vincular un grupo y un chat, registrar, filtrar y desconectar', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  const tag = uid();
  // Arranca desconectado aunque una corrida anterior se haya cortado.
  await request.delete('/api/groups/hubspot');
  await request.put('/api/groups/prefs', { data: { line: 'all' } });

  const n = await fakeNumber(request, `HubSpot ${tag}`);
  const groupName = `HS Grupo ${tag}`;
  const danaName = `HS Dana ${tag}`;
  const looseName = `HS Suelto ${tag}`;
  await inbound(request, n, `12036399${Date.now().toString().slice(-8)}@g.us`, groupName, 'Arrancamos el piloto la semana que viene');
  await inbound(request, n, `${DANA_PHONE}@c.us`, danaName, 'Hola, ¿llegó el pedido?');
  await inbound(request, n, `54911${Math.floor(1e7 + Math.random() * 8e7)}@c.us`, looseName, 'Buenas');
  const group = await chatByName(request, groupName);
  const dana = await chatByName(request, danaName);

  // ---------- Conectar ----------
  await page.goto('/en/app/lines/settings?tab=integrations', { waitUntil: 'networkidle' });
  const card = hubspotCard(page);
  await expect(card.getByText('Not connected')).toBeVisible();
  await card.getByRole('button', { name: 'Connect' }).click();
  const dialog = page.getByRole('dialog', { name: 'HubSpot' });
  await expect(dialog).toBeVisible();
  // Los permisos que necesita la private app están a la vista.
  for (const scope of ['crm.objects.companies.read', 'crm.objects.deals.read', 'crm.objects.contacts.read', 'crm.objects.owners.read', 'crm.objects.contacts.write']) {
    await expect(dialog.getByText(scope, { exact: true })).toBeVisible();
  }
  const tokenInput = dialog.getByLabel('Private app access token');
  // Un token que HubSpot no acepta.
  await tokenInput.fill('not-a-hubspot-token');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByRole('alert')).toContainText('did not accept that token');
  // Un token al que le faltan permisos: dice cuáles.
  await tokenInput.fill('pat-noscope-e2e');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByRole('alert')).toContainText('crm.objects.companies.read, crm.objects.deals.read');
  // El bueno.
  await tokenInput.fill(TOKEN);
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Connected to HubSpot account 424242')).toBeVisible();
  // El token no vuelve por la API.
  const status = await (await request.get('/api/groups/hubspot')).text();
  expect(status).not.toContain(TOKEN);
  expect(JSON.parse(status)).toMatchObject({ connected: true, autoLink: false, logNotes: false });

  // ---------- Vincular un grupo a una empresa y a un negocio ----------
  await page.goto(`/en/app/lines/list/${group.id}`, { waitUntil: 'networkidle' });
  const hs = hubspotRegion(page);
  await expect(hs.getByText('This chat is not linked to HubSpot yet.')).toBeVisible();
  await hs.getByRole('searchbox', { name: 'Search companies in HubSpot' }).fill('zzz-nothing');
  await expect(hs.getByText('Nothing in HubSpot matches that name.')).toBeVisible();
  await hs.getByRole('searchbox', { name: 'Search companies in HubSpot' }).fill('acme');
  await hs.getByRole('button', { name: 'Link Acme Logistics', exact: true }).click();
  const company = hs.getByRole('link', { name: 'Open Acme Logistics in HubSpot', exact: true });
  await expect(company).toHaveAttribute('href', 'https://app.hubspot.com/contacts/424242/record/0-2/9001');
  await expect(company).toHaveAttribute('target', '_blank');
  await expect(hs).toContainText('acme-logistics.example');
  await expect(hs).toContainText('Paula Ortiz');
  await expect(hs).toContainText('Customer');

  await hs.getByRole('combobox', { name: 'Record type to search' }).selectOption('deal');
  await hs.getByRole('searchbox', { name: 'Search deals in HubSpot' }).fill('renewal');
  await hs.getByRole('button', { name: 'Link Acme Logistics renewal', exact: true }).click();
  const deal = hs.getByRole('link', { name: 'Open Acme Logistics renewal in HubSpot', exact: true });
  await expect(deal).toHaveAttribute('href', 'https://app.hubspot.com/contacts/424242/record/0-3/8001');
  await expect(hs).toContainText('Contract sent');
  await expect(hs).toContainText('$12,000');
  await expect(hs).toContainText('Dec 15, 2026');

  // Queda guardado: al recargar sigue ahí.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(hubspotRegion(page).getByRole('link', { name: 'Open Acme Logistics in HubSpot', exact: true })).toBeVisible();
  await expect(hubspotRegion(page).getByRole('link', { name: 'Open Acme Logistics renewal in HubSpot', exact: true })).toBeVisible();

  // ---------- Registrar la conversación ----------
  await hubspotRegion(page).getByRole('button', { name: 'Log conversation to HubSpot' }).click();
  await expect(page.getByText('1 note saved in HubSpot')).toBeVisible();
  // Repetirlo no crea otra nota.
  await hubspotRegion(page).getByRole('button', { name: 'Log conversation to HubSpot' }).click();
  await expect(page.getByText('HubSpot already has this conversation')).toBeVisible();

  // Desvincular el negocio.
  await hubspotRegion(page).getByRole('button', { name: 'Unlink Acme Logistics renewal', exact: true }).click();
  await expect(hubspotRegion(page).getByRole('link', { name: 'Open Acme Logistics renewal in HubSpot', exact: true })).toHaveCount(0);
  await expect(hubspotRegion(page).getByRole('link', { name: 'Open Acme Logistics in HubSpot', exact: true })).toBeVisible();

  // ---------- Chat 1 a 1: contacto sugerido por teléfono ----------
  await page.goto(`/en/app/lines/inbox/${dana.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const dm = hubspotRegion(page);
  await expect(dm.getByText('A HubSpot contact has this number')).toBeVisible();
  await expect(dm.getByText('Dana Rivers')).toBeVisible();
  // Nada se vincula sin confirmar.
  const before = (await (await request.get(`/api/groups/hubspot/links?chat=${dana.id}`)).json()) as { links: unknown[]; suggestions: unknown[] };
  expect(before.links).toEqual([]);
  expect(before.suggestions).toHaveLength(1);
  await dm.getByRole('button', { name: 'Link Dana Rivers', exact: true }).click();
  await expect(dm.getByRole('link', { name: 'Open Dana Rivers in HubSpot', exact: true })).toHaveAttribute('href', 'https://app.hubspot.com/contacts/424242/record/0-1/7001');
  // Con el contacto viene su empresa principal.
  await expect(dm.getByRole('link', { name: 'Open Acme Logistics in HubSpot', exact: true })).toBeVisible();
  await expect(dm.getByText('A HubSpot contact has this number')).toHaveCount(0);

  // ---------- Bandeja: filtro y etiqueta de la fila ----------
  const linked = (await (await request.get(`/api/groups/chats?hubspot=linked&number=${n.id}`)).json()) as { rows: Array<{ name: string; hubspotName?: string }> };
  expect(linked.rows.map((r) => r.name).sort()).toEqual([danaName, groupName].sort());
  expect(linked.rows.find((r) => r.name === groupName)?.hubspotName).toBe('Acme Logistics');
  const unlinked = (await (await request.get(`/api/groups/chats?hubspot=unlinked&number=${n.id}`)).json()) as { rows: Array<{ name: string }> };
  expect(unlinked.rows.map((r) => r.name)).toEqual([looseName]);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('searchbox', { name: 'Search chats and messages' }).fill(tag);
  await expect(page.locator('.gr-row', { hasText: looseName })).toBeVisible();
  await expect(page.locator('.gr-row', { hasText: groupName }).locator('.gr-row-hubspot')).toHaveText('Acme Logistics');
  // En el panel de filtros: vinculados a HubSpot, sí o no.
  const linkedFilter = async (choice: 'Yes' | 'No') => {
    await page.getByTestId('lines-filter-button').click();
    const filters = page.getByRole('dialog', { name: 'Filters' });
    await filters.getByRole('navigation', { name: 'Filter fields' }).getByRole('button', { name: /^Linked to HubSpot/ }).click();
    await filters.getByRole('group', { name: 'Linked to HubSpot' }).getByRole('button', { name: choice, exact: true }).click();
    await filters.getByRole('button', { name: 'Apply' }).click();
  };
  await linkedFilter('Yes');
  await expect(page.getByTestId('filter-chips').locator('[data-chip="hubspot"]')).toContainText('Linked to HubSpot: Yes');
  await expect(page.locator('.gr-row', { hasText: looseName })).toHaveCount(0);
  await expect(page.locator('.gr-row', { hasText: groupName })).toBeVisible();
  await expect(page.locator('.gr-row', { hasText: danaName })).toBeVisible();
  await linkedFilter('No');
  await expect(page.locator('.gr-row', { hasText: groupName })).toHaveCount(0);
  await expect(page.locator('.gr-row', { hasText: looseName })).toBeVisible();
  await page.getByTestId('filter-chips').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.gr-row', { hasText: groupName })).toBeVisible();

  // ---------- Teléfono (390px, táctil), claro y oscuro ----------
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await phone.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(phone, baseURL!, theme);
      await mobile.goto(`/en/app/lines/list/${group.id}`, { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      const region = hubspotRegion(mobile);
      await expect(region.getByRole('link', { name: 'Open Acme Logistics in HubSpot', exact: true })).toBeVisible();
      await region.scrollIntoViewIfNeeded();
      await check(mobile, `lines hubspot 390 ${theme} vinculado`);
      // Con resultados de búsqueda abiertos.
      await region.getByRole('searchbox', { name: 'Search companies in HubSpot' }).fill('re');
      await expect(region.getByRole('button', { name: 'Link Globex Retail', exact: true })).toBeVisible();
      await check(mobile, `lines hubspot 390 ${theme} resultados`);
    }
    // El diálogo de conexión, con los ajustes.
    await setTheme(phone, baseURL!, 'light');
    await mobile.goto('/en/app/lines/settings?tab=integrations', { waitUntil: 'domcontentloaded' });
    await settle(mobile);
    await hubspotCard(mobile).getByRole('button', { name: 'Edit' }).click();
    await expect(mobile.getByRole('dialog', { name: 'HubSpot' })).toBeVisible();
    await check(mobile, 'lines hubspot 390 ajustes');
  } finally {
    await phone.close();
  }

  // ---------- Ajustes del workspace y desconectar ----------
  await page.goto('/en/app/lines/settings?tab=integrations', { waitUntil: 'networkidle' });
  await hubspotCard(page).getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'HubSpot' });
  await expect(edit.getByRole('checkbox', { name: /Link 1:1 chats automatically/ })).not.toBeChecked();
  await expect(edit.getByRole('checkbox', { name: /Log the conversations of linked chats/ })).not.toBeChecked();
  await edit.getByRole('checkbox', { name: /Log the conversations of linked chats/ }).check();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  expect(await (await request.get('/api/groups/hubspot')).json()).toMatchObject({ connected: true, autoLink: false, logNotes: true });

  await hubspotCard(page).getByRole('button', { name: 'Disconnect' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Disconnect HubSpot?');
  await confirm.getByRole('button', { name: 'Disconnect' }).click();
  await expect(hubspotCard(page).getByText('Not connected')).toBeVisible();
  expect(await (await request.get('/api/groups/hubspot')).json()).toMatchObject({ connected: false, logNotes: false });
  // Desconectado, la bandeja ya no ofrece el filtro ni muestra vínculos.
  const off = (await (await request.get(`/api/groups/chats?hubspot=linked&number=${n.id}`)).json()) as { rows: unknown[]; hubspot: boolean };
  expect(off.rows).toEqual([]);
  expect(off.hubspot).toBe(false);

  expect(errors, errors.join('\n')).toEqual([]);
});
