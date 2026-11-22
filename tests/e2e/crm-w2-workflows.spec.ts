import { expect, test, type Page } from '@playwright/test';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Workflows del CRM (W2): la espera con sus cuatro tipos (un tiempo, hasta
 * una fecha, hasta un día y hora, hasta un evento con tope). Después de una
 * espera por evento, "Correr cuando" ofrece "Si pasó" / "Si se venció". El
 * registro queda esperando el evento y el registro por acción lo dice. En los
 * cinco aspectos, claro y oscuro, a 1280 y 390 px, sin scroll horizontal y
 * con toques de 40 px en el celular. Workspace propio.
 */
ownWorkspace('crm-w2');

const uid = () => Math.random().toString(36).slice(2, 8);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const NAV = { timeout: 45_000 };
const LOOKS = [
  ['current', 'light'],
  ['lines', 'dark'],
  ['classic', 'light'],
  ['liquid', 'dark'],
  ['retro', 'light'],
] as const;

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
  test.describe(`workflows W2 a ${name}px`, () => {
    test.use({ viewport, ...(name === '390' ? { hasTouch: true, isMobile: true } : {}) });

    test('la espera: hasta una fecha, un día y hora o un evento, con sus ramas', async ({ page, request }) => {
      test.setTimeout(300_000);
      const tag = uid();
      const wf = await ok<{ id: string }>(
        request.post('/api/crm/workflows', {
          data: {
            name: `Form follow-up ${tag}`,
            triggers: [{ type: 'contact_created' }],
            actions: [
              { type: 'delay', config: { mode: 'event', event: 'form_submitted', timeoutAmount: 3, timeoutUnit: 'days' } },
              { type: 'create_task', config: { subject: `Submitted ${tag}`, when: 'yes' } },
              { type: 'create_task', config: { subject: `No answer ${tag}`, when: 'no' } },
            ],
          },
        }),
      );
      await ok(request.post('/api/crm/contacts', { data: { firstName: 'Fede', lastName: `W2${tag}`, email: `fede-${tag}@w2.test` } }));

      await page.goto(`/en/app/crm/workflows/${wf.id}`);
      const wait = page.getByTestId('workflow-delay').first();
      await expect(wait).toBeVisible(NAV);
      await expect(page.getByTestId('workflow-delay-mode')).toHaveValue('event');
      await expect(page.getByTestId('workflow-delay-event')).toHaveValue('form_submitted');
      // Después de esperar un evento, las ramas se llaman "si pasó" y "si se venció".
      const second = page.getByTestId('workflow-action').nth(1);
      await expect(second.getByLabel('Run when').locator('option[value="yes"]')).toHaveText('If it happened');
      await expect(second.getByLabel('Run when').locator('option[value="no"]')).toHaveText('If time ran out');

      // El registro quedó esperando el evento; el registro por acción lo dice, sin fechas.
      const runs = page.getByTestId('workflow-runs');
      const row = runs.locator('tr[data-status="waiting"]');
      await expect(row).toHaveCount(1);
      await row.getByTestId('workflow-run-toggle').click();
      const log = page.getByTestId('workflow-run-log');
      await expect(log.locator('li[data-outcome="waited"]')).toContainText('Waiting for the event');
      await log.getByTestId('workflow-unenroll').focus();
      await page.keyboard.press('Escape');
      await expect(log).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w2-event-${name}.png`, fullPage: true });

      // Hasta una propiedad de fecha del registro, 2 días antes, a las 10:30.
      await page.getByTestId('workflow-delay-mode').selectOption('date');
      await expect(wait).toHaveAttribute('data-mode', 'date');
      await page.getByTestId('workflow-delay-field').fill('custom.renewal_date');
      await page.getByTestId('workflow-delay-offset').fill('2');
      await wait.getByLabel('Before or after').selectOption('before');
      await page.getByTestId('workflow-delay-time').fill('10:30');
      // Ya no hay espera por evento: "Correr cuando" vuelve a no aparecer.
      await expect(second.getByLabel('Run when')).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w2-date-${name}.png`, fullPage: true });

      // Hasta un día de la semana y hora: lunes y jueves.
      await page.getByTestId('workflow-delay-mode').selectOption('weekday');
      const days = page.getByTestId('workflow-delay-days');
      await days.getByLabel('Thursday').check();
      if (name === '390') {
        const box = await days.locator('label.ui-check').first().boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
      }
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/crm-w2-weekday-${name}.png`, fullPage: true });

      // Sin días no se guarda.
      await days.getByLabel('Monday').uncheck();
      await days.getByLabel('Thursday').uncheck();
      await page.getByTestId('workflow-save').click();
      await expect(days.locator('.ui-error')).toBeVisible();
      await days.getByLabel('Monday').check();
      const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/crm/workflows/${wf.id}`));
      await page.getByTestId('workflow-save').click();
      expect((await saved).status()).toBe(200);
      const after = await ok<{ actions: Array<{ type: string; config: Record<string, unknown> }> }>(request.get(`/api/crm/workflows/${wf.id}`));
      expect(after.actions[0].config).toMatchObject({ mode: 'weekday', days: [1], time: '09:00' });

      // Los cinco aspectos, claro y oscuro: el bloque de la espera se lee sobre su fondo.
      // El primero, guardado en el perfil y recargando; los demás, cambiando el atributo (next dev se queda sin memoria con tantas recargas).
      try {
        for (const [i, [look, theme]] of LOOKS.entries()) {
          await page.emulateMedia({ colorScheme: theme });
          if (i === 1) {
            expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
            await page.goto(`/en/app/crm/workflows/${wf.id}`);
          } else {
            await page.evaluate((l) => document.documentElement.setAttribute('data-look', l), look);
          }
          await expect(page.locator('html')).toHaveAttribute('data-look', look);
          const block = page.getByTestId('workflow-delay').first();
          await expect(block).toBeVisible(NAV);
          const colors = await block.locator('legend').first().evaluate((el) => {
            let node: Element | null = el;
            let bg = 'rgba(0, 0, 0, 0)';
            while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
              bg = getComputedStyle(node).backgroundColor;
              node = node.parentElement;
            }
            return { ink: getComputedStyle(el).color, bg };
          });
          expect(colors.ink, `${look} ${theme}`).not.toBe(colors.bg);
          await noHorizontalScroll(page);
          await block.screenshot({ path: `test-results/crm-w2-${look}-${theme}-${name}.png` });
        }
      } finally {
        await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
      }
    });
  });
}
