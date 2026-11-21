import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { setTheme } from './responsive-audit';

/**
 * CRM › Ajustes › Integraciones › Sync con HubSpot, de punta a punta contra la
 * cuenta falsa del sync (CRM_IMPORT_FAKE; lib/hubspot/fake-portal.ts ›
 * seedSyncPortal: tres contactos, uno sin email; tres empresas, dos con el
 * mismo dominio; dos negocios). Conectar con una clave a la que le faltan
 * permisos de lectura (no conecta y dice cuáles), con una que solo lee
 * (conecta y avisa lo que va a faltar después), correr la vista previa y ver
 * los números y el grupo ambiguo, cancelar, desconectar, y que un member no
 * entra. A 1280 y a 390, y en los cinco aspectos, claro y oscuro.
 *
 * Cada test usa una cuenta nueva (su propio workspace): los números no
 * dependen de lo que otros tests dejaron. Nada sale a internet.
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

/** Cuenta nueva ya onboardeada, con su CRM en un estado conocido. */
async function person(browser: Browser, label: string, width = 1280): Promise<{ ctx: BrowserContext; p: Page; id: string; errors: string[] }> {
  const baseURL = test.info().project.use.baseURL as string;
  const email = `${label}-${uid()}@hsync-e2e.io`.toLowerCase();
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('/en/app', { waitUntil: 'domcontentloaded' });
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [label, id]);
  return { ctx, p, id, errors };
}

/** Un contacto con el email de uno de HubSpot (en otras mayúsculas), uno solo nuestro y una empresa con el dominio repetido en HubSpot. */
async function seedCrm(ws: string) {
  for (const table of ['crm_contacts', 'crm_companies', 'crm_deals']) await sql(`DELETE FROM ${table} WHERE user_id = ?`, [ws]);
  const contact = (id: string, first: string, last: string, email: string) =>
    sql(`INSERT INTO crm_contacts (id, user_id, owner_id, first_name, last_name, email, lifecycle_stage, lead_status, custom) VALUES (?, ?, ?, ?, ?, ?, 'lead', 'new', '{}')`, [`${ws}-${id}`, ws, ws, first, last, email]);
  await contact('c1', 'Mara', 'Quiroga', 'MARA@northwind-parts.example');
  await contact('c2', 'Only', 'Here', 'only-here@hsync-local.example');
  await sql(`INSERT INTO crm_companies (id, user_id, owner_id, name, domain, custom) VALUES (?, ?, ?, 'Tallgrass Labs', 'https://www.tallgrass-labs.example', '{}')`, [`${ws}-co1`, ws, ws]);
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const panel = (p: Page) => p.getByTestId('hubspot-sync');
const stat = (p: Page, object: string, key: string) => p.getByTestId(`hubspot-sync-${object}-${key}`);

async function connect(p: Page, key: string) {
  await p.getByLabel('Service key or private app token').fill(key);
  await p.getByRole('button', { name: 'Connect HubSpot' }).click();
}

for (const vp of [
  { name: '1280', width: 1280 },
  { name: '390', width: 390 },
]) {
  test(`conectar, vista previa, cancelar y desconectar a ${vp.name}`, async ({ browser }) => {
    const me = await person(browser, 'Olga', vp.width);
    const { p, ctx } = me;
    try {
      await seedCrm(me.id);
      await p.goto(SETTINGS, { waitUntil: 'networkidle' });
      await expect(panel(p)).toHaveAttribute('data-connected', 'false', { timeout: 120_000 });

      // El sync está apagado y la pantalla lo dice; no hay nada que prender todavía.
      await expect(p.getByTestId('hubspot-sync-off')).toContainText('Sync is off');
      await expect(p.getByTestId('hubspot-sync-preview')).toHaveCount(0);
      // De dónde sale la clave y qué permisos pide: los de leer ahora, los de escribir después.
      await expect(p.getByTestId('hubspot-key-help')).toBeVisible();
      await expect(p.getByTestId('hubspot-sync-scopes-read').locator('li')).toHaveCount(7);
      await expect(p.getByTestId('hubspot-sync-scopes-write').locator('li')).toHaveCount(3);
      await expect(p.getByTestId('hubspot-sync-lines')).toHaveCount(0);
      await noSideScroll(p);
      await p.screenshot({ path: test.info().outputPath(`hsync-connect-${vp.name}.png`), fullPage: true });

      // Sin permisos de lectura: no conecta y dice cuáles faltan, en palabras.
      await connect(p, 'pat-e2e-svc-noscope-key');
      const missing = p.getByTestId('hubspot-key-missing');
      await expect(missing).toBeVisible({ timeout: 120_000 });
      await expect(missing.locator('li')).toHaveCount(6);
      await expect(missing).toContainText('Read owners, the people records are assigned to');
      await expect(missing).toContainText('crm.objects.owners.read');
      await noSideScroll(p);
      await missing.scrollIntoViewIfNeeded();
      await p.screenshot({ path: test.info().outputPath(`hsync-missing-${vp.name}.png`) });
      expect(((await (await ctx.request.get(API)).json()) as { connected: boolean }).connected).toBe(false);

      // Una clave que solo lee: conecta, y lo de escribir queda como "hace falta después", no como error.
      await connect(p, 'pat-e2e-svc-readonly-key');
      await expect(panel(p)).toHaveAttribute('data-connected', 'true', { timeout: 120_000 });
      await expect(missing).toHaveCount(0);
      const summary = p.getByTestId('hubspot-key-summary');
      await expect(summary).toHaveAttribute('data-kind', 'service_key');
      await expect(summary.getByTestId('hubspot-key-portal')).toHaveText('HubSpot account 515151');
      await expect(summary.getByTestId('hubspot-key-can')).toContainText('Read contacts');
      await expect(summary.getByTestId('hubspot-key-cannot').locator('li')).toHaveCount(3);
      await expect(p.getByTestId('hubspot-sync-write-later')).toContainText('only needed later');
      await expect(p.getByTestId('hubspot-sync-error')).toHaveCount(0);
      await expect(p.getByTestId('hubspot-sync-off')).toBeVisible();
      // La clave no vuelve por la API.
      const status = await (await ctx.request.get(API)).text();
      expect(status).not.toContain('pat-e2e');
      expect(JSON.parse(status)).toMatchObject({ connected: true, portalId: '515151', tokenKind: 'service_key', settings: { enabled: false } });
      await noSideScroll(p);

      // Cancelar: se frena el primer tramo para que la vista previa siga en curso.
      const preview = p.getByTestId('hubspot-sync-preview');
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      await p.route('**/api/crm/hubspot-sync/preview/run', async (route) => {
        await held;
        await route.fallback();
      });
      await preview.getByTestId('hubspot-sync-preview-run').click();
      await expect(p.getByTestId('hubspot-sync-progress')).toBeVisible({ timeout: 120_000 });
      await expect(p.getByRole('progressbar', { name: 'Preview progress' })).toBeVisible();
      await preview.getByRole('button', { name: 'Cancel preview' }).click();
      await expect(p.getByTestId('hubspot-sync-preview-cancelled')).toBeVisible({ timeout: 120_000 });
      await expect(preview).toHaveAttribute('data-status', 'cancelled');
      release();
      await p.unroute('**/api/crm/hubspot-sync/preview/run');
      expect(((await (await ctx.request.get(`${API}/preview`)).json()) as { preview: { status: string } }).preview.status).toBe('cancelled');

      // La vista previa de verdad: números arriba y grupos que se abren.
      await preview.getByTestId('hubspot-sync-preview-run').click();
      const report = p.getByTestId('hubspot-sync-report');
      await expect(report).toBeVisible({ timeout: 120_000 });
      await expect(p.getByTestId('hubspot-sync-nothing-written')).toContainText('Nothing has been written');
      for (const [object, key, value] of [
        ['contacts', 'hubspot', '3'],
        ['contacts', 'zerosoft', '2'],
        ['contacts', 'matched', '1'],
        ['contacts', 'create_zerosoft', '1'],
        ['contacts', 'create_hubspot', '1'],
        ['contacts', 'review', '1'],
        ['companies', 'hubspot', '3'],
        ['companies', 'zerosoft', '1'],
        ['companies', 'create_zerosoft', '1'],
        ['companies', 'review', '2'],
        ['deals', 'hubspot', '2'],
        ['deals', 'create_zerosoft', '2'],
        ['deals', 'linked', '0'],
      ] as const) {
        await expect(stat(p, object, key), `${object} ${key}`).toHaveText(value);
      }
      // Las dos empresas de HubSpot con el mismo dominio: alguien tiene que decidir.
      const ambiguous = p.getByTestId('hubspot-sync-companies-bucket-multi_hubspot');
      await expect(ambiguous.locator('.hsync-sample').first()).toBeHidden();
      await ambiguous.locator('summary').click();
      await expect(ambiguous.locator('.hsync-sample').first()).toBeVisible();
      await expect(ambiguous.locator('.hsync-sample')).toHaveCount(2);
      await expect(ambiguous).toContainText('Tallgrass Labs (EU)');
      await expect(ambiguous).toContainText('HubSpot allows repeated domains');
      // El contacto sin email de HubSpot y el que coincide por email.
      const noEmail = p.getByTestId('hubspot-sync-contacts-bucket-no_key_hubspot');
      await noEmail.locator('summary').click();
      await expect(noEmail).toContainText('Bia Nunes');
      const matched = p.getByTestId('hubspot-sync-contacts-bucket-matched');
      await matched.locator('summary').click();
      await expect(matched).toContainText('Mara Quiroga');
      await expect(matched.getByRole('link', { name: 'Open in zerosoft' })).toHaveAttribute('href', new RegExp(`/app/crm/contacts/${me.id}-c1$`));
      // Dueños sin persona acá, pipelines sin equivalente y propiedades sin campo.
      const owners = p.getByTestId('hubspot-sync-owners');
      await owners.locator('summary').click();
      await expect(owners.getByTestId('hubspot-sync-owners-hubspot-only').locator('li')).toHaveCount(2);
      const props = p.getByTestId('hubspot-sync-properties-contacts');
      await props.locator('summary').click();
      await expect(props.getByTestId('hubspot-sync-properties-contacts-hubspot-only')).toContainText('preferred_language');
      await p.getByTestId('hubspot-sync-pipelines').locator('summary').click();
      await p.getByTestId('hubspot-sync-limits').locator('summary').click();
      await noSideScroll(p);
      await p.screenshot({ path: test.info().outputPath(`hsync-report-${vp.name}.png`), fullPage: true });

      // Nada se escribió: los registros del CRM son los mismos y no hay vínculos.
      expect(Number((await sql('SELECT COUNT(*) AS n FROM crm_contacts WHERE user_id = ?', [me.id]))[0].n)).toBe(2);
      expect(Number((await sql('SELECT COUNT(*) AS n FROM crm_companies WHERE user_id = ?', [me.id]))[0].n)).toBe(1);
      expect(Number((await sql('SELECT COUNT(*) AS n FROM crm_hubspot_links WHERE user_id = ?', [me.id]))[0].n)).toBe(0);
      // Al recargar, el informe sigue ahí (vive en el servidor).
      await p.reload({ waitUntil: 'networkidle' });
      await expect(stat(p, 'companies', 'review')).toHaveText('2', { timeout: 120_000 });

      // Desconectar pide confirmar; la confirmación se cierra con Esc y con un clic afuera.
      const confirm = p.getByTestId('hubspot-sync-disconnect-confirm');
      const disconnect = p.getByTestId('hubspot-sync-connect').getByRole('button', { name: 'Disconnect', exact: true });
      await disconnect.click();
      await expect(confirm).toBeVisible();
      await p.keyboard.press('Escape');
      await expect(confirm).toBeHidden();
      await disconnect.click();
      await expect(confirm).toBeVisible();
      await p.getByTestId('hubspot-sync-off').click();
      await expect(confirm).toBeHidden();
      await expect(panel(p)).toHaveAttribute('data-connected', 'true');
      await disconnect.click();
      await noSideScroll(p);
      await confirm.getByRole('button', { name: 'Disconnect HubSpot' }).click();
      await expect(panel(p)).toHaveAttribute('data-connected', 'false', { timeout: 120_000 });
      await expect(p.getByTestId('hubspot-sync-preview')).toHaveCount(0);
      expect(await (await ctx.request.get(API)).json()).toMatchObject({ connected: false, portalId: '' });
      expect(await (await ctx.request.get(`${API}/preview`)).json()).toEqual({ preview: null });
      expect(Number((await sql('SELECT COUNT(*) AS n FROM crm_hubspot_sync WHERE user_id = ?', [me.id]))[0].n)).toBe(0);
      expect(me.errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('un member del workspace no entra: ni a la pantalla ni a las rutas', async ({ browser }) => {
  const owner = await person(browser, 'Olga');
  const member = await person(browser, 'Mario');
  try {
    await seedCrm(owner.id);
    expect((await owner.ctx.request.post(API, { data: { token: 'pat-e2e-member-legacy' } })).status()).toBe(200);
    expect((await owner.ctx.request.post(`${API}/preview`)).status()).toBe(201);
    await expect.poll(async () => ((await (await owner.ctx.request.post(`${API}/preview/run`)).json()) as { preview: { status: string } }).preview.status, { timeout: 120_000 }).toBe('done');

    const team = String((await sql('SELECT id FROM teams WHERE owner_id = ? ORDER BY created_at LIMIT 1', [owner.id]))[0].id);
    await sql("UPDATE teams SET use_mode = 'team' WHERE id = ?", [team]);
    await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, member.id]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [team, member.id]);

    const p = member.p;
    await p.goto(SETTINGS, { waitUntil: 'networkidle' });
    await expect(p.locator('#hubspot-sync')).toContainText('Only workspace admins can change this.', { timeout: 120_000 });
    await expect(p.getByTestId('hubspot-sync')).toHaveCount(0);
    await expect(p.getByTestId('hubspot-sync-report')).toHaveCount(0);
    await expect(p.locator('body')).not.toContainText('Tallgrass');
    for (const res of [
      await member.ctx.request.get(API),
      await member.ctx.request.get(`${API}/preview`),
      await member.ctx.request.post(`${API}/preview`),
      await member.ctx.request.post(`${API}/preview/run`),
      await member.ctx.request.post(API, { data: { token: 'pat-e2e-member-own' } }),
      await member.ctx.request.post(API, { data: { useLinesKey: true } }),
      await member.ctx.request.delete(API),
      await member.ctx.request.delete(`${API}/preview`),
    ]) {
      expect(res.status(), res.url()).toBe(403);
      expect(await res.text()).not.toMatch(/Tallgrass|Mara|515151/);
    }
    // La conexión del owner sigue igual.
    expect(await (await owner.ctx.request.get(API)).json()).toMatchObject({ connected: true, portalId: '515151' });
  } finally {
    await owner.ctx.close();
    await member.ctx.close();
  }
});

test('el informe en los cinco aspectos, claro y oscuro', async ({ browser }) => {
  const me = await person(browser, 'Olga');
  const { p, ctx } = me;
  const baseURL = test.info().project.use.baseURL as string;
  try {
    await seedCrm(me.id);
    expect((await ctx.request.post(API, { data: { token: 'pat-e2e-svc-readonly-looks' } })).status()).toBe(200);
    expect((await ctx.request.post(`${API}/preview`)).status()).toBe(201);
    await expect.poll(async () => ((await (await ctx.request.post(`${API}/preview/run`)).json()) as { preview: { status: string } }).preview.status, { timeout: 120_000 }).toBe('done');
    for (const look of ['current', 'lines', 'classic', 'liquid', 'retro'] as const) {
      expect((await ctx.request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(ctx, baseURL, theme);
        await p.goto(SETTINGS, { waitUntil: 'networkidle' });
        await expect(p.locator('html')).toHaveAttribute('data-look', look);
        const card = p.getByTestId('hubspot-sync-object-companies');
        await expect(card).toBeVisible({ timeout: 120_000 });
        await p.getByTestId('hubspot-sync-companies-bucket-multi_hubspot').locator('summary').click();
        // El número y su etiqueta se leen sobre su fondo, y los bordes existen, en cada aspecto.
        const colors = await stat(p, 'companies', 'review').evaluate((el) => {
          const bgOf = (start: Element) => {
            let node: Element | null = start;
            let bg = 'rgba(0, 0, 0, 0)';
            while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
              bg = getComputedStyle(node).backgroundColor;
              node = node.parentElement;
            }
            return bg;
          };
          const label = el.parentElement!.querySelector('dt')!;
          return { ink: getComputedStyle(el).color, label: getComputedStyle(label).color, bg: bgOf(el), border: getComputedStyle(el.closest('.hsync-stats')!).borderTopColor };
        });
        expect(colors.ink, `${look} ${theme}`).not.toBe(colors.bg);
        expect(colors.label, `${look} ${theme}`).not.toBe(colors.bg);
        expect(colors.border, `${look} ${theme}`).not.toBe('rgba(0, 0, 0, 0)');
        await noSideScroll(p);
        await p.getByTestId('hubspot-sync-connect').scrollIntoViewIfNeeded();
        await p.screenshot({ path: test.info().outputPath(`hsync-${look}-${theme}.png`), fullPage: true });
      }
    }
    expect(me.errors).toEqual([]);
  } finally {
    await ctx.request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
    await ctx.close();
  }
});
