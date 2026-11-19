import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Apps destacadas del workspace, de punta a punta: un admin marca dos apps con
 * la estrella en Ajustes › Apps del workspace; el menú de apps las muestra
 * arriba y pliega el resto en "Other apps"; al abrirlo aparecen por categoría
 * y la búsqueda encuentra una de adentro; un member de la cuenta ve lo mismo y
 * no puede cambiarlo; al sacar las marcas vuelve el menú de siempre. A 1280 y
 * a 390 px, sin scroll horizontal.
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

/** Cuenta nueva ya onboardeada. @soon-e2e.io: no abre las "Próximamente", como una cuenta real. */
async function person(browser: Browser, label: string, width = 1280) {
  const baseURL = test.info().project.use.baseURL as string;
  const email = `${label}-${uid()}@soon-e2e.io`.toLowerCase();
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [label, id]);
  return { ctx, p, email, id };
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Marca o desmarca la estrella de una app y espera a que el servidor lo guarde. */
async function star(p: Page, app: string, on: boolean) {
  const saved = p.waitForResponse((r) => r.url().includes('/api/teams/apps/featured') && r.request().method() === 'PUT');
  await p.getByTestId(`ws-app-star-${app}`).click();
  expect((await saved).status()).toBe(200);
  await expect(p.getByTestId(`ws-app-star-${app}`)).toHaveAttribute('aria-pressed', String(on));
}

const panel = (p: Page) => p.locator('.band-switcher-panel');

test('Apps destacadas: el admin marca dos, el menú las pone arriba y pliega el resto; al desmarcarlas vuelve el de siempre', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await person(browser, 'Olga');
  const member = await person(browser, 'Mario');
  const p = owner.p;
  try {
    const team = String((await sql('SELECT id FROM teams WHERE owner_id = ? ORDER BY created_at LIMIT 1', [owner.id]))[0].id);
    await sql("UPDATE teams SET use_mode = 'team' WHERE id = ?", [team]);
    await sql("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '*')", [team, member.id]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [team, member.id]);

    // Sin destacadas: el menú de siempre (categorías a la vista, sin "Other apps").
    await p.goto('/en/app/settings/apps', { waitUntil: 'networkidle' });
    await p.locator('.band-product').click();
    await expect(panel(p).locator('.band-menu-grid')).toBeVisible();
    await expect(panel(p).getByRole('menuitem', { name: 'Track', exact: true })).toBeVisible();
    await expect(p.getByTestId('switcher-featured')).toHaveCount(0);
    await expect(p.getByTestId('switcher-other-toggle')).toHaveCount(0);
    const total = await panel(p).locator('.band-menu-grid [role="menuitem"]').count();
    await p.keyboard.press('Escape');
    await expect(panel(p)).toHaveCount(0);

    // Inbox siempre está: su fila no tiene interruptor, solo la estrella.
    await expect(p.getByTestId('ws-app-switch-inbox')).toHaveCount(0);
    await expect(p.getByTestId('ws-app-star-inbox')).toBeVisible();

    // El admin destaca CRM y Docs.
    await star(p, 'docs', true);
    await star(p, 'crm', true);

    // El menú: las dos arriba (en el orden del menú), el resto plegado con su cantidad.
    await p.locator('.band-product').click();
    const featured = p.getByTestId('switcher-featured');
    await expect(featured.getByRole('menuitem')).toHaveText(['CRM', 'Docs']);
    const other = p.getByTestId('switcher-other-toggle');
    await expect(other).toHaveAttribute('aria-expanded', 'false');
    await expect(other).toContainText(String(total - 2));
    await expect(panel(p).getByRole('menuitem', { name: 'Track', exact: true })).toHaveCount(0);
    await expect(panel(p).locator('.band-menu-grid')).toHaveCount(0);
    // Las otras dos filas plegadas siguen como estaban.
    await expect(p.getByTestId('switcher-soon-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(await overflow(p)).toBeLessThanOrEqual(0);

    // Con el teclado: las flechas recorren el menú y Enter abre "Other apps" en el lugar.
    await other.focus();
    await p.keyboard.press('Enter');
    await expect(other).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(p).locator('.band-menu-other .band-menu-grid')).toBeVisible();
    await expect(panel(p).getByRole('menuitem', { name: 'Track', exact: true })).toBeVisible();
    await expect(panel(p).locator('.band-menu-other .band-menu-grid').getByRole('menuitem', { name: 'CRM', exact: true })).toHaveCount(0);
    await p.keyboard.press('ArrowDown');
    await expect(panel(p).locator('.band-menu-other .band-menu-grid [role="menuitem"]').first()).toBeFocused();

    // Esc cierra el menú; al reabrirlo, "Other apps" vuelve plegado.
    await p.keyboard.press('Escape');
    await expect(panel(p)).toHaveCount(0);
    await p.locator('.band-product').click();
    await expect(p.getByTestId('switcher-other-toggle')).toHaveAttribute('aria-expanded', 'false');
    // Un clic afuera también lo cierra.
    await p.mouse.click(1000, 700);
    await expect(panel(p)).toHaveCount(0);

    // La búsqueda del menú encuentra una app que está dentro de "Other apps".
    await p.locator('.band-product').click();
    await panel(p).locator('.band-menu-search').click();
    await p.keyboard.type('Track');
    await expect(p.getByRole('option', { name: /^Track/ }).first()).toBeVisible();
    await p.keyboard.press('Escape');

    // Una destacada abre su app.
    await p.locator('.band-product').click();
    await p.getByTestId('switcher-featured').getByRole('menuitem', { name: 'Docs', exact: true }).click();
    await expect(p).toHaveURL(/\/en\/app\/docs/);

    // Es por cuenta: el member ve lo mismo en su menú, pero no puede cambiarlo.
    await member.p.goto('/en/app/settings/apps', { waitUntil: 'networkidle' });
    await expect(member.p.getByTestId('ws-app-star-crm')).toHaveAttribute('aria-pressed', 'true');
    await expect(member.p.getByTestId('ws-app-star-crm')).toBeDisabled();
    expect((await member.p.request.put('/api/teams/apps/featured', { data: { app: 'track', featured: true } })).status()).toBe(403);
    await member.p.locator('.band-product').click();
    await expect(member.p.getByTestId('switcher-featured').getByRole('menuitem')).toHaveText(['CRM', 'Docs']);
    await expect(member.p.getByTestId('switcher-other-toggle')).toHaveAttribute('aria-expanded', 'false');
    await member.p.keyboard.press('Escape');

    // A 390 px: mismas dos arriba, "Other apps" se abre en el lugar, sin scroll horizontal.
    await p.setViewportSize({ width: 390, height: 800 });
    await p.goto('/en/app/settings/apps', { waitUntil: 'networkidle' });
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.locator('.band-product').click();
    await expect(p.getByTestId('switcher-featured').getByRole('menuitem')).toHaveText(['CRM', 'Docs']);
    await p.getByTestId('switcher-other-toggle').click();
    await expect(panel(p).getByRole('menuitem', { name: 'Track', exact: true })).toBeVisible();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    await p.keyboard.press('Escape');
    await p.setViewportSize({ width: 1280, height: 900 });

    // Sin marcas, el menú de siempre.
    await star(p, 'crm', false);
    await star(p, 'docs', false);
    await p.locator('.band-product').click();
    await expect(p.getByTestId('switcher-featured')).toHaveCount(0);
    await expect(p.getByTestId('switcher-other-toggle')).toHaveCount(0);
    await expect(panel(p).locator('.band-menu-grid [role="menuitem"]')).toHaveCount(total);
    expect(await sql('SELECT app FROM workspace_featured_apps WHERE owner_id = ?', [owner.id])).toEqual([]);
  } finally {
    await owner.ctx.close();
    await member.ctx.close();
  }
});
