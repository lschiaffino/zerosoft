import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { setTheme } from './responsive-audit';

/**
 * CRM › Ajustes › Integraciones › Sync con HubSpot: la escritura del CRM en
 * HubSpot (bloque S3) contra la cuenta falsa del sync (CRM_IMPORT_FAKE;
 * lib/hubspot/fake-portal.ts › seedSyncPortal). Apagada aunque la entrada
 * esté al día; la vista previa muestra campos y conteos; prender pide
 * confirmar (Esc y un clic afuera cancelan); prendida manda el cambio y lo
 * cuenta; apagar. A 1280 y a 390, y la tarjeta en los cinco aspectos, claro y
 * oscuro.
 *
 * Solo se editan propiedades de registros que ya están en la cuenta falsa
 * (que comparten todos los specs del servidor): nada se crea allá.
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
  const email = `${label}-${uid()}@hsout-e2e.io`.toLowerCase();
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

/** Conecta la cuenta falsa y deja la entrada al día (por la API, como lo haría la pantalla). */
async function liveInbound(ctx: BrowserContext, label: string) {
  expect((await ctx.request.post(API, { data: { token: `pat-e2e-outbound-${label}-${uid()}` } })).status()).toBe(200);
  expect((await ctx.request.post(`${API}/inbound`, { data: { action: 'start' } })).status()).toBe(200);
  await expect.poll(async () => ((await (await ctx.request.post(`${API}/inbound/run`)).json()) as { inbound: { state: string } }).inbound.state, { timeout: 120_000 }).toBe('live');
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const card = (p: Page) => p.getByTestId('hubspot-sync-outbound');

for (const vp of [
  { name: '1280', width: 1280 },
  { name: '390', width: 390 },
]) {
  test(`vista previa, prender con confirmación, mandar un cambio y apagar a ${vp.name}`, async ({ browser }) => {
    const me = await person(browser, 'Mara', vp.width);
    const { p, ctx } = me;
    try {
      await liveInbound(ctx, vp.name);
      await p.goto(SETTINGS, { waitUntil: 'networkidle' });

      // La entrada al día no prende la escritura: apagada, y no se puede prender sin vista previa.
      await expect(card(p)).toHaveAttribute('data-state', 'off', { timeout: 120_000 });
      await expect(p.getByTestId('hubspot-sync-outbound-enable')).toBeDisabled();
      await expect(p.getByTestId('hubspot-sync-outbound-counts')).toHaveCount(0);
      await noSideScroll(p);

      // Un cambio acá en un contacto vinculado.
      const contactId = String(
        (await sql(`SELECT record_id FROM crm_hubspot_links WHERE user_id = ? AND object = 'contact' AND hubspot_id = '4001'`, [me.id]))[0].record_id,
      );
      const title = `Lead ${vp.name} ${uid()}`;
      expect((await ctx.request.patch(`/api/crm/contacts/${contactId}`, { data: { jobTitle: title } })).status()).toBe(200);

      // Vista previa: el objeto, cuántos registros y qué campo; nunca el valor.
      await p.getByTestId('hubspot-sync-outbound-preview-run').click();
      await expect(p.getByTestId('hubspot-sync-outbound-preview')).toBeVisible();
      await expect(p.getByTestId('hubspot-sync-outbound-preview-contacts-records')).toContainText('1 record to update');
      await expect(p.getByTestId('hubspot-sync-outbound-preview-contacts-fields')).toContainText('Job title (1)');
      await expect(card(p)).not.toContainText(title);
      await noSideScroll(p);
      await card(p).screenshot({ path: test.info().outputPath(`hsout-preview-${vp.name}.png`) });

      // Prender pide confirmar: Esc y un clic afuera cancelan.
      const enable = p.getByTestId('hubspot-sync-outbound-enable');
      await expect(enable).toBeEnabled();
      await enable.click();
      await expect(p.getByTestId('hubspot-sync-outbound-confirm')).toBeVisible();
      await expect(p.getByTestId('hubspot-sync-outbound-confirm-cancel')).toBeFocused();
      await p.keyboard.press('Escape');
      await expect(p.getByTestId('hubspot-sync-outbound-confirm')).toHaveCount(0);
      await expect(enable).toBeFocused();
      await enable.click();
      await expect(p.getByTestId('hubspot-sync-outbound-confirm')).toBeVisible();
      await p.locator('h3.hsync-title').first().click();
      await expect(p.getByTestId('hubspot-sync-outbound-confirm')).toHaveCount(0);
      await enable.click();
      await noSideScroll(p);
      await p.getByTestId('hubspot-sync-outbound-confirm').screenshot({ path: test.info().outputPath(`hsout-confirm-${vp.name}.png`) });
      await p.getByTestId('hubspot-sync-outbound-confirm-yes').click();

      // Prendida: la pantalla vacía la cola y cuenta lo que salió.
      await expect(card(p)).toHaveAttribute('data-state', 'on', { timeout: 60_000 });
      await expect(p.getByTestId('hubspot-sync-outbound-contacts-updated')).toHaveText('1', { timeout: 60_000 });
      await expect(p.getByTestId('hubspot-sync-outbound-queued')).toContainText('0 changes waiting');
      await expect(p.getByTestId('hubspot-sync-outbound-contacts-conflicts')).toHaveText('0');
      const body = await (await ctx.request.get(`${API}/outbound`)).text();
      expect(body).not.toContain(title);
      expect(body).not.toContain('pat-e2e');
      await noSideScroll(p);
      await p.screenshot({ path: test.info().outputPath(`hsout-on-${vp.name}.png`), fullPage: true });

      // La entrada relee lo que mandamos: igual de los dos lados, sin conflicto.
      await sql('UPDATE crm_hubspot_inbound SET next_run_at = NULL WHERE user_id = ?', [me.id]);
      await expect.poll(async () => ((await (await ctx.request.post(`${API}/inbound/run`)).json()) as { inbound: { conflicts: number; state: string } }).inbound.state, { timeout: 60_000 }).toBe('live');
      expect(Number((await sql('SELECT COUNT(*) AS n FROM crm_hubspot_sync_conflicts WHERE user_id = ?', [me.id]))[0].n)).toBe(0);
      expect(String((await sql('SELECT job_title FROM crm_contacts WHERE id = ?', [contactId]))[0].job_title)).toBe(title);

      // Apagar, con el teclado.
      await p.getByTestId('hubspot-sync-outbound-disable').focus();
      await p.keyboard.press('Enter');
      await expect(card(p)).toHaveAttribute('data-state', 'off');
      await p.reload({ waitUntil: 'networkidle' });
      await expect(card(p)).toHaveAttribute('data-state', 'off', { timeout: 60_000 });
      await noSideScroll(p);
      expect(me.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('la escritura en HubSpot en los cinco aspectos, claro y oscuro', async ({ browser }) => {
  const me = await person(browser, 'Joel');
  const { p, ctx } = me;
  const baseURL = test.info().project.use.baseURL as string;
  try {
    await liveInbound(ctx, 'looks');
    expect((await ctx.request.post(`${API}/outbound`, { data: { action: 'preview' } })).status()).toBe(200);
    expect((await ctx.request.post(`${API}/outbound`, { data: { action: 'enable' } })).status()).toBe(200);
    // Los cinco aspectos, claro y oscuro.
    for (const [look, theme] of (['current', 'lines', 'classic', 'liquid', 'retro'] as const).flatMap((l) => [[l, 'light'] as const, [l, 'dark'] as const])) {
      expect((await ctx.request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      await setTheme(ctx, baseURL, theme);
      await p.goto(SETTINGS, { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(card(p)).toHaveAttribute('data-state', 'on', { timeout: 120_000 });
      const colors = await p.getByTestId('hubspot-sync-outbound-contacts-updated').evaluate((el) => {
        let node: Element | null = el;
        let bg = 'rgba(0, 0, 0, 0)';
        while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
          bg = getComputedStyle(node).backgroundColor;
          node = node.parentElement;
        }
        return { ink: getComputedStyle(el).color, bg, border: getComputedStyle(el.closest('.hsync-table-wrap')!).borderTopColor };
      });
      expect(colors.ink, `${look} ${theme}`).not.toBe(colors.bg);
      expect(colors.border, `${look} ${theme}`).not.toBe('rgba(0, 0, 0, 0)');
      await noSideScroll(p);
      await card(p).screenshot({ path: test.info().outputPath(`hsout-${look}-${theme}.png`) });
    }
    expect(me.errors).toEqual([]);
  } finally {
    await ctx.request.post(`${API}/outbound`, { data: { action: 'disable' } }).catch(() => null);
    await ctx.request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
    await ctx.close();
  }
});
