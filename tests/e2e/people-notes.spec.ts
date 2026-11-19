import { e2eDb } from './helpers/db';
import { expect, test, type APIResponse, type Browser } from '@playwright/test';

/**
 * People: la pestaña Notas de la ficha. HR escribe, edita y borra (con
 * confirmación); el manager de la persona la lee y suma la suya; la persona
 * no ve la pestaña y la API le responde 404.
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

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

/** Una persona más en el workspace demo, con su propia sesión (cookie zs_e2e_as), como en people.spec.ts. */
async function member(browser: Browser, baseURL: string, name: string) {
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `ppl-notes-${name.toLowerCase().replace(/\W+/g, '-')}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const userId = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [name, userId]);
  await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [demoTeam, userId, 'member', '*']);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, userId]);
  expect((await ctx.request.post('/api/people/me')).ok()).toBe(true);
  return { ctx, page, userId };
}

test('HR escribe, edita y borra notas sobre una persona desde la ficha', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const { employee } = await ok<{ employee: { id: string } }>(request.post('/api/people/employees', { data: { name: `Nora Notes ${uid()}` } }));
  await page.goto(`/en/app/people/${employee.id}?tab=hrnotes`, { waitUntil: 'networkidle' });
  const panel = page.getByTestId('people-notes');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('people-note')).toHaveCount(0);

  const box = panel.locator('#ppl-note-new');
  const add = panel.locator('form').first().getByRole('button');
  await expect(add).toBeDisabled();
  await box.fill('First note');
  await add.click();
  await expect(page.getByTestId('people-note')).toHaveCount(1);
  await expect(box).toHaveValue('');
  // Ctrl+Enter también guarda.
  await box.fill('Second note');
  await box.press('Control+Enter');
  await expect(page.getByTestId('people-note')).toHaveCount(2);
  await expect(page.getByTestId('people-note').first().locator('.ppl-pre')).toHaveText('Second note');

  // Editar: Esc cancela, guardar cambia el texto.
  const first = page.getByTestId('people-note').first();
  await first.getByRole('button').first().click();
  const edit = first.locator('textarea');
  await expect(edit).toBeFocused();
  await edit.press('Escape');
  await expect(first.locator('textarea')).toHaveCount(0);
  await first.getByRole('button').first().click();
  await first.locator('textarea').fill('Second note, edited');
  await first.locator('form').getByRole('button').first().click();
  await expect(first.locator('.ppl-pre')).toHaveText('Second note, edited');

  // Borrar pide confirmación; Esc la cierra sin borrar.
  await first.getByRole('button').nth(1).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('people-note')).toHaveCount(2);
  await first.getByRole('button').nth(1).click();
  await confirm.getByRole('button').last().click();
  await expect(page.getByTestId('people-note')).toHaveCount(1);

  // Sigue ahí después de recargar.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('people-note')).toHaveCount(1);
  await expect(page.getByTestId('people-note').first().locator('.ppl-pre')).toHaveText('First note');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('el manager lee y escribe notas de su reporte; la persona no las ve', async ({ browser, baseURL, request }) => {
  const mgr = await member(browser, baseURL!, `Mara Manager ${uid()}`);
  const rep = await member(browser, baseURL!, `Raul Report ${uid()}`);
  const { employees } = await ok<{ employees: Array<{ id: string; userId: string | null }> }>(request.get('/api/people/employees'));
  const mgrId = employees.find((e) => e.userId === mgr.userId)!.id;
  const repId = employees.find((e) => e.userId === rep.userId)!.id;
  await ok(request.patch(`/api/people/employees/${repId}`, { data: { managerId: mgrId } }));
  await ok(request.post(`/api/people/employees/${repId}/notes`, { data: { body: 'Written by HR' } }));

  // El manager ve la pestaña con la nota de HR (sin editarla) y suma la suya.
  await mgr.page.goto(`/en/app/people/${repId}?tab=hrnotes`, { waitUntil: 'networkidle' });
  const notes = mgr.page.getByTestId('people-note');
  await expect(notes).toHaveCount(1);
  await expect(notes.first().getByRole('button')).toHaveCount(0);
  await mgr.page.locator('#ppl-note-new').fill('Written by the manager');
  await mgr.page.getByTestId('people-notes').locator('form').first().getByRole('button').click();
  await expect(notes).toHaveCount(2);
  await expect(notes.first().getByRole('button')).toHaveCount(2);

  // La persona: ni pestaña ni API.
  await rep.page.goto(`/en/app/people/${repId}?tab=hrnotes`, { waitUntil: 'networkidle' });
  await expect(rep.page.getByTestId('people-notes')).toHaveCount(0);
  expect((await rep.ctx.request.get(`/api/people/employees/${repId}/notes`)).status()).toBe(404);
  expect((await rep.ctx.request.post(`/api/people/employees/${repId}/notes`, { data: { body: 'x' } })).status()).toBe(404);
  await mgr.ctx.close();
  await rep.ctx.close();
});
