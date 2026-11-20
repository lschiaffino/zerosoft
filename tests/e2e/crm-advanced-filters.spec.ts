import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Filtros avanzados de los listados del CRM (components/crm/AdvancedFilters):
 * panel lateral (hoja en el teléfono) con grupos de filtros unidos con O y,
 * dentro de cada grupo, filtros unidos con Y. El filtro queda en la URL, se ve
 * como chips arriba de la tabla y sobrevive a recargar. Datos propios, con
 * nombres únicos, en un workspace propio.
 */
ownWorkspace('crm-af');

const uid = () => Math.random().toString(36).slice(2, 8);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
/** La primera espera después de navegar: el listado se vuelve a pedir al server. */
const NAV = { timeout: 30_000 };

async function ok<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (await r.json()) as T;
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

/** Cuatro contactos: Lima/Quito × lead/customer, con el mismo apellido único. */
async function seedContacts(request: APIRequestContext, tag: string) {
  for (const [city, stage] of [['Lima', 'lead'], ['Lima', 'customer'], ['Quito', 'lead'], ['Quito', 'customer']] as const) {
    await ok(
      request.post('/api/crm/contacts', {
        data: { firstName: `${city} ${stage}`, lastName: `Af${tag}`, email: `${city}-${stage}-${tag}@af.test`.toLowerCase(), city, lifecycleStage: stage },
      }),
    );
  }
}

const panelOf = (page: Page) => page.getByTestId('adv-filters-panel');
const ruleOf = (panel: Locator, group: number, rule: number) => panel.getByTestId('adv-filters-group').nth(group).getByTestId('adv-filters-rule').nth(rule);

/** Busca la propiedad por su nombre y la elige con Enter (el foco está en el buscador). */
async function pickProperty(rule: Locator, search: string, key: string) {
  const input = rule.getByTestId('adv-filters-prop-search');
  await expect(input).toBeFocused();
  await input.fill(search);
  await expect(rule.locator(`[data-key="${key}"]`)).toBeVisible();
  // Flecha abajo hasta que la opción buscada sea la activa (puede haber otras que coincidan antes).
  for (let i = 0; i < 12 && (await rule.locator(`[data-key="${key}"]`).getAttribute('aria-selected')) !== 'true'; i += 1) {
    await input.press('ArrowDown');
  }
  await input.press('Enter');
  await expect(rule.getByTestId('adv-filters-op')).toBeFocused();
}

for (const [name, viewport] of [['1280', DESKTOP], ['390', PHONE]] as const) {
  test.describe(`contactos a ${name}px`, () => {
    test.use({ viewport, ...(name === '390' ? { hasTouch: true, isMobile: true } : {}) });

    test('dos grupos: filas y conteo correctos, la URL lo guarda, chips, Esc y limpiar', async ({ page, request }) => {
      test.setTimeout(150_000);
      const tag = uid();
      await seedContacts(request, tag);
      const row = (city: string, stage: string) => page.getByRole('link', { name: `${city} ${stage} Af${tag}`, exact: true });

      await page.goto('/en/app/crm/contacts');
      const open = page.getByTestId('adv-filters-open');
      // Con el teclado: el botón abre el panel y el foco cae en el buscador de propiedades.
      await open.focus();
      await page.keyboard.press('Enter');
      const panel = panelOf(page);
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute('open', '');

      // Grupo 1: ciudad es Lima Y apellido contiene el tag.
      const r00 = ruleOf(panel, 0, 0);
      await pickProperty(r00, 'cit', 'city');
      await r00.getByTestId('adv-filters-op').selectOption('equals');
      await r00.getByTestId('adv-filters-value').fill('Lima');
      await r00.getByTestId('adv-filters-value').press('Enter');
      await expect(r00.locator('.crm-af-token')).toHaveCount(1);

      await panel.getByTestId('adv-filters-group').nth(0).getByTestId('adv-filters-add-rule').click();
      const r01 = ruleOf(panel, 0, 1);
      await pickProperty(r01, 'last na', 'lastName');
      // Sin Enter: el texto a medio escribir cuenta como valor al aplicar.
      await r01.getByTestId('adv-filters-value').fill(`Af${tag}`);

      // Grupo 2 (O): etapa es customer Y email contiene el tag.
      await panel.getByTestId('adv-filters-add-group').click();
      await expect(panel.getByTestId('adv-filters-group')).toHaveCount(2);
      const r10 = ruleOf(panel, 1, 0);
      await pickProperty(r10, 'lifecycle', 'lifecycle');
      await r10.getByTestId('adv-filters-options').getByRole('checkbox', { name: 'Customer' }).check();
      await panel.getByTestId('adv-filters-group').nth(1).getByTestId('adv-filters-add-rule').click();
      const r11 = ruleOf(panel, 1, 1);
      await pickProperty(r11, 'email', 'email');
      await r11.getByTestId('adv-filters-value').fill(`-${tag}@af.test`);
      await noHorizontalScroll(page);

      await panel.getByTestId('adv-filters-apply').click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(/[?&]filters=/, NAV);

      const expectFiltered = async () => {
        await expect(row('Lima', 'lead')).toBeVisible(NAV);
        await expect(row('Lima', 'customer')).toBeVisible();
        await expect(row('Quito', 'customer')).toBeVisible();
        await expect(row('Quito', 'lead')).toHaveCount(0);
        await expect(page.getByTestId('crm-total')).toHaveAttribute('data-total', '3');
        await expect(page.getByTestId('adv-filters-chip')).toHaveCount(4);
        await expect(page.getByTestId('adv-filters-count')).toHaveText('4');
      };
      await expectFiltered();
      await noHorizontalScroll(page);

      // La URL es el filtro: recargar lo conserva.
      await page.reload();
      await expectFiltered();

      // Un chip abre el panel con el filtro cargado; Esc lo cierra, descarta lo tocado y devuelve el foco.
      await page.getByTestId('adv-filters-chip').first().locator('.ui-filter-chip-text').click();
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('adv-filters-group')).toHaveCount(2);
      await expect(panel.getByTestId('adv-filters-rule')).toHaveCount(4);
      await ruleOf(panel, 0, 0).getByTestId('adv-filters-remove-rule').click();
      await expect(panel.getByTestId('adv-filters-rule')).toHaveCount(3);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(open).toBeFocused();
      await expectFiltered();

      if (name === '1280') {
        // Clic afuera (en el telón) también cierra sin aplicar.
        await open.click();
        await expect(panel).toBeVisible();
        await ruleOf(panel, 0, 0).getByTestId('adv-filters-remove-rule').click();
        await page.mouse.click(40, 400);
        await expect(panel).toBeHidden();
        await expectFiltered();
      } else {
        // En el teléfono el panel es una hoja a pantalla completa, sin scroll lateral.
        await open.click();
        await expect(panel).toBeVisible();
        const box = await panel.boundingBox();
        // La hoja ocupa el ancho de la pantalla (con el redondeo de subpíxeles del navegador).
        expect(box?.width ?? 0).toBeCloseTo(PHONE.width, 0);
        await noHorizontalScroll(page);
        await panel.getByTestId('adv-filters-close').click();
        await expect(panel).toBeHidden();
      }

      // Quitar un chip saca esa regla: sin "ciudad es Lima", el grupo 1 es todo el apellido.
      await page.getByTestId('adv-filters-chip').first().locator('.ui-filter-chip-x').click();
      await expect(page.getByTestId('adv-filters-chip')).toHaveCount(3, NAV);
      await expect(row('Quito', 'lead')).toBeVisible();
      await expect(page.getByTestId('crm-total')).toHaveAttribute('data-total', '4');

      // Limpiar todo: sin filtro en la URL ni chips.
      await page.getByTestId('adv-filters-chips-clear').click();
      await expect(page.getByTestId('adv-filters-chips')).toHaveCount(0, NAV);
      await expect(page).not.toHaveURL(/filters=/);
      await expect(page.getByTestId('adv-filters-count')).toHaveCount(0);
      await noHorizontalScroll(page);
    });
  });
}

test.describe('empresas y deals', () => {
  test.use({ viewport: DESKTOP });

  test('un filtro incompleto no se aplica; empresas por número y nombre', async ({ page, request }) => {
    test.setTimeout(120_000);
    const tag = uid();
    await ok(request.post('/api/crm/companies', { data: { name: `Small Co ${tag}`, employees: 10 } }));
    await ok(request.post('/api/crm/companies', { data: { name: `Big Co ${tag}`, employees: 500 } }));

    await page.goto('/en/app/crm/companies');
    await page.getByTestId('adv-filters-open').click();
    const panel = panelOf(page);
    const r0 = ruleOf(panel, 0, 0);
    await pickProperty(r0, 'employ', 'employees');
    await r0.getByTestId('adv-filters-op').selectOption('gte');
    // Sin valor: aplicar avisa y deja el panel abierto.
    await panel.getByTestId('adv-filters-apply').click();
    await expect(r0.getByTestId('adv-filters-error')).toBeVisible();
    await expect(panel).toBeVisible();
    await r0.getByTestId('adv-filters-value').fill('100');

    await panel.getByTestId('adv-filters-add-rule').click();
    const r1 = ruleOf(panel, 0, 1);
    await pickProperty(r1, 'name', 'name');
    await r1.getByTestId('adv-filters-value').fill(tag);
    // Enter en un valor con texto lo suma; otro Enter (ya sin texto) aplica.
    await r1.getByTestId('adv-filters-value').press('Enter');
    await r1.getByTestId('adv-filters-value').press('Enter');
    await expect(panel).toBeHidden();

    await expect(page.getByRole('link', { name: `Big Co ${tag}`, exact: true })).toBeVisible(NAV);
    await expect(page.getByRole('link', { name: `Small Co ${tag}`, exact: true })).toHaveCount(0);
    await expect(page.getByTestId('crm-total')).toHaveAttribute('data-total', '1');
    await expect(page.getByTestId('adv-filters-chip')).toHaveCount(2);
    await page.reload();
    await expect(page.getByTestId('crm-total')).toHaveAttribute('data-total', '1', NAV);
    await noHorizontalScroll(page);
  });

  test('deals: monto entre dos valores en la vista tabla', async ({ page, request }) => {
    test.setTimeout(120_000);
    const tag = uid();
    const pipeline = await ok<{ id: string }>(request.post('/api/crm/pipelines', { data: { name: `AF ${tag}` } }));
    const stage = await ok<{ id: string }>(request.post(`/api/crm/pipelines/${pipeline.id}/stages`, { data: { name: 'Open' } }));
    for (const [n, amount] of [['Small deal', 100], ['Mid deal', 6000], ['Big deal', 90000]] as const) {
      await ok(request.post('/api/crm/deals', { data: { name: `${n} ${tag}`, pipelineId: pipeline.id, stageId: stage.id, amount } }));
    }

    await page.goto(`/en/app/crm/deals?pipeline=${pipeline.id}&view=table`);
    await expect(page.getByTestId('crm-total')).toHaveAttribute('data-total', '3', NAV);
    await page.getByTestId('adv-filters-open').click();
    const panel = panelOf(page);
    const r0 = ruleOf(panel, 0, 0);
    await pickProperty(r0, 'amount', 'amount');
    await r0.getByTestId('adv-filters-op').selectOption('between');
    await r0.getByTestId('adv-filters-value').fill('5000');
    await r0.getByTestId('adv-filters-value-to').fill('10000');
    await panel.getByTestId('adv-filters-apply').click();
    await expect(panel).toBeHidden();

    await expect(page.getByRole('link', { name: `Mid deal ${tag}`, exact: true })).toBeVisible(NAV);
    await expect(page.getByTestId('crm-total')).toHaveAttribute('data-total', '1');
    // Sigue en la tabla del mismo pipeline (el filtro no pisa los otros params de la URL).
    await expect(page).toHaveURL(new RegExp(`pipeline=${pipeline.id}`));
    await expect(page).toHaveURL(/view=table/);
    await expect(page.getByTestId('adv-filters-chip')).toHaveCount(1);
    await page.getByTestId('adv-filters-chips-clear').click();
    await expect(page.getByTestId('adv-filters-chips')).toHaveCount(0, NAV);
    await expect(page.getByTestId('crm-total')).toHaveAttribute('data-total', '3');
  });

  test('un link viejo (lista plana de reglas) sigue filtrando y se ve como chips', async ({ page, request }) => {
    test.setTimeout(120_000);
    const tag = uid();
    await seedContacts(request, tag);
    const legacy = JSON.stringify([
      { f: 'email', o: 'contains', v: `-${tag}@af.test` },
      { f: 'lifecycle', o: 'is', v: 'customer' },
    ]);
    await page.goto(`/en/app/crm/contacts?filters=${encodeURIComponent(legacy)}`);
    await expect(page.getByTestId('crm-total')).toHaveAttribute('data-total', '2', NAV);
    await expect(page.getByTestId('adv-filters-chip')).toHaveCount(2);
    await expect(page.getByRole('link', { name: `Quito customer Af${tag}`, exact: true })).toBeVisible();
  });
});
