import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Vistas guardadas de los listados del CRM (B2): pestañas por defecto y
 * guardadas, guardar con quién la ve, fijar, menús que cierran con Esc y con
 * un clic afuera, "Editar columnas" (orden y primera fija), "Todas las
 * vistas" y el board de deals con la vista activa. Datos propios, con nombres
 * únicos, en un workspace propio.
 */
ownWorkspace('crm-b2');

const uid = () => Math.random().toString(36).slice(2, 8);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const NAV = { timeout: 45_000 };

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

async function seedContacts(request: APIRequestContext, tag: string) {
  for (const [first, stage] of [['Lena', 'lead'], ['Omar', 'customer']] as const) {
    await ok(
      request.post('/api/crm/contacts', {
        data: { firstName: first, lastName: `Sv${tag}`, email: `${first}-${tag}@b2.test`.toLowerCase(), phone: '+1 555 0100', lifecycleStage: stage },
      }),
    );
  }
}

const tabs = (page: Page) => page.getByTestId('view-tabs');

for (const [name, viewport] of [['1280', DESKTOP], ['390', PHONE]] as const) {
  test.describe(`vistas guardadas a ${name}px`, () => {
    test.use({ viewport, ...(name === '390' ? { hasTouch: true, isMobile: true } : {}) });

    test('pestañas por defecto, guardar una vista, fijarla, menús, columnas y todas las vistas', async ({ page, request }) => {
      test.setTimeout(180_000);
      const tag = uid();
      await seedContacts(request, tag);
      const lena = page.getByRole('link', { name: `Lena Sv${tag}`, exact: true });
      const omar = page.getByRole('link', { name: `Omar Sv${tag}`, exact: true });

      await page.goto('/en/app/crm/contacts');
      await expect(tabs(page)).toBeVisible();
      await expect(page.getByTestId('view-tab-all')).toHaveClass(/active/);
      await expect(lena).toBeVisible(NAV);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-b2-tabs-${name}.png`, fullPage: false });

      // Sin asignar: los contactos nuevos son de quien los crea, así que no aparecen.
      if (name === '1280') {
        await page.getByTestId('view-tab-unassigned').getByRole('tab').click();
      } else {
        // En el teléfono entran dos pestañas: la tercera está en "Más".
        await page.getByTestId('view-more-btn').click();
        const more = page.getByTestId('view-more-menu');
        await expect(more).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(more).toBeHidden();
        await page.getByTestId('view-more-btn').click();
        await more.getByRole('menuitem').first().click();
      }
      await expect(page).toHaveURL(/sv=unassigned/, NAV);
      await expect(lena).toHaveCount(0);
      await page.goto('/en/app/crm/contacts?sv=mine');
      await expect(page.getByTestId('view-tab-mine')).toHaveClass(/active/, NAV);
      await expect(lena).toBeVisible(NAV);

      // Filtrar sobre la vista la marca como cambiada; guardarla como vista nueva compartida.
      const search = page.locator('.filter-search input[type="search"]');
      await search.fill(`Lena Sv${tag}`);
      await search.press('Enter');
      await expect(omar).toHaveCount(0, NAV);
      await expect(page.getByTestId('view-modified')).toBeVisible();
      await page.getByTestId('view-save-as').click();
      const dialog = page.getByTestId('save-view-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByTestId('save-view-name').fill(`Leads ${tag}`);
      await dialog.getByTestId('save-view-everyone').check();
      await dialog.getByTestId('save-view-submit').click();
      await expect(dialog).toBeHidden(NAV);
      const saved = page.getByTestId('view-tab-saved').filter({ hasText: `Leads ${tag}` });
      await expect(saved).toHaveClass(/active/, NAV);
      await expect(page).toHaveURL(/sv=[0-9a-f-]{36}/);
      await expect(page.getByTestId('view-modified')).toHaveCount(0);
      await expect(omar).toHaveCount(0);

      // Recargar: la vista sigue filtrando.
      await page.reload();
      await expect(lena).toBeVisible(NAV);
      await expect(omar).toHaveCount(0);

      // Menú de la pestaña: Esc y un clic afuera lo cierran; fijar la pone primera.
      const menuBtn = page.getByTestId('view-tab-menu-btn');
      const menu = page.getByTestId('view-tab-menu');
      await menuBtn.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(menuBtn).toBeFocused();
      await menuBtn.click();
      await expect(menu).toBeVisible();
      await page.mouse.click(5, viewport.height - 5);
      await expect(menu).toBeHidden();
      await menuBtn.click();
      await menu.getByTestId('view-pin').click();
      await expect(tabs(page).locator('.view-tab').first()).toHaveText(new RegExp(`Leads ${tag}`), NAV);

      // Editar columnas: quitar el email, fijar la primera, y guardar en la vista.
      await page.getByTestId('edit-columns-btn').click();
      const cols = page.getByTestId('edit-columns-dialog');
      await expect(cols).toBeVisible();
      await cols.getByTestId('edit-columns-selected').locator('[data-column="email"]').getByRole('button', { name: /Remove/ }).click();
      await cols.getByTestId('edit-columns-freeze').check();
      await page.screenshot({ path: `test-results/crm-b2-columns-${name}.png`, fullPage: false });
      await cols.getByTestId('edit-columns-apply').click();
      await expect(cols).toBeHidden(NAV);
      await expect(page).toHaveURL(/cols=/, NAV);
      await expect(page.getByTestId('view-modified')).toBeVisible();
      await page.getByTestId('view-save').click();
      await expect(page.getByTestId('view-modified')).toHaveCount(0, NAV);
      if (name === '1280') {
        await expect(page.locator('table.crm-table.is-frozen')).toBeVisible();
        await expect(page.locator('table.crm-table thead th').filter({ hasText: /^Email$/ })).toHaveCount(0);
        await expect(page.locator('table.crm-table thead th').nth(1)).toContainText('Name');
      }
      // Esc cierra "Editar columnas" sin aplicar.
      await page.getByTestId('edit-columns-btn').click();
      await expect(cols).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(cols).toBeHidden();
      await noHorizontalScroll(page);

      // Todas las vistas: búsqueda y filtro por con quién se comparte.
      await page.getByTestId('view-add-btn').click();
      await page.getByTestId('view-add-menu').getByTestId('view-all-views').click();
      await expect(page).toHaveURL(/\/app\/crm\/views\?entity=contacts/, NAV);
      const table = page.getByTestId('all-views-table');
      await expect(table.getByRole('link', { name: `Leads ${tag}` })).toBeVisible();
      await page.getByTestId('all-views-shared').selectOption('private');
      await expect(table).toHaveCount(0);
      await page.getByTestId('all-views-shared').selectOption('everyone');
      await page.getByTestId('all-views-search').fill(tag);
      await expect(table.getByRole('link', { name: `Leads ${tag}` })).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-b2-all-views-${name}.png`, fullPage: false });

      // Abrir y borrar.
      await table.getByRole('link', { name: `Leads ${tag}` }).click();
      await expect(saved).toHaveClass(/active/, NAV);
      await menuBtn.click();
      await menu.getByTestId('view-delete').click();
      await page.getByTestId('confirm-dialog-confirm').click();
      await expect(page).not.toHaveURL(/sv=[0-9a-f-]{36}/, NAV);
      await expect(saved).toHaveCount(0, NAV);
    });

    test('board de deals: la vista "Deals abiertos" deja afuera los ganados', async ({ page, request }) => {
      test.setTimeout(120_000);
      const tag = uid();
      const pipeline = await ok<{ id: string }>(request.post('/api/crm/pipelines', { data: { name: `Sv ${tag}` } }));
      const open = await ok<{ id: string }>(request.post(`/api/crm/pipelines/${pipeline.id}/stages`, { data: { name: 'Open' } }));
      const won = await ok<{ id: string }>(request.post(`/api/crm/pipelines/${pipeline.id}/stages`, { data: { name: 'Won' } }));
      await ok(request.patch(`/api/crm/stages/${won.id}`, { data: { isWon: true } }));
      await ok(request.post('/api/crm/deals', { data: { name: `Open deal ${tag}`, amount: 100, pipelineId: pipeline.id, stageId: open.id } }));
      await ok(request.post('/api/crm/deals', { data: { name: `Won deal ${tag}`, amount: 100, pipelineId: pipeline.id, stageId: won.id } }));

      // En el teléfono el board muestra una etapa a la vez: se cuenta, no se mira si está a la vista.
      await page.goto(`/en/app/crm/deals?pipeline=${pipeline.id}`);
      await expect(page.locator('.kb-card-name', { hasText: `Won deal ${tag}` })).toHaveCount(1, NAV);
      await page.goto(`/en/app/crm/deals?pipeline=${pipeline.id}&sv=open`);
      await expect(page.getByTestId('view-tab-open')).toHaveClass(/active/, NAV);
      await expect(page.locator('.kb-card-name', { hasText: `Open deal ${tag}` })).toHaveCount(1, NAV);
      await expect(page.locator('.kb-card-name', { hasText: `Won deal ${tag}` })).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-b2-board-${name}.png`, fullPage: false });

      // La tabla mantiene la vista.
      await page.getByRole('link', { name: 'Table' }).first().click();
      await expect(page).toHaveURL(/view=table/, NAV);
      await expect(page).toHaveURL(/sv=open/);
      await expect(page.getByRole('link', { name: `Open deal ${tag}` })).toBeVisible(NAV);
      await expect(page.getByRole('link', { name: `Won deal ${tag}` })).toHaveCount(0);
    });
  });
}
