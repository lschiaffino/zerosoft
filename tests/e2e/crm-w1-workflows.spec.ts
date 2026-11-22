import { expect, test, type Page } from '@playwright/test';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Workflows del CRM (W1): una espera deja la inscripción "Esperando" con el
 * registro en el historial, la ficha del contacto muestra la tarjeta
 * Workflows, la sección Inscripción (reinscripción y filtros) y el
 * asistente con un disparador de empresa por propiedad y la acción Rotar
 * owner. A 1280 y 390 px, sin scroll horizontal. Workspace propio.
 */
ownWorkspace('crm-w1');

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

for (const [name, viewport] of [['1280', DESKTOP], ['390', PHONE]] as const) {
  test.describe(`workflows W1 a ${name}px`, () => {
    test.use({ viewport, ...(name === '390' ? { hasTouch: true, isMobile: true } : {}) });

    test('una espera deja la inscripción esperando, con el registro en el historial y en la ficha', async ({ page, request }) => {
      test.setTimeout(180_000);
      const tag = uid();
      const wf = await ok<{ id: string }>(
        request.post('/api/crm/workflows', {
          data: {
            name: `Follow up ${tag}`,
            settings: { reenroll: false },
            triggers: [{ type: 'contact_created' }],
            actions: [
              { type: 'create_task', config: { subject: `Call ${tag}` } },
              { type: 'delay', config: { amount: 3, unit: 'days' } },
              { type: 'create_task', config: { subject: `Second call ${tag}` } },
            ],
          },
        }),
      );
      const contact = await ok<{ id: string }>(
        request.post('/api/crm/contacts', { data: { firstName: 'Wanda', lastName: `W1${tag}`, email: `wanda-${tag}@w1.test` } }),
      );

      await page.goto(`/en/app/crm/workflows/${wf.id}`);
      const runs = page.getByTestId('workflow-runs');
      await expect(runs).toBeVisible(NAV);
      await expect(runs.getByRole('link', { name: `Wanda W1${tag}` })).toBeVisible();
      await expect(runs.locator('tr[data-status="waiting"]')).toHaveCount(1);
      // Inscripción: sin reinscripción, y un filtro se agrega y se quita.
      const enroll = page.getByTestId('workflow-enrollment').first();
      await expect(enroll.getByTestId('workflow-reenroll')).not.toBeChecked();
      await enroll.getByTestId('workflow-add-filter').click();
      await expect(enroll.getByTestId('workflow-filter')).toHaveCount(1);
      await expect(page.getByTestId('workflow-delay-amount')).toHaveValue('3');
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w1-workflow-${name}.png`, fullPage: true });
      await enroll.getByRole('button', { name: 'Remove filter 1' }).click();
      await expect(enroll.getByTestId('workflow-filter')).toHaveCount(0);

      // En el teléfono las tarjetas de asociaciones están en la pestaña Relacionado.
      await page.goto(`/en/app/crm/contacts/${contact.id}${name === '390' ? '?tab=related' : ''}`);
      const card = page.getByTestId('record-workflows');
      await expect(card).toBeVisible(NAV);
      await expect(card.getByRole('link', { name: `Follow up ${tag}` })).toBeVisible();
      await expect(card.locator('li[data-status="waiting"]')).toHaveCount(1);
      await card.scrollIntoViewIfNeeded();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w1-record-${name}.png`, fullPage: false });
    });

    test('asistente: disparador de empresa por propiedad y Rotar owner', async ({ page }) => {
      test.setTimeout(180_000);
      const tag = uid();
      await page.goto('/en/app/crm/workflows/new');
      const trigger = page.getByTestId('workflow-trigger').first();
      await expect(trigger).toBeVisible(NAV);
      await trigger.selectOption('company_updated');
      await page.getByTestId('workflow-trigger-field').fill('industry');
      await page.getByLabel('And the new value is').fill('Software');
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w1-wizard-trigger-${name}.png`, fullPage: true });
      await page.getByTestId('workflow-wizard-next').click();

      const action = page.getByTestId('workflow-action').first();
      await action.getByRole('combobox', { name: 'Action 1' }).selectOption('rotate_owner');
      // Sin nadie elegido no deja pasar.
      await page.getByTestId('workflow-wizard-next').click();
      await expect(page.getByTestId('workflow-create')).toHaveCount(0);
      await page.getByTestId('workflow-rotate-pool').getByRole('checkbox').first().check();
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w1-wizard-action-${name}.png`, fullPage: true });
      await page.getByTestId('workflow-wizard-next').click();
      await page.getByLabel('Workflow name').fill(`Rotate ${tag}`);
      await page.getByTestId('workflow-create').click();
      await expect(page).toHaveURL(/\/app\/crm\/workflows\/[0-9a-f-]{36}/, NAV);
      await expect(page.getByTestId('workflow-trigger-field')).toHaveValue('industry', NAV);
      await expect(page.getByTestId('workflow-rotate-pool').getByRole('checkbox').first()).toBeChecked();
    });
  });
}
