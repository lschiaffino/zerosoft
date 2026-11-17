import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Detalles del chat en Lines: guardar otra cosa (una etiqueta, "mantener archivado") devuelve el chat con
 * `properties` en un objeto nuevo. Eso no puede borrar lo que se está escribiendo en el nombre o la
 * descripción (pasaba lo mismo que con la paleta ⌘K y router.refresh()).
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function fakeGroup(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Drafts ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const res = (await (await request.post('/api/groups/create', { data: { numberId: id, name: `Drafts ${uid()}`, phones: [] } })).json()) as {
    results: Array<{ chatId: string }>;
  };
  return res.results[0].chatId;
}

for (const width of [1280, 390]) {
  test(`lo escrito en nombre y descripción sigue después de guardar otro campo (${width}px)`, async ({ page, request }) => {
    const chatId = await fakeGroup(request);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/en/app/lines/list/${chatId}`, { waitUntil: 'networkidle' });

    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    const description = page.getByRole('textbox', { name: 'Description', exact: true });
    await name.fill('Nombre a medio escribir');
    await description.fill('Descripción sin guardar');

    // Otro guardado del mismo chat mientras tanto.
    const saved = page.waitForResponse((r) => r.url().includes(`/api/groups/chats/${chatId}`) && r.request().method() === 'PATCH');
    await page.getByTestId('keep-archived').click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByTestId('keep-archived')).toBeChecked();

    await expect(name).toHaveValue('Nombre a medio escribir');
    await expect(description).toHaveValue('Descripción sin guardar');
  });
}
