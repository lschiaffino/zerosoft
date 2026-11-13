import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox, "Chat nuevo" de WhatsApp con el WhatsApp falso (GROUPS_FAKE=1): el
 * "+ Nuevo" del lateral abre el panel como el de WhatsApp Web (sin menú),
 * buscar y abrir un contacto, un número escrito a mano, Esc, el grupo nuevo
 * y el correo nuevo. Nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `5491${Math.floor(1e9 + Math.random() * 8e9)}`;
const SEARCH = 'Search name or number';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

const waStatus = async (request: APIRequestContext) => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state?: { status: string } }).state?.status;

/** Vincula el WhatsApp falso solo si hace falta: vincular tiene límite por IP y otros specs lo usan. */
async function linkWhatsapp(request: APIRequestContext) {
  if ((await waStatus(request)) === 'connected') return;
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
}

/** Un chat de WhatsApp con nombre (por la API). */
async function chat(request: APIRequestContext, name: string): Promise<{ id: string; phone: string }> {
  const to = phone();
  const res = await request.post('/api/inbox/compose', { data: { channel: 'whatsapp', to } });
  expect(res.ok(), await res.text()).toBe(true);
  const { thread } = (await res.json()) as { thread: { id: string } };
  expect((await request.patch(`/api/inbox/threads/${thread.id}`, { data: { title: name } })).ok()).toBe(true);
  return { id: thread.id, phone: to };
}

async function openPanel(page: Page) {
  await page.getByTestId('side-new').click();
  await expect(page.locator('.side-menu')).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: 'New chat' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: SEARCH })).toBeFocused();
  await expect(dialog.getByRole('status', { name: 'Loading…' })).toHaveCount(0, { timeout: 20_000 });
  return dialog;
}

test.beforeEach(async ({ page, request }) => {
  await linkWhatsapp(request);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Inbox, chat nuevo: Nuevo abre el panel sin menú, buscar sin tildes abre el chat y Esc cierra', async ({ page, request }) => {
  const errors = watchErrors(page);
  const name = `Ángela Prueba ${uid()}`;
  const c = await chat(request, name);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });

  const dialog = await openPanel(page);
  await expect(dialog.getByRole('option', { name: 'New group' })).toBeVisible();
  await expect(dialog.getByRole('listbox', { name: 'Contacts on WhatsApp' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const again = await openPanel(page);
  await again.getByRole('combobox', { name: SEARCH }).fill(name.replace('Á', 'a'));
  const row = again.getByRole('option', { name: new RegExp(name) });
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await row.click();
  await expect(again).toBeHidden();
  await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name })).toBeVisible();

  // Por teléfono, escrito con espacios: el mismo chat.
  const third = await openPanel(page);
  await third.getByRole('combobox', { name: SEARCH }).fill(`+${c.phone.slice(0, 2)} ${c.phone.slice(2, 3)} ${c.phone.slice(3)}`);
  await expect(third.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await expect(third.getByRole('option', { name: new RegExp(name) })).toBeVisible();
  await expect(third.getByRole('option', { name: /^Message \+/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('Inbox, chat nuevo: un número que no es contacto abre su chat con Enter', async ({ page }) => {
  const errors = watchErrors(page);
  const to = phone();
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const dialog = await openPanel(page);
  const search = dialog.getByRole('combobox', { name: SEARCH });
  await search.fill('123');
  await expect(dialog.getByText('That number is too short.', { exact: false })).toBeVisible();
  await search.fill(`+${to.slice(0, 2)} ${to.slice(2, 3)} ${to.slice(3, 5)} ${to.slice(5, 9)}-${to.slice(9)}`);
  const direct = dialog.getByRole('option', { name: /^Message \+54 9/ });
  await expect(direct).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.ib-wa-thread')).toBeVisible();
  await expect(page.locator('.ib-item').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Inbox, chat nuevo: grupo nuevo con participantes y nombre', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const a = `Grupo Ana ${tag}`;
  const b = `Grupo Beto ${tag}`;
  await chat(request, a);
  await chat(request, b);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await openPanel(page);
  // El panel cambia de título (y de nombre) en cada paso.
  const dialog = page.getByTestId('new-chat-panel');
  await dialog.getByRole('option', { name: 'New group' }).click();
  await expect(page.getByRole('dialog', { name: 'Add group members' })).toBeVisible();
  const next = dialog.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  const search = dialog.getByRole('combobox', { name: SEARCH });
  await search.fill(tag);
  await expect(dialog.getByRole('listbox').getByRole('option')).toHaveCount(2);
  await dialog.getByRole('option', { name: new RegExp(a) }).click();
  await expect(dialog.getByRole('option', { name: new RegExp(a) })).toHaveAttribute('aria-checked', 'true');
  // Enter elige la fila marcada (↓ a la segunda).
  await search.press('ArrowDown');
  await expect(dialog.getByRole('option', { name: new RegExp(b) })).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(dialog.getByRole('list', { name: 'Selected members' }).getByRole('button')).toHaveCount(2);
  await next.click();
  await expect(page.getByRole('dialog', { name: 'New group' })).toBeVisible();
  await expect(dialog.getByText('2 members')).toBeVisible();
  const title = `Asado ${tag}`;
  await dialog.getByLabel('Group name').fill(title);
  await dialog.getByRole('button', { name: 'Create group' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('.ib-wa-thread').getByRole('heading', { level: 2, name: title })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Inbox, chat nuevo: en el teléfono ocupa la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-compose-btn').click();
  const dialog = page.getByRole('dialog', { name: 'New chat' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
