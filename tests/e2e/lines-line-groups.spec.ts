import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Lines: grupos de líneas y acceso por grupo. Un admin crea el grupo Ventas,
 * le pone líneas y se lo da a una persona; esa persona ve en el selector de la
 * bandeja solo esas líneas, bajo el nombre del grupo, y puede elegir el grupo
 * entero. De Operaciones no se entera por ninguna vía (lista, abrir, API).
 * Sacarla del grupo le corta el acceso en el pedido siguiente.
 * Proveedor falso (GROUPS_FAKE=1), nombres y números inventados.
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

async function as(browser: Browser, email: string): Promise<BrowserContext> {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

/** Un member del workspace demo, con su cuenta creada y el workspace demo activo. */
async function member(browser: Browser, name: string) {
  const email = `grupo-${uid()}@lines-e2e.io`;
  const demo = await as(browser, 'session-demo');
  await demo.request.get('/api/teams/members');
  await demo.close();
  const ctx = await as(browser, email);
  const first = await ctx.request.get('/api/teams/members');
  expect(first.status(), await first.text()).toBeLessThan(500);
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  const team = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  await sql("UPDATE users SET name = ?, onboarded_at = datetime('now'), active_team_id = ? WHERE id = ?", [name, team, id]);
  await sql("INSERT OR REPLACE INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, id]);
  return { ctx, email, id, name };
}

/** Una línea conectada con un chat de un contacto inventado. Devuelve la línea y el chat. */
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
    data: { events: [{ type: 'message', chatId: `${p}@c.us`, isGroup: false, fromMe: false, senderPhone: p, senderName: contact, providerMessageId: `e2e-lg-${uid()}`, body: 'hola', timestamp: new Date().toISOString() }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const list = (await (await request.get(`/api/groups/chats?number=${id}&meta=0`)).json()) as { rows: Array<{ id: string }> };
  expect(list.rows).toHaveLength(1);
  return { id, chatId: list.rows[0].id, name, contact };
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (p: Page, name: string) => {
  const dir = process.env.LINES_SHOTS_DIR;
  if (dir) await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test('un admin arma el grupo Ventas y se lo da a una persona, que ve solo esas líneas en el selector y en la bandeja', async ({ browser, page, request }) => {
  test.setTimeout(300_000);
  const tag = uid();
  const ana = await member(browser, `Ana Ventas ${tag}`);
  const groupIds: string[] = [];
  const lineIds: string[] = [];
  try {
    const a = await lineWithChat(request, `Ventas A ${tag}`, `Cliente VA ${tag}`);
    const b = await lineWithChat(request, `Ventas B ${tag}`, `Cliente VB ${tag}`);
    const o = await lineWithChat(request, `Operaciones ${tag}`, `Cliente OP ${tag}`);
    lineIds.push(a.id, b.id, o.id);

    // ---------- El admin arma los grupos ----------
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
    const panel = page.getByTestId('line-groups');
    await expect(panel).toBeVisible();

    // Esc cierra el diálogo sin crear nada.
    await panel.getByTestId('line-group-new').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('line-group-name')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Grupo Ventas con la línea A, para Ana; la línea (hoy de todo el workspace) queda restringida.
    await panel.getByTestId('line-group-new').click();
    await dialog.getByTestId('line-group-name').fill(`Ventas ${tag}`);
    await dialog.locator(`[data-testid="line-group-line"][data-number-id="${a.id}"] input`).check();
    await dialog.locator(`[data-testid="line-group-person"][data-person-id="${ana.id}"] input`).check();
    await expect(dialog.getByTestId('line-group-restrict').locator('input')).toBeChecked();
    await shot(page, 'group-form-1280');
    await dialog.getByTestId('line-group-save').click();
    await expect(dialog).toHaveCount(0);
    const sales = panel.locator('[data-testid="line-group"]', { hasText: `Ventas ${tag}` });
    await expect(sales).toContainText(`Ventas A ${tag}`);
    await expect(sales.getByTestId('line-group-who')).toContainText(ana.name);
    const salesId = (await sales.getAttribute('data-group-id'))!;
    groupIds.push(salesId);
    expect(((await (await request.get(`/api/groups/numbers/${a.id}`)).json()) as { visibility: string; groupId: string }).visibility).toBe('restricted');

    // La línea B entra al grupo desde su fila; sigue abierta a todos y el grupo lo avisa.
    const rowB = page.locator(`[data-number-id="${b.id}"].gr-number`);
    await rowB.getByTestId('line-group-select').click();
    await page.getByRole('listbox', { name: `Group of Ventas B ${tag}` }).getByRole('option', { name: `Ventas ${tag}` }).click();
    await expect(sales).toContainText(`Ventas B ${tag}`);
    await expect(sales.getByTestId('line-group-open-warning')).toBeVisible();
    // Editar el grupo ofrece restringirla.
    await sales.getByTestId('line-group-edit').click();
    await expect(dialog.getByTestId('line-group-restrict')).toContainText(`Ventas B ${tag}`);
    await dialog.getByTestId('line-group-save').click();
    await expect(dialog).toHaveCount(0);
    await expect(sales.getByTestId('line-group-open-warning')).toHaveCount(0);

    // Grupo Operaciones, que no se le da a nadie.
    await panel.getByTestId('line-group-new').click();
    await dialog.getByTestId('line-group-name').fill(`Operaciones G ${tag}`);
    await dialog.locator(`[data-testid="line-group-line"][data-number-id="${o.id}"] input`).check();
    await dialog.getByTestId('line-group-save').click();
    await expect(dialog).toHaveCount(0);
    const ops = panel.locator('[data-testid="line-group"]', { hasText: `Operaciones G ${tag}` });
    await expect(ops.getByTestId('line-group-who')).toBeVisible();
    const opsId = (await ops.getAttribute('data-group-id'))!;
    groupIds.push(opsId);
    await sales.scrollIntoViewIfNeeded();
    await shot(page, 'groups-settings-1280');

    // ---------- Ana: solo Ventas ----------
    const mp = await ana.ctx.newPage();
    await mp.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    await mp.getByTestId('lines-line-select').click();
    const menu = mp.getByRole('listbox', { name: 'Line' });
    await expect(menu.getByRole('option', { name: `Ventas ${tag}`, exact: false }).first()).toBeVisible();
    await expect(menu.getByRole('option', { name: `Ventas A ${tag}` })).toBeVisible();
    await expect(menu.getByRole('option', { name: `Ventas B ${tag}` })).toBeVisible();
    await expect(menu.getByText(`Operaciones ${tag}`)).toHaveCount(0);
    await expect(menu.getByText(`Operaciones G ${tag}`)).toHaveCount(0);
    await shot(mp, 'member-line-menu-1280');
    // Las líneas van debajo de su grupo.
    const labels = await menu.getByRole('option').allInnerTexts();
    const at = (text: string) => labels.findIndex((l) => l.includes(text));
    expect(at(`Ventas ${tag}`)).toBeGreaterThanOrEqual(0);
    expect(at(`Ventas A ${tag}`)).toBeGreaterThan(at(`Ventas ${tag}`));
    // Esc cierra el menú; elegir el grupo filtra la bandeja a sus líneas.
    await mp.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await mp.getByTestId('lines-line-select').click();
    const listed = mp.waitForResponse((r) => r.url().includes('/api/groups/chats') && r.url().includes(`linegroup=${salesId}`));
    await menu.locator(`[data-value="g:${salesId}"]`).click();
    await listed;
    const list = mp.locator('.gr-list');
    await expect(list.getByText(`Cliente VA ${tag}`).first()).toBeVisible();
    await expect(list.getByText(`Cliente VB ${tag}`).first()).toBeVisible();
    await expect(mp.getByText(`Cliente OP ${tag}`)).toHaveCount(0);
    await shot(mp, 'member-inbox-group-1280');

    // Por API tampoco: ni la lista, ni el chat, ni sus mensajes, ni la línea, ni el grupo.
    const api = ana.ctx.request;
    const mine = (await (await api.get('/api/groups/numbers')).json()) as { numbers: Array<{ id: string }> };
    expect(mine.numbers.map((n) => n.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(mine.numbers.map((n) => n.id)).not.toContain(o.id);
    expect(((await (await api.get(`/api/groups/chats?number=${o.id}&meta=0`)).json()) as { rows: unknown[] }).rows).toHaveLength(0);
    expect(((await (await api.get(`/api/groups/chats?linegroup=${opsId}&meta=0`)).json()) as { rows: unknown[] }).rows).toHaveLength(0);
    expect((await api.get(`/api/groups/chats/${o.chatId}`)).status()).toBe(404);
    expect((await api.get(`/api/groups/chats/${o.chatId}/messages`)).status()).toBe(404);
    expect((await api.get(`/api/groups/numbers/${o.id}`)).status()).toBe(404);
    expect((await api.get(`/api/groups/chats/${a.chatId}`)).status()).toBe(200);
    const groups = (await (await api.get('/api/groups/line-groups')).json()) as { groups: Array<{ id: string; access?: unknown }> };
    expect(groups.groups.map((g) => g.id)).toEqual([salesId]);
    expect(groups.groups[0].access).toBeUndefined();
    // No edita grupos ni accesos, ni se abre la pantalla de grupos.
    expect((await api.post('/api/groups/line-groups', { data: { name: 'Mío' } })).status()).toBe(403);
    expect((await api.patch('/api/groups/line-groups', { data: { id: opsId, personIds: [ana.id] } })).status()).toBe(403);
    expect((await api.patch(`/api/groups/numbers/${o.id}`, { data: { groupId: salesId } })).status()).toBe(403);
    expect((await api.put('/api/groups/prefs', { data: { line: `g:${opsId}` } })).status()).toBe(404);
    await mp.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
    await expect(mp.getByTestId('line-groups')).toHaveCount(0);
    await expect(mp.getByText(`Operaciones ${tag}`)).toHaveCount(0);

    // A 390 px: el selector con grupos entra en pantalla y la bandeja no se desborda.
    await mp.setViewportSize({ width: 390, height: 800 });
    await mp.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    expect(await overflow(mp)).toBeLessThanOrEqual(0);
    await mp.getByTestId('lines-line-select').first().click();
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await shot(mp, 'member-line-menu-390');
    await mp.keyboard.press('Escape');

    // ---------- El admin le saca el grupo desde "Acceso por persona": corta en el acto ----------
    const access = page.getByTestId('person-access');
    await access.scrollIntoViewIfNeeded();
    await access.getByTestId('person-access-pick').click();
    await page.getByTestId('person-access-pick-panel').getByRole('combobox').fill(`ventas ${tag}`);
    await page.keyboard.press('Enter');
    const g = access.locator(`[data-testid="person-access-group"][data-group-id="${salesId}"]`);
    await expect(g.locator('input').first()).toBeChecked();
    await shot(page, 'person-access-1280');
    await g.locator('input').first().uncheck();
    await access.getByTestId('person-access-save').click();
    await expect(sales.getByTestId('line-group-who')).not.toContainText(ana.name);
    expect((await api.get(`/api/groups/chats/${a.chatId}`)).status()).toBe(404);
    expect((await api.get(`/api/groups/chats/${a.chatId}/messages`)).status()).toBe(404);
    expect(((await (await api.get('/api/groups/line-groups')).json()) as { groups: unknown[] }).groups).toEqual([]);
    expect(((await (await api.get('/api/groups/prefs')).json()) as { line: string }).line).toBe('all');

    // A 390 px los grupos y el acceso por persona entran sin scroll lateral.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('line-groups').scrollIntoViewIfNeeded();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shot(page, 'groups-settings-390');

    // Borrar un grupo no borra sus líneas.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: 'networkidle' });
    await ops.getByTestId('line-group-delete').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(ops).toHaveCount(0);
    await expect(page.locator(`[data-number-id="${o.id}"].gr-number`)).toBeVisible();
    expect(((await (await request.get(`/api/groups/numbers/${o.id}`)).json()) as { groupId: string | null }).groupId).toBeNull();
  } finally {
    for (const id of groupIds) await request.delete(`/api/groups/line-groups?id=${id}`);
    for (const id of lineIds) await request.delete(`/api/groups/numbers/${id}`);
    await request.put('/api/groups/prefs', { data: { line: 'all' } });
    await ana.ctx.close();
  }
});
