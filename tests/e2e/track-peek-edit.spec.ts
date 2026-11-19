import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Track: la vista rápida (Espacio sobre una fila) edita estado, prioridad y
 * asignado con los mismos menús que el issue. La fila de atrás cambia sin
 * recargar, la actividad lo cuenta, Esc cierra primero el menú y después la
 * vista, y un clic afuera cierra el menú sin cerrar la vista. En 1280 y 390.
 */

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z]/g, 'Q');
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Team = { id: string; slug: string };
type Issue = { id: string; identifier: string; priority: string; status_name: string | null; assignee_id: string | null };

const issueOf = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/track/issues/${id}`)).json()) as Issue;

for (const vp of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test(`vista rápida editable (${vp.width}): prioridad, estado y asignado en el lugar`, async ({ page, request }) => {
    test.slow();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const t = await ok<Team>(request.post('/api/track/projects', { data: { name: `Peek edit ${uid()}` } }));
    const title = `Editable en la vista rápida ${uid()}`;
    const issue = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title, priority: 'low' } }));

    await page.goto(`/en/app/track/team/${t.slug.toUpperCase()}`);
    const row = page.locator(`tr[data-issue-key="${issue.id}"]`);
    await expect(row).toContainText(title, { timeout: 30_000 });
    await row.hover();
    await page.keyboard.press(' ');
    const peek = page.getByTestId('track-peek');
    await expect(peek).toContainText(title, { timeout: 30_000 });
    const palette = page.locator('.cmdk');

    // Prioridad desde el chip: el menú se abre, se elige con el mouse y la vista sigue abierta.
    const priorityChip = peek.getByTestId('track-side-priority').getByRole('button');
    await expect(priorityChip).toHaveAccessibleName(/Priority: Low/);
    await priorityChip.click();
    await expect(palette).toBeVisible();
    await shot(page, `peek-edit-${vp.name}-priority-menu`);
    await palette.getByRole('option', { name: /^Urgent/ }).click();
    await expect(palette).toBeHidden();
    await expect(peek).toBeVisible();
    await expect(priorityChip).toHaveAccessibleName(/Priority: Urgent/);
    // La fila de atrás, sin recargar.
    await expect(row.locator('.track-col-priority [aria-label]').first()).toHaveAttribute('aria-label', /Urgent/);

    // Estado con el atajo S (la vista rápida tiene el foco): mismo menú, anclado al chip en desktop.
    await peek.locator('.track-peek-title').click();
    await page.keyboard.press('s');
    await expect(palette).toBeVisible();
    await page.keyboard.type('progress');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(peek).toBeVisible();
    await expect(peek.getByTestId('track-side-status')).toContainText('In progress');
    await expect(row.locator('.track-col-status [aria-label]').first()).toHaveAttribute('aria-label', /In progress/);

    // Asignado desde el chip.
    await peek.getByTestId('track-side-assignee').getByRole('button').click();
    await expect(palette).toBeVisible();
    await page.keyboard.type('Demo');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(peek.getByTestId('track-side-assignee')).toContainText('Demo');
    await expect.poll(async () => (await issueOf(request, issue.id)).assignee_id, { timeout: 20_000 }).not.toBeNull();

    // La actividad de la vista rápida cuenta los cambios.
    await expect(peek.getByTestId('track-peek-activity')).toContainText('Urgent');
    await expect(peek.getByTestId('track-peek-activity')).toContainText('In progress');
    await shot(page, `peek-edit-${vp.name}-after`);
    if (SHOTS) {
      // Capturas de los cinco aspectos, claro y oscuro (solo para mirarlas).
      for (const look of ['current', 'lines', 'classic', 'liquid', 'retro']) {
        for (const theme of ['light', 'dark']) {
          await page.evaluate(([l, th]) => {
            document.documentElement.dataset.look = l;
            document.documentElement.dataset.theme = th;
          }, [look, theme]);
          await shot(page, `peek-edit-${vp.name}-${look}-${theme}`);
        }
      }
      await page.evaluate(() => {
        delete document.documentElement.dataset.look;
        delete document.documentElement.dataset.theme;
      });
    }

    // Clic afuera del menú: cierra el menú, la vista queda.
    await peek.getByTestId('track-side-priority').getByRole('button').click();
    await expect(palette).toBeVisible();
    const box = await palette.boundingBox();
    expect(box).not.toBeNull();
    // Debajo del menú si entra; si no, a su izquierda (siempre dentro de la ventana y fuera del menú).
    const below = box!.y + box!.height + 24;
    await page.mouse.click(Math.min(box!.x + 8, vp.width - 8), below < vp.height - 8 ? below : vp.height - 8);
    await expect(palette).toBeHidden();
    await expect(peek).toBeVisible();

    // Esc: primero el menú, después la vista.
    await peek.getByTestId('track-side-status').getByRole('button').click();
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(peek).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(peek).toBeHidden();

    // Sin scroll de costado.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Guardado: la recarga y la API lo confirman.
    await expect.poll(async () => {
      const saved = await issueOf(request, issue.id);
      return [saved.priority, saved.status_name];
    }, { timeout: 45_000 }).toEqual(['urgent', 'In progress']);
    await page.reload();
    await expect(row.locator('.track-col-priority [aria-label]').first()).toHaveAttribute('aria-label', /Urgent/);
    await expect(row.locator('.track-col-status [aria-label]').first()).toHaveAttribute('aria-label', /In progress/);
  });
}
