import { expect, test, type Page } from '@playwright/test';

/**
 * Pedidos al asistente con link (modelo falso, ASSISTANT_FAKE=1): la persona
 * pide algo que el producto no hace, el asistente lo anota y comparte el link
 * al pedido; el aviso debajo de la respuesta lleva a la misma página. Después
 * "¿dónde está mi pedido?" vuelve a dar el link, y Ajustes › Mis pedidos lo
 * lista. A 1280 y 390 px, sin scroll de costado.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, label).toBeLessThanOrEqual(0);
}

test('pedir algo: link al pedido, la página del pedido, "¿dónde está mi pedido?" y Mis pedidos', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  const word = `Zq${uid()}`;

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  await input.fill(`I want to export ${word} boards to slides`);
  await input.press('Enter');

  const reply = panel.getByTestId('assistant-msg-assistant').last();
  await expect(reply.getByTestId('assistant-activity')).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
  // La respuesta comparte el link, y el aviso de abajo es un link a la misma página.
  const inReply = reply.getByRole('link', { name: 'See your request' });
  await expect(inReply).toHaveAttribute('href', /^\/en\/app\/settings\/requests\/[^/]+$/);
  const note = reply.getByTestId('assistant-request-link');
  await expect(note).toContainText(word);
  const href = (await note.getAttribute('href'))!;
  expect(await inReply.getAttribute('href')).toBe(href);
  const id = href.split('/').pop()!;

  // Más tarde: "¿dónde está mi pedido?" da el link otra vez.
  await input.fill('Where is my request? Give me the link to my request');
  await input.press('Enter');
  const later = panel.getByTestId('assistant-msg-assistant').last();
  await expect(later.getByTestId('assistant-activity')).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
  await expect(later.locator(`a[href="${href}"]`).first()).toBeVisible();

  await note.click();
  await expect(page).toHaveURL(new RegExp(`/en/app/settings/requests/${id}$`));
  const pageEl = page.getByTestId('request-page');
  await expect(pageEl).toBeVisible();
  await expect(pageEl).toHaveAttribute('data-stage', 'received');
  await expect(pageEl.getByRole('heading', { level: 2 })).toContainText(word);
  await expect(page.getByTestId('request-words')).toContainText(word);
  // Mis pedidos queda marcado en la nav de Ajustes.
  const nav = page.getByRole('navigation', { name: 'Settings' });
  await expect(nav.getByRole('link', { name: 'My requests', exact: true })).toHaveAttribute('aria-current', 'page');
  await noHorizontalScroll(page, 'request 1280');

  await pageEl.getByRole('link', { name: 'My requests' }).click();
  await expect(page).toHaveURL(/\/en\/app\/settings\/requests$/);
  const row = page.locator(`[data-testid="my-request-row"][data-id="${id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(word);
  await noHorizontalScroll(page, 'list 1280');

  // Un id que no es suyo (o no existe): 404.
  const missing = await page.goto(`/en/app/settings/requests/missing-${uid()}`);
  expect(missing?.status()).toBe(404);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/settings/requests', { waitUntil: 'load' });
  await expect(page.locator(`[data-testid="my-request-row"][data-id="${id}"]`)).toBeVisible();
  await noHorizontalScroll(page, 'list 390');
  await page.goto(`/en/app/settings/requests/${id}`, { waitUntil: 'load' });
  await expect(page.getByTestId('request-page')).toBeVisible();
  await noHorizontalScroll(page, 'request 390');

  expect(errors).toEqual([]);
});
