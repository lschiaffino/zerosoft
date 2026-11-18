import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Talk con el kit (el formato de Lines): mensajes, respuestas,
 * reacciones y huddles de un canal propio sembrado en la base, el filtro por
 * canal, el cambio de período, el vacío y 390 px sin scroll horizontal.
 */

const email = ownWorkspace('talk-analytics');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

let channel = '';

async function seed() {
  if (channel) return;
  const [user] = await sql('SELECT id FROM users WHERE email = ?', [email]);
  const ws = String(user.id);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await sql("INSERT INTO talk_channels (id, workspace_id, kind, name, created_by, created_at, updated_at) VALUES (?, ?, 'public', ?, ?, ?, ?)", [id, ws, `metricas-${uid()}`, ws, ago(30 * DAY), now]);
  await sql('INSERT INTO talk_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)', [id, ws, ago(30 * DAY)]);
  const post = async (when: number, parent: string | null = null) => {
    const m = crypto.randomUUID();
    await sql('INSERT INTO talk_messages (id, workspace_id, channel_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [m, ws, id, ws, parent, 'x', ago(when)]);
    return m;
  };
  const root = await post(DAY);
  await post(DAY - 60_000, root);
  await post(2 * DAY);
  await post(20 * DAY);
  await sql('INSERT INTO talk_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', [root, ws, '👍', ago(DAY - 120_000)]);
  await sql('INSERT INTO talk_huddles (id, workspace_id, channel_id, started_by, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), ws, id, ws, ago(DAY), ago(DAY - 15 * 60_000)]);
  channel = id;
}

async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

test('Talk: analítica con el kit, canal, período y vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await seed();

  await page.goto('/en/app/talk/analytics', { waitUntil: 'networkidle' });
  // El sidebar de la app lleva a la analítica (marcada).
  await expect(page.locator('a[href$="/app/talk/analytics"][aria-current="page"]').first()).toBeAttached();
  await expect(page.getByRole('img', { name: /^Messages, replies and reactions per day/ })).toBeVisible();

  const form = page.getByRole('form', { name: 'Report filters' });
  await form.getByLabel('Channel').selectOption(channel);
  await form.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/channel=/);
  expect(await kpi(page, 'Messages')).toBe(4);
  expect(await kpi(page, 'Thread replies')).toBe(1);
  expect(await kpi(page, 'People posting')).toBe(1);
  expect(await kpi(page, 'Reactions')).toBe(1);
  expect(await kpi(page, 'Huddles')).toBe(1);
  await expect(page.getByRole('region', { name: 'When people post' }).getByRole('img')).toBeVisible();
  await expect(page.getByRole('region', { name: 'By channel' }).getByRole('row')).toHaveCount(2);
  // El canal de la tabla abre la conversación.
  await expect(page.getByRole('region', { name: 'By channel' }).locator(`a[href$="/app/talk/${channel}"]`)).toBeVisible();

  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(/days=7/);
  expect(await kpi(page, 'Messages')).toBe(3);

  await page.goto(`/en/app/talk/analytics?from=2001-01-01&to=2001-01-31&channel=${channel}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.la-empty')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/app/talk/analytics?channel=${channel}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  expect(errors).toEqual([]);
});
