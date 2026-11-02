import fs from 'fs';
import { expect, test } from '@playwright/test';

/** Suscripciones desde la pantalla: crear, buscar, editar, probar, apagar, borrar con deshacer y darse de baja. */
const uid = () => Math.random().toString(36).slice(2, 8);

test.describe.configure({ mode: 'serial' });

let projectId = '';
let insightId = '';
let dashboardId = '';
const name = `Weekly ${uid()}`;

test.beforeAll(async ({ request }) => {
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Subs ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  projectId = project.id;
  await request.post('/api/ingest/e', { headers: { origin: 'http://shop.test' }, data: { api_key: project.publicKey, event: 'x', distinct_id: 'u' } });
  const post = async (path: string, data: unknown) => (await request.post(path, { data })).json();
  insightId = (await post('/api/analytics/insights', { projectId, name: 'Sales', query: { kind: 'trends', series: [{ event: 'x' }], dateRange: { from: '-1d' } } })).insight.id;
  dashboardId = (await post('/api/analytics/dashboards', { projectId, name: 'Board' })).dashboard.id;
  await request.patch(`/api/analytics/dashboards/${dashboardId}`, { data: { insightIds: [insightId] } });
});

test('vacío, crear, buscar, próxima entrega, apagar y borrar con deshacer', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto('/en/app/analytics/subscriptions', { waitUntil: 'networkidle' });
  await expect(page.getByText('No subscriptions yet')).toBeVisible();

  await page.getByRole('button', { name: 'New subscription' }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Add at least one');
  await dialog.getByLabel('What to send').selectOption(`i:${insightId}`);
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Recipients').fill('not-an-email');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Check the email');
  await dialog.getByLabel('Recipients').fill('ana@acme.com, bob@other.org');
  await dialog.getByLabel('Message').fill('For the Monday review');
  await dialog.getByRole('button', { name: 'Save' }).click();

  const table = page.getByTestId('an-subs-table');
  const row = table.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('ana@acme.com, bob@other.org', { timeout: 15_000 });
  await expect(row).not.toContainText('Not scheduled');

  await page.getByLabel('Search by name or recipient').fill('nobody-here');
  await expect(page.getByText('Nothing matches.')).toBeVisible();
  await page.getByLabel('Search by name or recipient').fill('other.org');
  await expect(row).toBeVisible();
  await page.getByLabel('Search by name or recipient').fill('');
  await page.getByRole('tab', { name: 'Dashboards' }).click();
  await expect(page.getByText('Nothing matches.')).toBeVisible();
  await page.getByRole('tab', { name: 'Insights' }).click();
  await expect(row).toBeVisible();

  // Mandar ahora llega de verdad a los destinatarios.
  await row.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText('Sent to its recipients.')).toBeVisible({ timeout: 15_000 });

  // Apagada no se puede probar.
  await row.getByRole('button', { name: 'Turn off' }).click();
  await expect(row).toContainText('Disabled', { timeout: 15_000 });
  await expect(row).toContainText('Not scheduled');
  await expect(row.getByRole('button', { name: 'Send now' })).toBeDisabled();
  await row.getByRole('button', { name: 'Turn on' }).click();
  await expect(row).not.toContainText('Disabled', { timeout: 15_000 });

  // Editar.
  await row.getByRole('button', { name: `Edit ${name}` }).click();
  await dialog.getByLabel('Frequency').selectOption('monthly');
  await dialog.getByLabel('When in the month').selectOption('ordinal');
  await dialog.getByLabel('Position', { exact: true }).selectOption('-1');
  await dialog.getByLabel('Day', { exact: true }).selectOption('fri');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  // Borrar y deshacer.
  await row.getByRole('button', { name: `Delete ${name}` }).click();
  await expect(page.getByText(`${name} was deleted.`)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(table.getByRole('row', { name: new RegExp(name) })).toBeVisible({ timeout: 15_000 });
});

test('desde un tablero se eligen los insights, y aparece en Cmd+K', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'zs_analytics_project', value: projectId, url: baseURL! }]);
  await page.goto(`/en/app/analytics/dashboards/${dashboardId}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Subscribe' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Sales')).toBeChecked();
  await dialog.getByLabel('Recipients').fill('team@acme.com');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await page.goto('/en/app/analytics/subscriptions', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-subs-table').getByRole('row', { name: /team@acme.com/ })).toContainText('Board');

  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await expect(page.getByRole('option', { name: new RegExp(name) }).first()).toBeVisible({ timeout: 15_000 });
});

test('darse de baja: abrir el link no cambia nada, confirmar sí', async ({ page, request }) => {
  const list = (await (await request.get(`/api/analytics/subscriptions?project=${projectId}`)).json()) as { subscriptions: Array<{ id: string; name: string; recipients: string[] }> };
  const s = list.subscriptions.find((x) => x.name === name)!;
  const file = process.env.EMAIL_CAPTURE_FILE;
  test.skip(!file || !fs.existsSync(file), 'sin archivo de emails');
  const mail = fs.readFileSync(file!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { to: string; text: string }).reverse().find((m) => m.to === 'ana@acme.com' && m.text.includes('unsubscribe?t='));
  const url = /(https?:\/\/\S*\/stats\/unsubscribe\?t=\S+)/.exec(mail!.text)![1];
  await page.goto(new URL(url).pathname + new URL(url).search, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('an-unsubscribe')).toBeVisible();
  const before = (await (await request.get(`/api/analytics/subscriptions?project=${projectId}`)).json()) as typeof list;
  expect(before.subscriptions.find((x) => x.id === s.id)?.recipients).toContain('ana@acme.com');
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByText('You will not get this report anymore.')).toBeVisible({ timeout: 15_000 });
});
