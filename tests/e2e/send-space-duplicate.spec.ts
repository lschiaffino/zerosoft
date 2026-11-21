import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Send: duplicar un espacio (el "Duplicate Space" de DocSend). La copia lleva los
 * documentos con su orden y carpetas, arranca sin links y queda en la lista.
 */
async function makeDoc(request: APIRequestContext, title: string): Promise<string> {
  const created = await request.post('/api/send/documents', { data: { title, file: { name: 'deck.pdf', mime: 'application/pdf', size: 1000 } } });
  expect(created.status()).toBe(201);
  return (await created.json()).document.id as string;
}

test('duplicar un espacio copia sus documentos y abre la copia', async ({ page, request }) => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const a = await makeDoc(request, `Deck ${suffix}`);
  const b = await makeDoc(request, `Model ${suffix}`);
  const { space } = await (await request.post('/api/send/spaces', { data: { title: `Seed ${suffix}` } })).json();
  const patched = await request.patch(`/api/send/spaces/${space.id}`, { data: { items: [{ documentId: b, folder: 'Finance' }, { documentId: a }] } });
  expect(patched.ok()).toBe(true);
  expect((await request.post(`/api/send/spaces/${space.id}/links`, { data: { name: 'Acme' } })).ok()).toBe(true);

  await page.goto(`/en/app/send/spaces/${space.id}`);
  await expect(page.getByTestId('send-space-item')).toHaveCount(2);

  // Esc cierra el diálogo sin duplicar.
  await page.getByTestId('send-space-duplicate').click();
  await expect(page.getByTestId('send-space-duplicate-title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('send-space-duplicate-dialog')).toBeHidden();

  await page.getByTestId('send-space-duplicate').click();
  const name = page.getByTestId('send-space-duplicate-title');
  await expect(name).toHaveValue(new RegExp(`Seed ${suffix}`));
  await name.fill(`Series A ${suffix}`);
  await name.press('Enter');

  await expect(page).not.toHaveURL(new RegExp(`/spaces/${space.id}$`));
  await expect(page.getByTestId('send-space-title-input')).toHaveValue(`Series A ${suffix}`);
  const items = page.getByTestId('send-space-item');
  await expect(items).toHaveCount(2);
  await expect(items.first().getByRole('textbox')).toHaveValue('Finance');
  await expect(items.first().getByRole('link')).toHaveAttribute('href', new RegExp(b));

  // La copia arranca sin links.
  await page.getByTestId('send-space-tab-links').click();
  await expect(page.getByTestId('send-link-row')).toHaveCount(0);

  await page.goto(`/en/app/send/spaces?q=${suffix}`);
  await expect(page.getByTestId('send-space-row')).toHaveCount(2);
});
