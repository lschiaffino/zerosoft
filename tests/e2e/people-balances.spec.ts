import { expect, test, type APIResponse } from '@playwright/test';

/**
 * People › saldos: HR crea una política manual desde Ajustes, la ficha arranca
 * en cero, HR carga días con fecha y nota, el historial lo muestra y borrar el
 * ajuste devuelve el saldo. Una política anual con tope acredita el año
 * entero el 1 de enero hasta el tope. 1280 y 390, sin scroll lateral.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

test('política manual: HR carga y borra un ajuste con nota; anual con tope acredita hasta el tope', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  // El demo (owner, HR) con su ficha y antigüedad: entra desde 2024.
  await ok(request.post('/api/people/me'));
  const { employees } = await ok<{ employees: Array<{ id: string; userId: string | null }> }>(request.get('/api/people/employees'));
  const me = employees.find((e) => e.userId === 'demo')!.id;
  await ok(request.patch(`/api/people/employees/${me}`, { data: { startDate: '2024-01-01' } }));

  // Ajustes: nueva política "a mano, por HR".
  const manualName = `Study days ${uid()}`;
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/people/settings', { waitUntil: 'networkidle' });
  await page.getByTestId('people-policies').waitFor();
  await page.locator('.ppl-panel-head .btn-primary').first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#pol-name').fill(manualName);
  await dialog.locator('#pol-kind').selectOption('other');
  await dialog.locator('#pol-accrual').selectOption('manual');
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const policyRow = page.getByTestId('people-policies').locator('tr', { hasText: manualName });
  await expect(policyRow).toBeVisible();
  await expect(policyRow.locator('td.num')).toHaveText('');

  // Anual de 20 días con tope de 12: el 1 de enero acredita el año entero, hasta el tope.
  const capName = `Capped ${uid()}`;
  await ok(request.post('/api/people/policies', { data: { name: capName, kind: 'vacation', accrual: 'annual', daysPerYear: 20, capDays: 12 } }));

  // La ficha: la manual arranca en cero; la anual con tope muestra 12.
  await page.goto(`/en/app/people/${me}?tab=timeoff`, { waitUntil: 'networkidle' });
  const manualCard = page.getByTestId('people-balances').locator(`[data-policy="${manualName}"]`);
  await expect(manualCard.getByTestId('people-available')).toHaveText('0');
  await expect(page.getByTestId('people-balances').locator(`[data-policy="${capName}"]`).getByTestId('people-available')).toHaveText('12');
  await expect(page.getByTestId('people-adjustments')).toBeVisible();

  // HR carga 3 días con nota; el dialogo cierra con Esc la primera vez.
  await page.getByTestId('people-adjust').click();
  const adjust = page.getByRole('dialog');
  await expect(adjust.locator('#adj-days')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(adjust).toBeHidden({ timeout: 20_000 });
  await page.getByTestId('people-adjust').click();
  await adjust.locator('#adj-policy').selectOption({ label: manualName });
  await adjust.locator('#adj-days').fill('3');
  await adjust.locator('#adj-note').fill('Exam week');
  await adjust.locator('button[type="submit"]').click();
  await expect(adjust).toBeHidden({ timeout: 20_000 });
  await expect(manualCard.getByTestId('people-available')).toHaveText('3');
  const row = page.getByTestId('people-adjustments').locator('tr[data-adjustment]', { hasText: manualName });
  await expect(row.getByTestId('people-adjustment-days')).toHaveText('+3');
  await expect(row).toContainText('Exam week');

  // 390: sin scroll lateral, el historial en tarjetas.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 860 });

  // Borrar el ajuste (con confirmación): el saldo vuelve a cero.
  await row.getByTestId('people-adjustment-delete').click();
  await page.getByRole('alertdialog').getByTestId('confirm-dialog-confirm').click();
  await expect(row).toHaveCount(0);
  await expect(manualCard.getByTestId('people-available')).toHaveText('0');
  expect(errors, errors.join('\n')).toEqual([]);
});
