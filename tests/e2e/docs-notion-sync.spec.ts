import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Docs ↔ Notion en dos vías contra el Notion falso (NOTION_IMPORT_FAKE=1,
 * token fake-notion-sync-*): conectar con el token de una integración
 * interna desde Ajustes › Integraciones, ver el import con su progreso,
 * abrir lo importado, y una edición de ida y vuelta (Notion → Docs y
 * Docs → Notion) con "Sincronizar ahora".
 */

const uid = () => Math.random().toString(36).slice(2, 8);
type Block = { id: string; type: string; content: string };

async function fake(request: APIRequestContext, token: string, method: string, path: string, body?: unknown) {
  const res = await request.post('/api/docs/notion/fake', { data: { token, method, path, body } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

const textOf = (b: { type: string; [k: string]: unknown }) => ((b[b.type] as { rich_text?: Array<{ plain_text: string }> }).rich_text ?? []).map((r) => r.plain_text).join('');

test('Notion: conectar con token, importar y editar de ida y vuelta', async ({ page, request }) => {
  test.setTimeout(180_000);
  const token = `fake-notion-sync-e2e-${uid()}`;
  // Otro spec (o un reintento) pudo dejar una conexión: se empieza de cero.
  await request.delete('/api/docs/notion');

  await page.goto('/en/app/docs/settings?tab=integrations', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('notion-sync-disconnected')).toBeVisible();
  // Token inválido: error claro, nada se conecta.
  await page.getByLabel('Internal integration token').fill('secret_wrong');
  await page.getByTestId('notion-sync-connect').click();
  // El anunciador de rutas de Next también es role=alert: se busca el aviso por su texto.
  await expect(page.getByRole('alert').filter({ hasText: 'Notion did not accept that token' })).toBeVisible();

  await page.getByLabel('Internal integration token').fill(token);
  await page.getByTestId('notion-sync-connect').click();
  // La pantalla empuja el import hasta terminar.
  await expect(page.getByTestId('notion-sync-state')).toHaveAttribute('data-status', 'live', { timeout: 90_000 });
  await expect(page.getByTestId('notion-sync-roots')).toContainText('Team wiki');
  await expect(page.getByTestId('notion-sync-log')).toContainText('Initial import finished');
  await expect(page.locator('body')).not.toContainText(token);

  // Lo importado: se encuentra y se abre.
  const found = (await (await request.get('/api/docs/search?q=Team%20wiki')).json()) as { rows: Array<{ id: string; title: string }> };
  const hit = found.rows.find((p) => p.title === 'Team wiki');
  expect(hit).toBeTruthy();
  await page.goto(`/en/app/docs/${hit!.id}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.docs-blocks')).toContainText('Ask in the team channel.');
  await expect(page.locator('.docs-blocks')).toContainText('npm run dev');

  // Notion → Docs: una persona edita el to-do en Notion.
  const kids = (await fake(request, token, 'GET', '/blocks/5a000000-0000-4000-8000-000000000001/children')) as { results: Array<{ id: string; type: string; [k: string]: unknown }> };
  const todo = kids.results.find((k) => k.type === 'to_do')!;
  await fake(request, token, 'PATCH', `/blocks/${todo.id}`, { to_do: { rich_text: [{ type: 'text', text: { content: 'Sign the guide this week' } }], checked: true } });
  await page.goto('/en/app/docs/settings?tab=integrations', { waitUntil: 'networkidle' });
  await page.getByTestId('notion-sync-now').click();
  await expect(page.getByRole('status').filter({ hasText: /Synced|already running/ })).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => {
      await request.post('/api/docs/notion/sync');
      const doc = (await (await request.get(`/api/docs/pages/${hit!.id}`)).json()) as { content: Block[] };
      return doc.content.some((b) => b.type === 'todo' && b.content === 'Sign the guide this week');
    }, { timeout: 60_000 })
    .toBe(true);

  // Docs → Notion: escribir en el editor y sincronizar.
  await page.goto(`/en/app/docs/${hit!.id}`, { waitUntil: 'networkidle' });
  const line = `Written in Docs ${uid()}`;
  await page.locator('.docs-blocks .docs-editable', { hasText: 'Ask in the team channel.' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(line);
  await expect(page.getByTestId('docs-save-status')).toHaveText('Saved', { timeout: 20_000 });
  await expect
    .poll(async () => {
      await request.post('/api/docs/notion/sync');
      const all = (await fake(request, token, 'GET', '/blocks/5a000000-0000-4000-8000-000000000001/children')) as { results: Array<{ id: string; type: string; has_children: boolean; [k: string]: unknown }> };
      const texts = all.results.map(textOf);
      for (const b of all.results.filter((x) => x.has_children)) {
        const sub = (await fake(request, token, 'GET', `/blocks/${b.id}/children`)) as { results: Array<{ type: string; [k: string]: unknown }> };
        texts.push(...sub.results.map(textOf));
      }
      return texts.includes(line);
    }, { timeout: 60_000 })
    .toBe(true);

  // Pausar y desconectar desde la pantalla (Esc cierra el diálogo; Enter confirma).
  await page.goto('/en/app/docs/settings?tab=integrations', { waitUntil: 'networkidle' });
  await page.getByTestId('notion-sync-pause').click();
  await expect(page.getByTestId('notion-sync-state')).toHaveAttribute('data-status', 'paused');
  await page.getByTestId('notion-sync-disconnect').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByTestId('notion-sync-disconnect').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByTestId('notion-sync-disconnected')).toBeVisible();
  // Lo importado queda en Docs.
  expect((await request.get(`/api/docs/pages/${hit!.id}`)).ok()).toBeTruthy();
});

test('Notion: a 390 px la pantalla no tiene scroll horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/docs/settings?tab=integrations', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Notion' }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
