import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Editor de Track como el de Linear: la cita se cierra con Enter en una línea
 * vacía (lo que sigue queda afuera), `>>> ` crea una sección colapsable,
 * /callout un destacado, las menciones se leen con el nombre, la actividad
 * dice "set the estimate to 3" y la vista rápida (Espacio) muestra el issue
 * casi entero.
 */

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z]/g, 'Q');
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

type Team = { id: string; slug: string; name: string };
type Issue = { id: string; identifier: string; title: string; description: string };

const team = (request: APIRequestContext, name: string) => ok<Team>(request.post('/api/track/projects', { data: { name } }));

async function descriptionOf(request: APIRequestContext, id: string): Promise<string> {
  const issue = (await (await request.get(`/api/track/issues/${id}`)).json()) as Issue;
  try {
    const blocks = JSON.parse(issue.description) as Array<{ text?: string }>;
    return blocks.map((b) => b.text ?? '').join('\n');
  } catch {
    return issue.description;
  }
}

test.describe('Track: editor como Linear', () => {
  test('cita que se cierra con Enter Enter, colapsable con >>> y callout con /', async ({ page, request }) => {
    const t = await team(request, `Editor ${uid()}`);
    const issue = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Bloques del editor' } }));
    await page.goto(`/en/app/track/issues/${issue.id}`);
    const editor = page.getByTestId('track-issue-description');
    await editor.click();

    await page.keyboard.type('> una cita');
    await expect(editor.locator('blockquote')).toContainText('una cita');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('fuera');
    // "fuera" quedó después de la cita, no adentro.
    await expect(editor.locator('blockquote')).not.toContainText('fuera');
    await page.keyboard.press('Enter');

    await page.keyboard.type('>>> Detalles');
    await expect(editor.locator('[data-toggle-title]')).toHaveText('Detalles');
    await page.keyboard.press('Enter');
    await page.keyboard.type('oculto');
    await expect(editor.locator('[data-toggle-body]')).toContainText('oculto');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await page.keyboard.type('/callout');
    await expect(page.getByTestId('track-md-menu')).toContainText('Callout');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Ojo con esto');
    await expect(editor.locator('[data-callout]')).toContainText('Ojo con esto');
    await shot(page, 'tl2-editor-blocks');

    // Al salir del editor se guarda como markdown.
    await page.getByTestId('track-issue-title').click();
    await expect
      .poll(() => descriptionOf(request, issue.id))
      .toBe('> una cita\n\nfuera\n\n+++ Detalles\noculto\n+++\n\n> [!NOTE]\n> Ojo con esto');

    // Al volver, el colapsable carga cerrado y la flecha lo abre.
    await page.reload();
    const toggle = editor.locator('[data-toggle]');
    await expect(toggle).toHaveAttribute('data-open', 'false');
    await expect(editor.locator('[data-toggle-body]')).toBeHidden();
    const title = editor.locator('[data-toggle-title]');
    const box = await title.boundingBox();
    if (!box) throw new Error('sin título');
    await page.mouse.click(box.x + 6, box.y + box.height / 2);
    await expect(toggle).toHaveAttribute('data-open', 'true');
    await expect(editor.locator('[data-toggle-body]')).toContainText('oculto');
  });

  test('mención en un comentario: se lee como chip con el nombre', async ({ page, request }) => {
    const t = await team(request, `Mencion ${uid()}`);
    const issue = await ok<Issue>(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Con mención' } }));
    await page.goto(`/en/app/track/issues/${issue.id}`);
    const composer = page.getByTestId('track-comment-input');
    await composer.click();
    await page.keyboard.type('Mirá esto @demo');
    await expect(page.getByTestId('track-md-menu')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(composer.locator('.track-chip-mention')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Enter');
    const comment = page.getByTestId('track-comment').filter({ hasText: 'Mirá esto' });
    const mention = comment.locator('.track-mention');
    await expect(mention).toBeVisible();
    await expect(mention).not.toHaveText(/@demo@/);
    await expect(mention).toHaveText(/^@\S/);
    await shot(page, 'tl2-mention');
  });

  test('actividad sin "from" vacío y vista rápida con descripción y comentarios', async ({ page, request }) => {
    const t = await team(request, `Peek ${uid()}`);
    const issue = await ok<Issue>(
      request.post(`/api/track/projects/${t.id}/issues`, {
        data: { title: 'Peek completo', description: [{ type: 'text', text: 'Texto **visible** en la vista rápida' }] },
      }),
    );
    await ok(request.post(`/api/track/projects/${t.id}/issues`, { data: { title: 'Hijo del peek', parentId: issue.id } }));
    await ok(request.post(`/api/track/issues/${issue.id}/comments`, { data: { body: 'Un comentario reciente' } }));
    const patched = await request.patch(`/api/track/issues/${issue.id}`, { data: { estimate: 3 } });
    expect(patched.ok()).toBeTruthy();

    await page.goto(`/en/app/track/issues/${issue.id}`);
    await expect(page.getByText(/set the estimate to 3/)).toBeVisible();
    await expect(page.getByText(/changed estimate from\s+to/)).toHaveCount(0);

    await page.goto(`/en/app/track/team/${t.slug.toUpperCase()}`);
    const row = page.locator(`[data-issue-key="${issue.id}"]`).first();
    await row.hover();
    await page.keyboard.press(' ');
    const peek = page.getByTestId('track-peek');
    await expect(peek.locator('strong', { hasText: 'visible' })).toBeVisible();
    await expect(peek).toContainText('Hijo del peek');
    await expect(peek).toContainText('Un comentario reciente');
    await shot(page, 'tl2-peek');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/app/track/(issues/${issue.id}|issue/${issue.identifier})`));
  });
});
