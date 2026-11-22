import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ownWorkspace } from './helpers/own-workspace';
import { setTheme } from './responsive-audit';

/**
 * Tareas del CRM (A3): el listado como tabla con vistas, filtros, orden y
 * edición en masa; las colas con nombre (crear, poner tareas, empezar la cola
 * desde la vista) y el recordatorio. A 1280 y a 390, sin scroll lateral, el
 * panel de colas cierra con Esc y con un clic afuera, y la tabla se lee en los
 * cinco aspectos, claro y oscuro. Datos propios en un workspace propio.
 */
ownWorkspace('crm-a3');

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

async function seed(request: APIRequestContext, tag: string) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 15:00`;
  };
  const call = await ok<{ id: string }>(
    request.post('/api/crm/activities', { data: { type: 'task', taskKind: 'call', subject: `Call ${tag}`, dueAt: at(-2), priority: 'high' } }),
  );
  const email = await ok<{ id: string }>(
    request.post('/api/crm/activities', { data: { type: 'task', taskKind: 'email', subject: `Email ${tag}`, dueAt: at(3) } }),
  );
  const todo = await ok<{ id: string }>(request.post('/api/crm/activities', { data: { type: 'task', subject: `Todo ${tag}`, dueAt: at(5) } }));
  return { call, email, todo };
}

const row = (page: Page, subject: string) => page.getByTestId('crm-task-row').filter({ has: page.getByRole('link', { name: subject, exact: true }) });

for (const [name, viewport] of [['1280', DESKTOP], ['390', PHONE]] as const) {
  test.describe(`tareas a ${name}px`, () => {
    test.use({ viewport, ...(name === '390' ? { hasTouch: true, isMobile: true } : {}) });

    test('tabla con vistas, filtros, colas, edición en masa y recordatorio', async ({ page, request }) => {
      test.setTimeout(240_000);
      const tag = uid();
      await seed(request, tag);

      await page.goto('/en/app/crm/tasks');
      await expect(page.getByTestId('view-tab-all')).toHaveClass(/active/, NAV);
      await expect(row(page, `Call ${tag}`)).toBeVisible(NAV);
      await expect(row(page, `Email ${tag}`)).toBeVisible();
      await expect(row(page, `Todo ${tag}`)).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: test.info().outputPath(`a3-tasks-${name}.png`) });

      // Vista Vencidas (link de antes con ?bucket=): solo la llamada vencida.
      await page.goto('/en/app/crm/tasks?bucket=overdue');
      await expect(row(page, `Call ${tag}`)).toBeVisible(NAV);
      await expect(row(page, `Email ${tag}`)).toHaveCount(0);
      await page.goto('/en/app/crm/tasks');
      await expect(row(page, `Email ${tag}`)).toBeVisible(NAV);

      // Filtro por tipo y limpiar.
      await page.getByTestId('task-filter-type').selectOption('email');
      await expect(page).toHaveURL(/type=email/, NAV);
      await expect(row(page, `Email ${tag}`)).toBeVisible(NAV);
      await expect(row(page, `Call ${tag}`)).toHaveCount(0);
      await page.getByTestId('task-filters-clear').click();
      await expect(row(page, `Call ${tag}`)).toBeVisible(NAV);

      // Orden por vencimiento: el encabezado lo dice.
      if (name === '1280') {
        await page.getByTestId('task-sort-due').click();
        await expect(page).toHaveURL(/sort=-due/, NAV);
        await expect(page.locator('th[aria-sort="descending"]')).toHaveCount(1);
        await page.goto('/en/app/crm/tasks');
      }

      // Colas: el panel cierra con Esc y, en la compu, con un clic afuera.
      const queueName = `Morning ${tag}`;
      await page.getByTestId('task-queues-manage').click();
      const dialog = page.getByTestId('task-queues-dialog');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      if (name === '1280') {
        // En el teléfono el panel ocupa la pantalla entera: no hay "afuera".
        await page.getByTestId('task-queues-manage').click();
        await expect(dialog).toBeVisible();
        await page.mouse.click(5, viewport.height / 2);
        await expect(dialog).toBeHidden();
      }
      await page.getByTestId('task-queues-manage').click();
      await dialog.getByTestId('task-queue-name').fill(queueName);
      await dialog.getByTestId('task-queue-create').click();
      await expect(dialog.getByTestId('task-queue-item').filter({ hasText: queueName })).toBeVisible(NAV);
      await noHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // Elegir dos tareas y ponerlas en la cola.
      await row(page, `Call ${tag}`).getByRole('checkbox').check();
      await row(page, `Email ${tag}`).getByRole('checkbox').check();
      const bar = page.getByTestId('task-bulk-bar');
      await expect(bar).toBeVisible();
      await bar.getByLabel('Property to edit').selectOption('queueId');
      await bar.getByLabel('Value', { exact: true }).selectOption({ label: queueName });
      await bar.getByRole('button', { name: 'Apply' }).click();
      await expect(page.getByTestId('task-bulk-notice')).toContainText('2', NAV);
      await expect(row(page, `Call ${tag}`).getByText(queueName).first()).toBeAttached(NAV);

      // Filtrar por la cola y empezar la cola con lo que muestra la vista.
      await page.getByTestId('task-filter-queue').selectOption({ label: queueName });
      await expect(page).toHaveURL(/queue=/, NAV);
      await expect(row(page, `Todo ${tag}`)).toHaveCount(0, NAV);
      await page.getByTestId('start-view-queue').click();
      await expect(page).toHaveURL(/\/app\/crm\/tasks\/queue\?.*queue=/, NAV);
      await expect(page.getByTestId('queue-counter')).toContainText('of 2', NAV);
      await noHorizontalScroll(page);
      await page.goto('/en/app/crm/tasks');

      // Completar en masa: salen de las abiertas y aparecen en Completadas.
      await row(page, `Call ${tag}`).getByRole('checkbox').check();
      await row(page, `Todo ${tag}`).getByRole('checkbox').check();
      await page.getByTestId('task-bulk-complete').click();
      await expect(row(page, `Call ${tag}`)).toHaveCount(0, NAV);
      await expect(row(page, `Todo ${tag}`)).toHaveCount(0);
      await page.goto('/en/app/crm/tasks?sv=done');
      await expect(row(page, `Call ${tag}`)).toBeVisible(NAV);

      // Recordatorio desde el composer: se ve en la fila y en la ficha.
      await page.goto('/en/app/crm/tasks');
      await expect(row(page, `Email ${tag}`)).toBeVisible(NAV);
      await page.getByTestId('crm-quick-task').click();
      await page.getByRole('textbox', { name: 'Subject' }).fill(`Remind ${tag}`);
      await page.getByLabel('Due date', { exact: true }).fill('2031-01-04T09:00');
      await page.getByTestId('task-reminder').selectOption('1h');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      const reminded = row(page, `Remind ${tag}`);
      await expect(reminded).toBeVisible(NAV);
      await expect(reminded.getByTestId('task-reminder-label')).toBeAttached();
      await reminded.getByRole('link', { name: `Remind ${tag}`, exact: true }).click();
      await expect(page.locator('.prop-row[data-prop="reminderAt"]')).toBeVisible(NAV);
      await expect(page.locator('.prop-row[data-prop="queueId"]')).toBeVisible();
      await noHorizontalScroll(page);
    });
  });
}

test('el check de la fila es un círculo de 22px; en el teléfono se toca en 40px', async ({ page, request }) => {
  test.setTimeout(180_000);
  const subject = `Send the proposal with the updated pricing table and the onboarding plan for the second quarter ${uid()}`;
  await ok(request.post('/api/crm/activities', { data: { type: 'task', subject } }));
  for (const [name, viewport] of [['1280', DESKTOP], ['390', PHONE]] as const) {
    await page.setViewportSize(viewport);
    await page.goto('/en/app/crm/tasks', { waitUntil: 'networkidle' });
    const check = row(page, subject).getByRole('button', { name: 'Complete' });
    await expect(check).toBeVisible(NAV);
    // clientWidth/Height es el círculo que se ve (sin el borde transparente del área táctil).
    const box = await check.evaluate((el: HTMLElement) => ({ w: el.clientWidth, h: el.clientHeight, ow: el.offsetWidth, oh: el.offsetHeight }));
    // Un título largo de varias líneas no aplasta el círculo.
    expect(box.w, name).toBeGreaterThanOrEqual(16);
    expect(box.w, name).toBe(box.h);
    expect(box.w, name).toBeLessThanOrEqual(24);
    if (name === '390') {
      expect(box.ow).toBeGreaterThanOrEqual(40);
      expect(box.oh).toBeGreaterThanOrEqual(40);
    }
  }
});

test('la tabla de tareas se lee en los cinco aspectos, claro y oscuro', async ({ page, request, context }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(DESKTOP);
  const tag = uid();
  await seed(request, tag);
  const baseURL = test.info().project.use.baseURL as string;
  try {
    for (const look of ['current', 'lines', 'classic', 'liquid', 'retro'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
        await setTheme(context, baseURL, theme);
        await page.goto('/en/app/crm/tasks', { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        const subject = row(page, `Call ${tag}`).getByRole('link', { name: `Call ${tag}`, exact: true });
        await expect(subject).toBeVisible(NAV);
        const colors = await subject.evaluate((el) => {
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
        await page.getByTestId('task-table').screenshot({ path: test.info().outputPath(`a3-${look}-${theme}.png`) });
      }
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
  }
});
