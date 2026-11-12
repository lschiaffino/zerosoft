import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Lines › Grupos como una vista de Linear, contra el proveedor y el HubSpot
 * falsos: el mismo grupo de WhatsApp en dos líneas es una sola fila (con las
 * dos líneas y una sola empresa de HubSpot), el filtro por línea (una, varias
 * o todas), el selector de columnas (también propiedades de la empresa), el
 * orden y que la vista se recuerde. Nada sale a internet ni a WhatsApp.
 *
 * Nombres, teléfonos y empresas son inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const TOKEN = 'pat-na1-e2e-lines-groups-table';
const VIEW_STORE = 'zs-groups-view-v1';
/** Con SHOTS=<carpeta>, capturas para revisar a ojo. */
const SHOTS = process.env.SHOTS;

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

interface NumberInfo {
  id: string;
  webhookPath: string;
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
  return { id, webhookPath: new URL(info.webhookUrl).pathname };
}

/** El grupo `jid` recibe un mensaje en esa línea; devuelve el id de su chat en esa línea. */
async function groupIn(request: APIRequestContext, n: NumberInfo, jid: string, name: string): Promise<string> {
  const res = await request.post(n.webhookPath, {
    data: {
      events: [{ type: 'message', chatId: jid, isGroup: true, chatName: name, fromMe: false, senderPhone: '5490000000177', senderName: 'Cliente de prueba', providerMessageId: `gt-${uid()}`, body: 'Hola' }],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const found = (await (await request.get(`/api/groups/chats?kind=group&number=${n.id}&q=${encodeURIComponent(name)}`)).json()) as { rows: Array<{ id: string; name: string }> };
  const chat = found.rows.find((r) => r.name === name);
  expect(chat, `chat ${name}`).toBeTruthy();
  return chat!.id;
}

let jidSeq = 0;
const newJid = () => `1203635${String(Date.now()).slice(-8)}${++jidSeq}@g.us`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test.afterAll(async ({ request }) => {
  // El workspace compartido queda sin HubSpot, pase lo que pase.
  await request.delete('/api/groups/hubspot').catch(() => null);
});

const groupRow = (page: Page, jid: string) => page.locator(`tr[data-group="${jid}"]`);

async function openList(page: Page, tag: string) {
  await page.goto('/en/app/lines/list', { waitUntil: 'networkidle' });
  await page.evaluate((key) => window.localStorage.removeItem(key), VIEW_STORE);
  await page.reload({ waitUntil: 'networkidle' });
  // Con `next dev` la primera carga puede recompilar: se vuelve a escribir hasta que la tabla responde.
  await expect(async () => {
    await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
    await expect(page.locator('tbody tr').first()).toContainText(tag, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

test('un grupo en dos líneas es una fila; filtro por línea, columnas de HubSpot, orden y vista guardada', async ({ page, request, browser, baseURL }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const ventas = await fakeNumber(request, `Ventas ${tag}`);
  const soporte = await fakeNumber(request, `Soporte ${tag}`);
  const shared = newJid();
  const onlyVentas = newJid();
  const onlySoporte = newJid();
  const sharedName = `Acme compartido ${tag}`;
  const ventasName = `Beta ventas ${tag}`;
  const soporteName = `Zeta soporte ${tag}`;
  const sharedInVentas = await groupIn(request, ventas, shared, sharedName);
  const sharedInSoporte = await groupIn(request, soporte, shared, sharedName);
  await groupIn(request, ventas, onlyVentas, ventasName);
  await groupIn(request, soporte, onlySoporte, soporteName);

  // HubSpot conectado; la empresa se vincula desde una sola línea y vale para el grupo.
  await request.delete('/api/groups/hubspot');
  const connected = await request.post('/api/groups/hubspot', { data: { token: TOKEN } });
  expect(connected.ok(), await connected.text()).toBe(true);
  const linked = await request.post('/api/groups/hubspot/links', { data: { chatId: sharedInVentas, type: 'company', objectId: '9001' } });
  expect(linked.ok(), await linked.text()).toBe(true);
  const other = (await (await request.get(`/api/groups/hubspot/links?chat=${sharedInSoporte}`)).json()) as { links: Array<{ type: string; id: string }> };
  expect(other.links).toMatchObject([{ type: 'company', id: '9001' }]);

  await openList(page, tag);

  // ---------- Una fila por grupo, con sus dos líneas y su empresa ----------
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(groupRow(page, shared)).toHaveCount(1);
  const lines = groupRow(page, shared).locator('.gr-gt-lines');
  await expect(lines.getByRole('link', { name: `Ventas ${tag}` })).toHaveAttribute('href', new RegExp(`/app/lines/list/${sharedInVentas}$`));
  await expect(lines.getByRole('link', { name: `Soporte ${tag}` })).toHaveAttribute('href', new RegExp(`/app/lines/list/${sharedInSoporte}$`));
  const company = groupRow(page, shared).getByRole('link', { name: 'Open Acme Logistics in HubSpot' });
  await expect(company).toHaveAttribute('href', /^https:\/\/app\.hubspot\.com\/contacts\/\d+\/record\/0-2\/9001$/);
  await expect(company).toHaveAttribute('target', '_blank');
  await expect(groupRow(page, onlyVentas)).toContainText('Not linked');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/gt-table.png` });

  // ---------- Filtro por línea: una, varias, todas ----------
  const linesButton = page.getByTestId('groups-lines-button');
  await expect(linesButton).toContainText('All lines');
  await linesButton.click();
  const linesMenu = page.getByRole('group', { name: 'Filter by line' });
  await linesMenu.getByLabel(`Soporte ${tag}`).check();
  await expect(linesButton).toContainText(`Soporte ${tag}`);
  await expect(groupRow(page, onlyVentas)).toHaveCount(0);
  await expect(groupRow(page, onlySoporte)).toHaveCount(1);
  // El grupo compartido sigue, una vez y con las dos líneas.
  await expect(groupRow(page, shared)).toHaveCount(1);
  await expect(groupRow(page, shared).locator('.gr-gt-line')).toHaveCount(2);
  await linesMenu.getByLabel(`Ventas ${tag}`).check();
  await expect(linesButton).toContainText('2 lines');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/gt-lines.png` });
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await linesMenu.getByLabel('All lines').check();
  await expect(linesButton).toContainText('All lines');
  await page.keyboard.press('Escape');
  await expect(linesMenu).toHaveCount(0);
  await expect(linesButton).toBeFocused();

  // ---------- Columnas: una propiedad de la empresa de HubSpot ----------
  await page.getByTestId('groups-columns-button').click();
  const columns = page.getByRole('group', { name: 'Columns' });
  await page.getByRole('searchbox', { name: 'Search columns' }).fill('plan');
  await columns.getByLabel('Plan', { exact: true }).check();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/gt-columns.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: 'Plan' })).toBeVisible();
  await expect(groupRow(page, shared).getByRole('cell', { name: 'Growth' })).toBeVisible();
  // Ocultar una columna del grupo.
  await page.getByTestId('groups-columns-button').click();
  await columns.getByLabel('Members', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: 'Members' })).toHaveCount(0);

  // ---------- Orden: por nombre, ascendente y descendente ----------
  const names = () => page.locator('tbody tr .gr-gt-name').allInnerTexts();
  await page.getByRole('columnheader', { name: 'Group' }).getByRole('button').click();
  await expect(page.getByRole('columnheader', { name: 'Group' })).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(names).toEqual([sharedName, ventasName, soporteName]);
  await page.getByRole('columnheader', { name: 'Group' }).getByRole('button').click();
  await expect(page.getByRole('columnheader', { name: 'Group' })).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(names).toEqual([soporteName, ventasName, sharedName]);

  // ---------- La vista se recuerda al volver ----------
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
  await expect(page.getByRole('columnheader', { name: 'Plan' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Members' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Group' })).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(names).toEqual([soporteName, ventasName, sharedName]);

  // ---------- Quitar la empresa desde la otra línea la quita del grupo ----------
  const unlinked = await request.delete(`/api/groups/hubspot/links?chat=${sharedInSoporte}&type=company`);
  expect(unlinked.ok(), await unlinked.text()).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
  await expect(groupRow(page, shared)).toContainText('Not linked');

  // ---------- Teléfono, claro y oscuro ----------
  const phone = await browser.newContext({ baseURL, viewport: PHONE, hasTouch: true, isMobile: true });
  try {
    const mobile = await phone.newPage();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(phone, baseURL!, theme);
      await mobile.goto('/en/app/lines/list', { waitUntil: 'domcontentloaded' });
      await settle(mobile);
      await mobile.getByRole('searchbox', { name: 'Search by name' }).fill(tag);
      await expect(mobile.locator(`tr[data-group="${shared}"]`)).toBeVisible();
      await check(mobile, `lines grupos tabla 390 ${theme}`);
      if (SHOTS) await mobile.screenshot({ path: `${SHOTS}/gt-390-${theme}.png`, fullPage: true });
      await mobile.getByTestId('groups-columns-button').click();
      await expect(mobile.getByRole('group', { name: 'Columns' })).toBeVisible();
      await check(mobile, `lines grupos columnas 390 ${theme}`);
      await mobile.keyboard.press('Escape');
      await mobile.getByTestId('groups-lines-button').click();
      await check(mobile, `lines grupos lineas 390 ${theme}`);
      await mobile.keyboard.press('Escape');
    }
  } finally {
    await phone.close();
  }

  await page.evaluate((key) => window.localStorage.removeItem(key), VIEW_STORE);
  expect(errors, errors.join('\n')).toEqual([]);
});
