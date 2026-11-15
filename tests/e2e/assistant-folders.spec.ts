import { readFileSync } from 'node:fs';
import path from 'node:path';
import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Asistente (modelo falso, ASSISTANT_FAKE=1): la persona pega un JSON
 * exportado de otra bandeja y pide "creá las carpetas". Se ve el
 * razonamiento plegado, la herramienta con su estado, el plan como tabla y
 * una tarjeta con Confirmar / Cancelar. Al confirmar, las carpetas y los
 * chats aparecen en Inbox sin recargar; repetirlo no duplica nada. Un JSON
 * largo pegado entra como archivo (no se corta).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp');
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

async function inbound(request: APIRequestContext, acc: { id: string; secret: string }, chat: { phone: string; name: string }) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        {
          type: 'message',
          chatId: `${chat.phone}@s.whatsapp.net`,
          isGroup: false,
          fromMe: false,
          senderPhone: chat.phone,
          senderName: chat.name,
          providerMessageId: `in-${uid()}`,
          body: 'hola',
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

/** Abre el bloque de actividad (plegado al terminar) de una respuesta. */
async function openActivity(reply: Locator): Promise<Locator> {
  const activity = reply.getByTestId('assistant-activity');
  await expect(activity).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
  if ((await activity.getAttribute('open')) === null) await activity.locator('> summary').click();
  await expect(activity).toHaveAttribute('open', '');
  return activity;
}

/** Los pasos se leen en lenguaje común: nunca el nombre de una herramienta (find_operations, propose_…). */
async function expectNoToolNames(activity: Locator) {
  const labels = await activity.locator('.asst-step > details > summary').allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  for (const l of labels) expect(l).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
}

async function fakeLine(request: APIRequestContext, name: string): Promise<{ id: string; webhookUrl: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

/** El JSON de ejemplo (tests/fixtures/assistant/inboxzero.json) con las carpetas de esta corrida. */
function taggedFixture(tag: string): Buffer {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'fixtures', 'assistant', 'inboxzero.json'), 'utf8')) as { folders: Array<{ name: string }> };
  for (const f of raw.folders) f.name = `${f.name} ${tag}`;
  return Buffer.from(JSON.stringify(raw, null, 2));
}

test.beforeEach(async ({ page }) => {
  // La primera respuesta del asistente compila sus rutas en `next dev`: más margen.
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('pegar un JSON de carpetas: plan con tabla, confirmar con el botón y verlas en Inbox; repetir no duplica', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const ana = { phone: phone(), name: `Ana Gómez ${tag}` };
  const beto = { phone: phone(), name: `Beto ${tag}` };
  const caro = { phone: phone(), name: `Caro ${tag}` };
  for (const c of [ana, beto, caro]) await inbound(request, acc, c);
  const clients = `Clientes ${tag}`;
  const vip = `VIP ${tag}`;
  // Otra bandeja: árbol con subcarpetas; chats por nombre (sin tilde), por teléfono con formato y uno que no existe.
  const json = {
    folders: [
      { name: clients, chats: [`ana gomez ${tag}`], subfolders: [{ name: vip, chats: [`+${beto.phone.slice(0, 2)} ${beto.phone.slice(2, 3)} ${beto.phone.slice(3, 5)} ${beto.phone.slice(5, 9)}-${beto.phone.slice(9)}`] }] },
      { name: `Familia ${tag}`, chats: [caro.name, `Tío Nadie ${tag}`] },
    ],
  };

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  await input.fill(`Create the folders, subfolders and assign the chats:\n${JSON.stringify(json, null, 2)}`);
  await input.press('Enter');

  // El mensaje largo de la persona se ve recortado, con "Show all".
  await expect(panel.getByTestId('assistant-msg-user').last().getByRole('button', { name: 'Show all' })).toBeVisible();
  // Lo que hizo, en un bloque plegado: razonamiento y la herramienta con ✓, sin nombres técnicos.
  const reply = panel.getByTestId('assistant-msg-assistant').last();
  const activity = await openActivity(reply);
  await expect(activity.getByTestId('assistant-reasoning')).toHaveAttribute('data-state', 'ok');
  const tool = activity.locator('[data-testid="assistant-tool-card"][data-tool="propose_folders_from_json"]');
  await expect(tool).toHaveAttribute('data-state', 'ok');
  await expect(tool.locator('summary')).toContainText('Create 3 folders and put 3 chats in them in Inbox');
  await expectNoToolNames(activity);
  // El plan: tabla en Markdown y la tarjeta con lo que no encontró y los botones.
  const table = reply.getByTestId('assistant-markdown').locator('table');
  await expect(table.getByRole('row', { name: new RegExp(`${clients} / ${vip} 1 new`) })).toBeVisible();
  const card = reply.getByTestId('assistant-action');
  await expect(card).toContainText('New folders (3)');
  await expect(card).toContainText(`Tío Nadie ${tag} in Familia ${tag}`);
  // Nada escrito todavía.
  expect(await sql('SELECT id FROM inbox_folders WHERE name = ?', [clients])).toEqual([]);

  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  await expect(card).toContainText('Created 3 folders (0 already existed). Added 3 chats to folders');

  // Inbox se pone al día solo: la carpeta y su subcarpeta en el lateral, el chat adentro.
  const side = page.locator('#side-branch');
  await expect(side.getByRole('link', { name: new RegExp(`^${clients}\\b`) })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await side.getByRole('link', { name: new RegExp(`^${vip}\\b`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: vip })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: beto.name })).toBeVisible();
  const rows = await sql(
    `SELECT f.name, t.title FROM inbox_thread_folders tf JOIN inbox_folders f ON f.id = tf.folder_id JOIN inbox_threads t ON t.id = tf.thread_id WHERE t.title LIKE ? ORDER BY t.title`,
    [`%${tag}`],
  );
  expect(rows.map((r) => `${r.name}:${r.title}`)).toEqual([`${clients}:${ana.name}`, `${vip}:${beto.name}`, `Familia ${tag}:${caro.name}`]);

  // Otra vez: no hay nada que hacer y no se duplica nada.
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toBeVisible();
  await input.fill('create the folders from this JSON again');
  await input.press('Enter');
  await expect(panel.getByTestId('assistant-msg-assistant').last()).toContainText('Everything in that JSON is already in place');
  expect(await sql('SELECT COUNT(*) AS n FROM inbox_folders WHERE name IN (?, ?)', [clients, `Familia ${tag}`])).toEqual([{ n: 2 }]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('un JSON largo pegado entra como archivo y Cancelar no cambia nada (390, oscuro)', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const acc = await linkWhatsapp(request);
  const tag = uid();
  const who = { phone: phone(), name: `Dani ${tag}` };
  await inbound(request, acc, who);
  // Más de 3000 caracteres: muchas carpetas con un chat que no existe y uno que sí.
  const big = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`Carpeta ${tag} ${i}`, i === 0 ? [{ name: who.name, phone: `+${who.phone}` }] : [`Persona ${i} ${tag}`]]));
  const text = JSON.stringify(big, null, 2);
  expect(text.length).toBeGreaterThan(3000);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  await input.click();
  await input.evaluate((el, value) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await expect(panel.getByText('pasted-1.json')).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(panel.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: 30_000 });
  await input.fill('create the folders and assign the chats');
  await input.press('Enter');
  const card = panel.getByTestId('assistant-msg-assistant').last().getByTestId('assistant-action');
  await expect(card).toContainText('Create 60 folders and put 1 chat in them in Inbox', { timeout: 30_000 });
  await expect(card).toContainText('Read from');
  await expect(card).toContainText('pasted-1.json');
  // Sin scroll horizontal en el teléfono.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(card).toHaveAttribute('data-status', 'cancelled');
  expect(await sql('SELECT COUNT(*) AS n FROM inbox_folders WHERE name LIKE ?', [`Carpeta ${tag}%`])).toEqual([{ n: 0 }]);
});

test('adjuntar inboxzero.json y pedir las carpetas de Inbox y Lines: un bloque de actividad, una tarjeta, confirmar y verlas en las dos', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  // Dos chats del JSON en Inbox (uno en "Clientes", otro en "Clientes / VIP") y uno en una línea de Lines.
  await inbound(request, acc, { phone: '5491155500001', name: `Uno ${tag}` });
  await inbound(request, acc, { phone: '5491155500004', name: `Cuatro ${tag}` });
  const line = await fakeLine(request, `Ventas ${tag}`);
  const res = await request.post(new URL(line.webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId: '5491155500001@c.us', isGroup: false, fromMe: false, senderPhone: '5491155500001', senderName: `Uno ${tag}`, providerMessageId: `lf-${tag}`, body: 'hola' }] },
  });
  expect(res.ok(), await res.text()).toBe(true);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  await panel.getByTestId('assistant-file-input').setInputFiles({ name: 'inboxzero.json', mimeType: 'application/json', buffer: taggedFixture(tag) });
  await expect(panel.getByTestId('assistant-attachment')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  await input.fill('configurá mis carpetas de inbox y lines en función de esto');
  await input.press('Enter');

  const reply = panel.getByTestId('assistant-msg-assistant').last();
  // Una sola tarjeta para todo (23 carpetas en cada app), con lo que se crea en Inbox y en Lines.
  const card = reply.getByTestId('assistant-action');
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  await expect(card).toHaveAttribute('data-status', 'pending');
  await expect(card).toContainText('Inbox · New folders (23)');
  await expect(card).toContainText('Lines · New folders (23)');
  // La respuesta siempre trae texto; la actividad queda plegada en una línea y se abre con los pasos.
  await expect(reply.getByTestId('assistant-markdown')).not.toBeEmpty();
  const activity = await openActivity(reply);
  await expect(activity.getByTestId('assistant-tool-card')).toHaveCount(1);
  await expectNoToolNames(activity);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  await expect(card.getByRole('status')).toContainText('Inbox:');
  await expect(card.getByRole('status')).toContainText('Lines:');

  // Inbox: las carpetas en el lateral sin recargar, la subcarpeta con su chat.
  const side = page.locator('#side-branch');
  await expect(side.getByRole('link', { name: new RegExp(`^Clientes ${tag}\\b`) })).toBeVisible({ timeout: 20_000 });
  expect(await sql('SELECT COUNT(*) AS n FROM inbox_folders WHERE name LIKE ?', [`% ${tag}`])).toEqual([{ n: 23 }]);
  const vip = await sql(
    'SELECT t.title FROM inbox_thread_folders tf JOIN inbox_folders f ON f.id = tf.folder_id JOIN inbox_threads t ON t.id = tf.thread_id WHERE f.name = ?',
    [`VIP ${tag}`],
  );
  expect(vip.map((r) => r.title)).toEqual([`Cuatro ${tag}`]);
  // Lines: las mismas carpetas, compartidas por el workspace.
  const lines = (await (await request.get('/api/groups/folders')).json()) as { folders: Array<{ name: string }> };
  expect(lines.folders.filter((f) => f.name.endsWith(` ${tag}`))).toHaveLength(23);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('el panel se fija al costado, se ensancha arrastrando el borde y va a pantalla completa; en el teléfono es una hoja', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.removeItem('zs:assistant-panel-layout'));
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toHaveAttribute('data-mode', 'float');

  // Fijo: la página se corre y no queda tapada.
  const pin = panel.getByRole('button', { name: 'Keep open at the side' });
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toHaveAttribute('data-mode', 'pinned');
  await expect(panel).toHaveAttribute('role', 'complementary');
  const content = (await page.locator('.app-content').boundingBox())!;
  let box = (await panel.boundingBox())!;
  expect(content.x + content.width).toBeLessThanOrEqual(box.x + 1);

  // Ancho: con el teclado sobre el borde (como al arrastrarlo) y queda guardado.
  const edge = panel.getByRole('separator', { name: 'Assistant panel width' });
  const before = Number(await edge.getAttribute('aria-valuenow'));
  await edge.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(edge).toHaveAttribute('aria-valuenow', String(before + 64));
  // Arrastrar el borde a la izquierda lo ensancha.
  const handle = (await edge.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + 200, { steps: 4 });
  await page.mouse.up();
  const dragged = Number(await edge.getAttribute('aria-valuenow'));
  expect(dragged).toBeGreaterThan(before + 64);
  box = (await panel.boundingBox())!;
  expect(Math.round(box.width)).toBe(dragged);

  // Recargar: sigue fijo y con el mismo ancho.
  await page.reload({ waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  await expect(panel).toHaveAttribute('data-mode', 'pinned');
  await expect(panel.getByRole('separator', { name: 'Assistant panel width' })).toHaveAttribute('aria-valuenow', String(dragged));

  // Pantalla completa; Esc vuelve a fijo.
  const full = panel.getByRole('button', { name: 'Full screen' });
  await full.click();
  await expect(panel).toHaveAttribute('data-mode', 'full');
  box = (await panel.boundingBox())!;
  expect(Math.round(box.width)).toBe(1280);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-mode', 'pinned');
  // Soltarlo: vuelve a flotar.
  await pin.click();
  await expect(panel).toHaveAttribute('data-mode', 'float');

  // Teléfono: hoja a pantalla completa, sin fijar ni ensanchar.
  await page.setViewportSize({ width: 390, height: 800 });
  box = (await panel.boundingBox())!;
  expect(Math.round(box.width)).toBe(390);
  await expect(panel.getByRole('button', { name: 'Keep open at the side' })).toBeHidden();
  await expect(panel.getByRole('separator')).toBeHidden();
  const send = panel.getByRole('button', { name: 'Send' });
  const attach = panel.getByRole('button', { name: 'Attach files' });
  const s1 = (await send.boundingBox())!;
  const a1 = (await attach.boundingBox())!;
  // + y Enviar en la misma barra, alineados al centro.
  expect(Math.abs(s1.y + s1.height / 2 - (a1.y + a1.height / 2))).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.localStorage.removeItem('zs:assistant-panel-layout'));
  expect(errors, errors.join('\n')).toEqual([]);
});

