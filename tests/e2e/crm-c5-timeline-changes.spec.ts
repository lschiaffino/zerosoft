import { expect, test, type Page } from '@playwright/test';

/**
 * CRM C5: los cambios de propiedades de la ficha salen en el timeline (una línea cada uno, como en
 * HubSpot), no cuentan como actividad y se esconden con la casilla "Property changes" del filtro, que
 * queda recordada. El menú cierra con Esc. A 1280 y a 390 (sin scroll lateral). Datos inventados.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

async function json<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

const panel = (page: Page) => page.getByTestId('record-panel-activity');
const change = (page: Page, field: string) => panel(page).locator(`[data-testid="crm-timeline-change"][data-field="${field}"]`);

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'sin scroll lateral').toBeLessThanOrEqual(0);
}

for (const [name, viewport] of [
  ['1280', DESKTOP],
  ['390', PHONE],
] as const) {
  test.describe(`cambios de propiedades en el timeline a ${name}`, () => {
    test.use({ viewport });

    test('se ven, no cuentan como actividad y se esconden desde el filtro', async ({ page, request }) => {
      test.setTimeout(120_000);
      const tag = uid();
      const contact = await json<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Paz', lastName: `Prop ${tag}` } }));
      await json(request.patch(`/api/crm/contacts/${contact.id}`, { data: { leadStatus: 'connected', jobTitle: `Analyst ${tag}` } }));
      const note = `Prop note ${tag}`;
      await json(request.post('/api/crm/activities', { data: { type: 'note', body: note, contactId: contact.id } }));

      await page.goto(`/en/app/crm/contacts/${contact.id}?tab=activity`, { waitUntil: 'networkidle' });
      await expect(change(page, 'lead_status')).toContainText('Lead status changed from New to Connected');
      await expect(change(page, 'job_title')).toContainText(`Job title set to Analyst ${tag}`);
      // Un cambio no es actividad: la pestaña cuenta solo la nota.
      await expect(panel(page).getByTestId('timeline-tab-all')).toContainText('1');
      await noSideScroll(page);

      const filter = panel(page).getByTestId('timeline-filter');
      await filter.click();
      const menu = panel(page).getByTestId('timeline-filter-menu');
      await expect(menu).toBeVisible();
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      const toggle = menu.getByTestId('timeline-filter-changes');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(change(page, 'lead_status')).toHaveCount(0);
      await expect(panel(page).getByTestId('crm-timeline-item').filter({ hasText: note })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(filter).toBeFocused();

      // Queda recordado al volver; se prenden de nuevo desde el mismo menú.
      await page.reload({ waitUntil: 'networkidle' });
      await expect(panel(page).getByTestId('crm-timeline-item').filter({ hasText: note })).toBeVisible();
      await expect(change(page, 'lead_status')).toHaveCount(0);
      await filter.click();
      await menu.getByTestId('timeline-filter-changes').click();
      await page.keyboard.press('Escape');
      await expect(change(page, 'lead_status')).toBeVisible();
      await noSideScroll(page);
    });
  });
}
