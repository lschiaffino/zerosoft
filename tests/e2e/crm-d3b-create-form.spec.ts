import fs from 'fs';
import path from 'path';
import { expect as baseExpect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM, bloque D3b: formulario de alta configurable (HubSpot "Manage create
 * form"). Ajustes › Datos elige qué propiedades muestra el alta, en qué orden
 * y cuáles son obligatorias; la ventana de alta rápida y los formularios
 * completos lo siguen. Cada prueba usa una cuenta propia (la configuración es
 * del workspace y la cuenta demo es compartida). A 1280 y 390, y en los cinco
 * aspectos en claro y oscuro. Datos inventados.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const WIDTHS = [1280, 390] as const;
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function shot(page: Page, info: TestInfo, name: string) {
  const body = await page.screenshot();
  await info.attach(name, { body, contentType: 'image/png' });
  const dir = process.env.E2E_SHOT_DIR;
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), body);
  }
}

async function ok<T>(p: Promise<import('@playwright/test').APIResponse>, status = 200): Promise<T> {
  const res = await p;
  expect(res.status(), await res.text()).toBe(status);
  return (await res.json()) as T;
}

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Cuenta nueva, ya onboardeada y sin tours: su propio workspace, owner de él. */
async function person(browser: Browser, opts: { width?: number; theme?: 'light' | 'dark' } = {}) {
  const baseURL = test.info().project.use.baseURL as string;
  const email = `create-form-${uid()}@crm-create-form-e2e.io`;
  const ctx: BrowserContext = await browser.newContext({ baseURL, viewport: { width: opts.width ?? 1280, height: 900 } });
  const cookies = [{ name: 'zs_e2e_as', value: email, url: baseURL }];
  if (opts.theme) cookies.push({ name: 'zs_theme', value: opts.theme, url: baseURL });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ctx.request.get('/api/notes');
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = 'Form Owner' WHERE id = ?", [id]);
  await ctx.request.post('/api/tours', { data: { kind: 'off', off: true } });
  return { ctx, page, request: ctx.request, errors };
}

/** Una propiedad propia de contactos, un pipeline con una etapa y el formulario de alta configurado por API. */
async function seed(request: APIRequestContext) {
  await ok(request.post('/api/crm/custom-fields', { data: { entity: 'contacts', name: 'plan_tier', label: 'Plan tier', type: 'text' } }), 201);
  const pipeline = await ok<{ id: string }>(request.post('/api/crm/pipelines', { data: { name: 'Ventas' } }), 201);
  await ok(request.post(`/api/crm/pipelines/${pipeline.id}/stages`, { data: { name: 'Calificado' } }), 201);
  await ok(
    request.put('/api/crm/create-form', {
      data: {
        entity: 'contacts',
        fields: [
          { key: 'jobTitle', required: true },
          { key: 'custom.plan_tier', required: true },
          { key: 'phone' },
        ],
      },
    }),
  );
  await ok(
    request.put('/api/crm/create-form', {
      data: { entity: 'deals', fields: [{ key: 'dealType', required: true }, { key: 'nextStep' }, { key: 'amount' }] },
    }),
  );
}

test('Ajustes › Datos: elegir propiedades, orden y obligatorias del alta (1280 y 390)', async ({ browser }, info) => {
  for (const width of WIDTHS) {
    const { ctx, page, request, errors } = await person(browser, { width });
    try {
      await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
      const panel = page.getByTestId('create-form-panel');
      await expect(panel).toBeVisible();
      // Por defecto: lo que ya mostraba el alta rápida.
      await expect(panel.getByTestId('create-form-row-phone')).toBeVisible();

      const add = panel.getByTestId('create-form-add-select');
      const saved = () => page.waitForResponse((r) => r.url().includes('/api/crm/create-form') && r.request().method() === 'PUT');
      await add.selectOption({ label: 'Job title' });
      await Promise.all([saved(), panel.getByRole('button', { name: 'Add', exact: true }).click()]);
      await expect(panel.getByTestId('create-form-row-jobTitle')).toBeVisible();
      await Promise.all([saved(), panel.getByTestId('create-form-required-jobTitle').check()]);
      await Promise.all([saved(), panel.getByRole('button', { name: 'Move up: Job title' }).click()]);

      const form = await ok<{ fields: Array<{ key: string; required: boolean }> }>(request.get('/api/crm/create-form?entity=contacts'));
      expect(form.fields).toEqual([
        { key: 'phone', required: false },
        { key: 'companyId', required: false },
        { key: 'jobTitle', required: true },
        { key: 'lifecycleStage', required: false },
      ]);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await panel.scrollIntoViewIfNeeded();
      await shot(page, info, `d3b-settings-contacts-${width}`);

      // Deals: la base siempre obligatoria; deal type se suma como obligatoria.
      await panel.getByLabel('Object').selectOption('deals');
      await expect(panel.getByTestId('create-form-required-name')).toBeDisabled();
      await add.selectOption({ label: 'Deal type' });
      await Promise.all([saved(), panel.getByRole('button', { name: 'Add', exact: true }).click()]);
      await Promise.all([saved(), panel.getByTestId('create-form-required-dealType').check()]);
      const deals = await ok<{ fields: Array<{ key: string; required: boolean }> }>(request.get('/api/crm/create-form?entity=deals'));
      expect(deals.fields).toContainEqual({ key: 'dealType', required: true });
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, info, `d3b-settings-deals-${width}`);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('el alta rápida y los formularios completos siguen la configuración (1280 y 390)', async ({ browser }, info) => {
  for (const width of WIDTHS) {
    const { ctx, page, request, errors } = await person(browser, { width });
    try {
      await seed(request);
      const tag = uid();

      // La ruta de la app exige las obligatorias.
      const refused = await request.post('/api/crm/contacts', { data: { firstName: `Sin ${tag}` } });
      expect(refused.status()).toBe(400);
      expect(await refused.json()).toMatchObject({ error: 'missing_required', fields: ['jobTitle', 'custom.plan_tier'] });

      // Alta rápida de contacto.
      await page.goto('/en/app/crm/contacts?new=1', { waitUntil: 'networkidle' });
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('create-field-jobTitle')).toBeVisible();
      const jobTitle = dialog.getByLabel(/Job title/);
      await expect(jobTitle).toHaveAttribute('required', '');
      await dialog.getByLabel('First name').fill(`Quick ${tag}`);
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      // Falta lo obligatorio: el modal sigue abierto.
      await expect(dialog).toBeVisible();
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, info, `d3b-quick-contact-${width}`);
      await jobTitle.fill('Buyer');
      await dialog.getByLabel(/Plan tier/).fill('Pro');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog).toBeHidden();
      const list = await ok<{ rows: Array<{ first_name: string; job_title: string; custom: string }> }>(
        request.get(`/api/crm/contacts?q=${encodeURIComponent(`Quick ${tag}`)}`),
      );
      expect(list.rows[0]).toMatchObject({ job_title: 'Buyer' });
      expect(JSON.parse(list.rows[0].custom)).toMatchObject({ plan_tier: 'Pro' });

      // Formulario completo de contacto.
      await page.goto('/en/app/crm/contacts/new?full=1', { waitUntil: 'networkidle' });
      await page.getByLabel('First name').fill(`Full ${tag}`);
      await page.getByLabel(/Job title/).fill('Owner');
      await page.getByLabel(/Plan tier/).fill('Basic');
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, info, `d3b-full-contact-${width}`);
      await page.getByRole('button', { name: 'Create contact' }).click();
      await expect(page).toHaveURL(/\/en\/app\/crm\/contacts\/[0-9a-f-]{36}$/, { timeout: 20_000 });

      // Alta rápida de deal: deal type obligatorio.
      await page.goto('/en/app/crm/deals?new=1', { waitUntil: 'networkidle' });
      const dealDialog = page.getByRole('dialog');
      await expect(dealDialog.getByTestId('create-field-dealType')).toBeVisible();
      await dealDialog.getByLabel('Name').fill(`Deal ${tag}`);
      await dealDialog.getByLabel(/Deal type/).selectOption('newbusiness');
      await dealDialog.getByLabel(/Next step/).fill('Send proposal');
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, info, `d3b-quick-deal-${width}`);
      await dealDialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dealDialog).toBeHidden();

      // Formulario completo de deal: deal type y next step arriba, won reason en "More fields".
      await page.goto('/en/app/crm/deals/new?full=1', { waitUntil: 'networkidle' });
      await page.getByLabel('Name', { exact: true }).fill(`Full deal ${tag}`);
      await page.getByLabel(/Deal type/).selectOption('existingbusiness');
      await page.getByRole('button', { name: /More fields/ }).click();
      await expect(page.getByLabel('Closed won reason')).toBeVisible();
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, info, `d3b-full-deal-${width}`);
      await page.getByRole('button', { name: 'Create deal' }).click();
      await expect(page).toHaveURL(/\/en\/app\/crm\/deals\/[0-9a-f-]{36}$/, { timeout: 20_000 });
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('formulario de alta en los cinco aspectos, claro a 1280 y oscuro a 390', async ({ browser }, info) => {
  test.setTimeout(400_000);
  for (const look of LOOKS) {
    for (const [theme, width] of [
      ['light', 1280],
      ['dark', 390],
    ] as const) {
      const { ctx, page, request, errors } = await person(browser, { width, theme });
      try {
        await ok(request.put('/api/profile/look', { data: { look } }));
        await seed(request);
        await page.goto('/en/app/crm/settings?tab=data', { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const panel = page.getByTestId('create-form-panel');
        await panel.scrollIntoViewIfNeeded();
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await shot(page, info, `d3b-looks-settings-${look}-${theme}-${width}`);

        await page.goto('/en/app/crm/contacts?new=1', { waitUntil: 'networkidle' });
        await expect(page.getByRole('dialog').getByTestId('create-field-custom.plan_tier')).toBeVisible();
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await shot(page, info, `d3b-looks-quick-${look}-${theme}-${width}`);
        // Esc cierra el modal.
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toBeHidden();
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }
  }
});
