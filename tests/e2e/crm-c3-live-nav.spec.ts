import { expect, test, type Browser, type BrowserContext, type APIResponse, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM bloque C3: en vivo y anterior/siguiente.
 * - Dos personas del mismo workspace a la vez: lo que crea, edita, mueve o
 *   borra una aparece en la tabla, el tablero y la ficha de la otra sin
 *   recargar, y una celda en edición no se pisa.
 * - Una ficha abierta desde la tabla recorre esa vista con anterior/siguiente
 *   (botones y J/K); abierta directo, no los muestra.
 * Nombres inventados, con un token propio por corrida.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

async function teammate(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const email = `c3-live-${uid()}@crm-c3-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  await ctx.request.get('/api/notes');
  const db = e2eDb();
  try {
    const team = (await db.execute("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1")).rows[0]?.id;
    expect(team).toBeTruthy();
    await db.execute({ sql: "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT ?, id, 'admin' FROM users WHERE email = ?", args: [String(team), email] });
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE email = ?", args: [String(team), email] });
  } finally {
    db.close();
  }
  return ctx;
}

/** La próxima consulta en vivo que trae un cambio. */
function liveChange(page: Page) {
  return page.waitForResponse(
    async (r) => r.url().includes('/api/crm/live') && r.ok() && ((await r.json().catch(() => null)) as { changed?: boolean } | null)?.changed === true,
    { timeout: 60_000 },
  );
}

test.describe('CRM en vivo', () => {
  test('la tabla de contactos: alta, edición y borrado de otra persona, sin pisar una celda en edición', async ({ browser, page, request, baseURL }) => {
    test.setTimeout(180_000);
    const tok = `lv${uid()}`;
    const a = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: `Ana ${tok}`, email: `ana.${tok}@c3.test` } }));
    await page.goto(`/en/app/crm/contacts?q=${tok}`);
    const names = page.getByTestId('record-name');
    await expect(names).toHaveCount(1);
    // La tabla ya está hidratada (guarda su vista en la pestaña al montarse).
    await page.waitForFunction(() => sessionStorage.getItem('zs-crm-view:contacts') !== null);

    const other = await teammate(browser, baseURL!);
    try {
      // Alta de la otra persona: aparece la fila nueva.
      const b = await ok<{ id: string }>(other.request.post('/api/crm/contacts', { data: { firstName: `Beto ${tok}`, email: `beto.${tok}@c3.test` } }));
      await expect(names).toHaveCount(2, { timeout: 60_000 });

      // Selección: una casilla tildada sigue tildada después de un cambio ajeno.
      const rowA = page.locator('tr', { has: page.locator(`a[href$="/app/crm/contacts/${a.id}"]`) }).first();
      const box = rowA.getByRole('checkbox');
      await box.check();

      // Una celda en edición no se pisa: la recarga espera a que la persona termine.
      await rowA.locator('td.card-contact-phone button.cell-inline').click();
      const phone = page.getByRole('textbox', { name: 'phone' });
      await phone.fill('12');
      const seen = liveChange(page);
      await ok(other.request.patch(`/api/crm/contacts/${b.id}`, { data: { firstName: `Bruno ${tok}` } }));
      await seen;
      // Una vuelta más del sondeo: una recarga que no esperara ya se habría pintado.
      await page.waitForResponse((r) => r.url().includes('/api/crm/live'), { timeout: 60_000 });
      await expect(phone).toBeFocused();
      await expect(phone).toHaveValue('12');
      await expect(names.filter({ hasText: `Bruno ${tok}` })).toHaveCount(0);
      await phone.press('Escape');
      await expect(names.filter({ hasText: `Bruno ${tok}` })).toHaveCount(1, { timeout: 60_000 });
      await expect(box).toBeChecked();

      // Borrado de la otra persona: la fila se va.
      expect((await other.request.delete(`/api/crm/contacts/${b.id}`)).ok()).toBeTruthy();
      await expect(names).toHaveCount(1, { timeout: 60_000 });
    } finally {
      await other.close();
    }
  });

  test('la ficha: un cambio ajeno aparece y un borrado ajeno avisa', async ({ browser, page, request, baseURL }) => {
    test.setTimeout(180_000);
    const tok = `lf${uid()}`;
    const c = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: `Carla ${tok}`, email: `carla.${tok}@c3.test` } }));
    await page.goto(`/en/app/crm/contacts/${c.id}`);
    await expect(page.locator('.rec-name')).toContainText(tok);

    const other = await teammate(browser, baseURL!);
    try {
      await ok(other.request.patch(`/api/crm/contacts/${c.id}`, { data: { jobTitle: `Role ${tok}` } }));
      await expect(page.locator('.rec-keyline')).toContainText(`Role ${tok}`, { timeout: 60_000 });

      expect((await other.request.delete(`/api/crm/contacts/${c.id}`)).ok()).toBeTruthy();
      const gone = page.getByTestId('crm-live-gone');
      await expect(gone).toBeVisible({ timeout: 60_000 });
      await expect(gone.getByRole('link')).toHaveAttribute('href', /\/app\/crm\/contacts$/);
    } finally {
      await other.close();
    }
  });

  test('el tablero de negocios: un cambio de etapa de otra persona mueve la card', async ({ browser, page, request, baseURL }) => {
    test.setTimeout(180_000);
    const tok = `lb${uid()}`;
    const pipeline = await ok<{ id: string }>(request.post('/api/crm/pipelines', { data: { name: `Live ${tok}` } }));
    const s1 = await ok<{ id: string }>(request.post(`/api/crm/pipelines/${pipeline.id}/stages`, { data: { name: 'Open' } }));
    const s2 = await ok<{ id: string }>(request.post(`/api/crm/pipelines/${pipeline.id}/stages`, { data: { name: 'Next' } }));
    const deal = await ok<{ id: string }>(request.post('/api/crm/deals', { data: { name: `Deal ${tok}`, pipelineId: pipeline.id, stageId: s1.id, amount: 10 } }));

    await page.goto(`/en/app/crm/deals?pipeline=${pipeline.id}`);
    const card = (stage: string) => page.locator(`[data-stage-col="${stage}"] .kb-card[data-deal-id="${deal.id}"]`);
    await expect(card(s1.id)).toBeVisible();

    const other = await teammate(browser, baseURL!);
    try {
      await ok(other.request.post(`/api/crm/deals/${deal.id}/move`, { data: { stageId: s2.id } }));
      await expect(card(s2.id)).toBeVisible({ timeout: 60_000 });
      await expect(card(s1.id)).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});

test.describe('anterior / siguiente en la ficha', () => {
  test('recorre la vista de la tabla con botones y J/K; abierta directo no aparece', async ({ browser, page, request, baseURL }) => {
    test.setTimeout(180_000);
    const tok = `nv${uid()}`;
    const ids: string[] = [];
    for (const n of ['A', 'B', 'C']) {
      ids.push((await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: `${n} ${tok}`, email: `${n.toLowerCase()}.${tok}@c3.test` } }))).id);
    }
    // Orden por nombre: A, B, C.
    await page.goto(`/en/app/crm/contacts?q=${tok}&sort=name`);
    await expect(page.getByTestId('record-name')).toHaveCount(3);
    // La tabla ya guardó su vista en la pestaña (lo hace al hidratar).
    await page.waitForFunction(() => sessionStorage.getItem('zs-crm-view:contacts') !== null);
    await page.locator(`a[data-testid="record-open"][href$="/app/crm/contacts/${ids[1]}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${ids[1]}`), { timeout: 60_000 });

    const nav = page.getByTestId('record-nav');
    const pos = page.getByTestId('record-nav-position');
    await expect(nav).toBeVisible();
    await expect(pos).toHaveAttribute('data-index', '2');
    await expect(pos).toHaveAttribute('data-total', '3');

    await page.getByTestId('record-nav-next').click();
    await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${ids[2]}`), { timeout: 60_000 });
    await expect(pos).toHaveAttribute('data-index', '3');
    await expect(page.getByTestId('record-nav-next')).toBeDisabled();

    // Teclado: K = anterior, dos veces hasta el primero.
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('k');
    await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${ids[1]}`), { timeout: 60_000 });
    await expect(pos).toHaveAttribute('data-index', '2');
    await page.keyboard.press('k');
    await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${ids[0]}`), { timeout: 60_000 });
    await expect(page.getByTestId('record-nav-prev')).toBeDisabled();
    await page.keyboard.press('j');
    await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${ids[1]}`), { timeout: 60_000 });

    // Abierta directo, en otra pestaña sin vista: sin anterior/siguiente.
    const fresh = await browser.newContext({ baseURL: baseURL! });
    try {
      await fresh.addCookies(await page.context().cookies());
      const p2 = await fresh.newPage();
      await p2.goto(`/en/app/crm/contacts/${ids[1]}`);
      await expect(p2.locator('.rec-name')).toContainText(tok);
      await expect(p2.getByTestId('record-nav')).toHaveCount(0);
    } finally {
      await fresh.close();
    }
  });
});
