import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';

/**
 * Analítica de Inbox, Calls y CRM (el kit de components/analytics-kit): cada
 * página carga, los números son los de lo sembrado, el período cambia lo que
 * cuenta y a 390 px no hay scroll horizontal. Un workspace propio para que
 * nada de otras suites cambie las cuentas; los datos se siembran directo en
 * la base (fechas fijas relativas a ahora).
 */

const email = ownWorkspace('analytics-kit');
test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const sqlTs = (iso: string) => iso.slice(0, 19).replace('T', ' ');
const rid = (p: string) => `${p}_${Math.random().toString(16).slice(2, 12)}${Math.random().toString(16).slice(2, 12)}`;

async function sql(statement: string, args: Array<string | number | null> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

let seeded: string | null = null;

/** Siembra una vez: mensajes del Inbox, llamadas y deals del workspace propio. */
async function seed(): Promise<string> {
  if (seeded) return seeded;
  const [u] = await sql('SELECT id FROM users WHERE email = ?', [email]);
  const me = String(u.id);
  const now = ago(0);

  // Inbox: tres recibidos y una respuesta en los últimos días, uno recibido hace 20 días.
  const acc = rid('iba');
  await sql(`INSERT INTO inbox_accounts (id, owner_id, kind, status, created_at, updated_at) VALUES (?, ?, 'whatsapp', 'connected', ?, ?)`, [acc, me, now, now]);
  const thread = rid('ibt');
  await sql(
    `INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, last_message_at, last_from_me, created_at, updated_at)
     VALUES (?, ?, ?, 'whatsapp', 'dm', ?, 'Cliente de prueba', ?, 0, ?, ?)`,
    [thread, me, acc, thread, now, now, now],
  );
  const msg = (fromMe: number, at: string) =>
    sql(`INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, from_me, body, sent_at, created_at) VALUES (?, ?, ?, ?, ?, 'hola', ?, ?)`, [rid('ibm'), me, thread, rid('x'), fromMe, at, at]);
  await msg(0, ago(20 * DAY));
  await msg(1, ago(20 * DAY - 60_000));
  await msg(0, ago(2 * DAY));
  await msg(1, ago(2 * DAY - 10 * 60_000));
  await msg(0, ago(3 * 3_600_000));
  await msg(0, ago(2 * 3_600_000));

  // Calls: dos llamadas recientes (10 y 20 min) y una hace 20 días (30 min).
  const callRow = (at: string, min: number, talk: number) =>
    sql(
      `INSERT INTO calls (id, workspace_id, owner_id, title, status, started_at, duration_ms, metrics, analysis, created_at, updated_at) VALUES (?, ?, ?, 'Demo', 'ready', ?, ?, ?, ?, ?, ?)`,
      [
        rid('cl'),
        me,
        me,
        at,
        min * 60_000,
        JSON.stringify({ talkMs: 1, talkRatio: talk, bySpeaker: [], longestMonologue: null, longestCustomerStory: null, interactivity: 1, patienceMs: null, questionsInternal: 1, questionsExternal: 2 }),
        JSON.stringify({ summary: '', topics: [{ name: 'Pricing', startMs: 0 }], competitors: [{ name: 'Acme', atMs: 0, quote: '' }], scorecard: { methodology: 'spiced', items: [], total: 0 } }),
        at,
        at,
      ],
    );
  await callRow(ago(DAY), 10, 0.5);
  await callRow(ago(2 * DAY), 20, 0.5);
  await callRow(ago(20 * DAY), 30, 0.5);

  // CRM: un pipeline propio; dos deals creados hace poco (uno ganado) y uno hace 20 días.
  const pipe = rid('pip');
  await sql(`INSERT INTO crm_pipelines (id, user_id, name, position) VALUES (?, ?, 'Analítica e2e', 99)`, [pipe, me]);
  const stage = async (name: string, pos: number, won: number) => {
    const sid = rid('stg');
    await sql(`INSERT INTO crm_stages (id, pipeline_id, name, probability, position, is_won, is_lost) VALUES (?, ?, ?, 50, ?, ?, 0)`, [sid, pipe, name, pos, won]);
    return sid;
  };
  const open = await stage('Propuesta e2e', 0, 0);
  const won = await stage('Ganado e2e', 1, 1);
  const deal = (stageId: string, amount: number, created: string, closed: string | null) =>
    sql(
      `INSERT INTO crm_deals (id, user_id, owner_id, pipeline_id, stage_id, name, amount, currency, closed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Deal e2e', ?, 'USD', ?, ?, ?)`,
      [rid('deal'), me, me, pipe, stageId, amount, closed ? sqlTs(closed) : null, sqlTs(created), sqlTs(created)],
    );
  await deal(open, 1000, ago(DAY), null);
  await deal(won, 5000, ago(2 * DAY), ago(DAY));
  await deal(open, 700, ago(20 * DAY), null);
  seeded = me;
  return me;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

/** El número de una tarjeta (el valor final, sin esperar a que termine de contar). */
async function kpi(page: Page, label: string): Promise<number> {
  const tile = page.locator(`.la-kpi[data-kpi="${label}"]`);
  await expect(tile).toBeVisible();
  return Number(await tile.locator('.la-num').getAttribute('data-value'));
}

async function noHorizontalScroll(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

async function switchTo7Days(page: Page, path: string) {
  await page.getByRole('navigation', { name: 'Period' }).getByRole('link', { name: '7 days' }).click();
  await expect(page).toHaveURL(new RegExp(`${path}\\?days=7`));
  await expect(page.getByRole('status').filter({ hasText: 'Compared with the 7 days before' })).toBeVisible();
}

test('Inbox: analítica personal con los números sembrados y cambio de período', async ({ page }) => {
  const errors = watchErrors(page);
  await seed();
  await page.goto('/en/app/inbox/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Inbox analytics' })).toBeVisible();
  // La entrada del sidebar, marcada.
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/app\/inbox\/analytics$/);
  expect(await kpi(page, 'Received')).toBe(4);
  expect(await kpi(page, 'Sent')).toBe(2);
  expect(await kpi(page, 'Active chats')).toBe(1);
  await expect(page.locator('.la-kpi[data-kpi="First response (median)"]')).toContainText('min');
  await expect(page.getByRole('img', { name: /^Messages per day by channel/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Most active chats' }).getByRole('link', { name: 'Cliente de prueba' })).toBeVisible();
  await expect(page.getByText('Only you see these numbers')).toBeVisible();

  await switchTo7Days(page, '/en/app/inbox/analytics');
  expect(await kpi(page, 'Received')).toBe(3);
  expect(await kpi(page, 'Sent')).toBe(1);

  // Un rango sin nada: el vacío, sin tarjetas.
  await page.goto('/en/app/inbox/analytics?from=2001-01-01&to=2001-01-31', { waitUntil: 'networkidle' });
  await expect(page.getByText('Nothing in this range')).toBeVisible();
  await expect(page.locator('.la-kpi')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/inbox/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('Calls: analítica con llamadas, minutos, temas y por rep', async ({ page }) => {
  const errors = watchErrors(page);
  await seed();
  await page.goto('/en/app/calls/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Calls analytics' })).toBeVisible();
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/app\/calls\/analytics$/);
  expect(await kpi(page, 'Calls recorded')).toBe(3);
  expect(await kpi(page, 'Minutes recorded')).toBe(60);
  expect(await kpi(page, 'Customer questions')).toBe(6);
  expect(await kpi(page, 'Team talk time')).toBeCloseTo(0.5, 5);
  await expect(page.getByRole('region', { name: 'Top topics' })).toContainText('Pricing');
  await expect(page.getByRole('region', { name: 'Competitors mentioned' })).toContainText('Acme');
  await expect(page.getByRole('region', { name: 'By rep' }).getByRole('row')).toHaveCount(2);

  await switchTo7Days(page, '/en/app/calls/analytics');
  expect(await kpi(page, 'Calls recorded')).toBe(2);
  expect(await kpi(page, 'Minutes recorded')).toBe(30);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/calls/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('CRM: analítica con deals, pipeline por etapa, filtro de pipeline y período', async ({ page }) => {
  const errors = watchErrors(page);
  await seed();
  await page.goto('/en/app/crm/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'CRM analytics' })).toBeVisible();
  await expect(page.locator('.side-line [aria-current="page"]')).toHaveAttribute('href', /\/app\/crm\/analytics$/);
  expect(await kpi(page, 'Deals created')).toBe(3);
  expect(await kpi(page, 'Deals won')).toBe(1);
  expect(await kpi(page, 'Won revenue')).toBe(5000);
  await expect(page.locator('.la-kpi[data-kpi="Won revenue"]')).toContainText('$');
  expect(await kpi(page, 'Open pipeline')).toBe(1700);
  await expect(page.getByRole('region', { name: 'Open pipeline by stage' })).toContainText('Propuesta e2e');
  await expect(page.getByRole('region', { name: 'By owner' }).getByRole('row')).toHaveCount(2);

  await switchTo7Days(page, '/en/app/crm/analytics');
  expect(await kpi(page, 'Deals created')).toBe(2);

  // Con más de un pipeline, el filtro: el propio cuenta lo mismo; los demás, nada.
  const select = page.getByRole('form', { name: 'Report filters' }).getByLabel('Pipeline');
  if (await select.count()) {
    await select.selectOption({ label: 'Analítica e2e' });
    await page.getByRole('form', { name: 'Report filters' }).getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/pipeline=/);
    expect(await kpi(page, 'Deals created')).toBe(2);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/crm/analytics', { waitUntil: 'networkidle' });
  await expect(page.locator('.la-kpi').first()).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});
