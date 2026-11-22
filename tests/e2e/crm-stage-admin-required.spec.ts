import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM: un miembro mueve su deal a una etapa que pide un campo que tiene
 * oculto. El diálogo no nombra el campo, dice que lo completa un admin, no
 * ofrece guardar y se cierra con Esc. A 1280 (claro) y 390 (oscuro, otro
 * aspecto) sin scroll horizontal. Workspace propio: los permisos por campo
 * no tocan al resto de la suite.
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

/** Owner con un pipeline cuya segunda etapa pide un campo oculto para members, y un member con un deal propio. */
async function setup(browser: Browser, opts: { width: number; scheme: 'light' | 'dark'; look?: string }) {
  const ownerEmail = `adm-owner-${uid()}@crm-admreq-e2e.test`;
  const memberEmail = `adm-member-${uid()}@crm-admreq-e2e.test`;
  const owner = await personContext(browser, ownerEmail, opts);
  const onb = await owner.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'Adm', locale: 'en', apps: ['crm'] } });
  expect(onb.ok(), await onb.text()).toBe(true);
  const field = await (await owner.request.post('/api/crm/custom-fields', { data: { entity: 'deals', name: `adm_${uid()}`, label: 'Budget code', type: 'text' } })).json();
  const perms = await owner.request.put(`/api/crm/field-permissions/${field.id}`, { data: { rules: [{ subject: 'role:member', access: 'hidden' }] } });
  expect(perms.ok(), await perms.text()).toBe(true);
  const p = await (await owner.request.post('/api/crm/pipelines', { data: { name: `Adm ${uid()}` } })).json();
  const open = await (await owner.request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: 'Open' } })).json();
  const review = await (await owner.request.post(`/api/crm/pipelines/${p.id}/stages`, { data: { name: 'Review' } })).json();
  const rule = await owner.request.patch(`/api/crm/stages/${review.id}`, { data: { requiredFields: [`custom:${field.name}`] } });
  expect(rule.ok(), await rule.text()).toBe(true);
  const invite = await owner.request.post('/api/teams/invites', { data: { emails: [memberEmail], role: 'member' } });
  expect(invite.ok(), await invite.text()).toBe(true);
  const token = String((await sql("SELECT token FROM team_invites WHERE email = ? AND status = 'pending'", [memberEmail]))[0]?.token);

  const member = await personContext(browser, memberEmail, opts);
  const accepted = await member.request.post('/api/teams/accept', { data: { token } });
  expect(accepted.ok(), await accepted.text()).toBe(true);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [memberEmail]);
  await member.request.post('/api/tours', { data: { kind: 'off', off: true } });
  if (opts.look) await sql('UPDATE users SET ui_look = ? WHERE email = ?', [opts.look, memberEmail]);
  const deal = await (await member.request.post('/api/crm/deals', { data: { name: `Adm deal ${uid()}`, pipelineId: p.id, stageId: open.id } })).json();
  expect(deal.id).toBeTruthy();
  return { owner, member, deal, field, review };
}

async function closeAll(...ctxs: BrowserContext[]) {
  for (const c of ctxs) await c.close();
}

for (const view of [
  { width: 1280, scheme: 'light' as const },
  { width: 390, scheme: 'dark' as const, look: 'retro' },
]) {
  test(`mover a una etapa con un campo que solo completa un admin: el diálogo lo dice sin nombrarlo (${view.width})`, async ({ browser }) => {
    // next dev (E2E_DEV) compila la ficha del deal la primera vez: más margen que el de CI.
    test.setTimeout(300_000);
    const { owner, member, deal, field, review } = await setup(browser, view);
    try {
      const page = await member.newPage();
      await page.goto(`/en/app/crm/deals/${deal.id}`);
      const step = page.locator('.stage-step-btn', { hasText: 'Review' });
      await expect(step).toBeVisible();
      const check = page.waitForResponse((r) => r.url().includes(`/api/crm/deals/${deal.id}/move`) && r.request().method() === 'POST');
      await step.click();
      const body = (await (await check).json()) as { adminRequired?: boolean; missing?: unknown[] };
      expect(body).toMatchObject({ adminRequired: true, missing: [] });

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('stage-req-admin')).toBeVisible();
      await expect(dialog.getByTestId('stage-req-submit')).toHaveCount(0);
      await expect(dialog).not.toContainText('Budget code');
      await expect(dialog.getByTestId('stage-req-cancel')).toBeFocused();
      // Sin scroll horizontal.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      // El deal sigue en su etapa.
      const saved = await (await member.request.get(`/api/crm/deals/${deal.id}`)).json();
      expect((saved.deal ?? saved).stage_id).not.toBe(review.id);
      expect(JSON.stringify(saved)).not.toContain(field.name);
    } finally {
      await closeAll(member, owner);
    }
  });
}
