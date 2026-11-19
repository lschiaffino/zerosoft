import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * Lines › Ajustes › Números: el dueño de una línea se elige en la misma fila,
 * con un buscador de personas que explica qué implica ser el dueño. Lo cambia
 * un admin; un member lo ve escrito y no lo puede cambiar. La lista cierra con
 * Esc y al hacer clic afuera. Proveedor falso (GROUPS_FAKE=1), nombres inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

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
  const email = `owner-${uid()}@lines-e2e.io`;
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

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shot = async (p: Page, name: string) => {
  const dir = process.env.LINES_SHOTS_DIR;
  if (dir) await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test('un admin elige el dueño de una línea en su fila; el member lo ve y no lo cambia', async ({ browser, page, request }) => {
  test.setTimeout(180_000);
  const tag = uid();
  const olga = await member(browser, `Olga Dueña ${tag}`);
  try {
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Linea Dueño ${tag}` } });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
    // La pantalla dice qué es el dueño.
    await expect(page.getByTestId('lines-owner-help')).toContainText('always see');
    const line = page.locator(`[data-number-id="${id}"]`);
    const picker = line.getByTestId('line-owner');
    await expect(picker).toHaveAccessibleName(`Owner of Linea Dueño ${tag}: No owner`);

    // Abre: buscador con foco, la lista y la explicación. Esc cierra y devuelve el foco.
    await picker.click();
    const panel = page.getByTestId('line-owner-panel');
    await expect(panel.getByRole('combobox')).toBeFocused();
    await expect(panel).toContainText('Chats are not assigned to the owner');
    await shot(page, 'owner-picker-open-1280');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(picker).toBeFocused();

    // Clic afuera también la cierra.
    await picker.click();
    await expect(panel).toBeVisible();
    await page.getByTestId('lines-owner-help').click();
    await expect(panel).toHaveCount(0);

    // Busca por nombre y elige con Enter: se guarda en el acto.
    await picker.click();
    await panel.getByRole('combobox').fill(`dueña ${tag}`);
    await expect(panel.getByRole('option')).toHaveCount(1);
    const saved = page.waitForResponse((r) => r.url().includes(`/api/groups/numbers/${id}`) && r.request().method() === 'PATCH');
    await page.keyboard.press('Enter');
    expect((await saved).status()).toBe(200);
    await expect(picker).toHaveAccessibleName(`Owner of Linea Dueño ${tag}: ${olga.name}`);
    await expect(picker).toContainText(olga.name);
    expect(((await (await request.get(`/api/groups/numbers/${id}`)).json()) as { ownerId: string }).ownerId).toBe(olga.id);
    await shot(page, 'owner-set-1280');

    // Una búsqueda sin resultados lo dice.
    await picker.click();
    await panel.getByRole('combobox').fill('zzzz-nadie');
    await expect(panel).toContainText('Nobody matches');
    await page.keyboard.press('Escape');

    // La dueña (member) ve "You" y no tiene selector; tampoco lo cambia por API.
    const mp = await olga.ctx.newPage();
    await mp.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
    const mine = mp.locator(`[data-number-id="${id}"]`);
    await expect(mine.getByTestId('line-owner-name')).toHaveText('You');
    await expect(mine.getByTestId('line-owner')).toHaveCount(0);
    expect((await olga.ctx.request.patch(`/api/groups/numbers/${id}`, { data: { ownerId: null } })).status()).toBe(403);

    // A 390 px la fila se apila y el selector entra en pantalla, abierto y cerrado.
    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload({ waitUntil: 'networkidle' });
    await line.scrollIntoViewIfNeeded();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await picker.click();
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shot(page, 'owner-picker-open-390');
    // Sin dueño otra vez.
    await panel.getByRole('option', { name: 'No owner' }).click();
    await expect(picker).toHaveAccessibleName(`Owner of Linea Dueño ${tag}: No owner`);
    await request.delete(`/api/groups/numbers/${id}`);
  } finally {
    await olga.ctx.close();
  }
});
