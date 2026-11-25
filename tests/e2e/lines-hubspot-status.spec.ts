import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines + HubSpot en las dos direcciones, contra el HubSpot falso en memoria
 * (GROUPS_INTEGRATIONS_FAKE), y el estado del sync en Ajustes › Integraciones:
 *
 * - HubSpot → Lines: alguien edita una empresa en HubSpot y "Sincronizar ahora"
 *   la trae; una empresa borrada en HubSpot queda a la vista con el nombre del
 *   grupo; un límite de HubSpot se dice en palabras y se puede reintentar.
 * - Lines → HubSpot: editar una propiedad llega a HubSpot en el momento y la
 *   conversación del grupo se deja como una nota que no se duplica.
 *
 * El workspace del e2e es uno solo y el HubSpot falso vive en la memoria del
 * servidor: el spec deja HubSpot desconectado y sin límite al terminar, pase o falle.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const SETTINGS = '/en/app/lines/settings?tab=integrations';
const TOKEN = 'pat-na1-e2e-lines-hubspot-status';
const uid = () => Math.random().toString(36).slice(2, 8);

const card = (page: Page) => page.locator('.gr-integration', { hasText: 'HubSpot' });

async function fake(request: APIRequestContext, body: Record<string, unknown>) {
  const res = await request.post('/api/groups/hubspot/fake', { data: body });
  expect(res.ok(), await res.text()).toBe(true);
}

async function fakeCompany(request: APIRequestContext, id: string): Promise<Record<string, string>> {
  return ((await (await request.get(`/api/groups/hubspot/fake?company=${id}`)).json()) as { properties: Record<string, string> }).properties;
}

async function newGroup(request: APIRequestContext, name: string): Promise<{ id: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Status ${name}` } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const res = await request.post(new URL(info.webhookUrl).pathname, {
    data: {
      events: [
        {
          type: 'message',
          chatId: `1203639${String(Date.now()).slice(-7)}@g.us`,
          isGroup: true,
          chatName: name,
          fromMe: false,
          senderPhone: '5491100000077',
          senderName: 'Cliente',
          providerMessageId: `hst-${uid()}`,
          body: 'Hola, necesitamos ayuda con el pedido',
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const found = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string }> };
  expect(found.rows.length, `chat ${name}`).toBeGreaterThan(0);
  return found.rows[0];
}

test.beforeAll(async ({ request }) => {
  await request.delete('/api/groups/hubspot').catch(() => null);
});
test.afterAll(async ({ request }) => {
  await request.post('/api/groups/hubspot/fake', { data: { rateLimit: 0 } }).catch(() => null);
  await request.delete('/api/groups/hubspot').catch(() => null);
});

test('las dos direcciones y el estado del sync en Ajustes', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tag = uid();
  const groupName = `Acme estado ${tag}`;

  // ---------- Conectar con la empresa 9001 vinculada a un grupo ----------
  await fake(request, { rateLimit: 0 });
  await fake(request, { create: { id: '9001', properties: { name: 'Acme Logistics', city: 'Rosario' } } });
  const connected = await request.post('/api/groups/hubspot', { data: { token: TOKEN, logNotes: true } });
  expect(connected.ok(), await connected.text()).toBe(true);
  const group = await newGroup(request, groupName);
  const linked = await request.post('/api/groups/hubspot/links', { data: { chatId: group.id, type: 'company', objectId: '9001' } });
  expect(linked.ok(), await linked.text()).toBe(true);

  // ---------- Lines → HubSpot: la propiedad y la conversación llegan ----------
  const patched = await request.patch('/api/groups/hubspot/company', { data: { chatId: group.id, property: 'city', value: 'Salta' } });
  expect(patched.ok(), await patched.text()).toBe(true);
  expect((await fakeCompany(request, '9001')).city).toBe('Salta');
  const logged = await request.post('/api/groups/hubspot/log', { data: { chatId: group.id } });
  expect(logged.ok(), await logged.text()).toBe(true);
  expect(await logged.json()).toEqual({ notes: 1, days: 1 });
  // Repetirlo no deja otra nota.
  expect(await (await request.post('/api/groups/hubspot/log', { data: { chatId: group.id } })).json()).toEqual({ notes: 0, days: 1 });

  // ---------- HubSpot → Lines: "Sincronizar ahora" trae el cambio ----------
  await page.goto(SETTINGS, { waitUntil: 'networkidle' });
  await expect(card(page)).toContainText('Connected to HubSpot account');
  await fake(request, { company: '9001', properties: { city: 'Posadas' } });
  await card(page).getByTestId('hubspot-sync-now').click();
  await expect(card(page).getByTestId('hubspot-card-synced')).toContainText('Last sync:');
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/hubspot/company?chat=${group.id}`)).json()) as { values: Record<string, string> }).values.city)
    .toBe('Posadas');
  await expect(card(page).getByTestId('hubspot-card-problems')).toHaveCount(0);

  // ---------- Un límite de HubSpot se dice y se puede reintentar ----------
  await fake(request, { rateLimit: 40 });
  await card(page).getByTestId('hubspot-sync-now').click();
  await expect(page.getByText('HubSpot is limiting requests', { exact: false }).first()).toBeVisible();
  await fake(request, { rateLimit: 0 });
  await card(page).getByTestId('hubspot-sync-now').click();
  await expect(card(page).getByTestId('hubspot-card-synced')).toContainText('Last sync:');

  // ---------- Una empresa borrada en HubSpot queda a la vista con el nombre del grupo ----------
  await fake(request, { remove: '9001' });
  await card(page).getByTestId('hubspot-sync-now').click();
  const problems = card(page).getByTestId('hubspot-card-problems');
  await expect(problems).toContainText('no longer in HubSpot');
  await expect(problems).toContainText(groupName);

  expect(errors).toEqual([]);
});
