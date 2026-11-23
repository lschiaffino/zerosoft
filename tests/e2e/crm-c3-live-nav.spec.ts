import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM C3: listas y fichas en vivo (un compañero cambia algo y se ve sin
 * recargar, pero nunca algo que la persona no ve) y anterior / siguiente en
 * la vista previa y la ficha, con los filtros y el orden de la lista. Cada
 * test corre en un workspace propio (la base es compartida). Datos inventados.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()) as T;
}

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function personContext(browser: Browser, email: string) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  return ctx;
}

/** Owner y un member que solo ve lo suyo. */
async function teamWorkspace(browser: Browser) {
  const ownerEmail = `c3-owner-${uid()}@crm-c3-e2e.test`;
  const memberEmail = `c3-member-${uid()}@crm-c3-e2e.test`;
  const owner = await personContext(browser, ownerEmail);
  await ok(owner.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', name: 'C3', locale: 'en', apps: ['crm'] } }));
  await owner.request.post('/api/tours', { data: { kind: 'off', off: true } });
  await ok(owner.request.post('/api/teams/invites', { data: { emails: [memberEmail], role: 'member' } }));
  const token = String((await sql("SELECT token FROM team_invites WHERE email = ? AND status = 'pending'", [memberEmail]))[0]?.token);
  const member = await personContext(browser, memberEmail);
  await ok(member.request.post('/api/teams/accept', { data: { token } }));
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE email = ?", [memberEmail]);
  await member.request.post('/api/tours', { data: { kind: 'off', off: true } });
  await ok(owner.request.put('/api/crm/visibility', { data: { visibility: 'mine' } }));
  const memberId = String((await sql('SELECT id FROM users WHERE email = ?', [memberEmail]))[0]?.id);
  return { owner, member, memberId };
}

test('lista y ficha en vivo, sin mostrar lo que el member no ve', async ({ browser }) => {
  const { owner, member, memberId } = await teamWorkspace(browser);
  const ctxs: BrowserContext[] = [owner, member];
  try {
    const tag = uid();
    const mine = await ok<{ id: string }>(owner.request.post('/api/crm/contacts', { data: { firstName: `Live${tag}`, lastName: 'Mine', ownerId: memberId } }));
    const page = await member.newPage();
    await page.goto(`/en/app/crm/contacts?q=Live${tag}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('record-name').filter({ hasText: `Live${tag} Mine` })).toBeVisible();

    // El owner le cambia el apellido: la tabla del member lo muestra sin recargar.
    await ok(owner.request.patch(`/api/crm/contacts/${mine.id}`, { data: { lastName: 'Renamed' } }));
    await expect(page.getByTestId('record-name').filter({ hasText: `Live${tag} Renamed` })).toBeVisible({ timeout: 20_000 });

    // Uno del owner (fuera del alcance del member) no aparece, aunque pasen varias vueltas del sondeo.
    await ok(owner.request.post('/api/crm/contacts', { data: { firstName: `Live${tag}`, lastName: 'Hidden' } }));
    for (let i = 0; i < 2; i++) await page.waitForResponse((r) => r.url().includes('/api/crm/live') && r.ok());
    await expect(page.getByText(`Live${tag} Hidden`)).toHaveCount(0);

    // Ficha: una nota del owner en este contacto aparece sola en el timeline.
    await page.goto(`/en/app/crm/contacts/${mine.id}?tab=activity`, { waitUntil: 'networkidle' });
    const subject = `Live note ${uid()}`;
    await ok(owner.request.post('/api/crm/activities', { data: { type: 'note', subject, body: 'From a teammate', contactId: mine.id, ownerId: memberId } }));
    await expect(page.getByTestId('crm-timeline-item').filter({ hasText: subject })).toBeVisible({ timeout: 20_000 });
  } finally {
    for (const c of ctxs) await c.close();
  }
});

test('anterior y siguiente en la vista previa y la ficha, con los filtros de la lista', async ({ browser }) => {
  const { owner, member } = await teamWorkspace(browser);
  try {
    const tag = uid();
    const ids: string[] = [];
    for (const last of ['Alpha', 'Bravo', 'Charlie']) {
      ids.push((await ok<{ id: string }>(owner.request.post('/api/crm/contacts', { data: { firstName: `Nav${tag}`, lastName: last } }))).id);
    }
    const page = await owner.newPage();
    const listUrl = `/en/app/crm/contacts?q=Nav${tag}&sort=name`;
    await page.goto(listUrl, { waitUntil: 'networkidle' });

    // Vista previa: j y k recorren las filas en el orden de la tabla.
    await page.getByTestId('record-name').filter({ hasText: `Nav${tag} Alpha` }).click();
    const preview = page.getByTestId('record-preview');
    await expect(preview.getByTestId('preview-nav-pos')).toHaveText('1 of 3');
    await expect(preview.getByTestId('preview-nav-prev')).toBeDisabled();
    await page.keyboard.press('j');
    await expect(preview.getByRole('heading', { name: `Nav${tag} Bravo` })).toBeVisible();
    await preview.getByTestId('preview-nav-next').click();
    await expect(preview.getByRole('heading', { name: `Nav${tag} Charlie` })).toBeVisible();
    await expect(preview.getByTestId('preview-nav-next')).toBeDisabled();
    await page.keyboard.press('k');
    await expect(preview.getByRole('heading', { name: `Nav${tag} Bravo` })).toBeVisible();

    // Ficha: ‹ › y j / k entre los mismos registros; Volver lleva a la lista con sus filtros.
    await preview.getByTestId('preview-open-record').click();
    await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${ids[1]}`));
    await expect(page.getByTestId('record-nav-pos')).toHaveText('2 of 3');
    await page.getByTestId('record-nav-next').click();
    await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${ids[2]}`));
    await expect(page.getByTestId('record-nav-pos')).toHaveText('3 of 3');
    await page.keyboard.press('k');
    await expect(page).toHaveURL(new RegExp(`/app/crm/contacts/${ids[1]}`));
    await expect(page.getByTestId('record-back')).toHaveAttribute('href', new RegExp(`q=Nav${tag}`));
    await page.getByTestId('record-back').click();
    await expect(page).toHaveURL(new RegExp(`q=Nav${tag}`));

    // Al ancho de un teléfono, los botones están y no hay desplazamiento lateral.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/en/app/crm/contacts/${ids[1]}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('record-nav')).toBeVisible();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sw).toBeLessThanOrEqual(0);
  } finally {
    await owner.close();
    await member.close();
  }
});
