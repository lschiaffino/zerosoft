import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Inbox: comandos con "/" en el campo de un chat de WhatsApp (WhatsApp falso,
 * GROUPS_FAKE=1). "/" lista las acciones del chat (las de la cabecera y del
 * menú "…"), los snippets y la AI; Enter ejecuta y borra el "/comando". ";"
 * sigue abriendo los snippets.
 */

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
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

async function inbound(request: APIRequestContext, acc: { id: string; secret: string }, chat: { phone: string; name: string; body: string }) {
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
          body: chat.body,
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('"/" en un chat de WhatsApp: lista las acciones, fija el chat, silencia con argumento e inserta un snippet', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const name = `Lucía ${uid()}`;
  await inbound(request, acc, { phone: phone(), name, body: '¿Me pasás la dirección?' });
  const shortcut = `dir${uid()}`;
  await request.post('/api/inbox/snippets', { data: { title: 'Dirección', shortcut, body: 'Hola {primer_nombre}, es en Av. Siempreviva 742' } });

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
  const thread = page.locator('.ib-wa-thread');
  const field = page.getByRole('textbox', { name: 'Message' });
  const menu = page.getByTestId('slash-menu');
  const list = page.getByRole('listbox', { name: 'Commands' });

  // "/" lista las acciones del chat, los snippets y la AI.
  await field.click();
  await field.pressSequentially('/');
  await expect(list).toBeVisible();
  for (const cmd of ['/done', '/snooze', '/remind', '/folder', '/notes', '/unread', '/pin', '/archive', '/mute', '/later', '/dictate']) {
    await expect(list.getByRole('option', { name: new RegExp(`^${cmd},`) })).toBeVisible();
  }
  await expect(list.getByRole('group', { name: 'Snippets' })).toBeVisible();
  await expect(list.getByRole('group', { name: 'Write with AI' }).getByRole('option', { name: /^\/suggest,/ })).toBeVisible();
  await expect(field).toBeFocused();

  // Una acción: /pin fija el chat (lo mismo que el menú "…") y el campo queda vacío.
  await field.pressSequentially('pin');
  await expect(menu.getByTestId('slash-item').first()).toContainText('/pin');
  await field.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(field).toHaveValue('');
  await expect(thread.locator('.gr-thread-actions').getByRole('img', { name: 'Pinned' })).toBeVisible();

  // Con argumento: "/mute week" silencia por una semana; el resto del mensaje queda.
  await field.fill('ya te contesto /mute week');
  await expect(menu.getByTestId('slash-item')).toHaveCount(1);
  await field.press('Enter');
  await expect(field).toHaveValue('ya te contesto ');
  await thread.locator('.gr-thread-actions').getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Unmute' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Un snippet con "/atajo": entra en el campo con el nombre del chat y no se manda solo.
  await field.fill('');
  await field.click();
  await field.pressSequentially(`/${shortcut}`);
  await expect(list.getByRole('group', { name: 'Snippets' }).getByRole('option', { name: new RegExp(`^/${shortcut},`) })).toBeVisible();
  await expect(menu.getByTestId('slash-item').first()).toContainText(`/${shortcut}`);
  await field.press('Enter');
  await expect(field).toHaveValue(`Hola ${name.split(' ')[0]}, es en Av. Siempreviva 742`);
  await expect(thread.locator('.gr-msg-out')).toHaveCount(0);

  // ";" sigue abriendo los snippets, y un "/texto" que no es comando se manda tal cual.
  await field.fill('');
  await field.click();
  await field.pressSequentially(`;${shortcut.slice(0, 4)}`);
  await expect(page.getByRole('listbox', { name: 'Snippets' })).toBeVisible();
  await field.press('Escape');
  await field.fill('');
  await field.click();
  await field.pressSequentially('/hello');
  await expect(menu).toHaveCount(0);
  await field.press('Enter');
  await expect(thread.locator('.gr-msg-out', { hasText: '/hello' })).toBeVisible();

  // Desde el menú +: "Commands" abre la lista para quien usa el mouse.
  await thread.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Commands', exact: true }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole('option', { name: /^\/notes,/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(thread.getByLabel('Notes about this chat')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
