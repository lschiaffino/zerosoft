import { expect, test, type Page } from '@playwright/test';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Workflows del CRM (W3): el asistente con "El registro cumple los
 * criterios" (sin criterios no deja pasar) e "inscribir también los que ya
 * cumplen"; el botón de inscribir los que ya cumplen en un workflow guardado;
 * el registro por acción (se abre, Esc lo cierra) y sacar un registro a mano
 * desde el historial y desde la ficha. A 1280 y 390 px, claro y oscuro, sin
 * scroll horizontal. Workspace propio.
 */
ownWorkspace('crm-w3');

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

async function tapTarget(page: Page, testId: string) {
  const box = await page.getByTestId(testId).first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
}

for (const [name, viewport] of [['1280', DESKTOP], ['390', PHONE]] as const) {
  test.describe(`workflows W3 a ${name}px`, () => {
    test.use({ viewport, ...(name === '390' ? { hasTouch: true, isMobile: true } : {}) });

    test('asistente por criterios: inscribe los que ya cumplen y se pueden sacar a mano', async ({ page, request }) => {
      test.setTimeout(240_000);
      const tag = uid();
      const city = `Rosario${tag}`;
      await ok(request.post('/api/crm/contacts', { data: { firstName: 'Ceci', lastName: `W3${tag}`, email: `ceci-${tag}@w3.test`, city } }));

      await page.goto('/en/app/crm/workflows/new');
      const trigger = page.getByTestId('workflow-trigger').first();
      await expect(trigger).toBeVisible(NAV);
      await trigger.selectOption('criteria_met');
      await expect(page.getByTestId('workflow-criteria-entity')).toHaveValue('contact');
      // Sin criterios no pasa del primer paso.
      await page.getByTestId('workflow-wizard-next').click();
      await expect(page.getByTestId('workflow-trigger')).toBeVisible();
      await expect(page.locator('.crm-savebar [role="status"]')).not.toBeEmpty();

      const enroll = page.getByTestId('workflow-enrollment').first();
      await enroll.getByTestId('workflow-add-filter').click();
      const filter = enroll.getByTestId('workflow-filter').first();
      await filter.getByLabel('Field').fill('city');
      await filter.getByLabel('Value').fill(city);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w3-wizard-criteria-${name}.png`, fullPage: true });
      await page.getByTestId('workflow-wizard-next').click();

      const action = page.getByTestId('workflow-action').first();
      await expect(action).toBeVisible();
      await action.getByLabel('Task title').fill(`Call ${tag}`);
      await page.getByTestId('workflow-wizard-next').click();
      await page.getByLabel('Workflow name').fill(`Criteria ${tag}`);
      await page.getByTestId('workflow-enroll-existing-opt').check();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w3-wizard-review-${name}.png`, fullPage: true });
      await page.getByTestId('workflow-create').click();
      // En next dev la primera vez compila la ruta y la página del workflow.
      await expect(page).toHaveURL(/\/app\/crm\/workflows\/[0-9a-f-]{36}/, { timeout: 120_000 });

      // El contacto que ya cumplía quedó inscripto, esperando su turno en el cron.
      const runs = page.getByTestId('workflow-runs');
      await expect(runs).toBeVisible(NAV);
      const row = runs.locator('tr[data-status="waiting"]');
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('link', { name: `Ceci W3${tag}` })).toBeVisible();

      // Registro por acción: se abre, y Esc lo cierra con el foco de vuelta en el botón.
      const toggle = row.getByTestId('workflow-run-toggle');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const log = page.getByTestId('workflow-run-log');
      await expect(log).toBeVisible();
      await log.getByTestId('workflow-unenroll').focus();
      await page.keyboard.press('Escape');
      await expect(log).toHaveCount(0);
      await expect(toggle).toBeFocused();

      await toggle.click();
      await page.getByTestId('workflow-unenroll').click();
      if (name === '390') await tapTarget(page, 'workflow-unenroll-confirm');
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w3-unenroll-${name}.png`, fullPage: true });
      await page.getByTestId('workflow-unenroll-confirm').click();
      await expect(runs.locator('tr[data-status="unenrolled"]')).toHaveCount(1, NAV);

      // Dark.
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.getByTestId('workflow-run-toggle').first().click();
      await expect(page.getByTestId('workflow-run-log')).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w3-log-dark-${name}.png`, fullPage: true });
    });

    test('registro por acción, inscribir los que ya cumplen y sacar desde la ficha', async ({ page, request }) => {
      test.setTimeout(240_000);
      const tag = uid();
      const city = `Lima${tag}`;
      // Un workflow por evento con espera: el registro queda inscripto y se puede sacar desde la ficha.
      const wf = await ok<{ id: string }>(
        request.post('/api/crm/workflows', {
          data: {
            name: `Nurture ${tag}`,
            triggers: [{ type: 'contact_created' }],
            actions: [
              { type: 'create_task', config: { subject: `First ${tag}` } },
              { type: 'delay', config: { amount: 2, unit: 'days' } },
              { type: 'create_task', config: { subject: `Second ${tag}` } },
            ],
          },
        }),
      );
      const contact = await ok<{ id: string }>(
        request.post('/api/crm/contacts', { data: { firstName: 'Dora', lastName: `W3${tag}`, email: `dora-${tag}@w3.test`, city } }),
      );
      // Otro por criterios, guardado y prendido: el botón inscribe al contacto que ya cumple.
      const crit = await ok<{ id: string }>(
        request.post('/api/crm/workflows', {
          data: {
            name: `By city ${tag}`,
            enabled: true,
            settings: { filters: [{ entity: 'contact', field: 'city', op: 'equals', value: `Other${tag}` }] },
            triggers: [{ type: 'criteria_met', config: { entity: 'contact' } }],
            actions: [{ type: 'create_task', config: { subject: `Crit ${tag}` } }],
          },
        }),
      );
      await ok(request.post('/api/crm/contacts', { data: { firstName: 'Eva', lastName: `W3${tag}`, email: `eva-${tag}@w3.test`, city: `Other${tag}` } }));
      // Ese contacto entró al crearse: el botón no lo duplica.
      await page.goto(`/en/app/crm/workflows/${crit.id}`);
      await expect(page.getByTestId('workflow-backfill')).toBeVisible(NAV);
      await page.getByTestId('workflow-backfill').click();
      await page.getByTestId('workflow-backfill-confirm').click();
      await expect(page.getByTestId('workflow-backfill-result')).toBeVisible(NAV);
      await expect(page.getByTestId('workflow-runs').locator('tbody > tr[data-status]')).toHaveCount(1);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w3-backfill-${name}.png`, fullPage: true });

      await page.goto(`/en/app/crm/workflows/${wf.id}`);
      const runs = page.getByTestId('workflow-runs');
      await expect(runs).toBeVisible(NAV);
      await runs.getByTestId('workflow-run-toggle').first().click();
      const log = page.getByTestId('workflow-run-log');
      await expect(log.locator('li[data-outcome="ok"]')).toHaveCount(1);
      await expect(log.locator('li[data-outcome="waited"]')).toHaveCount(1);
      if (name === '390') await tapTarget(page, 'workflow-run-toggle');
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w3-log-${name}.png`, fullPage: true });

      await page.goto(`/en/app/crm/contacts/${contact.id}${name === '390' ? '?tab=related' : ''}`);
      const card = page.getByTestId('record-workflows');
      await expect(card).toBeVisible(NAV);
      const item = card.locator('li[data-status="waiting"]').filter({ hasText: `Nurture ${tag}` });
      await item.getByTestId('record-workflow-unenroll').click();
      if (name === '390') await tapTarget(page, 'record-workflow-unenroll-confirm');
      await card.scrollIntoViewIfNeeded();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w3-record-${name}.png`, fullPage: false });
      const removed = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/enrollments/'));
      await card.getByTestId('record-workflow-unenroll-confirm').click();
      expect((await removed).status()).toBe(204);
      await expect(card.locator('li[data-status="unenrolled"]')).toHaveCount(1, NAV);
    });
  });
}
