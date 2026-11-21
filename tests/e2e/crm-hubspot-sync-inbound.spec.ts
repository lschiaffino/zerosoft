import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { setTheme } from './responsive-audit';

/**
 * CRM › Ajustes › Integraciones › Sync con HubSpot: la entrada de HubSpot al
 * CRM (bloque S2) contra la cuenta falsa del sync (CRM_IMPORT_FAKE;
 * lib/hubspot/fake-portal.ts › seedSyncPortal: tres empresas, tres contactos,
 * dos negocios). Apagado al conectar, arrancar, ver el avance de la primera
 * vuelta, los conteos, pausar y retomar. A 1280 y a 390, y la pantalla en el
 * aspecto actual claro y en retro oscuro.
 *
 * Cada test usa su propia cuenta (su propio workspace). Nada sale a internet.
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
  const email = `${label}-${uid()}@hsin-e2e.io`.toLowerCase();
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

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const card = (p: Page) => p.getByTestId('hubspot-sync-inbound');
const cell = (p: Page, row: string, col: string) => p.getByTestId(`hubspot-sync-inbound-${row}-${col}`);
const count = async (table: string, ws: string) => Number((await sql(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [ws]))[0].n);

for (const vp of [
  { name: '1280', width: 1280 },
  { name: '390', width: 390 },
]) {
  test(`arrancar, avance, conteos, pausar y retomar a ${vp.name}`, async ({ browser }) => {
    const me = await person(browser, 'Ines', vp.width);
    const { p, ctx } = me;
    try {
      expect((await ctx.request.post(API, { data: { token: `pat-e2e-inbound-${uid()}` } })).status()).toBe(200);
      await p.goto(SETTINGS, { waitUntil: 'networkidle' });

      // Conectado no es prendido: apagado hasta que un admin lo arranca, y nada entró al CRM.
      await expect(card(p)).toHaveAttribute('data-state', 'off', { timeout: 120_000 });
      await expect(p.getByTestId('hubspot-sync-off')).toContainText('Sync is off');
      await expect(p.getByTestId('hubspot-sync-inbound-counts')).toHaveCount(0);
      // Los emails registrados piden un permiso que esta clave no informa: arrancan sin marcar.
      await expect(p.getByTestId('hubspot-sync-inbound-object-emails')).not.toBeChecked();
      await expect(p.getByTestId('hubspot-sync-inbound-object-contacts')).toBeChecked();
      expect(await count('crm_contacts', me.id)).toBe(0);
      await noSideScroll(p);

      // Se ve el avance: el primer tramo queda retenido hasta mirarlo.
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      await p.route('**/api/crm/hubspot-sync/inbound/run', async (route) => {
        await held;
        await route.fallback();
      });
      await p.getByTestId('hubspot-sync-inbound-start').click();
      await expect(card(p)).toHaveAttribute('data-state', 'initial', { timeout: 60_000 });
      await expect(p.getByTestId('hubspot-sync-inbound-progress')).toBeVisible();
      await expect(p.getByRole('progressbar', { name: 'Sync progress' })).toBeVisible();
      await expect(p.getByTestId('hubspot-sync-inbound-pause')).toBeVisible();
      await noSideScroll(p);
      await p.getByTestId('hubspot-sync-inbound-progress').screenshot({ path: test.info().outputPath(`hsin-progress-${vp.name}.png`) });
      release();

      // La pantalla empuja tramos hasta traer todo; después queda al día.
      await expect(card(p)).toHaveAttribute('data-state', 'live', { timeout: 120_000 });
      await expect(cell(p, 'contacts', 'linked')).toHaveText('3');
      await expect(cell(p, 'companies', 'linked')).toHaveText('3');
      await expect(cell(p, 'deals', 'linked')).toHaveText('2');
      await expect(cell(p, 'contacts', 'created')).toHaveText('3');
      await expect(cell(p, 'contacts', 'conflicts')).toHaveText('0');
      await expect(p.getByTestId('hubspot-sync-inbound-last')).toContainText('Last sync');
      expect(await count('crm_contacts', me.id)).toBe(3);
      expect(await count('crm_deals', me.id)).toBe(2);
      // Lo que vuelve por la API son conteos y códigos: ni la clave ni datos de registros.
      const body = await (await ctx.request.get(`${API}/inbound`)).text();
      expect(body).not.toContain('pat-e2e');
      expect(body).not.toContain('northwind');
      await noSideScroll(p);
      await p.screenshot({ path: test.info().outputPath(`hsin-live-${vp.name}.png`), fullPage: true });

      // Pausar: nada corre aunque se empujen tramos. Retomar vuelve a "al día".
      await p.getByTestId('hubspot-sync-inbound-pause').click();
      await expect(card(p)).toHaveAttribute('data-state', 'paused');
      await expect(p.getByTestId('hubspot-sync-inbound-state')).toContainText('Paused');
      const paused = (await (await ctx.request.post(`${API}/inbound/run`)).json()) as { inbound: { state: string } };
      expect(paused.inbound.state).toBe('paused');
      await p.getByTestId('hubspot-sync-inbound-resume').focus();
      await p.keyboard.press('Enter');
      await expect(card(p)).toHaveAttribute('data-state', 'live', { timeout: 60_000 });

      // Cambiar qué se trae: se guarda y queda así al volver.
      await p.getByTestId('hubspot-sync-inbound-object-notes').uncheck();
      await p.getByTestId('hubspot-sync-inbound-objects-save').click();
      await expect(p.getByTestId('hubspot-sync-inbound-objects-save')).toHaveCount(0);
      await p.reload({ waitUntil: 'networkidle' });
      await expect(p.getByTestId('hubspot-sync-inbound-object-notes')).not.toBeChecked({ timeout: 60_000 });
      await expect(card(p)).toHaveAttribute('data-state', 'live');
      await noSideScroll(p);
      expect(me.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('la pantalla del sync en el aspecto actual claro y en retro oscuro', async ({ browser }) => {
  const me = await person(browser, 'Teo');
  const { p, ctx } = me;
  const baseURL = test.info().project.use.baseURL as string;
  try {
    expect((await ctx.request.post(API, { data: { token: `pat-e2e-inbound-looks-${uid()}` } })).status()).toBe(200);
    expect((await ctx.request.post(`${API}/inbound`, { data: { action: 'start' } })).status()).toBe(200);
    await expect.poll(async () => ((await (await ctx.request.post(`${API}/inbound/run`)).json()) as { inbound: { state: string } }).inbound.state, { timeout: 120_000 }).toBe('live');
    for (const [look, theme] of [
      ['current', 'light'],
      ['retro', 'dark'],
    ] as const) {
      expect((await ctx.request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      await setTheme(ctx, baseURL, theme);
      await p.goto(SETTINGS, { waitUntil: 'networkidle' });
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(card(p)).toHaveAttribute('data-state', 'live', { timeout: 120_000 });
      // El número se lee sobre su fondo y la tabla tiene borde, en cada aspecto.
      const colors = await cell(p, 'contacts', 'linked').evaluate((el) => {
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
      await card(p).screenshot({ path: test.info().outputPath(`hsin-${look}-${theme}.png`) });
    }
    expect(me.errors).toEqual([]);
  } finally {
    await ctx.request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
    await ctx.close();
  }
});
