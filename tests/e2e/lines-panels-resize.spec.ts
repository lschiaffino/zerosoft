import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Lines: los paneles de la bandeja cambian de ancho arrastrando los divisores
 * (lista | conversación | detalles). El ancho queda guardado en el navegador,
 * se vuelve al original con doble clic o Enter, se maneja con el teclado, y en
 * ventanas chicas los divisores que no aplican desaparecen.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

const uid = () => Math.random().toString(36).slice(2, 8);

/** Un número falso conectado con un chat. Devuelve el nombre del chat. */
async function seedChat(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Paneles ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const name = `Paula ${uid()}`;
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: {
      events: [
        { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `pr-${uid()}`, body: 'Hola, ¿me pasan el presupuesto?', timestamp: Date.now() },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  return name;
}

const width = (loc: Locator) => loc.evaluate((el) => el.getBoundingClientRect().width);
const now = async (sep: Locator) => Number(await sep.getAttribute('aria-valuenow'));
const noHScroll = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

/** Arrastra un divisor `dx` px en horizontal, con el mouse. */
async function drag(page: Page, sep: Locator, dx: number) {
  const box = (await sep.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + 30, { steps: 4 });
  await page.mouse.move(x + dx, y + 60, { steps: 4 });
  await page.mouse.up();
}

test('Lines: los paneles de la bandeja cambian de ancho, el ancho se guarda y se puede volver al original', async ({ page, request }) => {
  test.slow();
  const errors = watchErrors(page);
  const name = await seedChat(request);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: new RegExp(name) }).first().click();

  const list = page.locator('.gr-inbox > .gr-list');
  const thread = page.locator('.gr-inbox > .gr-thread');
  const details = page.locator('.gr-inbox > .gr-details');
  const listSep = page.getByRole('separator', { name: 'Resize chat list' });
  const detailsSep = page.getByRole('separator', { name: 'Resize details panel' });
  await expect(details).toBeVisible({ timeout: 45_000 });
  await expect(listSep).toBeVisible();
  await expect(detailsSep).toBeVisible();
  await expect(listSep).toHaveAttribute('aria-orientation', 'vertical');
  await expect(listSep).toHaveCSS('cursor', 'col-resize');

  // Sin tocar nada: el ancho por defecto, y el divisor dice el ancho real.
  const listDefault = await width(list);
  const detailsDefault = await width(details);
  expect(Math.abs((await now(listSep)) - listDefault)).toBeLessThanOrEqual(1);
  expect(Math.abs(detailsDefault - 340)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('zs-lines-panels:')))).toBe(false);

  // Arrastrar el divisor de la lista 80px a la derecha la ensancha 80px.
  await drag(page, listSep, 80);
  await expect.poll(async () => Math.abs((await width(list)) - (listDefault + 80))).toBeLessThanOrEqual(2);
  const dragged = await width(list);
  expect(await now(listSep)).toBe(Math.round(dragged));
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  expect(await page.evaluate(() => document.documentElement.classList.contains('ui-resizing'))).toBe(false);
  expect(await noHScroll(page)).toBeLessThanOrEqual(1);

  // Recargar: el ancho sigue.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(details).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => width(list)).toBe(dragged);
  await expect(listSep).toHaveAttribute('aria-valuenow', String(Math.round(dragged)));

  // Teclado: flechas, Shift para pasos grandes, Inicio y Fin.
  await listSep.focus();
  await expect(listSep).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => width(list)).toBe(dragged + 16);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => width(list)).toBe(dragged + 16 - 64);
  await page.keyboard.press('Home');
  const min = Number(await listSep.getAttribute('aria-valuemin'));
  expect(min).toBe(300);
  await expect.poll(() => width(list)).toBe(min);
  await page.keyboard.press('End');
  const max = Number(await listSep.getAttribute('aria-valuemax'));
  expect(max).toBeGreaterThan(min);
  await expect.poll(() => width(list)).toBe(max);
  // Con la lista al máximo la conversación conserva su ancho mínimo.
  expect(await width(thread)).toBeGreaterThanOrEqual(399);

  // Una ventana más chica acomoda el ancho guardado: la conversación no se aplasta.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await width(thread)) >= 399).toBe(true);
  expect(await noHScroll(page)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(() => width(list)).toBe(max);

  // Enter vuelve al ancho por defecto y borra lo guardado.
  await listSep.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => Math.abs((await width(list)) - listDefault)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('zs-lines-panels:')))).toBe(false);

  // Doble clic también.
  await drag(page, listSep, -40);
  await expect.poll(async () => (await width(list)) < listDefault - 1).toBe(true);
  await listSep.dblclick();
  await expect.poll(async () => Math.abs((await width(list)) - listDefault)).toBeLessThanOrEqual(1);

  // El panel de detalles: arrastrar su divisor a la izquierda lo ensancha; doble clic lo devuelve.
  await drag(page, detailsSep, -60);
  await expect.poll(async () => Math.abs((await width(details)) - (detailsDefault + 60))).toBeLessThanOrEqual(2);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(details).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => Math.abs((await width(details)) - (detailsDefault + 60))).toBeLessThanOrEqual(2);
  await detailsSep.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.abs((await width(details)) - (detailsDefault + 60 - 16))).toBeLessThanOrEqual(2);
  await detailsSep.dblclick();
  await expect.poll(async () => Math.abs((await width(details)) - detailsDefault)).toBeLessThanOrEqual(1);

  // Dos columnas (los detalles pasan a ser un panel flotante): queda solo el divisor de la lista.
  await listSep.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(listSep).toBeVisible();
  await expect(detailsSep).toBeHidden();
  expect(await width(thread)).toBeGreaterThanOrEqual(399);
  expect(await noHScroll(page)).toBeLessThanOrEqual(1);

  // Teléfono: una sola columna, sin divisores, y el ancho guardado no se usa.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await expect(list).toBeVisible();
  await expect(listSep).toBeHidden();
  await expect(detailsSep).toBeHidden();
  expect(Math.abs((await width(list)) - (await width(page.locator('.gr-inbox'))))).toBeLessThanOrEqual(1);
  expect(await noHScroll(page)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('zs-lines-panels:')))).toBe(true);

  expect(errors).toEqual([]);
});
