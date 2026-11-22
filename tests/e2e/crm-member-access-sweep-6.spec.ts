import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * CRM, sexta pasada, en pantalla: un miembro (visibilidad "mine") consulta el
 * catálogo de productos y los tags sin poder editarlos ni borrarlos, y en la
 * papelera ve "Registro privado" en lugar de la empresa (que no ve) en la que
 * se fusionó algo suyo. El dueño ve en la secuencia el motivo de una
 * inscripción pausada porque quien enviaba salió. En los cinco aspectos a 390
 * (claro y oscuro alternados) y en el aspecto por defecto a 1280, sin scroll
 * lateral. Datos inventados.
 */

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()}`).toBe(true);
  return (await r.json()) as T;
}

/** Una persona nueva sumada al equipo del usuario demo como miembro (cookie de e2e). */
async function teammate(browser: Browser, baseURL: string, opts: { viewport?: { width: number; height: number }; phone?: boolean } = {}): Promise<{ ctx: BrowserContext; id: string; email: string }> {
  const email = `sweep6-${uid()}@crm-sweep6-e2e.io`;
  const ctx = await browser.newContext({ baseURL, ...(opts.viewport ? { viewport: opts.viewport } : {}), ...(opts.phone ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  await ctx.request.get('/api/notes');
  const db = e2eDb();
  try {
    const team = (await db.execute("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1")).rows[0]?.id;
    expect(team).toBeTruthy();
    await db.execute({ sql: "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT ?, id, 'member' FROM users WHERE email = ?", args: [String(team), email] });
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE email = ?", args: [String(team), email] });
    const id = String((await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] })).rows[0]?.id ?? '');
    expect(id).toBeTruthy();
    return { ctx, id, email };
  } finally {
    db.close();
  }
}

async function seed(request: APIRequestContext, memberId: string) {
  const tag = uid();
  const holdings = `Holdings ${tag}`;
  const keep = await ok<{ id: string }>(request.post('/api/crm/companies', { data: { name: holdings } }));
  const drop = await ok<{ id: string }>(request.post('/api/crm/companies', { data: { name: `Member dup ${tag}`, ownerId: memberId } }));
  await ok(request.post('/api/crm/companies/merge', { data: { keepId: keep.id, dropId: drop.id } }));
  await ok(request.post('/api/crm/products', { data: { name: `Seat license ${tag}`, price: 120 } }));
  await ok(request.post('/api/crm/tags', { data: { name: `Priority ${tag}` } }));
  return { tag, holdings };
}

test('CRM: un miembro consulta productos y tags sin editarlos, y la papelera no nombra una empresa que no ve', async ({ browser, page, request, baseURL }) => {
  test.setTimeout(600_000);
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const before = await ok<{ visibility: string }>(request.get('/api/crm/visibility'));
  await ok(request.put('/api/crm/visibility', { data: { visibility: 'mine' } }));
  const { ctx, id: memberId } = await teammate(browser, baseURL!);
  const errors: string[] = [];
  try {
    const s = await seed(request, memberId);

    // API: el catálogo y renombrar/borrar tags son de owner y admins; crear un tag sigue abierto.
    expect((await ctx.request.post('/api/crm/products', { data: { name: 'Nope', price: 1 } })).status()).toBe(403);
    const tags = await ok<{ rows: Array<{ id: string; name: string }> }>(ctx.request.get('/api/crm/tags'));
    const shared = tags.rows.find((t) => t.name === `Priority ${s.tag}`)!;
    expect((await ctx.request.patch(`/api/crm/tags/${shared.id}`, { data: { name: 'Renamed' } })).status()).toBe(403);
    expect((await ctx.request.delete(`/api/crm/tags/${shared.id}`)).status()).toBe(403);
    expect((await ctx.request.post('/api/crm/tags', { data: { name: `Mine ${s.tag}` } })).status()).toBe(201);

    // Papelera por la API: la empresa en la que se fusionó sale privada.
    const trash = await ok<{ rows: Array<{ label: string; merged_into: string | null; merged_into_private?: boolean }> }>(ctx.request.get('/api/crm/trash'));
    const entry = trash.rows.find((r) => r.label === `Member dup ${s.tag}`)!;
    expect(entry).toMatchObject({ merged_into: null, merged_into_private: true });
    expect(JSON.stringify(trash)).not.toContain(s.holdings);

    // Pantallas del miembro, en los cinco aspectos (390) y en el de siempre (1280).
    const combos: Array<{ look: (typeof LOOKS)[number]; theme: 'light' | 'dark'; phone: boolean }> = [
      { look: 'current', theme: 'light', phone: false },
      { look: 'current', theme: 'dark', phone: false },
      ...LOOKS.map((look, i) => ({ look, theme: i % 2 ? ('dark' as const) : ('light' as const), phone: true })),
    ];
    for (const { look, theme, phone } of combos) {
      await ok(ctx.request.put('/api/profile/look', { data: { look } }));
      const view = await browser.newContext({ baseURL, viewport: phone ? PHONE : { width: 1280, height: 860 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
      await view.addCookies(await ctx.cookies());
      await setTheme(view, baseURL!, theme);
      const p = await view.newPage();
      p.on('pageerror', (e) => errors.push(`${p.url()} pageerror ${e.message}`));
      p.on('response', (r) => {
        if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
      });
      const label = `${look} ${theme} ${phone ? 390 : 1280}`;

      await p.goto(`/en/app/crm/products?q=${encodeURIComponent(s.tag)}`, { waitUntil: 'domcontentloaded' });
      await settle(p);
      await expect(p.locator('html')).toHaveAttribute('data-look', look);
      await expect(p.getByText(`Seat license ${s.tag}`)).toBeVisible();
      await expect(p.locator('.prod-actions')).toHaveCount(0);
      await expect(p.locator('button.prod-name')).toHaveCount(0);
      await check(p, `sweep6 products ${label}`, { tap: phone });

      await p.goto('/en/app/crm/settings?tab=data', { waitUntil: 'domcontentloaded' });
      await settle(p);
      const row = p.locator('.tags-row', { hasText: `Priority ${s.tag}` });
      await expect(row).toHaveClass(/tags-row-static/);
      await expect(row.locator('input, button')).toHaveCount(0);
      await check(p, `sweep6 tags ${label}`, { tap: phone });

      await p.goto(`/en/app/crm/trash?q=${encodeURIComponent(s.tag)}`, { waitUntil: 'domcontentloaded' });
      await settle(p);
      const merged = p.locator('tr', { hasText: `Member dup ${s.tag}` });
      await expect(merged.getByTestId('crm-private-record')).toBeVisible();
      expect(await p.content()).not.toContain(s.holdings);
      await check(p, `sweep6 trash ${label}`, { tap: phone });
      await view.close();
    }
  } finally {
    await ctx.request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
    await ctx.close();
    await request.put('/api/crm/visibility', { data: { visibility: before.visibility } });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CRM: la secuencia muestra el motivo cuando quien envía salió del workspace', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const tag = uid();
  const { sequence: seq } = await ok<{ sequence: { id: string } }>(request.post('/api/crm/sequences', { data: { name: `Follow-up ${tag}`, steps: [{ type: 'task', subject: 'Call back' }] } }));
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Rio', email: `rio-${tag}@example.com` } }));
  // Una inscripción ya pausada por el tick (el cron no corre en e2e): remitente que no es del workspace.
  const db = e2eDb();
  try {
    await db.execute({
      sql: `INSERT INTO crm_sequence_enrollments (id, user_id, sequence_id, contact_id, sender_id, enrolled_by, status, exit_reason, current_step, created_at, updated_at)
            VALUES (?, 'demo', ?, ?, 'gone-sender', 'demo', 'paused', 'sender_left', 0, datetime('now'), datetime('now'))`,
      args: [`e2e-enr-${tag}`, seq.id, contact.id],
    });
  } finally {
    db.close();
  }
  for (const viewport of [{ width: 1280, height: 860 }, PHONE]) {
    await page.setViewportSize(viewport);
    await page.goto(`/en/app/crm/sequences/${seq.id}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await expect(page.getByText('Sender left the workspace').first()).toBeVisible();
    await check(page, `sweep6 sequence ${viewport.width}`, { tap: viewport.width < 500 });
  }
});
