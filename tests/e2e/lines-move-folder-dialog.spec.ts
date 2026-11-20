import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * "Mover a carpeta": el mismo diálogo en Lines y en Inbox (components/ui/FolderPickerDialog). Se filtra
 * escribiendo, las flechas marcan y Enter mueve a la marcada, "Sin carpeta" es la primera fila, la carpeta
 * actual va marcada, "+ Carpeta nueva" la crea ahí mismo y mueve el chat, Esc y un clic afuera cierran. A 1280
 * y a 390 (hoja de abajo, sin scroll de costado), con capturas de los dos en claro (Actual) y oscuro (Retro).
 * Proveedores falsos; nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const indent = (l: Locator) => l.evaluate((el) => parseFloat(getComputedStyle(el).paddingInlineStart));

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Capturas del diálogo abierto: claro con el aspecto Actual y oscuro con Retro (solo en esta página, sin tocar la cuenta). */
async function shots(page: Page, app: string, width: number) {
  for (const [look, theme] of [
    ['current', 'light'],
    ['retro', 'dark'],
  ] as const) {
    await page.evaluate(
      ([l, t]) => {
        document.documentElement.dataset.look = l;
        document.documentElement.dataset.theme = t;
      },
      [look, theme],
    );
    await page.screenshot({ path: test.info().outputPath(`move-${app}-${look}-${theme}-${width}.png`), animations: 'disabled' });
    const dir = process.env.MOVE_SHOTS_DIR;
    if (dir) await page.screenshot({ path: `${dir}/move-${app}-${look}-${theme}-${width}.png`, animations: 'disabled' });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.look = 'current';
    document.documentElement.dataset.theme = 'light';
  });
}

/** Esc cierra; abierto de nuevo, un clic en el telón (fuera de la hoja) también. */
async function closesOutside(page: Page, dialog: Locator, open: () => Promise<void>) {
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await open();
  const box = (await dialog.boundingBox())!;
  await page.mouse.click(Math.max(4, box.x / 2), Math.max(4, box.y / 2));
  await expect(dialog).toBeHidden();
}

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
    data: { events: [{ type: 'message', chatId: `${p}@c.us`, isGroup: false, fromMe: false, senderPhone: p, senderName: contact, providerMessageId: `e2e-mv-${uid()}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const list = (await (await request.get(`/api/groups/chats?number=${id}&meta=0`)).json()) as { rows: Array<{ id: string }> };
  expect(list.rows).toHaveLength(1);
  return { id, chatId: list.rows[0].id };
}

for (const size of [
  { width: 1280, height: 900 },
  { width: 390, height: 800 },
]) {
  test(`Lines: mover a carpeta con búsqueda, teclado, Sin carpeta y carpeta nueva (${size.width}px)`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const tag = uid();
    const line = await lineWithChat(request, `Linea mover ${tag}`, `Cliente MV ${tag}`);
    const made: string[] = [];
    const folder = async (name: string, parentId?: string) => {
      const r = await request.post('/api/groups/folders', { data: { name, parentId } });
      expect(r.status(), await r.text()).toBe(201);
      const { id } = (await r.json()) as { id: string };
      made.push(id);
      return id;
    };
    const folderOfChat = async () =>
      ((await (await request.get(`/api/groups/chats?number=${line.id}&meta=0`)).json()) as { rows: Array<{ id: string; folderId: string | null }> }).rows.find((c) => c.id === line.chatId)?.folderId ?? null;
    try {
      const alfa = await folder(`Alfa ${tag}`);
      const beta = await folder(`Beta ${tag}`);
      const sub = await folder(`Sub ${tag}`, beta);
      await request.post('/api/groups/chats/bulk', { data: { ids: [line.chatId], action: 'folder', folderId: alfa } });

      await page.setViewportSize(size);
      await page.goto(`/en/app/lines/inbox`, { waitUntil: 'domcontentloaded' });
      const row = page.locator(`[data-testid="chat-row"][data-chat-id="${line.chatId}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      const dialog = page.getByRole('dialog', { name: 'Move to folder' });
      const open = async () => {
        await expect(async () => {
          if (!(await dialog.isVisible())) {
            await row.click({ button: 'right', timeout: 5_000 });
            await page.getByRole('menuitem', { name: 'Move to folder' }).click({ timeout: 5_000 });
          }
          await expect(dialog).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
      };
      const q = dialog.getByTestId('lines-move-q');
      const mine = dialog.getByTestId('lines-move-mine');
      const btn = (name: string) => mine.getByRole('button', { name });

      // ---------- Abierto: la búsqueda tiene el foco, la actual va marcada, "Sin carpeta" primero, el árbol con sangría ----------
      await open();
      await expect(q).toBeFocused();
      await expect(btn(`Alfa ${tag}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(btn(`Beta ${tag}`)).toHaveAttribute('aria-pressed', 'false');
      await expect(mine.getByRole('button').first()).toHaveAttribute('data-testid', 'lines-move-none');
      expect(await indent(btn(`Sub ${tag}`))).toBeGreaterThan(await indent(btn(`Beta ${tag}`)));
      await expect(dialog.getByTestId('lines-move-new-folder')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await shots(page, 'lines', size.width);

      // ---------- La búsqueda filtra ----------
      await q.fill(`Beta ${tag}`);
      await expect(btn(`Beta ${tag}`)).toBeVisible();
      await expect(btn(`Alfa ${tag}`)).toHaveCount(0);
      await expect(btn(`Sub ${tag}`)).toHaveCount(0);
      await expect(dialog.getByTestId('lines-move-none')).toHaveCount(0);
      await q.fill(`zz-nada-${tag}`);
      await expect(dialog.getByText('No folder matches.')).toBeVisible();

      // ---------- Flechas y Enter: mueve a la marcada ----------
      await q.fill(tag);
      await expect(btn(`Sub ${tag}`)).toBeVisible();
      await expect(mine.locator('.is-active')).toContainText(`Alfa ${tag}`);
      await q.press('ArrowDown');
      await q.press('ArrowDown');
      await expect(mine.locator('.is-active')).toContainText(`Sub ${tag}`);
      await q.press('Enter');
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect.poll(folderOfChat, { timeout: 15_000 }).toBe(sub);

      // ---------- "Sin carpeta" lo saca ----------
      await open();
      await expect(btn(`Sub ${tag}`)).toHaveAttribute('aria-pressed', 'true');
      await dialog.getByTestId('lines-move-none').click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect.poll(folderOfChat, { timeout: 15_000 }).toBeNull();

      // ---------- Carpeta nueva ahí mismo, solo con el teclado: Esc cierra el campo, no el diálogo ----------
      await open();
      await q.fill(`Gamma ${tag}`);
      await expect(dialog.getByTestId('lines-move-new-folder')).toHaveClass(/is-active/);
      await q.press('Enter');
      const nameField = dialog.getByTestId('lines-move-new-name');
      await expect(nameField).toBeFocused();
      await expect(nameField).toHaveValue(`Gamma ${tag}`);
      await nameField.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(nameField).toHaveCount(0);
      await q.press('Enter');
      await expect(nameField).toHaveValue(`Gamma ${tag}`);
      await nameField.press('Enter');
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect
        .poll(async () => {
          const f = (await (await request.get('/api/groups/folders')).json()) as { folders: Array<{ id: string; name: string }> };
          const gamma = f.folders.find((x) => x.name === `Gamma ${tag}`);
          if (gamma && !made.includes(gamma.id)) made.push(gamma.id);
          return gamma ? (await folderOfChat()) === gamma.id : false;
        }, { timeout: 15_000 })
        .toBe(true);

      // ---------- Esc y un clic afuera cierran ----------
      await open();
      await closesOutside(page, dialog, open);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    } finally {
      for (const id of made.reverse()) await request.delete(`/api/groups/folders?id=${id}`);
      await request.delete(`/api/groups/numbers/${line.id}`);
    }
  });

  test(`Inbox: el mismo diálogo, con colores, búsqueda, Enter, Sin carpeta y carpeta nueva (${size.width}px)`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const tag = uid();
    await request.post('/api/inbox/whatsapp', waLinkIp());
    await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
    const [acc] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
    const title = `Mover IB ${tag}`;
    const p = phone();
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
      data: { events: [{ type: 'message', chatId: `${p}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: p, senderName: title, providerMessageId: `in-${uid()}`, body: 'test message', timestamp: new Date().toISOString() }] },
    });
    expect(res.ok()).toBe(true);
    const made: string[] = [];
    const folder = async (name: string, color: string, parentId?: string) => {
      const r = await request.post('/api/inbox/folders', { data: { name, color, parentId } });
      expect(r.status(), await r.text()).toBe(201);
      const { folder: f } = (await r.json()) as { folder: { id: string } };
      made.push(f.id);
      return f.id;
    };
    try {
      const alfa = await folder(`Alfa ${tag}`, '#0e9f6e');
      const beta = await folder(`Beta ${tag}`, '#7b4dff');
      await folder(`Sub ${tag}`, '#e23d7f', beta);
      const hit = (await (await request.get(`/api/inbox/threads?q=${encodeURIComponent(title)}`)).json()) as { threads: Array<{ id: string; title: string }> };
      const thread = hit.threads.find((t) => t.title === title)!;
      expect(thread).toBeTruthy();
      await request.post('/api/inbox/threads', { data: { ids: [thread.id], action: 'addFolder', folderId: alfa } });
      const foldersOf = async () =>
        ((await (await request.get(`/api/inbox/threads?q=${encodeURIComponent(title)}`)).json()) as { threads: Array<{ id: string; folderIds: string[] }> }).threads.find((t) => t.id === thread.id)?.folderIds ?? [];

      await page.setViewportSize(size);
      await page.goto('/en/app/inbox', { waitUntil: 'domcontentloaded' });
      const row = page.locator('.ib-item', { hasText: title });
      await expect(row).toBeVisible({ timeout: 30_000 });
      const dialog = page.getByRole('dialog', { name: 'Add to folder' });
      const open = async () => {
        await expect(async () => {
          if (!(await dialog.isVisible())) {
            await row.click({ button: 'right', timeout: 5_000 });
            await page.getByRole('menuitem', { name: 'Add to folder' }).click({ timeout: 5_000 });
          }
          await expect(dialog).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });
      };
      const q = dialog.getByTestId('ib-move-q');
      const list = dialog.getByTestId('ib-move-list');
      const btn = (name: string) => list.getByRole('button', { name });

      await open();
      await expect(q).toBeFocused();
      await expect(btn(`Alfa ${tag}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(btn(`Alfa ${tag}`).locator('.ui-fp-swatch')).toHaveCSS('background-color', 'rgb(14, 159, 110)');
      await expect(list.getByRole('button').first()).toHaveAttribute('data-testid', 'ib-move-none');
      expect(await indent(btn(`Sub ${tag}`))).toBeGreaterThan(await indent(btn(`Beta ${tag}`)));
      expect(await overflow(page)).toBeLessThanOrEqual(1);
      await shots(page, 'inbox', size.width);

      // Búsqueda y Enter: suma a la primera que coincide.
      await q.fill(`Beta ${tag}`);
      await expect(btn(`Alfa ${tag}`)).toHaveCount(0);
      await q.press('Enter');
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect.poll(async () => (await foldersOf()).sort(), { timeout: 15_000 }).toEqual([alfa, beta].sort());

      // "Sin carpeta" lo saca de todas.
      await open();
      await dialog.getByTestId('ib-move-none').click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect.poll(foldersOf, { timeout: 15_000 }).toEqual([]);

      // Carpeta nueva ahí mismo: se crea y el chat entra.
      await open();
      await dialog.getByTestId('ib-move-new-folder').click();
      await dialog.getByTestId('ib-move-new-name').fill(`Gamma ${tag}`);
      await dialog.getByTestId('ib-move-new-save').click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect
        .poll(async () => {
          const f = (await (await request.get('/api/inbox/folders')).json()) as { folders: Array<{ id: string; name: string }> };
          const gamma = f.folders.find((x) => x.name === `Gamma ${tag}`);
          if (gamma && !made.includes(gamma.id)) made.push(gamma.id);
          return gamma ? (await foldersOf()).includes(gamma.id) : false;
        }, { timeout: 15_000 })
        .toBe(true);

      await open();
      await closesOutside(page, dialog, open);
    } finally {
      for (const id of made.reverse()) await request.delete(`/api/inbox/folders/${id}`);
    }
  });
}
