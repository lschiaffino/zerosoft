import { expect as baseExpect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CRM, bloque C4: una fila de contactos, empresas o deals se despliega y
 * muestra sus asociados y la última actividad (como la vista previa de fila
 * de HubSpot). Se abre y se cierra con el botón de la primera columna o con
 * el teclado (Enter / Espacio, Esc devuelve el foco), a 1280 y a 390.
 *
 * Cada test crea sus registros con una marca propia y filtra por ella (la
 * cuenta demo es compartida). Se busca por rol, testid o atributo.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const PHONE = { width: 390, height: 844 };

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

async function json<T>(res: Promise<{ ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

async function noSideScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${client}`).toBeLessThanOrEqual(client);
}

/** Una empresa con dos contactos, un deal abierto y uno ganado, y una nota. */
async function seed(request: APIRequestContext, tag: string) {
  const company = await json<{ id: string }>(request.post('/api/crm/companies', { data: { name: `Rowexp ${tag}`, domain: `rowexp-${tag}.example` } }));
  const a = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Ana', lastName: `Rowexp ${tag}`, email: `ana-${tag}@x.example`, jobTitle: 'Buyer', companyId: company.id } }));
  const b = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Bo', lastName: `Rowexp ${tag}`, email: `bo-${tag}@x.example`, companyId: company.id } }));
  const { rows: pipelines } = await json<{ rows: Array<{ id: string; stages: Array<{ id: string; is_won: number; is_lost: number }> }> }>(request.get('/api/crm/pipelines'));
  const p = pipelines[0];
  const open = p.stages.find((s) => !s.is_won && !s.is_lost)!;
  const won = p.stages.find((s) => s.is_won)!;
  const deal = await json<{ id: string }>(
    request.post('/api/crm/deals', { data: { name: `Open rowexp ${tag}`, pipelineId: p.id, stageId: open.id, amount: 4200, companyId: company.id, contactIds: [a.id, b.id] } }),
  );
  await json(request.post('/api/crm/deals', { data: { name: `Won rowexp ${tag}`, pipelineId: p.id, stageId: won.id, amount: 100, companyId: company.id, contactIds: [a.id] } }));
  await json(request.post('/api/crm/activities', { data: { type: 'note', body: `Kickoff call notes ${tag}`, companyId: company.id } }));
  return { company: company.id, a: a.id, b: b.id, deal: deal.id, pipeline: p.id };
}

const firstRow = (page: Page) => page.locator('.crm-table tbody tr').first();

for (const [name, viewport] of [
  ['1280', { width: 1280, height: 860 }],
  ['390', PHONE],
] as const) {
  test.describe(`expandable rows at ${name}`, () => {
    test.use({ viewport, ...(name === '390' ? { hasTouch: true, isMobile: true } : {}) });

    test('company row: contacts, open deals and last activity; keyboard and Esc', async ({ page, request }) => {
      const tag = uid();
      const s = await seed(request, tag);
      await page.goto(`/en/app/crm/companies?q=${tag}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.crm-table tbody tr')).toHaveCount(1);
      const toggle = firstRow(page).getByTestId('row-expand');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      if (name === '390') {
        const box = (await toggle.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(40);
        expect(box.height).toBeGreaterThanOrEqual(40);
      }

      const loaded = page.waitForResponse((r) => r.url().includes('/api/crm/row-expand') && r.url().includes(s.company));
      await toggle.click();
      expect((await loaded).ok()).toBe(true);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const panel = page.getByTestId('row-expansion');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('row-exp-contacts').getByRole('link')).toHaveCount(2);
      await expect(panel.getByTestId('row-exp-contacts')).toContainText('Buyer');
      // Solo el deal abierto.
      await expect(panel.getByTestId('row-exp-deals').getByRole('link', { name: `Open rowexp ${tag}` })).toBeVisible();
      await expect(panel.getByTestId('row-exp-deals').getByRole('link', { name: `Won rowexp ${tag}` })).toHaveCount(0);
      // Hay una última actividad (cuál exactamente lo prueba el unitario: la cuenta demo es compartida).
      await expect(panel.getByTestId('row-exp-last-activity')).toBeVisible();
      await noSideScroll(page);
      await page.screenshot({ path: `test-results/crm-c4-expand-company-${name}.png` });

      // Esc dentro del panel lo cierra y el foco vuelve al botón.
      await panel.getByTestId('row-exp-contacts').getByRole('link').first().focus();
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      // Con el teclado: Enter abre, Espacio cierra; Esc sobre la flecha también.
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('row-exp-contacts').getByRole('link')).toHaveCount(2);
      await page.keyboard.press(' ');
      await expect(panel).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(toggle).toBeFocused();

      // Un link del panel lleva a la ficha.
      await toggle.click();
      await panel.getByTestId('row-exp-deals').getByRole('link', { name: `Open rowexp ${tag}` }).click();
      await expect(page).toHaveURL(new RegExp(`/app/crm/deals/${s.deal}`));
    });

    test('contact and deal rows', async ({ page, request }) => {
      const tag = uid();
      const s = await seed(request, tag);
      await page.goto(`/en/app/crm/contacts?q=ana-${tag}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.crm-table tbody tr')).toHaveCount(1);
      await firstRow(page).getByTestId('row-expand').click();
      const panel = page.getByTestId('row-expansion');
      await expect(panel.getByTestId('row-exp-deals').getByRole('link')).toHaveCount(2);
      await expect(panel.getByTestId('row-exp-contacts')).toHaveCount(0);
      await noSideScroll(page);

      await page.goto(`/en/app/crm/deals?pipeline=${s.pipeline}&view=table&q=Open%20rowexp%20${tag}`, { waitUntil: 'networkidle' });
      await expect(page.locator('.crm-table tbody tr')).toHaveCount(1);
      await firstRow(page).getByTestId('row-expand').click();
      await expect(panel.getByTestId('row-exp-contacts').getByRole('link')).toHaveCount(2);
      await expect(panel.getByTestId('row-exp-companies').getByRole('link', { name: `Rowexp ${tag}` })).toBeVisible();
      await expect(panel.getByTestId('row-exp-companies').getByTestId('row-exp-primary')).toHaveCount(1);
      await noSideScroll(page);
      await page.screenshot({ path: `test-results/crm-c4-expand-deal-${name}.png` });
    });
  });
}

test.describe('expandable rows: errors', () => {
  test.use({ viewport: { width: 1280, height: 860 } });

  test('a failed load shows an error with retry', async ({ page, request }) => {
    const tag = uid();
    await seed(request, tag);
    await page.goto(`/en/app/crm/companies?q=${tag}`, { waitUntil: 'networkidle' });
    let fail = true;
    await page.route('**/api/crm/row-expand**', (route) => (fail ? route.fulfill({ status: 500, body: '{}' }) : route.continue()));
    await firstRow(page).getByTestId('row-expand').click();
    await expect(page.getByTestId('row-expansion').getByRole('alert')).toBeVisible();
    fail = false;
    await page.getByTestId('row-expansion-retry').click();
    await expect(page.getByTestId('row-exp-contacts').getByRole('link')).toHaveCount(2);
  });
});
