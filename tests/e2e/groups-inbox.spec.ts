import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Bandeja de Groups (tanda G1) de punta a punta contra el proveedor falso
 * (GROUPS_FAKE=1) y el modelo falso (GROUPS_AI_FAKE=1): editar, borrar,
 * reenviar y fijar mensajes; notas con @menciones; asignación con historial;
 * acciones en masa; traducción y borradores AI; round-robin y llamadas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

interface NumberInfo {
  id: string;
  webhookUrl: string;
}

async function fakeNumber(request: APIRequestContext): Promise<NumberInfo> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Inbox ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

async function events(request: APIRequestContext, n: NumberInfo, list: unknown[]) {
  const res = await request.post(new URL(n.webhookUrl).pathname, { data: { events: list } });
  expect(res.ok(), await res.text()).toBe(true);
}

const dm = () => `549${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}@c.us`;

async function inbound(request: APIRequestContext, n: NumberInfo, chatId: string, body: string, senderName: string) {
  await events(request, n, [
    { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: chatId.replace(/@.*/, ''), senderName, providerMessageId: `e2e-${uid()}`, body },
  ]);
}

/** Errores de la página y respuestas 5xx (salvo el 503 ai_disabled que un test provoca a propósito). */
function watchErrors(page: Page, allow: RegExp | null = null): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500 && !(allow && res.status() === 503 && allow.test(res.url()))) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function openChat(page: Page, name: string) {
  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: name }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

test('mensajes: editar, fijar, reenviar y borrar para todos', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const a = `Ana${uid()}`;
  const b = `Beto${uid()}`;
  await inbound(request, n, dm(), 'Where is my invoice?', a);
  await inbound(request, n, dm(), 'hi', b);
  await openChat(page, a);

  const composer = page.getByLabel('WhatsApp', { exact: true });
  await composer.fill('Sending it today');
  await composer.press('Enter');
  const mine = page.locator('.gr-msg-out', { hasText: 'Sending it today' });
  await expect(mine.getByText('Sent')).toBeVisible();

  // Editar desde el menú del mensaje (Enter guarda).
  await mine.hover();
  await mine.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const editor = mine.getByLabel('Edit message');
  await editor.fill('Sending it today, before 5 pm');
  await editor.press('Enter');
  const edited = page.locator('.gr-msg-out', { hasText: 'before 5 pm' });
  await expect(edited.getByText('Edited')).toBeVisible();
  // La vista previa de la bandeja sigue al mensaje editado, sin recargar.
  await expect(page.locator('.gr-row', { hasText: a })).toContainText('before 5 pm');

  // Fijar: aparece arriba del hilo.
  await edited.hover();
  await edited.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Pin' }).click();
  await expect(page.getByRole('region', { name: 'Pinned messages' }).getByText('before 5 pm')).toBeVisible();

  // Reenviar a otro chat.
  await edited.hover();
  await edited.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Forward' }).click();
  const fw = page.getByRole('dialog', { name: 'Forward message' });
  await fw.getByLabel('Search chats and groups').fill(b);
  await fw.getByRole('checkbox').first().check();
  await fw.getByRole('button', { name: 'Forward to 1 chat' }).click();
  await expect(page.getByText('Forwarded to 1 chat')).toBeVisible();

  // Borrar para todos (con confirmación): queda marcado y sale de los fijados.
  await edited.hover();
  await edited.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete for everyone' }).click();
  await page.getByRole('alertdialog', { name: 'Delete for everyone?' }).getByRole('button', { name: 'Delete for everyone' }).click();
  await expect(page.locator('.gr-msg-out.is-deleted').getByText('Deleted for everyone')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pinned messages' })).toHaveCount(0);
  await expect(page.locator('.gr-row', { hasText: a })).toContainText('Message deleted');

  // La copia reenviada está en el otro chat.
  await openChat(page, b);
  await expect(page.locator('.gr-msg-out', { hasText: 'before 5 pm' }).getByText('Forwarded')).toBeVisible();
  expect(errors).toEqual([]);
});

test('notas con @mención, editar y borrar; asignar deja historial', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const who = `Caro${uid()}`;
  await inbound(request, n, dm(), 'Need help with billing', who);
  await openChat(page, who);

  await page.locator('.gr-messages').click();
  await page.keyboard.press('n');
  const note = page.getByLabel('Internal note', { exact: true });
  await note.pressSequentially('Ping @Dem');
  const list = page.getByRole('listbox', { name: 'Mention someone' });
  await expect(list.getByText('Demo User')).toBeVisible();
  await note.press('Enter');
  await expect(note).toHaveValue('Ping @Demo User ');
  await note.pressSequentially('about this');
  await page.getByRole('button', { name: 'Save note' }).click();
  const saved = page.locator('.gr-msg-note', { hasText: 'about this' });
  await expect(saved.locator('.gr-mention', { hasText: '@Demo User' })).toBeVisible();

  await saved.hover();
  await saved.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await saved.getByLabel('Edit message').fill('Ping @Demo User about this invoice');
  await saved.getByRole('button', { name: 'Save' }).click();
  const editedNote = page.locator('.gr-msg-note', { hasText: 'about this invoice' });
  await expect(editedNote.getByText('Edited')).toBeVisible();
  await editedNote.hover();
  await editedNote.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete note' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note' }).click();
  await expect(page.locator('.gr-msg-note', { hasText: 'about this invoice' })).toHaveCount(0);

  // Asignar y cerrar quedan en el hilo.
  await page.getByLabel('Assigned to').selectOption({ label: 'Demo User' });
  // Asignárselo a uno mismo se lee "se asignó el chat", como en la auditoría.
  await expect(page.locator('.gr-system', { hasText: 'Demo User assigned the chat to themselves' })).toBeVisible();
  await page.locator('.gr-messages').click();
  await page.keyboard.press('e');
  await expect(page.locator('.gr-system', { hasText: 'closed the chat' })).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.locator('.gr-system', { hasText: 'reopened the chat' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('acciones en masa: no leído, fijar y cerrar varios chats', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  const x = `Xime${tag}`;
  const y = `Yago${tag}`;
  await inbound(request, n, dm(), 'one', x);
  await inbound(request, n, dm(), 'two', y);
  await page.goto('/en/app/groups/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('searchbox', { name: 'Search chats and messages' }).fill(tag);
  await expect(page.locator('.gr-row')).toHaveCount(2);
  await page.getByLabel(`Select chat ${x}`).check();
  await page.getByLabel(`Select chat ${y}`).check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar.getByText('2 selected')).toBeVisible();
  await bar.getByRole('button', { name: 'Mark read' }).click();
  await expect(page.getByText('2 chats updated')).toBeVisible();
  await expect(page.locator('.gr-row.is-unread')).toHaveCount(0);

  await page.getByLabel(`Select chat ${x}`).check();
  await bar.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.locator('.gr-row', { hasText: x }).getByRole('img', { name: 'Pinned' })).toBeVisible();

  await page.getByLabel(`Select chat ${x}`).check();
  await page.getByLabel(`Select chat ${y}`).check();
  await bar.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.gr-row')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Closed' }).click();
  await expect(page.locator('.gr-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('AI: traducir entrantes, traducir la respuesta, borrador y error sin AI', async ({ page, request, context }) => {
  const errors = watchErrors(page, /\/api\/groups\/chats\/[^/]+\/draft$/);
  const n = await fakeNumber(request);
  const who = `Dolo${uid()}`;
  await inbound(request, n, dm(), 'Hola, ¿cuándo llega la factura?', who);
  await openChat(page, who);

  await page.getByRole('button', { name: /^Translate/ }).click();
  const msg = page.locator('.gr-msg-in');
  await expect(msg.getByText('[en] Hola, ¿cuándo llega la factura?')).toBeVisible();
  await expect(msg.getByText('Translated from Spanish')).toBeVisible();
  await msg.getByRole('button', { name: 'See original' }).click();
  await expect(msg.getByText('Hola, ¿cuándo llega la factura?', { exact: true })).toBeVisible();

  // Respuesta traducida al idioma del cliente, editable antes de mandar.
  const composer = page.getByLabel('WhatsApp', { exact: true });
  await composer.fill('It arrives tomorrow');
  await page.getByLabel('Translate reply').selectOption({ label: "Customer's language (Spanish)" });
  await expect(composer).toHaveValue('[es] It arrives tomorrow');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(composer).toHaveValue('It arrives tomorrow');

  // Borrador AI con el chat vacío; "Mejorar" con texto.
  await composer.fill('');
  await page.getByRole('button', { name: 'AI draft' }).click();
  await expect(composer).toHaveValue(/Thanks for writing/);
  await composer.fill('it arrives tomorrow');
  await page.getByRole('button', { name: 'Improve with AI' }).click();
  await expect(composer).toHaveValue('It arrives tomorrow.');

  // Sin AI: error claro.
  await context.addCookies([{ name: 'groups_ai_fake', value: 'off', url: new URL(page.url()).origin }]);
  await composer.fill('');
  await page.getByRole('button', { name: 'AI draft' }).click();
  await expect(page.getByRole('alert').getByText('AI is off in this workspace. An admin can turn it on in settings.')).toBeVisible();
  await context.clearCookies({ name: 'groups_ai_fake' });
  expect(errors).toEqual([]);
});

test('round-robin: equipo y regla en Ajustes, el chat nuevo llega asignado', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const tag = uid();
  await page.goto('/en/app/groups/settings?tab=assignment', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New team' }).click();
  const teamDialog = page.getByRole('dialog', { name: 'New team' });
  await teamDialog.getByLabel('Team name').fill(`Support ${tag}`);
  await teamDialog.getByLabel('Demo User').check();
  await teamDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Support ${tag}`)).toBeVisible();

  await page.getByRole('button', { name: 'New rule' }).click();
  const ruleDialog = page.getByRole('dialog', { name: 'New rule' });
  await ruleDialog.getByLabel('Rule name').fill(`Line ${tag}`);
  await ruleDialog.getByLabel('Number').selectOption(n.id);
  await ruleDialog.getByRole('combobox', { name: 'Team', exact: true }).selectOption({ label: `Support ${tag}` });
  await ruleDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.gr-mini-list li', { hasText: `Line ${tag}` }).getByText('On')).toBeVisible();

  const who = `Eli${tag}`;
  await inbound(request, n, dm(), 'Hello there', who);
  await openChat(page, who);
  await expect(page.locator('.gr-system', { hasText: `Assigned to Demo User by the rule Line ${tag}` })).toBeVisible();
  await expect(page.getByLabel('Assigned to')).toHaveValue(/.+/);
  await expect(page.locator('.gr-row', { hasText: who }).locator('.gr-row-assignee')).toHaveText('Demo User');

  // Ausente: los chats nuevos esperan sin asignar.
  await page.getByRole('button', { name: 'Available' }).click();
  await expect(page.getByRole('button', { name: 'Away' })).toBeVisible();
  const later = `Fran${tag}`;
  await inbound(request, n, dm(), 'Anyone?', later);
  await openChat(page, later);
  await expect(page.getByLabel('Assigned to')).toHaveValue('');
  await page.getByRole('button', { name: 'Away' }).click();
  await expect(page.getByRole('button', { name: 'Available' })).toBeVisible();
  await expect(page.locator('.gr-row', { hasText: later }).locator('.gr-row-assignee')).toHaveText('Demo User', { timeout: 10_000 });

  // Apagar la regla para no afectar a otros tests.
  await page.goto('/en/app/groups/settings?tab=assignment');
  await page.locator('.gr-mini-list li', { hasText: `Line ${tag}` }).getByRole('checkbox').uncheck();
  await expect(page.locator('.gr-mini-list li', { hasText: `Line ${tag}` }).getByText('Off')).toBeVisible();
  expect(errors).toEqual([]);
});

test('llamadas: entrante atendida con duración y perdida, en el hilo', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const chatId = dm();
  const who = `Gus${uid()}`;
  await inbound(request, n, chatId, 'I will call you', who);
  const t0 = Math.floor(Date.now() / 1000) - 120;
  const call = (callId: string, status: string, at: number) => ({
    type: 'call',
    chatId,
    callId,
    direction: 'in',
    status,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: who,
    timestamp: new Date(at * 1000).toISOString(),
  });
  await events(request, n, [call('c1', 'ringing', t0), call('c1', 'answered', t0 + 3), call('c1', 'ended', t0 + 68)]);
  await events(request, n, [call('c2', 'ringing', t0 + 90), call('c2', 'missed', t0 + 110)]);
  await openChat(page, who);
  await expect(page.locator('.gr-system-call', { hasText: 'Incoming call' })).toContainText('1:05');
  await expect(page.locator('.gr-system-call', { hasText: 'Missed call' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('390px y modo oscuro: hilo con menú y Ajustes de asignación sin scroll horizontal', async ({ page, request }) => {
  const n = await fakeNumber(request);
  const who = `Hana${uid()}`;
  await inbound(request, n, dm(), 'hola desde el teléfono', who);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, who);
  const msg = page.locator('.gr-msg-in');
  await msg.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Forward' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  const width = async () => page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  let w = await width();
  expect(w.scroll).toBeLessThanOrEqual(w.inner + 1);
  await page.goto('/en/app/groups/settings?tab=assignment', { waitUntil: 'networkidle' });
  w = await width();
  expect(w.scroll).toBeLessThanOrEqual(w.inner + 1);
});
