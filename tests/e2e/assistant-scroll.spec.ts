import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Asistente con una sola barra de scroll (modelo falso, ASSISTANT_FAKE=1).
 * Con el JSON de ejemplo (tests/fixtures/assistant/inboxzero.json) arma un
 * plan grande: 23 carpetas nuevas y muchos chats que no encuentra. La
 * ventana no scrollea, nada adentro de la respuesta tiene scroll vertical
 * propio, "Mostrar las N" abre la lista en el lugar sin mover la charla,
 * Confirmar queda a mano mientras se recorre la tarjeta, "Ir al final"
 * aparece si subiste a leer y al abrir la charla se ve el último mensaje.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function linkWhatsapp(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
}

/** El JSON de ejemplo con carpetas propias de esta corrida (y chats que no existen: van a "Not found"). */
function taggedFixture(tag: string): Buffer {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'fixtures', 'assistant', 'inboxzero.json'), 'utf8')) as {
    folders: Array<{ name: string }>;
    chats: Array<{ name: string }>;
  };
  for (const f of raw.folders) f.name = `${f.name} ${tag}`;
  for (const c of raw.chats) c.name = `${c.name} ${tag}`;
  return Buffer.from(JSON.stringify(raw, null, 2));
}

/** La ventana no scrollea: ni intentándolo. */
async function expectWindowDoesNotScroll(page: Page) {
  const r = await page.evaluate(() => {
    const se = document.scrollingElement!;
    se.scrollTop = 100_000;
    const top = se.scrollTop;
    se.scrollTop = 0;
    return { top, height: se.scrollHeight, inner: window.innerHeight, width: se.scrollWidth, innerW: window.innerWidth };
  });
  expect(r.top, `the window scrolled (scrollHeight ${r.height}, viewport ${r.inner})`).toBe(0);
  expect(r.width).toBeLessThanOrEqual(r.innerW + 1);
}

/** Ningún elemento de la charla (tarjeta, tabla, lista) tiene scroll vertical propio: solo la charla. */
async function nestedVerticalScrolls(messages: Locator): Promise<string[]> {
  return messages.evaluate((root) => {
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) out.push(`${el.tagName.toLowerCase()}.${el.className}`);
    }
    return out;
  });
}

async function askForPlan(page: Page, scope: Locator, tag: string): Promise<Locator> {
  await scope.getByTestId('assistant-file-input').setInputFiles({ name: 'inboxzero.json', mimeType: 'application/json', buffer: taggedFixture(tag) });
  await expect(scope.getByTestId('assistant-attachment')).toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  const input = scope.getByRole('textbox', { name: /Ask anything/ });
  await input.fill('create the folders from this json in inbox');
  await input.press('Enter');
  const card = scope.getByTestId('assistant-msg-assistant').last().getByTestId('assistant-action');
  await expect(card).toHaveAttribute('data-status', 'pending', { timeout: 90_000 });
  await expect(card).toContainText('New folders (23)');
  return card;
}

test.beforeEach(async () => {
  // La primera respuesta del asistente compila sus rutas en `next dev`: más margen.
  test.slow();
});

test('página del asistente: una sola barra de scroll con un plan largo (1440)', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await linkWhatsapp(request);
  const tag = uid();
  await page.goto('/en/app/assistant', { waitUntil: 'networkidle' });
  const assistant = page.getByTestId('assistant-page');
  // Cabecera compacta: el título de la app arriba del historial, sin encabezado grande de página.
  await expect(assistant.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible();
  await expectWindowDoesNotScroll(page);

  const card = await askForPlan(page, assistant, tag);
  const messages = assistant.getByTestId('assistant-messages');
  await expect(page.getByTestId('assistant-msg-assistant').last().getByTestId('assistant-markdown')).toContainText('Click Confirm');
  await expectWindowDoesNotScroll(page);
  expect(await nestedVerticalScrolls(messages)).toEqual([]);

  // Al terminar quedó en el final: la tarjeta termina a la vista con Confirmar.
  const confirm = card.getByRole('button', { name: 'Confirm' });
  await expect(confirm).toBeInViewport();

  // La lista de carpetas: 8 renglones y "Show all 23" la abre en el lugar, sin mover la charla.
  const folders = card.getByTestId('assistant-action-list').first();
  await expect(folders.locator('li')).toHaveCount(8);
  const showAll = card.getByRole('button', { name: 'Show all 23' });
  await showAll.scrollIntoViewIfNeeded();
  const before = await messages.evaluate((el) => el.scrollTop);
  const y = (await showAll.boundingBox())!.y;
  await showAll.click();
  await expect(folders.locator('li')).toHaveCount(23);
  await expect(showAll).toHaveCount(0);
  expect(await messages.evaluate((el) => el.scrollTop)).toBe(before);
  expect(Math.abs((await folders.locator('li').nth(8).boundingBox())!.y - y)).toBeLessThan(30);
  // Lo que no encontró: agrupado y recortado igual.
  const notFound = card.getByTestId('assistant-action-list').nth(1);
  await expect(notFound.locator('li')).toHaveCount(8);
  await card.getByTestId('assistant-show-rows').first().click();
  expect((await notFound.locator('li').count()) > 8).toBe(true);
  expect(await nestedVerticalScrolls(messages)).toEqual([]);
  await expectWindowDoesNotScroll(page);

  // A mitad de la tarjeta, Confirmar sigue a la vista (la barra queda pegada abajo).
  await card.evaluate((el) => {
    const list = el.closest('[data-testid="assistant-messages"]') as HTMLElement;
    list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top + 200;
  });
  await expect(confirm).toBeInViewport();
  const bar = (await card.getByTestId('assistant-action-bar').boundingBox())!;
  const box = (await messages.boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(box.y + box.height + 1);

  // Subiste a leer: "Jump to latest" vuelve al final.
  await messages.evaluate((el) => (el.scrollTop = 0));
  const jump = assistant.getByTestId('assistant-jump');
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(jump).toBeHidden();
  expect(await messages.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);

  await confirm.click();
  await expect(card).toHaveAttribute('data-status', 'done', { timeout: 120_000 });

  // Abrir la charla de nuevo: queda en el último mensaje.
  await expect(page).toHaveURL(/\?c=/);
  await page.reload({ waitUntil: 'networkidle' });
  const reloaded = page.getByTestId('assistant-messages');
  await expect(reloaded.getByTestId('assistant-action')).toHaveAttribute('data-status', 'done');
  await expect.poll(() => reloaded.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);
  await expect(reloaded.getByTestId('assistant-action')).toBeInViewport();
  await expectWindowDoesNotScroll(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('panel y teléfono (390, oscuro): sin scrolls anidados y el campo siempre a la vista', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await linkWhatsapp(request);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const card = await askForPlan(page, panel, uid());
  const messages = panel.getByTestId('assistant-messages');
  expect(await nestedVerticalScrolls(messages)).toEqual([]);
  await card.getByRole('button', { name: 'Show all 23' }).click();
  await expect(card.getByTestId('assistant-action-list').first().locator('li')).toHaveCount(23);
  expect(await nestedVerticalScrolls(messages)).toEqual([]);
  await expect(card.getByRole('button', { name: 'Confirm' })).toBeInViewport();

  // Teléfono: hoja a pantalla completa, el campo abajo y a la vista.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(panel.getByRole('textbox', { name: /Ask anything/ })).toBeInViewport();
  await expect(card.getByRole('button', { name: 'Confirm' })).toBeInViewport();
  expect(await nestedVerticalScrolls(messages)).toEqual([]);
  await expectWindowDoesNotScroll(page);
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(card).toHaveAttribute('data-status', 'cancelled');

  // La página a 390: barra de arriba, el historial en lugar de la charla.
  await page.keyboard.press('Escape');
  await page.goto('/en/app/assistant', { waitUntil: 'networkidle' });
  const assistant = page.getByTestId('assistant-page');
  await expectWindowDoesNotScroll(page);
  await expect(assistant.getByRole('textbox', { name: /Ask anything/ })).toBeInViewport();
  await expect(assistant.getByTestId('assistant-history')).toBeHidden();
  await assistant.getByRole('button', { name: 'Show chats' }).click();
  await expect(assistant.getByTestId('assistant-history')).toBeVisible();
  await expect(assistant.getByRole('textbox', { name: /Ask anything/ })).toBeHidden();
  await assistant.getByTestId('assistant-history').getByRole('link').first().click();
  await expect(assistant.getByTestId('assistant-history')).toBeHidden();
  await expect(assistant.getByRole('textbox', { name: /Ask anything/ })).toBeInViewport();
  await expectWindowDoesNotScroll(page);
  expect(errors, errors.join('\n')).toEqual([]);
});
