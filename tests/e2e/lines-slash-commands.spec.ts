import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: comandos con "/" en el campo del chat, contra el proveedor falso
 * (GROUPS_FAKE=1). "/" abre la lista (acciones del hilo, respuestas rápidas y
 * AI), se filtra escribiendo, Enter ejecuta y borra el "/comando" sin tocar
 * el resto. Con argumento ("/assign demo") elige en un paso. Un mensaje que
 * de verdad empieza con "/" se manda con Esc y Enter. Las respuestas rápidas
 * siguen entrando con "/atajo".
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Slash ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

const dm = () => `549${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}@c.us`;

async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, body: string, senderName: string) {
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName, providerMessageId: `e2e-${uid()}`, body }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function openChat(page: Page, request: APIRequestContext, name: string): Promise<string> {
  const n = await fakeNumber(request);
  await inbound(request, n, dm(), '¿me pasás el horario?', name);
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: name }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page).toHaveURL(/\/lines\/inbox\/[^/?#]+/);
  return new URL(page.url()).pathname.split('/').pop()!;
}

async function chatState(request: APIRequestContext, id: string): Promise<{ assignedTo: string | null; status: string; labels: Array<{ name: string }> }> {
  const d = (await (await request.get(`/api/groups/chats/${id}`)).json()) as Record<string, unknown>;
  return ((d.chat as Record<string, unknown> | undefined) ?? d) as { assignedTo: string | null; status: string; labels: Array<{ name: string }> };
}

test('"/" lista los comandos, se filtra, y /note y /reply cambian a dónde va lo escrito', async ({ page, request }) => {
  const errors = watchErrors(page);
  await openChat(page, request, `Slash${uid()}`);
  const field = page.locator('textarea.wa-input');
  const menu = page.getByTestId('slash-menu');
  const list = page.getByRole('listbox', { name: 'Commands' });

  await field.click();
  await field.pressSequentially('/');
  await expect(list).toBeVisible();
  await expect(list.getByRole('group', { name: 'Actions' })).toBeVisible();
  for (const name of ['/assign', '/close', '/note', '/ticket', '/later', '/mute', '/pin', '/summary']) {
    await expect(list.getByRole('option', { name: new RegExp(`^${name},`) })).toBeVisible();
  }
  // El foco sigue en el campo; la fila marcada se anuncia desde ahí y las flechas la mueven.
  await expect(field).toBeFocused();
  const first = await field.getAttribute('aria-activedescendant');
  expect(first).toBeTruthy();
  await field.press('ArrowDown');
  await expect(field).not.toHaveAttribute('aria-activedescendant', first!);
  await field.press('ArrowUp');
  await expect(field).toHaveAttribute('aria-activedescendant', first!);

  // Filtrar: queda /note primero. Enter lo ejecuta y el campo queda vacío, en nota interna.
  await field.pressSequentially('no');
  await expect(menu.getByTestId('slash-item').first()).toContainText('/note');
  await field.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(field).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Internal note' })).toHaveAttribute('aria-selected', 'true');
  await expect(field).toBeFocused();

  // De vuelta a WhatsApp con /reply; el texto que ya estaba escrito no se toca.
  await field.pressSequentially('lo veo mañana /repl');
  await expect(menu.getByTestId('slash-item').first()).toContainText('/reply');
  await field.press('Tab');
  await expect(page.getByRole('tab', { name: 'WhatsApp' })).toHaveAttribute('aria-selected', 'true');
  await expect(field).toHaveValue('lo veo mañana ');

  // "/note" seguido de texto: Enter pasa a nota y deja el texto; nada salió al cliente.
  await field.fill('/note llamar el lunes');
  await expect(menu.getByTestId('slash-item')).toHaveCount(1);
  await field.press('Enter');
  await expect(field).toHaveValue('llamar el lunes');
  await expect(page.getByRole('tab', { name: 'Internal note' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.gr-msg-out')).toHaveCount(0);
  await field.press('Enter');
  await expect(page.locator('.gr-msg-note', { hasText: 'llamar el lunes' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('/assign elige a la persona y /label pone y saca una etiqueta', async ({ page, request }) => {
  const errors = watchErrors(page);
  const tag = uid();
  const label = (await (await request.post('/api/groups/labels', { data: { name: `Mayorista ${tag}`, color: 'green' } })).json()) as { id: string; name: string };
  const id = await openChat(page, request, `Asig${tag}`);
  const field = page.locator('textarea.wa-input');
  const menu = page.getByTestId('slash-menu');

  // Elegir el comando deja "/assign " y muestra a las personas (las mismas del selector del encabezado).
  await field.click();
  await field.pressSequentially('/assi');
  await field.press('Enter');
  await expect(field).toHaveValue('/assign ');
  const people = page.getByRole('listbox', { name: '/assign' });
  await expect(people.getByRole('option', { name: /Demo User/ })).toBeVisible();
  await expect(people.getByRole('option', { name: /Unassigned/ })).toBeVisible();
  await field.pressSequentially('demo');
  await expect(menu.getByTestId('slash-item').first()).toContainText('Demo User');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect(page.getByLabel('Assigned to')).not.toHaveValue('');
  await expect.poll(async () => (await chatState(request, id)).assignedTo).not.toBeNull();

  // En un paso, con el resto del mensaje intacto.
  await field.fill('te escribo en un rato /assign nobody');
  await expect(menu.getByTestId('slash-item').first()).toContainText('Unassigned');
  await field.press('Enter');
  await expect(field).toHaveValue('te escribo en un rato ');
  await expect(page.getByLabel('Assigned to')).toHaveValue('');
  await expect.poll(async () => (await chatState(request, id)).assignedTo).toBeNull();

  // Sin coincidencias el menú avisa y Enter no manda "/assign zzz" al cliente.
  await field.fill('/assign zzzz');
  await expect(menu).toContainText('Nobody matches');
  await field.press('Enter');
  await expect(field).toHaveValue('/assign zzzz');
  await expect(page.locator('.gr-msg-out')).toHaveCount(0);

  // Etiqueta: la pone, y elegirla de nuevo la saca.
  await field.fill(`/label mayorista ${tag}`);
  await expect(menu.getByRole('option', { name: new RegExp(label.name) })).toBeVisible();
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect.poll(async () => (await chatState(request, id)).labels.map((l) => l.name)).toContain(label.name);
  await field.fill(`/label mayorista ${tag}`);
  await expect(menu.getByRole('option', { name: new RegExp(`${label.name}, on`) })).toBeVisible();
  await menu.getByRole('option', { name: new RegExp(label.name) }).click();
  await expect.poll(async () => (await chatState(request, id)).labels.map((l) => l.name)).not.toContain(label.name);
  await expect(field).toHaveValue('');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('una respuesta rápida sigue entrando con /atajo, y "/hello" se manda como texto', async ({ page, request }) => {
  const errors = watchErrors(page);
  const shortcut = `hrs${uid()}`;
  const saved = await request.post('/api/groups/quick-replies', { data: { shortcut, body: 'Atendemos de lunes a viernes de 9 a 18.' } });
  expect(saved.ok(), await saved.text()).toBe(true);
  await openChat(page, request, `Rapida${uid()}`);
  const field = page.locator('textarea.wa-input');
  const menu = page.getByTestId('slash-menu');
  const out = page.locator('.gr-msg-out');

  // "/atajo" + Enter pone el texto en el campo (no lo manda); otro Enter lo manda.
  await field.click();
  await field.pressSequentially(`/${shortcut.slice(0, 6)}`);
  await expect(page.getByRole('listbox', { name: 'Commands' }).getByRole('group', { name: 'Quick replies' })).toBeVisible();
  await expect(menu.getByRole('option', { name: new RegExp(`^/${shortcut},`) })).toBeVisible();
  await field.press('Enter');
  await expect(field).toHaveValue('Atendemos de lunes a viernes de 9 a 18.');
  await expect(out).toHaveCount(0);
  await field.press('Enter');
  await expect(out.filter({ hasText: 'Atendemos de lunes a viernes' })).toBeVisible();
  await expect(field).toHaveValue('');

  // Nada coincide con "/hello": no hay menú y Enter lo manda tal cual.
  await field.pressSequentially('/hello');
  await expect(menu).toHaveCount(0);
  await field.press('Enter');
  await expect(out.filter({ hasText: '/hello' })).toBeVisible();

  // "/close" sí coincide: Esc cierra el menú, el texto queda y Enter lo manda como texto. El chat sigue abierto.
  await field.pressSequentially('/close');
  await expect(menu).toBeVisible();
  await field.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(field).toHaveValue('/close');
  await expect(page).toHaveURL(/\/lines\/inbox\/[^/?#]+/);
  await field.press('Enter');
  await expect(out.filter({ hasText: '/close' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Close/ })).toBeVisible();

  // Borrar la "/" cierra el menú.
  await field.pressSequentially('/');
  await expect(menu).toBeVisible();
  await field.press('Backspace');
  await expect(menu).toHaveCount(0);

  // Una URL o "y/o" no abren nada.
  await field.fill('mirá https://example.test/precios y/o');
  await expect(menu).toHaveCount(0);
  await field.fill('');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('con el mouse desde el menú +, y a 390 px sin scroll horizontal', async ({ page, request }) => {
  const errors = watchErrors(page);
  await openChat(page, request, `Mouse${uid()}`);
  const field = page.locator('textarea.wa-input');
  const menu = page.getByTestId('slash-menu');

  await page.getByRole('button', { name: 'Attach' }).click();
  await page.getByRole('menuitem', { name: 'Commands', exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(field).toHaveValue('/');
  await menu.getByRole('option', { name: /^\/note,/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(field).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Internal note' })).toHaveAttribute('aria-selected', 'true');
  await expect(field).toBeFocused();

  // En el teléfono: a todo el ancho, encima del campo, sin scroll horizontal.
  await page.setViewportSize({ width: 390, height: 780 });
  await field.fill('/');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const fieldBox = await field.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  expect(box && fieldBox && box.y + box.height <= fieldBox.y + 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const row = await menu.getByTestId('slash-item').first().boundingBox();
  expect(row && row.height >= 44).toBe(true);
  await field.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
