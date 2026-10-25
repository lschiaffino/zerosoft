import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Regresiones de los bugs del benchmark (docs/benchmark/track.md, cal.md,
 * link.md, "Bugs encontrados").
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Status = { id: string; category: string; position: number };

async function trackProject(request: APIRequestContext) {
  const project = await ok<{ id: string }>(request.post('/api/track/projects', { data: { name: `Bench ${uid()}` } }));
  const res = await request.get(`/api/track/projects/${project.id}/statuses`);
  const statuses = ((await res.json()) as { rows?: Status[] } | Status[]);
  const rows = Array.isArray(statuses) ? statuses : (statuses.rows ?? []);
  return { id: project.id, statuses: rows };
}

test.describe('Track', () => {
  test('con orden Newest, el issue creado con C aparece primero sin recargar', async ({ page, request }) => {
    const p = await trackProject(request);
    const todo = p.statuses.find((s) => s.category === 'todo')!;
    for (const n of [1, 2]) {
      await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: `Viejo ${n}`, statusId: todo.id } }));
    }
    await page.goto(`/en/app/track/team/${p.id}`);
    await expect(page.locator('tr[data-issue-row]', { hasText: 'Viejo 1' })).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('c');
    const title = `Nuevo ${uid()}`;
    await page.getByRole('textbox', { name: 'Issue title' }).fill(title);
    await page.keyboard.press('ControlOrMeta+Enter');
    const rows = page.locator('tbody tr');
    await expect(rows.filter({ hasText: title })).toHaveCount(1);
    await expect(page.locator('tr[data-issue-row]', { hasText: title })).toBeVisible();
    const texts = await rows.allInnerTexts();
    const at = (s: string) => texts.findIndex((t) => t.includes(s));
    expect(at(title)).toBeLessThan(at('Viejo 2'));
    expect(at('Viejo 2')).toBeLessThan(at('Viejo 1'));
    await shot(page, 'track_newest_first');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`la vista activa se lee al pasar el mouse (${scheme})`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const p = await trackProject(request);
      await ok(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Uno' } }));
      await page.goto(`/en/app/track/team/${p.id}`);
      for (const view of ['board', 'gantt']) {
        const btn = page.getByTestId(`track-view-${view}`);
        await btn.click();
        await expect(btn).toHaveAttribute('aria-pressed', 'true');
        await btn.hover();
        await page.waitForTimeout(250);
        const { color, bg } = await btn.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { color: cs.color, bg: cs.backgroundColor };
        });
        expect(color).not.toBe(bg);
        // Sigue siendo la placa de tinta: el fondo no es el gris claro/oscuro del hover común.
        expect(bg).not.toBe(scheme === 'light' ? 'rgb(245, 245, 245)' : 'rgb(29, 28, 26)');
      }
      await shot(page, `track_view_hover_${scheme}`);
    });
  }

  test('la página del issue copia el link y borra con confirmación (menú y ⌘⌫)', async ({ page, request, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = await trackProject(request);
    const a = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Para borrar' } }));
    const b = await ok<{ id: string; identifier: string }>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Por teclado' } }));

    await page.goto(`/en/app/track/issues/${a.id}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByTestId('track-copy-link')).toBeVisible();
    await shot(page, 'track_issue_menu');
    await page.getByTestId('track-copy-link').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/app/track/issues/${a.id}`);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId('track-issue-delete').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(`Delete ${a.identifier}?`);
    await page.waitForTimeout(300);
    await shot(page, 'track_issue_delete_confirm');
    await dialog.getByTestId('confirm-dialog-confirm').click();
    await expect(page).toHaveURL(new RegExp(`/app/track/team/${p.id}`));
    // Borrar deja "Deshacer" unos segundos (como Linear) y después borra de verdad.
    await expect(page.getByTestId('track-undo-toast')).toContainText(a.identifier);
    await expect.poll(async () => (await request.get(`/api/track/issues/${a.id}`)).status(), { timeout: 15_000 }).toBe(404);

    // Atajo: ⌘⌫ abre la misma confirmación; Esc la cancela.
    await page.goto(`/en/app/track/issues/${b.id}`);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ControlOrMeta+Backspace');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeHidden();
    expect((await request.get(`/api/track/issues/${b.id}`)).status()).toBe(200);
  });

  test('la fecha de inicio se edita en el panel de propiedades', async ({ page, request }) => {
    const p = await trackProject(request);
    const issue = await ok<{ id: string }>(request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Con inicio' } }));
    await page.goto(`/en/app/track/issues/${issue.id}`);
    const start = page.getByTestId('track-property-start');
    await expect(start).toContainText('Start');
    await start.getByRole('button').click();
    await page.getByRole('menuitem', { name: /Tomorrow/ }).click();
    await expect
      .poll(async () => ((await (await request.get(`/api/track/issues/${issue.id}`)).json()) as { start_date: string | null }).start_date)
      .not.toBeNull();
    await shot(page, 'track_issue_start_date');
  });

  test('C y la API sin statusId usan el mismo status por defecto', async ({ page, request }) => {
    const p = await trackProject(request);
    const viaApi = await ok<{ status_category: string; status_id: string }>(
      request.post(`/api/track/projects/${p.id}/issues`, { data: { title: 'Por API' } }),
    );
    expect(viaApi.status_category).toBe('todo');
    await page.goto(`/en/app/track/team/${p.id}`);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('c');
    await expect(page.getByRole('textbox', { name: 'Issue title' })).toBeVisible();
    const select = page.getByRole('dialog').locator('select').first();
    await expect(select).toHaveValue(viaApi.status_id);
  });
});

test.describe('Cal', () => {
  async function booking(request: APIRequestContext, guest: string, hour: number) {
    const key = (await (await request.post('/api/keys', { data: { name: `e2e ${uid()}` } })).json()).key as string;
    const et = await ok<{ id: string }>(
      request.post('/api/calendar/event-types', { data: { slug: `bf-${uid()}`, title: 'Bench call', durationMin: 30, active: true } }),
    );
    const rules = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));
    await request.post(`/api/calendar/event-types/${et.id}/availability`, { data: { rules } });
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const email = `${guest.toLowerCase()}@example.com`;
    await ok(
      request.post('/api/v1/calendar/bookings', {
        headers: { authorization: `Bearer ${key}` },
        data: { eventTypeId: et.id, start: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, name: guest, email },
      }),
    );
    return { email };
  }

  test('Analytics: breadcrumb y campos de fecha a la altura de los botones', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app/calendar/analytics');
    await expect(page.locator('.band-section-name')).toHaveText('Analytics');
    for (const id of ['#cal-an-from', '#cal-an-to']) {
      const box = await page.locator(id).boundingBox();
      expect(box!.height).toBeLessThan(50);
    }
    await shot(page, 'cal_analytics');
  });

  test('Bookings: la hora de inicio entra en una línea', async ({ page, request }) => {
    await booking(request, `Hora${uid()}`, 10);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app/calendar/bookings');
    const time = page.locator('.cal-bk-time').first();
    await expect(time).toBeVisible();
    const lines = await time.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el.firstChild!);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(lines).toBe(1);
    await shot(page, 'cal_bookings_time');
  });

  test('⌘K encuentra una reserva por nombre del invitado', async ({ page, request }) => {
    const guest = `Invitada${uid()}`;
    const { email } = await booking(request, guest, 14);
    await page.goto('/en/app/calendar', { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill(guest);
    // La reserva también crea el contacto en CRM: se elige la fila de Bookings (meta con el tipo de evento).
    const option = dialog.getByRole('option', { name: new RegExp(`${guest}.*Bench call`) });
    await expect(option).toBeVisible();
    await expect(page.locator('.cmdk-group', { hasText: 'Bookings' })).toBeVisible();
    await shot(page, 'cal_cmdk_booking');
    await option.click();
    await expect(page).toHaveURL(new RegExp(`/app/calendar/bookings\\?q=${encodeURIComponent(email).replace(/\./g, '\\.')}`));
    await expect(page.getByText(guest).first()).toBeVisible();
  });
});

test.describe('Link', () => {
  test('el detalle con un título largo no hace scroll horizontal a 390px', async ({ page, request }) => {
    const slug = `linkbench${uid()}`;
    const link = await ok<{ id: string }>(request.post('/api/links', { data: { url: 'https://example.com/uno', slug } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/en/app/links/${link.id}`);
    await expect(page.locator('.ui-page-title')).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await shot(page, 'link_detail_390');
  });

  test('en la lista, "/" enfoca la búsqueda y "?" muestra los atajos', async ({ page, request }) => {
    await ok(request.post('/api/links', { data: { url: 'https://example.com/atajos' } }));
    await page.goto('/en/app/links');
    const search = page.getByRole('searchbox', { name: 'Search links' });
    await expect(search).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(search).not.toBeFocused();

    await page.keyboard.press('Shift+?');
    const help = page.getByTestId('links-shortcuts');
    await expect(help).toBeVisible();
    await expect(help).toContainText('Keyboard shortcuts');
    await expect(help).toContainText('Search links');
    await shot(page, 'link_shortcuts_help');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
  });
});
