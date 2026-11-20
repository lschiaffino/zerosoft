import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { setTheme } from './responsive-audit';

/**
 * Lines: la bandeja como kanban. El botón junto al selector de línea (solo en
 * la bandeja de Lines) la prende; se crean dos etapas del equipo, una tarjeta
 * se mueve arrastrando (escritorio) y con "Mover a…" (también en el teléfono),
 * y al recargar sigue ahí. Otra persona (cookie zs_e2e_as) no ve las etapas
 * personales de la primera. El tablero de una propiedad de HubSpot (portal
 * falso) muestra sus opciones y mover escribe el valor. Búsqueda, pestañas y
 * carpetas achican el tablero. A 1280 y a 390, sin scroll lateral de la
 * página; los menús cierran con Esc y con un clic afuera. Proveedor falso,
 * nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const TOKEN = 'pat-na1-e2e-lines-kanban';
const LOOKS = ['current', 'liquid', 'retro'] as const;

test.describe.configure({ mode: 'serial' });

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
  const email = `kanban-${uid()}@lines-e2e.io`;
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

/** Una línea conectada (visible para todo el workspace) con dos chats de contactos inventados. */
async function lineWithChats(request: APIRequestContext, name: string, contacts: string[]) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name } });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 15_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  for (const contact of contacts) {
    const p = phone();
    const res = await request.post(new URL(webhookUrl).pathname, {
      data: { events: [{ type: 'message', chatId: `${p}@c.us`, isGroup: false, fromMe: false, senderPhone: p, senderName: contact, providerMessageId: `e2e-kb-${uid()}`, body: 'hola', timestamp: new Date().toISOString() }] },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
  const list = (await (await request.get(`/api/groups/chats?number=${id}&meta=0`)).json()) as { rows: Array<{ id: string; name: string }> };
  expect(list.rows).toHaveLength(contacts.length);
  return { id, chats: contacts.map((c) => list.rows.find((r) => r.name === c)!.id) };
}

type BoardJson = { board: string; columns: Array<{ id: string; name: string; count: number; cards: Array<{ id: string }> }>; readOnly: string | null };
const boardOf = async (request: APIRequestContext, q: string) => (await (await request.get(`/api/groups/kanban?${q}`)).json()) as BoardJson;
const columnOfCard = (b: BoardJson, chatId: string) => b.columns.find((c) => c.cards.some((x) => x.id === chatId))?.id ?? null;
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (p: Page, name: string) => {
  const dir = process.env.LINES_SHOTS_DIR;
  if (dir) await p.screenshot({ path: `${dir}/kanban-${name}.png`, fullPage: false, animations: 'disabled' });
};
const card = (p: Page, chatId: string) => p.locator(`[data-testid="kanban-card"][data-chat-id="${chatId}"]`);
const column = (p: Page, id: string) => p.locator(`[data-testid="kanban-column"][data-column-id="${id}"]`);
const columnNamed = (p: Page, name: string) => p.getByTestId('kanban-column').filter({ has: p.getByRole('heading', { name, exact: true }) });

/** "Mover a…" en la tarjeta: el menú, y la columna. */
async function moveWithMenu(p: Page, c: Locator, name: string, target: string) {
  await c.getByRole('button', { name: `Move ${name} to…` }).click();
  await p.getByRole('menuitem', { name: target, exact: true }).click();
}

/** Busca en la bandeja (el tablero usa la misma búsqueda). */
async function search(p: Page, text: string) {
  const box = p.getByRole('searchbox', { name: 'Search chats and messages' }).first();
  await box.fill(text);
  await box.press('Enter');
}

for (const size of [
  { width: 1280, height: 900 },
  { width: 390, height: 800 },
]) {
  const wide = size.width >= 1000;

  test(`kanban de la bandeja: etapas del equipo, mover, recargar, mis etapas y filtros (${size.width}px)`, async ({ browser, page, request, baseURL }) => {
    test.setTimeout(process.env.LINES_SHOTS_DIR ? 900_000 : 300_000);
    const tag = uid();
    const names = [`Kanban Uno ${tag}`, `Kanban Dos ${tag}`];
    const line = await lineWithChats(request, `Linea kanban ${tag}`, names);
    const [uno, dos] = line.chats;
    const made: string[] = [];
    let mineId = '';
    const b = await member(browser, `Bea Kanban ${tag}`, size);
    try {
      await request.put('/api/groups/kanban', { data: { on: false, board: 'team' } });
      // Con next dev cada ruta compila en su primer pedido: que no le toque a un paso con espera corta.
      await request.get('/api/groups/kanban/stages?scope=team');
      await request.post('/api/groups/kanban/move', { data: {} });
      expect((await request.get(`/en/app/lines/inbox/${dos}`)).status()).toBe(200);
      await page.setViewportSize(size);

      // ---------- El botón solo está en la bandeja de Lines ----------
      await page.goto('/en/app/lines/tickets', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main, body').first()).toBeVisible();
      await expect(page.getByTestId('lines-kanban-toggle')).toHaveCount(0);
      await page.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
      const toggle = page.getByTestId('lines-kanban-toggle');
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      // En escritorio va en la banda de arriba, después del selector de línea.
      if (wide) await expect(page.locator('#band-app-slot').getByTestId('lines-kanban-toggle')).toBeVisible({ timeout: 30_000 });
      // Un clic antes de que la página termine de hidratar no hace nada: se reintenta hasta que queda prendido.
      await expect(async () => {
        if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 });
      }).toPass({ timeout: 45_000 });
      await expect(page.getByTestId('lines-kanban')).toBeVisible({ timeout: 30_000 });
      await search(page, tag);
      // Un servidor recién levantado (next dev) puede tardar en la primera lectura: el tablero se relee solo.
      await expect(card(page, uno)).toBeVisible({ timeout: 90_000 });
      await expect(card(page, dos)).toBeVisible();

      // ---------- Dos etapas del equipo (admin) ----------
      for (const stage of [`Onb ${tag}`, `Live ${tag}`]) {
        await page.getByTestId('kanban-new-stage').click();
        const dialog = page.getByRole('dialog', { name: 'New stage' });
        await expect(dialog).toBeVisible();
        await dialog.getByTestId('kanban-stage-name').fill(stage);
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden({ timeout: 30_000 });
        await expect(columnNamed(page, stage)).toBeVisible({ timeout: 15_000 });
      }
      const stages = (await (await request.get('/api/groups/kanban/stages?scope=team')).json()) as { stages: Array<{ id: string; name: string }> };
      const onb = stages.stages.find((s) => s.name === `Onb ${tag}`)!.id;
      const live = stages.stages.find((s) => s.name === `Live ${tag}`)!.id;
      made.push(onb, live);
      await shot(page, `board-${size.width}`);
      expect(await overflow(page)).toBeLessThanOrEqual(1);

      // ---------- Mover: arrastrando (escritorio) y con "Mover a…" ----------
      if (wide) {
        await card(page, uno).dragTo(column(page, onb));
        await expect(column(page, onb).locator(`[data-chat-id="${uno}"]`)).toBeVisible();
        await expect.poll(async () => columnOfCard(await boardOf(request, `board=team&q=${tag}`), uno), { timeout: 30_000 }).toBe(onb);
      } else {
        await moveWithMenu(page, card(page, uno), names[0], `Onb ${tag}`);
        await expect.poll(async () => columnOfCard(await boardOf(request, `board=team&q=${tag}`), uno), { timeout: 30_000 }).toBe(onb);
      }
      await moveWithMenu(page, card(page, dos), names[1], `Live ${tag}`);
      await expect.poll(async () => columnOfCard(await boardOf(request, `board=team&q=${tag}`), dos), { timeout: 30_000 }).toBe(live);
      if (!wide) await column(page, live).scrollIntoViewIfNeeded();
      await expect(column(page, live).locator(`[data-chat-id="${dos}"]`)).toBeVisible();

      // Menús: Esc y clic afuera los cierran.
      await card(page, dos).getByRole('button', { name: `Move ${names[1]} to…` }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await page.getByTestId('lines-kanban-board').click();
      await expect(page.getByRole('listbox')).toBeVisible();
      // Un clic afuera (en el margen del tablero, que no hace nada; el menú abierto tapa las primeras columnas).
      await page.locator('.gr-kanban-cols').click({ position: { x: 4, y: 300 } });
      await expect(page.getByRole('listbox')).toHaveCount(0);

      // ---------- Recargar: sigue en kanban y la tarjeta en su columna ----------
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('lines-kanban')).toBeVisible({ timeout: 30_000 });
      await search(page, tag);
      await expect(column(page, onb).locator(`[data-chat-id="${uno}"]`)).toBeVisible({ timeout: 30_000 });

      // Abrir una tarjeta abre el chat.
      await card(page, dos).getByRole('link').click();
      await expect(page).toHaveURL(new RegExp(`/app/lines/inbox/${dos}`), { timeout: 60_000 });
      const back = page.locator('.gr-thread .gr-back');
      await expect(back).toBeVisible({ timeout: 60_000 });
      await shot(page, `chat-${size.width}`);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await back.click();
      await expect(page).toHaveURL(/\/app\/lines\/inbox(\?.*)?$/, { timeout: 30_000 });

      // ---------- Filtros y carpetas achican las tarjetas ----------
      const groupsTab = page.getByRole('tab', { name: 'Groups' });
      await expect(card(page, uno)).toBeVisible({ timeout: 30_000 });
      await groupsTab.click();
      await expect(groupsTab).toHaveAttribute('aria-selected', 'true');
      await expect(card(page, uno)).toHaveCount(0, { timeout: 30_000 });
      // Las pestañas no se apagan solas: "All" vuelve a todos.
      await page.getByRole('tab', { name: 'All' }).click();
      await expect(groupsTab).toHaveAttribute('aria-selected', 'false');
      await expect(card(page, uno)).toBeVisible({ timeout: 30_000 });
      const folder = await request.post('/api/groups/folders', { data: { name: `Kanban carpeta ${tag}` } });
      const folderId = ((await folder.json()) as { id: string }).id;
      await request.post('/api/groups/chats/bulk', { data: { ids: [uno], action: 'folder', folderId } });
      await page.goto(`/en/app/lines/inbox?folder=${folderId}`, { waitUntil: 'domcontentloaded' });
      await expect(card(page, uno)).toBeVisible({ timeout: 30_000 });
      await expect(card(page, dos)).toHaveCount(0, { timeout: 30_000 });
      await request.delete(`/api/groups/folders?id=${folderId}`);

      // ---------- Mis etapas: las de A no las ve B ----------
      const mine = await request.post('/api/groups/kanban/stages', { data: { scope: 'me', name: `Mia ${tag}` } });
      expect(mine.status()).toBe(201);
      mineId = ((await mine.json()) as { id: string }).id;
      expect((await request.post('/api/groups/kanban/move', { data: { chatId: uno, board: 'me', column: mineId } })).status()).toBe(200);
      const br = b.ctx.request;
      expect(((await (await br.get('/api/groups/kanban/stages?scope=me')).json()) as { stages: unknown[] }).stages).toEqual([]);
      expect((await br.post('/api/groups/kanban/move', { data: { chatId: uno, board: 'me', column: mineId } })).status()).toBe(404);
      expect((await br.patch('/api/groups/kanban/stages', { data: { scope: 'me', id: mineId, name: 'x' } })).status()).toBe(404);
      expect((await br.delete(`/api/groups/kanban/stages?scope=me&id=${mineId}`)).status()).toBe(404);
      await br.put('/api/groups/kanban', { data: { on: true, board: 'me' } });
      const bp = await b.ctx.newPage();
      await bp.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
      await expect(bp.getByTestId('lines-kanban')).toBeVisible({ timeout: 30_000 });
      await search(bp, tag);
      await expect(card(bp, uno)).toBeVisible({ timeout: 30_000 });
      await expect(bp.getByText(`Mia ${tag}`)).toHaveCount(0);
      await expect(bp.getByTestId('kanban-column')).toHaveCount(1);
      // Las etapas del equipo sí las ve, sin poder editarlas.
      await bp.getByTestId('lines-kanban-board').click();
      await bp.getByRole('option', { name: 'Team stages' }).click();
      await expect(columnNamed(bp, `Onb ${tag}`)).toBeVisible();
      await expect(bp.getByTestId('kanban-new-stage')).toHaveCount(0);
      expect(await overflow(bp)).toBeLessThanOrEqual(1);
      await bp.close();

      // ---------- Capturas en los aspectos (solo local) ----------
      if (process.env.LINES_SHOTS_DIR) {
        try {
          for (const look of LOOKS) {
            for (const theme of ['light', 'dark'] as const) {
              if (look !== 'current' && theme === 'dark') continue;
              await request.put('/api/profile/look', { data: { look } });
              await setTheme(page.context(), baseURL!, theme);
              await page.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
              await search(page, tag);
              await expect(card(page, uno)).toBeVisible({ timeout: 30_000 });
              await shot(page, `${look}-${theme}-${size.width}`);
              expect(await overflow(page)).toBeLessThanOrEqual(1);
            }
          }
        } finally {
          await request.put('/api/profile/look', { data: { look: 'current' } });
          await setTheme(page.context(), baseURL!, 'light');
        }
      }
    } finally {
      for (const id of made) await request.delete(`/api/groups/kanban/stages?scope=team&id=${id}`).catch(() => null);
      if (mineId) await request.delete(`/api/groups/kanban/stages?scope=me&id=${mineId}`).catch(() => null);
      await request.put('/api/groups/kanban', { data: { on: false, board: 'team' } }).catch(() => null);
      await b.ctx.close();
    }
  });
}

test('kanban de HubSpot: las opciones de la propiedad son las columnas y mover escribe el valor (portal falso)', async ({ page, request }) => {
  test.setTimeout(240_000);
  const tag = uid();
  const name = `Kanban HubSpot ${tag}`;
  const line = await lineWithChats(request, `Linea kanban hs ${tag}`, [name]);
  const [chat] = line.chats;
  try {
    await request.delete('/api/groups/hubspot');
    await request.post('/api/groups/hubspot/fake', { data: { rateLimit: 0 } });
    await request.post('/api/groups/hubspot/fake', { data: { company: '9002', properties: { name: 'Globex Retail', plan_tier: 'starter' } } });
    const conn = await request.post('/api/groups/hubspot', { data: { token: TOKEN } });
    expect(conn.ok(), await conn.text()).toBe(true);
    const link = await request.post('/api/groups/hubspot/links', { data: { chatId: chat, type: 'company', objectId: '9002' } });
    expect(link.ok(), await link.text()).toBe(true);
    await request.put('/api/groups/kanban', { data: { on: true, board: 'hs:plan_tier' } });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/en/app/lines/inbox', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('lines-kanban')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('lines-kanban-board')).toContainText('Plan');
    await search(page, tag);
    for (const option of ['No value', 'Starter', 'Growth', 'Scale']) await expect(columnNamed(page, option)).toBeVisible();
    await expect(column(page, 'starter').locator(`[data-chat-id="${chat}"]`)).toBeVisible({ timeout: 30_000 });
    await shot(page, 'hubspot-1280');

    await moveWithMenu(page, card(page, chat), name, 'Scale');
    await expect(column(page, 'scale').locator(`[data-chat-id="${chat}"]`)).toBeVisible();
    await expect
      .poll(async () => ((await (await request.get('/api/groups/hubspot/fake?company=9002')).json()) as { properties: Record<string, string> }).properties.plan_tier, { timeout: 30_000 })
      .toBe('scale');
    // Sin cambios en otras empresas, y el tablero de la API dice lo mismo.
    expect(columnOfCard(await boardOf(request, `board=hs:plan_tier&q=${tag}`), chat)).toBe('scale');
  } finally {
    await request.post('/api/groups/hubspot/fake', { data: { company: '9002', properties: { plan_tier: 'starter' } } }).catch(() => null);
    await request.put('/api/groups/kanban', { data: { on: false, board: 'team' } }).catch(() => null);
    await request.delete('/api/groups/hubspot').catch(() => null);
  }
});
