import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { setTheme } from './responsive-audit';

/**
 * CRM › Ajustes › Integraciones › Sync con HubSpot › Conflictos (bloque S4),
 * contra la cuenta falsa del sync (CRM_IMPORT_FAKE; seedSyncPortal). Compara
 * los dos lados de un registro, elige por campo, deja HubSpot en todos con
 * confirmación (Esc y un clic afuera cancelan) y descarta uno de fusión. A
 * 1280 y a 390, y la tarjeta en los cinco aspectos, claro y oscuro.
 *
 * La escritura en HubSpot queda apagada y nada de esto escribe en la cuenta
 * falsa (que comparten todos los specs del servidor): el conflicto se arma
 * acá, corriendo el shadow del vínculo a un valor que no tiene ningún lado.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(480_000);

const SETTINGS = '/en/app/crm/settings?tab=integrations';
const API = '/api/crm/hubspot-sync';
const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function person(browser: Browser, label: string, width = 1280): Promise<{ ctx: BrowserContext; p: Page; id: string; errors: string[] }> {
  const baseURL = test.info().project.use.baseURL as string;
  const email = `${label}-${uid()}@hsconf-e2e.io`.toLowerCase();
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('/en/app', { waitUntil: 'domcontentloaded' });
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [label, id]);
  for (const table of ['crm_contacts', 'crm_companies', 'crm_deals']) await sql(`DELETE FROM ${table} WHERE user_id = ?`, [id]);
  return { ctx, p, id, errors };
}

async function liveInbound(ctx: BrowserContext, label: string, ws: string) {
  expect((await ctx.request.post(API, { data: { token: `pat-e2e-conflicts-${label}-${uid()}` } })).status()).toBe(200);
  expect((await ctx.request.post(`${API}/inbound`, { data: { action: 'start' } })).status()).toBe(200);
  await expect.poll(async () => ((await (await ctx.request.post(`${API}/inbound/run`)).json()) as { inbound: { state: string } }).inbound.state, { timeout: 120_000 }).toBe('live');
  // La entrada no vuelve a correr durante el spec: los conflictos se arman a mano.
  await sql("UPDATE crm_hubspot_inbound SET next_run_at = '2999-01-01T00:00:00.000Z' WHERE user_id = ?", [ws]);
}

const linked = async (ws: string, object: string, hubspotId: string) =>
  String((await sql('SELECT record_id FROM crm_hubspot_links WHERE user_id = ? AND object = ? AND hubspot_id = ?', [ws, object, hubspotId]))[0].record_id);

/** Arma un conflicto: el shadow de esos campos pasa a un valor que no tiene ningún lado, y se anota. */
async function conflict(ws: string, object: string, recordId: string, fields: string[]) {
  const row = (await sql('SELECT shadow FROM crm_hubspot_links WHERE user_id = ? AND object = ? AND record_id = ?', [ws, object, recordId]))[0];
  const shadow = JSON.parse(String(row.shadow)) as Record<string, string>;
  for (const f of fields) shadow[f] = `stale-${uid()}`;
  await sql('UPDATE crm_hubspot_links SET shadow = ? WHERE user_id = ? AND object = ? AND record_id = ?', [JSON.stringify(shadow), ws, object, recordId]);
  await sql(
    `INSERT INTO crm_hubspot_sync_conflicts (user_id, object, record_id, hubspot_id, kind, fields) VALUES (?, ?, ?, '', 'fields', ?)
     ON CONFLICT(user_id, object, record_id) DO UPDATE SET fields = excluded.fields`,
    [ws, object, recordId, fields.join(',')],
  );
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const card = (p: Page) => p.getByTestId('hubspot-sync-conflicts');

for (const vp of [
  { name: '1280', width: 1280 },
  { name: '390', width: 390 },
]) {
  test(`comparar, elegir por campo, dejar HubSpot en todos y descartar a ${vp.name}`, async ({ browser }) => {
    const me = await person(browser, 'Ana', vp.width);
    const { p, ctx } = me;
    try {
      await liveInbound(ctx, vp.name, me.id);
      const contactId = await linked(me.id, 'contact', '4001');
      const companyId = await linked(me.id, 'company', '3001');
      const mergedId = await linked(me.id, 'contact', '4002');
      const mineTitle = `Title ${uid()}`;
      const mineLast = `Last ${uid()}`;
      expect((await ctx.request.patch(`/api/crm/contacts/${contactId}`, { data: { jobTitle: mineTitle, lastName: mineLast } })).status()).toBe(200);
      expect((await ctx.request.patch(`/api/crm/companies/${companyId}`, { data: { industry: `Industry ${uid()}` } })).status()).toBe(200);
      await conflict(me.id, 'contact', contactId, ['last_name', 'job_title']);
      await conflict(me.id, 'company', companyId, ['industry']);
      await sql(`INSERT INTO crm_hubspot_sync_conflicts (user_id, object, record_id, hubspot_id, kind, fields) VALUES (?, 'contact', ?, '4002', 'merge', '')`, [me.id, mergedId]);
      const writesBefore = await (await ctx.request.get(`${API}/outbound`)).json();

      await p.goto(SETTINGS, { waitUntil: 'networkidle' });
      await expect(card(p)).toHaveAttribute('data-count', '3', { timeout: 120_000 });
      const row = p.locator(`[data-key="contact:${contactId}"]`);
      await expect(row).toContainText('Last name');
      await noSideScroll(p);

      // Comparar: lo de cada lado, leído de HubSpot; Aplicar espera una elección.
      await row.getByTestId('hubspot-sync-conflict-compare').click();
      const detail = row.getByTestId('hubspot-sync-conflict-detail');
      await expect(detail.getByTestId('hubspot-sync-conflict-field')).toHaveCount(2);
      await expect(detail).toContainText(mineTitle);
      await expect(row.getByTestId('hubspot-sync-conflict-apply')).toBeDisabled();
      const last = detail.locator('[data-field="last_name"]');
      const title = detail.locator('[data-field="job_title"]');
      const theirLast = (await last.locator('label').nth(1).locator('.hsync-conf-value').innerText()).trim();
      expect(theirLast).not.toBe(mineLast);
      await last.getByTestId('hubspot-sync-conflict-hubspot').check();
      await title.getByTestId('hubspot-sync-conflict-here').check();
      if (vp.width === 390) {
        for (const box of await detail.locator('label.hsync-conf-option').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(40);
      }
      await noSideScroll(p);
      await row.screenshot({ path: test.info().outputPath(`hsconf-compare-${vp.name}.png`) });
      await row.getByTestId('hubspot-sync-conflict-apply').click();
      await expect(p.getByTestId('hubspot-sync-conflicts-notice')).toHaveText('Conflict resolved.');
      await expect(card(p)).toHaveAttribute('data-count', '2');
      const after = (await sql('SELECT last_name, job_title FROM crm_contacts WHERE id = ?', [contactId]))[0];
      expect(after.job_title).toBe(mineTitle);
      expect(after.last_name).not.toBe(mineLast);

      // Dejar HubSpot en todos: confirmación que cierran Esc y un clic afuera.
      const all = p.getByTestId('hubspot-sync-conflicts-all-hubspot');
      await all.click();
      await expect(p.getByTestId('hubspot-sync-conflicts-confirm')).toBeVisible();
      await expect(p.getByTestId('hubspot-sync-conflicts-confirm-cancel')).toBeFocused();
      await p.keyboard.press('Escape');
      await expect(p.getByTestId('hubspot-sync-conflicts-confirm')).toHaveCount(0);
      await expect(all).toBeFocused();
      await all.click();
      await expect(p.getByTestId('hubspot-sync-conflicts-confirm')).toBeVisible();
      await card(p).locator('h3.hsync-title').click();
      await expect(p.getByTestId('hubspot-sync-conflicts-confirm')).toHaveCount(0);
      await all.click();
      await noSideScroll(p);
      await p.getByTestId('hubspot-sync-conflicts-confirm').screenshot({ path: test.info().outputPath(`hsconf-confirm-${vp.name}.png`) });
      await p.getByTestId('hubspot-sync-conflicts-confirm-yes').click();
      await expect(p.getByTestId('hubspot-sync-conflicts-notice')).toHaveText('1 field resolved.');
      await expect(card(p)).toHaveAttribute('data-count', '1');

      // La de fusión solo se saca de la lista.
      const merged = p.locator(`[data-key="contact:${mergedId}"]`);
      await expect(merged).toHaveAttribute('data-kind', 'merge');
      await merged.getByTestId('hubspot-sync-conflict-dismiss').click();
      await expect(p.getByTestId('hubspot-sync-conflicts-empty')).toBeVisible();
      await expect(card(p)).toHaveAttribute('data-count', '0');

      // Nada salió a HubSpot: la escritura sigue apagada y sin cambios contados.
      const writesAfter = await (await ctx.request.get(`${API}/outbound`)).json();
      expect(writesAfter.outbound.enabled).toBe(false);
      expect(writesAfter.outbound.counts).toEqual(writesBefore.outbound.counts);
      await noSideScroll(p);
      await card(p).screenshot({ path: test.info().outputPath(`hsconf-empty-${vp.name}.png`) });
      expect(me.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('conflictos en los cinco aspectos, claro y oscuro', async ({ browser }) => {
  const me = await person(browser, 'Leo');
  const { p, ctx } = me;
  const baseURL = test.info().project.use.baseURL as string;
  try {
    await liveInbound(ctx, 'looks', me.id);
    const contactId = await linked(me.id, 'contact', '4001');
    expect((await ctx.request.patch(`/api/crm/contacts/${contactId}`, { data: { jobTitle: `Title ${uid()}` } })).status()).toBe(200);
    await conflict(me.id, 'contact', contactId, ['job_title']);
    for (const [look, theme] of (['current', 'lines', 'classic', 'liquid', 'retro'] as const).flatMap((l) => [[l, 'light'] as const, [l, 'dark'] as const])) {
      expect((await ctx.request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      await setTheme(ctx, baseURL, theme);
      await p.goto(SETTINGS, { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(card(p)).toHaveAttribute('data-count', '1', { timeout: 120_000 });
      const row = p.locator(`[data-key="contact:${contactId}"]`);
      await row.getByTestId('hubspot-sync-conflict-compare').click();
      await row.getByTestId('hubspot-sync-conflict-here').check();
      const colors = await row.locator('label.hsync-conf-option').first().evaluate((el) => {
        let node: Element | null = el;
        let bg = 'rgba(0, 0, 0, 0)';
        while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
          bg = getComputedStyle(node).backgroundColor;
          node = node.parentElement;
        }
        return { ink: getComputedStyle(el.querySelector('.hsync-conf-value')!).color, bg, border: getComputedStyle(el).borderTopColor };
      });
      expect(colors.ink, `${look} ${theme}`).not.toBe(colors.bg);
      expect(colors.border, `${look} ${theme}`).not.toBe('rgba(0, 0, 0, 0)');
      await noSideScroll(p);
      await card(p).screenshot({ path: test.info().outputPath(`hsconf-${look}-${theme}.png`) });
    }
    expect(me.errors).toEqual([]);
  } finally {
    await ctx.request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
    await ctx.close();
  }
});
