import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { setTheme } from './responsive-audit';

/**
 * Lines: las carpetas son de cada persona. A crea una carpeta y guarda un chat;
 * B (otra persona del mismo workspace, que ve el mismo chat) no ve esa carpeta,
 * tiene el chat sin carpeta y no puede tocar la de A por la API. B crea la suya
 * desde "Mover a carpeta" y el chat queda en una carpeta distinta para cada uno.
 * A 1280 y a 390. Proveedor falso (GROUPS_FAKE=1), nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function as(browser: Browser, email: string, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

/** Un member del workspace demo, con su cuenta creada y el workspace demo activo. */
async function member(browser: Browser, name: string, viewport: { width: number; height: number }) {
  const email = `carpetas-${uid()}@lines-e2e.io`;
  const demo = await as(browser, 'session-demo', viewport);
  await demo.request.get('/api/teams/members');
  await demo.close();
  const ctx = await as(browser, email, viewport);
  const first = await ctx.request.get('/api/teams/members');
  expect(first.status(), await first.text()).toBeLessThan(500);
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  const team = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  await sql("UPDATE users SET name = ?, onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [name, team, id]);
  await sql("INSERT OR REPLACE INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, id]);
  return { ctx, id };
}

/** Una línea conectada (visible para todo el workspace) con un chat de un contacto inventado, con fecha de ahora. */
async function lineWithChat(request: APIRequestContext, name: string, contact: string) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 15_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const p = phone();
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: { events: [{ type: 'message', chatId: `${p}@c.us`, isGroup: false, fromMe: false, senderPhone: p, senderName: contact, providerMessageId: `e2e-pf-${uid()}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const list = (await (await request.get(`/api/groups/chats?number=${id}&meta=0`)).json()) as { rows: Array<{ id: string }> };
  expect(list.rows).toHaveLength(1);
  return { id, chatId: list.rows[0].id };
}

type Folders = { folders: Array<{ id: string; name: string; chats: number }> };
const foldersOf = async (request: APIRequestContext) => ((await (await request.get('/api/groups/folders')).json()) as Folders).folders;
const folderOfChat = async (request: APIRequestContext, numberId: string, chatId: string) =>
  ((await (await request.get(`/api/groups/chats?number=${numberId}&meta=0`)).json()) as { rows: Array<{ id: string; folderId: string | null }> }).rows.find((c) => c.id === chatId)?.folderId;
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (p: Page, name: string) => {
  const dir = process.env.LINES_SHOTS_DIR;
  if (dir) await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false, animations: 'disabled' });
};

for (const size of [
  { width: 1280, height: 900 },
  { width: 390, height: 800 },
]) {
  test(`cada persona tiene sus carpetas y su propio orden de chats (${size.width}px)`, async ({ browser, page, request, baseURL }) => {
    test.setTimeout(process.env.LINES_SHOTS_LOOKS ? 900_000 : 300_000);
    const tag = uid();
    const wide = size.width >= 1000;
    const b = await member(browser, `Beto Carpetas ${tag}`, size);
    const line = await lineWithChat(request, `Linea carpetas ${tag}`, `Cliente PF ${tag}`);
    const mine: string[] = [];
    try {
      // ---------- A: crea una carpeta y guarda el chat ----------
      const made = await request.post('/api/groups/folders', { data: { name: `Clientes ${tag}` } });
      expect(made.status(), await made.text()).toBe(201);
      const folderA = ((await made.json()) as { id: string }).id;
      mine.push(folderA);
      const filed = await request.post('/api/groups/chats/bulk', { data: { ids: [line.chatId], action: 'folder', folderId: folderA } });
      expect(((await filed.json()) as { updated: number }).updated).toBe(1);
      await page.setViewportSize(size);
      await page.goto(`/en/app/lines/inbox?folder=${folderA}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(`[data-testid="chat-row"][data-chat-id="${line.chatId}"]`)).toBeVisible({ timeout: 30_000 });
      if (wide) await expect(page.locator('#side-branch').getByTestId('lines-folder').filter({ hasText: `Clientes ${tag}` })).toBeVisible();
      else await expect(page.getByTestId('lines-folder-select')).toContainText(`Clientes ${tag}`);

      // ---------- B: no ve la carpeta de A, y el chat está sin carpeta ----------
      const br = b.ctx.request;
      expect((await foldersOf(br)).filter((f) => f.id === folderA || f.name === `Clientes ${tag}`)).toEqual([]);
      expect(await folderOfChat(br, line.id, line.chatId)).toBeNull();
      expect(((await (await br.get(`/api/groups/chats?folder=${folderA}&meta=0`)).json()) as { rows: unknown[] }).rows).toEqual([]);
      // Por id tampoco: renombrar, borrar o mover chats adentro responde como una carpeta que no existe.
      expect((await br.patch('/api/groups/folders', { data: { id: folderA, name: 'Otra' } })).status()).toBe(404);
      expect((await br.delete(`/api/groups/folders?id=${folderA}`)).status()).toBe(404);
      expect((await br.post('/api/groups/chats/bulk', { data: { ids: [line.chatId], action: 'folder', folderId: folderA } })).status()).toBe(404);

      const bp = await b.ctx.newPage();
      // Con ?folder= de la carpeta de A, B no recibe ningún chat.
      await bp.goto(`/en/app/lines/inbox?folder=${folderA}`, { waitUntil: 'networkidle' });
      await expect(bp.locator(`[data-chat-id="${line.chatId}"]`)).toHaveCount(0);
      await bp.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
      const row = bp.locator(`[data-testid="chat-row"][data-chat-id="${line.chatId}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      if (wide) {
        const side = bp.locator('#side-branch').getByTestId('lines-folders');
        await expect(side).toBeVisible();
        await expect(side.getByTestId('lines-folder')).toHaveCount(0);
        // Sin carpetas todavía: el botón para crear la primera está a la vista.
        await expect(side.getByTestId('lines-folder-new')).toBeVisible();
      } else {
        await expect(bp.getByTestId('lines-folder-select')).toHaveCount(0);
      }
      await expect(bp.getByText(`Clientes ${tag}`)).toHaveCount(0);

      // ---------- B: crea la suya desde "Mover a carpeta" ----------
      const dialog = bp.getByRole('dialog', { name: 'Move to folder' });
      const openMove = async () => {
        await expect(async () => {
          if (!(await dialog.isVisible())) {
            await row.click({ button: 'right', timeout: 5_000 });
            await bp.getByRole('menuitem', { name: 'Move to folder' }).click({ timeout: 5_000 });
          }
          await expect(dialog).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
      };
      await openMove();
      await expect(dialog.getByRole('button', { name: `Clientes ${tag}` })).toHaveCount(0);
      await expect(dialog.getByTestId('lines-move-new-folder')).toBeVisible();
      await shot(bp, `move-empty-${size.width}`);
      expect(await overflow(bp)).toBeLessThanOrEqual(1);
      // Esc cierra sin crear nada.
      await bp.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      expect((await foldersOf(br)).filter((f) => f.name.endsWith(tag))).toEqual([]);

      // Solo local (LINES_SHOTS_DIR y LINES_SHOTS_LOOKS): el diálogo vacío en los cinco aspectos, claro y oscuro.
      if (process.env.LINES_SHOTS_DIR && process.env.LINES_SHOTS_LOOKS) {
        try {
          for (const look of LOOKS) {
            for (const theme of ['light', 'dark'] as const) {
              await br.put('/api/profile/look', { data: { look } });
              await setTheme(b.ctx, baseURL!, theme);
              await bp.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
              await expect(row).toBeVisible({ timeout: 30_000 });
              await shot(bp, `inbox-${look}-${theme}-${size.width}`);
              await openMove();
              await dialog.getByTestId('lines-move-new-folder').click();
              await shot(bp, `move-new-${look}-${theme}-${size.width}`);
              expect(await overflow(bp)).toBeLessThanOrEqual(1);
              await bp.keyboard.press('Escape');
              await expect(dialog).toBeHidden();
            }
          }
        } finally {
          await br.put('/api/profile/look', { data: { look: 'current' } });
          await setTheme(b.ctx, baseURL!, 'light');
          await bp.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
          await expect(row).toBeVisible({ timeout: 30_000 });
        }
      }

      await openMove();
      await dialog.getByTestId('lines-move-new-folder').click();
      await dialog.getByTestId('lines-move-new-name').fill(`Urgentes ${tag}`);
      await dialog.getByTestId('lines-move-new-save').click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect.poll(async () => (await foldersOf(br)).filter((f) => f.name === `Urgentes ${tag}`).map((f) => f.chats), { timeout: 15_000 }).toEqual([1]);
      const folderB = (await foldersOf(br)).find((f) => f.name === `Urgentes ${tag}`)!.id;
      expect(await folderOfChat(br, line.id, line.chatId)).toBe(folderB);
      if (wide) await expect(bp.locator('#side-branch').getByTestId('lines-folder').filter({ hasText: `Urgentes ${tag}` })).toBeVisible({ timeout: 15_000 });
      else await expect(bp.getByTestId('lines-folder-select')).toBeVisible({ timeout: 15_000 });
      expect(await overflow(bp)).toBeLessThanOrEqual(1);
      await shot(bp, `after-${size.width}`);

      // ---------- A: lo suyo quedó como estaba, y no ve la carpeta de B ----------
      const forA = await foldersOf(request);
      expect(forA.find((f) => f.id === folderA)).toMatchObject({ name: `Clientes ${tag}`, chats: 1 });
      expect(forA.filter((f) => f.id === folderB || f.name === `Urgentes ${tag}`)).toEqual([]);
      expect(await folderOfChat(request, line.id, line.chatId)).toBe(folderA);
      expect((await request.delete(`/api/groups/folders?id=${folderB}`)).status()).toBe(404);
      await br.delete(`/api/groups/folders?id=${folderB}`);
    } finally {
      for (const id of mine) await request.delete(`/api/groups/folders?id=${id}`);
      await request.delete(`/api/groups/numbers/${line.id}`);
      await b.ctx.close();
    }
  });
}
