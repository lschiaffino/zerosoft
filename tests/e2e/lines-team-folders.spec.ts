import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { setTheme } from './responsive-audit';

/**
 * Lines: carpetas del equipo junto a las de cada persona. El admin (la sesión
 * demo, dueña del workspace) crea una carpeta del equipo y una subcarpeta; B
 * (un member del mismo workspace) las ve, sin menú para administrarlas y con
 * 403 por la API, y pone un chat en la subcarpeta desde "Mover a carpeta"; el
 * admin lo ve ahí. Las carpetas personales de cada uno siguen siendo privadas.
 * A 1280 y a 390. Proveedor falso (GROUPS_FAKE=1), nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
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
  const email = `equipo-${uid()}@lines-e2e.io`;
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
    data: { events: [{ type: 'message', chatId: `${p}@c.us`, isGroup: false, fromMe: false, senderPhone: p, senderName: contact, providerMessageId: `e2e-tf-${uid()}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const list = (await (await request.get(`/api/groups/chats?number=${id}&meta=0`)).json()) as { rows: Array<{ id: string }> };
  expect(list.rows).toHaveLength(1);
  return { id, chatId: list.rows[0].id };
}

type Folder = { id: string; name: string; parentId: string | null; chats: number };
type Folders = { folders: Folder[]; team: Folder[]; canManageTeam: boolean };
const foldersOf = async (request: APIRequestContext) => (await (await request.get('/api/groups/folders')).json()) as Folders;
const chatOf = async (request: APIRequestContext, numberId: string, chatId: string) =>
  ((await (await request.get(`/api/groups/chats?number=${numberId}&meta=0`)).json()) as { rows: Array<{ id: string; folderId: string | null; teamFolderId?: string | null }> }).rows.find(
    (c) => c.id === chatId,
  );
const moveTo = async (request: APIRequestContext, chatId: string, folderId: string) =>
  expect((await request.post('/api/groups/chats/bulk', { data: { ids: [chatId], action: 'folder', folderId } })).status()).toBe(200);
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (p: Page, name: string) => {
  const dir = process.env.LINES_SHOTS_DIR;
  if (dir) await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false, animations: 'disabled' });
};

for (const size of [
  { width: 1280, height: 900 },
  { width: 390, height: 800 },
]) {
  test(`carpetas del equipo: el admin las crea, todos las ven y cualquiera pone chats (${size.width}px)`, async ({ browser, page, request, baseURL }) => {
    test.setTimeout(process.env.CI ? 300_000 : 900_000);
    const tag = uid();
    const wide = size.width >= 1000;
    const teamName = `Ventas ${tag}`;
    const subName = `Norte ${tag}`;
    const b = await member(browser, `Beto Equipo ${tag}`, size);
    const line = await lineWithChat(request, `Linea equipo ${tag}`, `Cliente TF ${tag}`);
    const teamIds: string[] = [];
    const personal: Array<{ request: APIRequestContext; id: string }> = [];
    try {
      await page.setViewportSize(size);
      const forAdmin = await foldersOf(request);
      expect(forAdmin.canManageTeam).toBe(true);

      // ---------- Admin: crea la carpeta del equipo y una subcarpeta ----------
      if (wide) {
        await page.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
        const side = page.locator('#side-branch').getByTestId('lines-folders');
        await side.getByTestId('lines-team-folder-new').click();
        const create = page.getByRole('dialog', { name: 'New team folder' });
        await create.getByLabel('Folder name').fill(teamName);
        await create.getByRole('button', { name: 'Save' }).click();
        await expect(create).toBeHidden({ timeout: 15_000 });
        const teamRow = side.getByTestId('lines-team-folders').getByTestId('lines-team-folder').filter({ hasText: teamName });
        await expect(teamRow).toBeVisible({ timeout: 15_000 });
        // El menú de la carpeta del equipo: se cierra con un clic afuera y con Esc.
        const menu = page.getByTestId('lines-folder-menu');
        await teamRow.hover();
        await side.getByRole('button', { name: `Actions for ${teamName}` }).click();
        await expect(menu).toBeVisible();
        await page.mouse.click(900, 500);
        await expect(menu).toHaveCount(0);
        await teamRow.hover();
        await side.getByRole('button', { name: `Actions for ${teamName}` }).click();
        await expect(menu).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await teamRow.hover();
        await side.getByRole('button', { name: `Actions for ${teamName}` }).click();
        await menu.getByRole('menuitem', { name: 'New subfolder' }).click();
        const sub = page.getByRole('dialog', { name: 'New team subfolder' });
        await sub.getByLabel('Folder name').fill(subName);
        await sub.getByRole('button', { name: 'Save' }).click();
        await expect(sub).toBeHidden({ timeout: 15_000 });
        await expect(side.getByTestId('lines-team-folder').filter({ hasText: subName })).toBeVisible({ timeout: 15_000 });
      } else {
        // En el teléfono el árbol no está a la vista: las crea por la API y la bandeja ofrece el selector.
        const made = await request.post('/api/groups/folders', { data: { name: teamName, team: true } });
        expect(made.status(), await made.text()).toBe(201);
        const parentId = ((await made.json()) as { id: string }).id;
        expect((await request.post('/api/groups/folders', { data: { name: subName, team: true, parentId } })).status()).toBe(201);
      }
      const team = (await foldersOf(request)).team;
      const ventas = team.find((f) => f.name === teamName)!;
      const norte = team.find((f) => f.name === subName)!;
      expect(norte.parentId).toBe(ventas.id);
      teamIds.push(ventas.id);
      // La personal del admin: B nunca la ve.
      const mine = await request.post('/api/groups/folders', { data: { name: `Admin propia ${tag}` } });
      personal.push({ request, id: ((await mine.json()) as { id: string }).id });

      // ---------- B: las ve, sin poder administrarlas ----------
      const br = b.ctx.request;
      const forB = await foldersOf(br);
      expect(forB.canManageTeam).toBe(false);
      expect(forB.team.filter((f) => f.name.endsWith(tag)).map((f) => f.name).sort()).toEqual([subName, teamName].sort());
      expect(forB.folders.filter((f) => f.name.endsWith(tag))).toEqual([]);
      expect((await br.patch('/api/groups/folders', { data: { id: ventas.id, name: 'Otra' } })).status()).toBe(403);
      expect((await br.delete(`/api/groups/folders?id=${ventas.id}`)).status()).toBe(403);
      expect((await br.post('/api/groups/folders', { data: { name: `Intruso ${tag}`, team: true } })).status()).toBe(403);
      const bp = await b.ctx.newPage();
      await bp.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
      const row = bp.locator(`[data-testid="chat-row"][data-chat-id="${line.chatId}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      if (wide) {
        const side = bp.locator('#side-branch').getByTestId('lines-folders');
        const teamSec = side.getByTestId('lines-team-folders');
        await expect(teamSec.getByTestId('lines-team-folder').filter({ hasText: teamName })).toBeVisible({ timeout: 15_000 });
        await expect(teamSec.getByTestId('lines-team-folder').filter({ hasText: subName })).toBeVisible();
        // Sin menú ni "+" para las del equipo; las suyas sí se crean.
        await teamSec.getByTestId('lines-team-folder').filter({ hasText: teamName }).hover();
        await expect(side.getByRole('button', { name: `Actions for ${teamName}` })).toHaveCount(0);
        await expect(side.getByTestId('lines-team-folder-new')).toHaveCount(0);
        await expect(side.getByTestId('lines-my-folders').getByTestId('lines-folder-new')).toBeVisible();
        await expect(side.getByText(`Admin propia ${tag}`)).toHaveCount(0);
      } else {
        const select = bp.getByTestId('lines-folder-select');
        await expect(select).toBeVisible({ timeout: 15_000 });
        await select.click();
        const list = bp.getByRole('listbox', { name: 'Folders' });
        await expect(list.getByRole('option', { name: new RegExp(teamName) })).toBeVisible();
        await expect(list.getByRole('option', { name: new RegExp(subName) })).toBeVisible();
        await expect(list.getByRole('option', { name: new RegExp(`Admin propia ${tag}`) })).toHaveCount(0);
        await shot(bp, `select-member-${size.width}`);
        expect(await overflow(bp)).toBeLessThanOrEqual(1);
        await bp.keyboard.press('Escape');
        await expect(list).toHaveCount(0);
      }

      // ---------- B: pone el chat en la subcarpeta del equipo desde "Mover a carpeta" ----------
      const dialog = bp.getByRole('dialog', { name: 'Move to folder' });
      const openMove = () =>
        expect(async () => {
          if (!(await dialog.isVisible())) {
            await row.click({ button: 'right', timeout: 5_000 });
            await bp.getByRole('menuitem', { name: 'Move to folder' }).click({ timeout: 5_000 });
          }
          await expect(dialog).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
      await openMove();
      await expect(dialog.getByTestId('lines-move-team').getByRole('button', { name: teamName })).toBeVisible();
      await shot(bp, `move-member-${size.width}`);
      expect(await overflow(bp)).toBeLessThanOrEqual(1);
      await dialog.getByTestId('lines-move-team').getByRole('button', { name: subName }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect.poll(async () => (await chatOf(br, line.id, line.chatId))?.teamFolderId, { timeout: 30_000 }).toBe(norte.id);
      // Su carpeta personal no cambió (no tenía), y la del admin tampoco.
      expect((await chatOf(br, line.id, line.chatId))?.folderId).toBeNull();
      // Sacarlo de la carpeta del equipo pregunta antes (es para todos), y "No" (lo que queda enfocado) no lo saca.
      const ask = bp.getByRole('alertdialog', { name: `Also remove from the team folder “${subName}” for everyone?` });
      const askUnfile = async () => {
        await expect(async () => {
          await openMove();
          await expect(dialog.getByTestId('lines-move-team-none')).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
        await dialog.getByTestId('lines-move-team-none').click();
        await expect(ask).toBeVisible({ timeout: 15_000 });
        await expect(ask.getByTestId('confirm-dialog-cancel')).toBeFocused();
      };
      await askUnfile();
      await bp.keyboard.press('Enter');
      await expect(ask).toBeHidden();
      expect((await chatOf(br, line.id, line.chatId))?.teamFolderId).toBe(norte.id);

      // ---------- Admin: lo ve en la carpeta del equipo ----------
      expect(await chatOf(request, line.id, line.chatId)).toMatchObject({ teamFolderId: norte.id, folderId: null });
      await expect.poll(async () => (await foldersOf(request)).team.find((f) => f.id === norte.id)?.chats, { timeout: 30_000 }).toBe(1);
      await page.goto(`/en/app/lines/inbox?folder=${ventas.id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(`[data-testid="chat-row"][data-chat-id="${line.chatId}"]`)).toBeVisible({ timeout: 30_000 });
      if (wide) await expect(page.getByTestId('lines-folder-current')).toContainText(teamName);
      else await expect(page.getByTestId('lines-folder-select')).toContainText(teamName);
      expect(await overflow(page)).toBeLessThanOrEqual(1);

      // ---------- Personales de cada uno: privadas, y el mismo chat en las dos ----------
      const bMine = await br.post('/api/groups/folders', { data: { name: `Beto propia ${tag}` } });
      const bMineId = ((await bMine.json()) as { id: string }).id;
      personal.push({ request: br, id: bMineId });
      expect(((await (await br.post('/api/groups/chats/bulk', { data: { ids: [line.chatId], action: 'folder', folderId: bMineId } })).json()) as { updated: number }).updated).toBe(1);
      expect(await chatOf(br, line.id, line.chatId)).toMatchObject({ folderId: bMineId, teamFolderId: norte.id });
      expect((await foldersOf(request)).folders.filter((f) => f.id === bMineId)).toEqual([]);
      expect((await request.delete(`/api/groups/folders?id=${bMineId}`)).status()).toBe(404);
      expect((await br.delete(`/api/groups/folders?id=${personal[0].id}`)).status()).toBe(404);
      expect(((await (await request.get(`/api/groups/chats?folder=${bMineId}&meta=0`)).json()) as { rows: unknown[] }).rows).toEqual([]);

      // Capturas (solo local, con LINES_SHOTS_DIR): el lateral del admin con las dos secciones, claro y retro oscuro.
      if (process.env.LINES_SHOTS_DIR && wide) {
        try {
          for (const [look, theme] of [
            ['current', 'light'],
            ['retro', 'dark'],
          ] as const) {
            await request.put('/api/profile/look', { data: { look } });
            await setTheme(page.context(), baseURL!, theme);
            await page.goto(`/en/app/lines/inbox?folder=${norte.id}`, { waitUntil: 'domcontentloaded' });
            await expect(page.locator('#side-branch').getByTestId('lines-team-folder').filter({ hasText: subName })).toBeVisible({ timeout: 30_000 });
            await shot(page, `sidebar-${look}-${theme}-${size.width}`);
          }
        } finally {
          await request.put('/api/profile/look', { data: { look: 'current' } });
          await setTheme(page.context(), baseURL!, 'light');
        }
      }
      if (process.env.LINES_SHOTS_DIR && !wide) {
        await page.getByTestId('lines-folder-select').click();
        await shot(page, `select-admin-${size.width}`);
        await page.keyboard.press('Escape');
      }

      // ---------- B lo saca de la del equipo, confirmando: sale para todos y su carpeta personal sigue ----------
      await bp.reload({ waitUntil: 'domcontentloaded' });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await askUnfile();
      await ask.getByTestId('confirm-dialog-confirm').click();
      await expect.poll(async () => (await chatOf(request, line.id, line.chatId))?.teamFolderId, { timeout: 30_000 }).toBeNull();
      expect((await chatOf(br, line.id, line.chatId))?.folderId).toBe(bMineId);
      await moveTo(request, line.chatId, norte.id);

      // ---------- Admin borra la del equipo: el chat sale de ella, la personal de B sigue ----------
      expect((await request.delete(`/api/groups/folders?id=${ventas.id}`)).status()).toBe(200);
      teamIds.length = 0;
      expect(await chatOf(br, line.id, line.chatId)).toMatchObject({ folderId: bMineId, teamFolderId: null });
      expect((await foldersOf(br)).team.filter((f) => f.name.endsWith(tag))).toEqual([]);
    } finally {
      for (const id of teamIds) await request.delete(`/api/groups/folders?id=${id}`);
      for (const p of personal) await p.request.delete(`/api/groups/folders?id=${p.id}`);
      await request.delete(`/api/groups/numbers/${line.id}`);
      await b.ctx.close();
    }
  });
}
