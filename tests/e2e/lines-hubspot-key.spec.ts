import { expect, test, type Page } from '@playwright/test';
import { setTheme } from './responsive-audit';

/**
 * Lines › Integraciones › HubSpot con una service key, contra el HubSpot
 * falso en memoria (GROUPS_INTEGRATIONS_FAKE): los pasos para conseguir la
 * clave en los dos casos, una clave a la que le faltan permisos (dicho en
 * palabras), conectar y ver la cuenta, el tipo de clave y lo que puede hacer,
 * y desconectar. En 1280 y en 390, en los cinco aspectos, claro y oscuro.
 *
 * El workspace del e2e es uno solo: el spec deja HubSpot desconectado y el
 * aspecto por defecto al terminar, pase o falle.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const SETTINGS = '/en/app/lines/settings?tab=integrations';
const card = (page: Page) => page.locator('.gr-integration', { hasText: 'HubSpot' });
const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'HubSpot' });

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Nada del diálogo se sale por los costados de la pantalla. */
async function fitsViewport(page: Page, width: number) {
  const box = await dialogOf(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  const wide = await dialogOf(page).evaluate((el) => [...el.querySelectorAll('*')].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === 'visible' && n.getBoundingClientRect().right > window.innerWidth + 1).length);
  expect(wide).toBe(0);
}

test.beforeAll(async ({ request }) => {
  await request.delete('/api/groups/hubspot').catch(() => null);
});
test.afterAll(async ({ request }) => {
  await request.delete('/api/groups/hubspot').catch(() => null);
  await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
});

for (const vp of [
  { name: '1280', width: 1280, height: 800 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`service key en ${vp.name}: pasos, permisos que faltan, cuenta y permisos, desconectar`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const key = `pat-na1-svc-e2e-key-${vp.name}`;
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(SETTINGS, { waitUntil: 'networkidle' });
    await expect(card(page).getByText('Not connected')).toBeVisible();
    await card(page).getByRole('button', { name: 'Connect' }).click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();

    // Los dos caminos para conseguir la clave, cerrados hasta que se abren.
    const help = dialog.getByTestId('hubspot-key-help');
    await expect(help).toContainText('Paste a service key or the access token of a legacy private app');
    const fresh = help.getByTestId('hubspot-key-new');
    await expect(fresh.locator('ol')).toBeHidden();
    await fresh.locator('summary').click();
    await expect(fresh.locator('ol li')).toHaveCount(4);
    await expect(fresh).toContainText('Development › Keys › Service keys');
    await expect(fresh.getByRole('link', { name: 'HubSpot guide to service keys' })).toHaveAttribute('href', /developers\.hubspot\.com/);
    const legacy = help.getByTestId('hubspot-key-legacy');
    await legacy.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(legacy.locator('ol li')).toHaveCount(3);
    await expect(legacy).toContainText('Development › Legacy apps');
    await expect(dialog).not.toContainText('create a private app');
    await fitsViewport(page, vp.width);
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath(`lines-key-help-${vp.name}.png`) });

    // Una service key a la que le faltan permisos obligatorios: se dicen en palabras.
    const input = dialog.getByLabel('Service key or private app token');
    await input.fill('pat-na1-svc-noscope-e2e');
    await dialog.getByRole('button', { name: 'Connect' }).click();
    const missing = dialog.getByTestId('hubspot-key-missing');
    await expect(missing).toBeVisible({ timeout: 30_000 });
    await expect(missing).toContainText('This key is missing permissions');
    await expect(missing).toContainText('Read companies');
    await expect(missing).toContainText('crm.objects.companies.read');
    await expect(missing).toContainText('Read deals and pipelines');
    await expect(missing).not.toContainText('Read contacts');
    await missing.scrollIntoViewIfNeeded();
    await fitsViewport(page, vp.width);
    await page.screenshot({ path: test.info().outputPath(`lines-key-missing-${vp.name}.png`) });
    expect(await (await request.get('/api/groups/hubspot')).json()).toMatchObject({ connected: false });

    // La buena.
    await input.fill(key);
    await dialog.getByRole('button', { name: 'Connect' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(card(page).getByText('Connected to HubSpot account 424242')).toBeVisible();
    await expect(card(page).getByTestId('hubspot-card-kind')).toHaveText('Connected with a service key');
    const status = await (await request.get('/api/groups/hubspot')).text();
    expect(status).not.toContain(key);
    expect(JSON.parse(status)).toMatchObject({ connected: true, portalId: '424242', tokenKind: 'service_key' });

    // Editar: la cuenta, el tipo de clave y lo que puede hacer; sin webhooks con una service key.
    await card(page).getByRole('button', { name: 'Edit' }).click();
    await expect(dialog).toBeVisible();
    const summary = dialog.getByTestId('hubspot-key-summary');
    await expect(summary).toHaveAttribute('data-kind', 'service_key');
    await expect(summary.getByTestId('hubspot-key-portal')).toHaveText('HubSpot account 424242');
    await expect(summary).toContainText('Connected with a service key');
    await expect(summary.getByTestId('hubspot-key-can')).toContainText('Read companies');
    await expect(summary.getByTestId('hubspot-key-can')).toContainText('Create and edit contacts, and add notes');
    await expect(summary.getByTestId('hubspot-key-cannot')).toHaveCount(0);
    await expect(dialog.getByTestId('hubspot-no-webhooks')).toBeVisible();
    await fitsViewport(page, vp.width);
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath(`lines-key-connected-${vp.name}.png`) });

    // El diálogo cierra con Esc y, en escritorio, con un clic afuera.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    if (vp.width >= 1000) {
      await card(page).getByRole('button', { name: 'Edit' }).click();
      await expect(dialog).toBeVisible();
      await page.mouse.click(8, 8);
      await expect(dialog).toBeHidden();
    }

    // Desconectar: confirma y borra la clave.
    await card(page).getByRole('button', { name: 'Disconnect' }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Disconnect HubSpot?' }));
    await expect(confirm.first()).toBeVisible();
    await confirm.first().getByRole('button', { name: 'Disconnect' }).click();
    await expect(card(page).getByText('Not connected')).toBeVisible({ timeout: 30_000 });
    await expect(card(page).getByTestId('hubspot-card-kind')).toHaveCount(0);
    expect(await (await request.get('/api/groups/hubspot')).json()).toMatchObject({ connected: false, portalId: '', scopes: [] });
    expect(errors).toEqual([]);
  });
}

test('la clave conectada en los cinco aspectos, claro y oscuro', async ({ page, request, context, baseURL }) => {
  const res = await request.post('/api/groups/hubspot', { data: { token: 'pat-na1-svc-readonly-e2e-looks' } });
  expect(res.ok(), await res.text()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const look of ['current', 'lines', 'classic', 'liquid', 'retro'] as const) {
    expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(context, baseURL!, theme);
      await page.goto(SETTINGS, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      await card(page).getByRole('button', { name: 'Edit' }).click();
      const dialog = dialogOf(page);
      const summary = dialog.getByTestId('hubspot-key-summary');
      await expect(summary).toBeVisible();
      // Una clave de solo lectura: lo que todavía no puede también se ve.
      await expect(summary.getByTestId('hubspot-key-cannot')).toContainText('Create and edit companies');
      await dialog.getByTestId('hubspot-key-new').locator('summary').click();
      // El texto se lee sobre su fondo en cada aspecto: el color sale de los tokens, no queda transparente ni igual al fondo.
      const colors = await summary.evaluate((el) => {
        const ink = getComputedStyle(el.querySelector('strong')!).color;
        let node: Element | null = el;
        let bg = 'rgba(0, 0, 0, 0)';
        while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
          bg = getComputedStyle(node).backgroundColor;
          node = node.parentElement;
        }
        return { ink, bg, border: getComputedStyle(el).borderTopColor };
      });
      expect(colors.ink, `${look} ${theme}`).not.toBe(colors.bg);
      expect(colors.border, `${look} ${theme}`).not.toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({ path: test.info().outputPath(`lines-key-${look}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  }
});
