import { expect, test, type Page } from '@playwright/test';
import { setTheme } from './responsive-audit';

/**
 * CRM › Importar › HubSpot con una service key, contra el proveedor falso
 * (CRM_IMPORT_FAKE): los pasos para conseguir la clave en los dos casos, una
 * clave sin un permiso obligatorio (dicho en palabras), la vista previa con
 * la cuenta, el tipo de clave, lo que puede leer y lo que no, y cancelar
 * (que borra la clave). En 1280 y en 390, en los cinco aspectos, claro y
 * oscuro. Nada sale a internet.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const SETTINGS = '/en/app/crm/settings?tab=import';

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function openConnect(page: Page) {
  const card = page.getByTestId('migrate-card-hubspot');
  await expect(async () => {
    await card.getByRole('button', { name: 'Connect HubSpot' }).click();
    await expect(page.getByRole('heading', { name: 'Connect HubSpot' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
}

/** Deja el workspace sin vista previa pendiente (la clave se borra con ella). */
async function cancelActive(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get('/api/crm/import/jobs');
  const active = res.ok() ? ((await res.json()) as { active: { id: string; status: string } | null }).active : null;
  if (active?.status === 'preview') await request.delete(`/api/crm/import/jobs/${active.id}`);
}

test.beforeAll(async ({ request }) => cancelActive(request));
test.afterAll(async ({ request }) => {
  await cancelActive(request);
  await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
});

for (const vp of [
  { name: '1280', width: 1280, height: 800 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`service key en ${vp.name}: pasos, permiso que falta, cuenta y permisos, cancelar`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(SETTINGS, { waitUntil: 'networkidle' });
    await openConnect(page);

    // Los dos caminos para conseguir la clave y los permisos en palabras.
    const help = page.getByTestId('hubspot-key-help');
    const fresh = help.getByTestId('hubspot-key-new');
    await fresh.locator('summary').click();
    await expect(fresh.locator('ol li')).toHaveCount(4);
    await expect(fresh).toContainText('Create service key');
    const legacy = help.getByTestId('hubspot-key-legacy');
    await legacy.locator('summary').click();
    await expect(legacy.locator('ol li')).toHaveCount(3);
    await expect(page.locator('.mig-body')).not.toContainText('create a private app');
    await expect(page.locator('.mig-body')).toContainText('Read owners, the people records are assigned to');
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath(`crm-key-help-${vp.name}.png`), fullPage: true });

    // Sin un permiso obligatorio: dice cuál, y no queda nada guardado.
    const input = page.getByLabel('Service key or private app token');
    await input.fill('fake-svc-noowners');
    await page.getByRole('button', { name: 'Connect and preview' }).click();
    const missing = page.getByTestId('hubspot-key-missing');
    await expect(missing).toBeVisible({ timeout: 30_000 });
    await expect(missing).toContainText('Read owners, the people records are assigned to');
    await expect(missing).toContainText('crm.objects.owners.read');
    await expect(missing.locator('li')).toHaveCount(1);
    await noSideScroll(page);
    await missing.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`crm-key-missing-${vp.name}.png`) });
    expect(((await (await request.get('/api/crm/import/jobs')).json()) as { active: unknown }).active).toBeNull();

    // Una service key sin el permiso de emails: conecta y la vista previa dice qué puede y qué no.
    await input.fill('fake-svc-noemail');
    await page.getByRole('button', { name: 'Connect and preview' }).click();
    const preview = page.getByTestId('migrate-preview');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const summary = preview.getByTestId('hubspot-key-summary');
    await expect(summary).toHaveAttribute('data-kind', 'service_key');
    await expect(summary.getByTestId('hubspot-key-portal')).toHaveText('HubSpot account 434343');
    await expect(summary).toContainText('Connected with a service key');
    await expect(summary.getByTestId('hubspot-key-can')).toContainText('Read contacts');
    await expect(summary.getByTestId('hubspot-key-can')).toContainText('Read lists');
    await expect(summary.getByTestId('hubspot-key-cannot')).toContainText('Read emails logged on records');
    await expect(summary.getByTestId('hubspot-key-cannot').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('migrate-count-contacts')).toHaveText('24');
    await noSideScroll(page);
    await page.screenshot({ path: test.info().outputPath(`crm-key-connected-${vp.name}.png`), fullPage: true });
    // La clave no vuelve por la API.
    const jobs = await (await request.get('/api/crm/import/jobs')).text();
    expect(jobs).not.toContain('fake-svc-noemail');
    expect(JSON.parse(jobs).active.preview.connection).toMatchObject({ portalId: '434343', kind: 'service_key', missing: ['sales-email-read'] });

    // Cancelar desconecta: vuelve a las tarjetas y no queda vista previa (ni clave).
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('migrate-card-hubspot')).toBeVisible({ timeout: 30_000 });
    await expect(preview).toBeHidden();
    await expect.poll(async () => ((await (await request.get('/api/crm/import/jobs')).json()) as { active: unknown }).active).toBeNull();

    // El paso de la clave se cierra con Esc.
    await openConnect(page);
    await page.getByLabel('Service key or private app token').press('Escape');
    await expect(page.getByRole('heading', { name: 'Connect HubSpot' })).toBeHidden();
    await expect(page.getByTestId('migrate-card-hubspot')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('la vista previa con la clave en los cinco aspectos, claro y oscuro', async ({ page, request, context, baseURL }) => {
  await cancelActive(request);
  const created = await request.post('/api/crm/import/jobs', { data: { provider: 'hubspot', token: 'fake-svc-noemail' } });
  expect(created.status(), await created.text()).toBe(201);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const look of ['current', 'lines', 'classic', 'liquid', 'retro'] as const) {
    expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(context, baseURL!, theme);
      await page.goto(SETTINGS, { waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('data-look', look);
      const summary = page.getByTestId('migrate-preview').getByTestId('hubspot-key-summary');
      await expect(summary).toBeVisible({ timeout: 30_000 });
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
      await summary.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`crm-key-${look}-${theme}.png`) });
    }
  }
});
