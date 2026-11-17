import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * "Sin carpeta" en Inbox y en Lines: arriba del árbol de carpetas, filtra los
 * chats que no están en ninguna y, al sumar uno a una carpeta, sale de la
 * lista. Proveedores falsos; los nombres son de prueba.
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

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

async function inbound(request: APIRequestContext, acc: { id: string; secret: string }, name: string) {
  const p = phone();
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        { type: 'message', chatId: `${p}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: p, senderName: name, providerMessageId: `in-${uid()}`, body: 'test message', timestamp: new Date().toISOString() },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

test('Inbox: Sin carpeta lista los sueltos y sumar uno a una carpeta lo saca', async ({ page, request }) => {
  const tag = uid();
  const acc = await linkWhatsapp(request);
  const [a, b, c] = [`Chat A ${tag}`, `Chat B ${tag}`, `Chat C ${tag}`];
  for (const n of [a, b, c]) await inbound(request, acc, n);
  const first = (await (await request.post('/api/inbox/folders', { data: { name: `Folder 1 ${tag}` } })).json()) as { folder: { id: string } };
  await request.post('/api/inbox/folders', { data: { name: `Folder 2 ${tag}` } });
  // La búsqueda puede traer también B y C (comparten palabras): se elige el chat A por su título.
  const hit = (await (await request.get(`/api/inbox/threads?q=${encodeURIComponent(a)}`)).json()) as { threads: Array<{ id: string; title: string }> };
  const chatA = hit.threads.find((t) => t.title === a);
  expect(chatA).toBeTruthy();
  expect((await request.post('/api/inbox/threads', { data: { ids: [chatA!.id], action: 'addFolder', folderId: first.folder.id } })).ok()).toBe(true);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const side = page.locator('#side-branch');
  // La entrada va arriba del árbol, antes de la primera carpeta.
  const entry = side.getByTestId('inbox-nofolder');
  await expect(side.locator('.ib-ftree > li').first()).toHaveAttribute('data-testid', 'inbox-nofolder', { timeout: 15_000 });
  await entry.getByRole('link').click();
  await expect(page).toHaveURL(/\/app\/inbox\/v\/nofolder/);
  await expect(entry).toHaveClass(/active/);
  await expect(page.getByRole('heading', { level: 1, name: 'No folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit folder' })).toHaveCount(0);

  const list = page.locator('.ib-list');
  await expect(list.locator('.ib-item', { hasText: b })).toBeVisible();
  await expect(list.locator('.ib-item', { hasText: c })).toBeVisible();
  await expect(list.locator('.ib-item', { hasText: a })).toHaveCount(0);

  // V (sumar a carpeta) desde la fila: el chat sale de la lista enseguida, con deshacer.
  await list.locator('.ib-item', { hasText: b }).locator('.ib-row-btn').focus();
  await page.keyboard.press('v');
  const move = page.getByRole('dialog', { name: 'Add to folder' });
  await move.getByRole('textbox').fill(`Folder 2 ${tag}`);
  await move.getByRole('textbox').press('Enter');
  await expect(list.locator('.ib-item', { hasText: b })).toHaveCount(0, { timeout: 15_000 });
  await expect(list.locator('.ib-item', { hasText: c })).toBeVisible();
  const toast = page.locator('.ib-toast', { hasText: 'Added to the folder' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(list.locator('.ib-item', { hasText: b })).toBeVisible();

  // Link directo: la misma vista al recargar.
  await page.goto('/en/app/inbox/v/nofolder', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'No folder' })).toBeVisible();
  await expect(page.locator('.ib-list .ib-item', { hasText: a })).toHaveCount(0);
});

test('Lines: Sin carpeta arriba del árbol, filtra y sumar a una carpeta lo saca', async ({ page, request }) => {
  const tag = uid();
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Line ${tag}` } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const send = async (name: string) => {
    const res = await request.post(new URL(webhookUrl).pathname, {
      data: { events: [{ type: 'message', chatId: `${phone()}@c.us`, isGroup: false, fromMe: false, senderPhone: phone(), senderName: name, providerMessageId: `ln-${uid()}`, body: 'test message' }] },
    });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const [a, b] = [`Chat A ${tag}`, `Chat B ${tag}`];
  await send(a);
  await send(b);
  const folder = (await (await request.post('/api/groups/folders', { data: { name: `Folder ${tag}` } })).json()) as { id: string };
  const found = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(a)}`)).json()) as { rows: Array<{ id: string }> };
  await request.post('/api/groups/chats/bulk', { data: { ids: [found.rows[0].id], action: 'folder', folderId: folder.id } });

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const side = page.locator('#side-branch').getByTestId('lines-folders');
  await expect(side.locator('.grf-ftree > li').first()).toHaveAttribute('data-testid', 'lines-nofolder', { timeout: 15_000 });
  await side.getByTestId('lines-nofolder').getByRole('link').click();
  await expect(page).toHaveURL(/folder=none/);
  await expect(page.getByText(b).first()).toBeVisible();
  await expect(page.getByText(a)).toHaveCount(0);

  // Menú de la fila, "Mover a carpeta": sale de la lista enseguida.
  await page.locator('.gr-row-item', { hasText: b }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to folder' }).click();
  await page.getByRole('dialog', { name: 'Move to folder' }).getByRole('button', { name: `Folder ${tag}` }).click();
  await expect(page.locator('.gr-row-item', { hasText: b })).toHaveCount(0, { timeout: 15_000 });
  await request.delete(`/api/groups/folders?id=${folder.id}`);
});
