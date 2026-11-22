import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM: la tabla de envíos de un form no lleva la columna de un campo del form
 * que guarda en una propiedad que la persona tiene oculta (ni su etiqueta, ni
 * el valor en el detalle, ni en el CSV). El owner la ve. A 1280 (claro) y 390
 * (oscuro, otro aspecto) sin scroll horizontal. Workspace propio: los
 * permisos por campo no tocan al resto de la suite.
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

async function personContext(browser: Browser, email: string, opts: { width: number; scheme: 'light' | 'dark'; look?: string }) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: opts.width, height: opts.width < 500 ? 844 : 900 }, colorScheme: opts.scheme });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  if (opts.look) await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  return ctx;
}

/** Owner con un campo de contactos oculto para members, un form que lo usa y un envío; y un member. */
async function setup(browser: Browser, opts: { width: number; scheme: 'light' | 'dark'; look?: string }) {
  const ownerEmail = `subs-owner-${uid()}@crm-subcols-e2e.test`;
  const memberEmail = `subs-member-${uid()}@crm-subcols-e2e.test`;
  const owner = await personContext(browser, ownerEmail, opts);
  const onb = await owner.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'Subs', locale: 'en', apps: ['crm'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  const name = `subs_${uid()}`;
  const field = await (await owner.request.post('/api/crm/custom-fields', { data: { entity: 'contacts', name, label: 'Budget code', type: 'text' } })).json();
  const perms = await owner.request.put(`/api/crm/field-permissions/${field.id}`, { data: { rules: [{ subject: 'role:member', access: 'hidden' }] } });
  expect(perms.ok(), await perms.text()).toBe(true);
  const created = await owner.request.post('/api/crm/forms', {
    data: {
      name: `Signup ${uid()}`,
      status: 'active',
      fields: [
        { id: 'email', type: 'email', label: 'Work email', property: 'email', required: true },
        { id: 'budget', type: 'text', label: 'Budget question', property: `custom.${name}`, required: false },
        { id: 'note', type: 'text', label: 'Anything else', property: '', required: false },
      ],
      settings: { minSubmitSeconds: 0 },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const form = await created.json();
  const sent = await owner.request.post(`/api/crm/forms/submit/${form.token}`, {
    data: { values: { email: `lead-${uid()}@example.test`, budget: 'bq-4471', note: 'nq-visible' }, elapsedMs: 9000 },
  });
  expect(sent.ok(), await sent.text()).toBe(true);

  const invite = await owner.request.post('/api/teams/invites', { data: { emails: [memberEmail], role: 'member' } });
  expect(invite.ok(), await invite.text()).toBe(true);
  const token = String((await sql("SELECT token FROM team_invites WHERE email = ? AND status = 'pending'", [memberEmail]))[0]?.token);
  const member = await personContext(browser, memberEmail, opts);
  const accepted = await member.request.post('/api/teams/accept', { data: { token } });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [memberEmail]);
  await member.request.post('/api/tours', { data: { kind: 'off', off: true } });
  if (opts.look) await sql('UPDATE users SET ui_look = ? WHERE email = ?', [opts.look, memberEmail]);
  return { owner, member, form };
}

async function closeAll(...ctxs: BrowserContext[]) {
  for (const c of ctxs) await c.close();
}

for (const view of [
  { width: 1280, scheme: 'light' as const },
  { width: 390, scheme: 'dark' as const, look: 'retro' },
]) {
  test(`envíos de un form: sin la columna de un campo oculto para quien mira (${view.width})`, async ({ browser }) => {
    // next dev (E2E_DEV) compila la página del form la primera vez: más margen que el de CI.
    test.setTimeout(300_000);
    const { owner, member, form } = await setup(browser, view);
    try {
      const page = await member.newPage();
      await page.goto(`/en/app/crm/forms/${form.id}?tab=submissions`);
      const table = page.locator('.forms-subs table');
      await expect(page.getByTestId('form-submission-row')).toHaveCount(1);
      await expect(table.locator('thead')).toContainText('Work email');
      await expect(table.locator('thead')).toContainText('Anything else');
      await expect(table.locator('thead')).not.toContainText('Budget question');
      await expect(page.locator('.forms-subs')).not.toContainText('bq-4471');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

      const csv = await (await member.request.get(`/api/crm/forms/${form.id}/submissions?format=csv`)).text();
      expect(csv.split('\n')[0]).not.toContain('Budget question');
      expect(csv).not.toContain('bq-4471');
      expect(csv).toContain('nq-visible');

      // El owner ve la columna y el valor.
      const ownerPage = await owner.newPage();
      await ownerPage.goto(`/en/app/crm/forms/${form.id}?tab=submissions`);
      await expect(ownerPage.locator('.forms-subs table thead')).toContainText('Budget question');
      await expect(ownerPage.getByTestId('form-submission-row')).toContainText('bq-4471');
    } finally {
      await closeAll(member, owner);
    }
  });
}
