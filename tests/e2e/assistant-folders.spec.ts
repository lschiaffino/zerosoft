import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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
  // Otra bandeja: árbol con subcarpetas; chats por nombre (sin tilde), por teléfono con formato y uno que no existe.
  const json = {
    folders: [
      { name: clients, chats: [`ana gomez ${tag}`], subfolders: [{ name: 'VIP', chats: [`+${beto.phone.slice(0, 2)} ${beto.phone.slice(2, 3)} ${beto.phone.slice(3, 5)} ${beto.phone.slice(5, 9)}-${beto.phone.slice(9)}`] }] },
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
  // Razonamiento plegado, herramienta con ✓ y etiqueta corta.
  const reply = panel.getByTestId('assistant-msg-assistant').last();
  await expect(reply.getByTestId('assistant-reasoning')).toContainText(/Thought for \d+ seconds?/, { timeout: 30_000 });
  const tool = reply.locator('[data-testid="assistant-tool-card"][data-tool="propose_folders_from_json"]');
  await expect(tool).toHaveAttribute('data-state', 'ok');
  await expect(tool.locator('summary')).toContainText('Plan ready: Create 3 folders and put 3 chats in them in Inbox');
  // El plan: tabla en Markdown y la tarjeta con lo que no encontró y los botones.
  const table = reply.getByTestId('assistant-markdown').locator('table');
  await expect(table.getByRole('row', { name: new RegExp(`${clients} / VIP 1 new`) })).toBeVisible();
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
  await expect(side.getByRole('link', { name: clients })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await side.getByRole('link', { name: 'VIP' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'VIP' })).toBeVisible();
  await expect(page.locator('.ib-item', { hasText: beto.name })).toBeVisible();
  const rows = await sql(
    `SELECT f.name, t.title FROM inbox_thread_folders tf JOIN inbox_folders f ON f.id = tf.folder_id JOIN inbox_threads t ON t.id = tf.thread_id WHERE t.title LIKE ? ORDER BY t.title`,
    [`%${tag}`],
  );
  expect(rows.map((r) => `${r.name}:${r.title}`)).toEqual([`${clients}:${ana.name}`, `VIP:${beto.name}`, `Familia ${tag}:${caro.name}`]);

  // Otra vez: no hay nada que hacer y no se duplica nada.
  await page.keyboard.press('ControlOrMeta+j');
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
