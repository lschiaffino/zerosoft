import { e2eDb } from './helpers/db';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Inbox en Ajustes › Workspace › Apps, como cualquier app: su fila tiene el
 * interruptor, el acceso y las excepciones (además de la estrella). Apagada,
 * sale del switcher, /app/inbox muestra el aviso de app apagada y su API
 * responde 403; prendida de nuevo, vuelve. A 1280 y a 390 px.
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

async function person(browser: Browser, label: string, width: number) {
  const baseURL = test.info().project.use.baseURL as string;
  const email = `${label}-${uid()}@soon-e2e.io`.toLowerCase();
  const ctx = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }, { name: 'zs_theme', value: 'light', url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now'), name = ? WHERE id = ?", [label, id]);
  return { ctx, p, id };
}

const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Guarda la regla (PUT /api/teams/apps) y espera la respuesta. */
async function saved(p: Page, action: () => Promise<void>) {
  const res = p.waitForResponse((r) => r.url().endsWith('/api/teams/apps') && r.request().method() === 'PUT');
  await action();
  expect((await res).status()).toBe(200);
}

async function switcherHasInbox(p: Page): Promise<boolean> {
  await p.goto('/en/app/settings/apps', { waitUntil: 'networkidle' });
  await p.locator('.band-product').click();
  const panel = p.locator('.band-switcher-panel');
  await expect(panel).toBeVisible();
  const n = await panel.getByRole('menuitem', { name: 'Inbox', exact: true }).count();
  await p.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  return n > 0;
}

for (const width of [1280, 390]) {
  test(`Inbox se apaga y se prende como las demás apps (${width}px)`, async ({ browser }) => {
    test.setTimeout(150_000);
    const owner = await person(browser, 'Olga', width);
    const p = owner.p;
    try {
      await p.goto('/en/app/settings/apps', { waitUntil: 'networkidle' });
      const row = p.getByTestId('ws-app-inbox');
      await expect(row).toBeVisible();
      await expect(p.getByTestId('ws-app-switch-inbox')).toBeChecked();
      await expect(p.getByTestId('ws-app-mode-inbox')).toHaveValue('all');
      await expect(p.getByTestId('ws-app-edit-inbox')).toBeVisible();
      await expect(p.getByTestId('ws-app-star-inbox')).toBeVisible();
      expect(await overflow(p)).toBeLessThanOrEqual(0);
      if (width === 1280) await row.screenshot({ path: test.info().outputPath('inbox-row-light.png') });

      // Abierta: en el switcher y su API responde.
      expect(await switcherHasInbox(p)).toBe(true);
      expect((await p.request.get('/api/inbox/folders')).status()).toBe(200);

      // Apagada: sale del switcher, la página muestra el aviso y la API corta (ni el owner entra).
      await saved(p, () => p.getByTestId('ws-app-switch-inbox').uncheck());
      await expect(row).toHaveAttribute('data-mode', 'off');
      expect(await switcherHasInbox(p)).toBe(false);
      await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await p.waitForURL(/\/en\/app\?blocked=inbox/);
      await expect(p.getByTestId('home-blocked')).toBeVisible();
      expect(await overflow(p)).toBeLessThanOrEqual(0);
      const off = await p.request.get('/api/inbox/folders');
      expect(off.status()).toBe(403);
      expect(await off.json()).toEqual({ error: 'app_disabled', app: 'inbox' });

      // Prendida de nuevo: vuelve todo.
      await p.goto('/en/app/settings/apps', { waitUntil: 'networkidle' });
      await saved(p, () => p.getByTestId('ws-app-switch-inbox').check());
      await expect(row).toHaveAttribute('data-mode', 'all');
      expect(await switcherHasInbox(p)).toBe(true);
      await p.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await expect(p).toHaveURL(/\/en\/app\/inbox/);
      expect((await p.request.get('/api/inbox/folders')).status()).toBe(200);
    } finally {
      await owner.ctx.close();
    }
  });
}
