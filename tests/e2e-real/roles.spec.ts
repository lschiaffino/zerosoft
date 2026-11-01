import fs from 'fs';
import { createClient } from '@libsql/client';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * El mismo camino que una persona de verdad: sin DEMO_MODE, cada rol entra con
 * su código por email y su propia sesión de NextAuth. Corre con
 * playwright.real.config.ts (npm run test:e2e:real). Cubre lo que depende de la
 * sesión real: la campana sobre Miembros, responder pedidos, la pestaña que se
 * queda sin workspace, quién da qué apps y quién lee sueldos.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
let ip = 0;

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function lastCode(email: string): string {
  const lines = fs.readFileSync(process.env.E2E_MAIL_FILE!, 'utf8').trim().split('\n').filter(Boolean);
  const mail = lines.map((l) => JSON.parse(l) as { to: string; text: string }).reverse().find((m) => m.to === email);
  return /\b(\d{6})\b/.exec(mail!.text)![1];
}

interface Person {
  ctx: BrowserContext;
  page: Page;
  email: string;
  id: string;
}

/** Cuenta nueva con sesión real. `onboarded`: ya pasó el onboarding. */
async function signIn(browser: Browser, name: string): Promise<Person> {
  const baseURL = test.info().project.use.baseURL as string;
  const email = `${name.toLowerCase()}-${uid()}@real-e2e.io`;
  ip += 1;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 860 }, extraHTTPHeaders: { 'x-forwarded-for': `10.20.${ip % 250}.7` } });
  const sent = await ctx.request.post('/api/auth/email-code', { data: { email, locale: 'en' } });
  expect(sent.ok(), await sent.text()).toBe(true);
  await expect.poll(() => (fs.existsSync(process.env.E2E_MAIL_FILE!) ? fs.readFileSync(process.env.E2E_MAIL_FILE!, 'utf8').includes(email) : false)).toBe(true);
  const { csrfToken } = (await (await ctx.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  await ctx.request.post('/api/auth/callback/email-code', { form: { csrfToken, email, code: lastCode(email), json: 'true', callbackUrl: `${baseURL}/en/app` } });
  const session = (await (await ctx.request.get('/api/auth/session')).json()) as { user?: { email?: string } };
  expect(session.user?.email).toBe(email);
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  return { ctx, page: await ctx.newPage(), email, id };
}

/** Owner con un workspace de equipo. */
async function owner(browser: Browser): Promise<Person & { teamId: string }> {
  const p = await signIn(browser, 'owner');
  const res = await p.ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', teamName: `Acme ${uid()}`, size: '2-10', name: 'Olga Owner' } });
  expect(res.ok(), await res.text()).toBe(true);
  const teamId = String((await sql('SELECT id FROM teams WHERE owner_id = ?', [p.id]))[0].id);
  return { ...p, teamId };
}

/** Invita desde el owner y la persona acepta con su sesión. */
async function join(browser: Browser, by: Person, name: string, role: 'admin' | 'member' | 'guest', apps: '*' | string[]): Promise<Person> {
  const p = await signIn(browser, name);
  const res = await by.ctx.request.post('/api/teams/invites', { data: { emails: p.email, role, apps } });
  expect(res.status(), await res.text()).toBe(201);
  const { results } = (await res.json()) as { results: Array<{ url: string }> };
  const token = results[0].url.split('/invite/')[1].split('?')[0];
  expect((await p.ctx.request.post('/api/teams/accept', { data: { token } })).ok()).toBe(true);
  expect((await p.ctx.request.post('/api/onboarding', { data: { kind: 'invited', name } })).ok()).toBe(true);
  return p;
}

const closeAll = (...people: Person[]) => Promise.all(people.map((p) => p.ctx.close()));

test('la campana abre el pedido aunque ya esté en Miembros; Esc y recargar no lo reabren', async ({ browser }) => {
  const olga = await owner(browser);
  const mel = await join(browser, olga, 'Mel', 'member', ['crm', 'docs']);
  try {
    const page = olga.page;
    await page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await mel.page.goto('/en/app/track', { waitUntil: 'networkidle' });
    await mel.page.waitForURL(/blocked=track/);
    await mel.page.getByRole('button', { name: 'Ask for access' }).click();
    await expect(mel.page.getByTestId('access-requested')).toContainText('Request sent');
    // "Enviado" sobrevive a recargar.
    await mel.page.reload({ waitUntil: 'networkidle' });
    await expect(mel.page.getByTestId('access-requested')).toContainText('Request sent');

    await page.locator('.side-bell').click();
    await page.locator('.side-bell-item').filter({ hasText: 'Track' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('request-line')).toContainText('Track');
    // Lo pedido ya viene tildado.
    await expect(dialog.getByRole('checkbox', { name: /Track/ })).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/settings\/members$/);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Quitar sigue a la vista a 1280: la tabla no scrollea por dentro.
    const wrap = page.locator('.ws-members').first();
    expect(await wrap.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    // "Edit access" también cierra con Esc desde que abre.
    await page.locator('tr', { has: page.locator(`[data-email="${mel.email}"]`) }).getByRole('button', { name: 'Edit access' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await closeAll(olga, mel);
  }
});

test('rechazar: la persona se entera y vuelve a pedir; aprobar cierra el aviso de otro admin; sacar la app deja pedir de nuevo', async ({ browser }) => {
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', '*');
  const mel = await join(browser, olga, 'Mel', 'member', ['docs']);
  try {
    const unread = async (p: Person) => ((await (await p.ctx.request.get('/api/notifications?type=workspace_access&unreadOnly=1&limit=20')).json()) as { rows: Array<{ title: string; href: string }> }).rows;
    expect((await mel.ctx.request.post('/api/teams/access-request', { data: { app: 'crm' } })).ok()).toBe(true);
    const href = (await unread(olga)).find((r) => r.href.includes(mel.id))!.href;
    expect((await unread(ada)).some((r) => r.href.includes(mel.id))).toBe(true);

    await olga.page.goto(`/en${href}`, { waitUntil: 'networkidle' });
    await olga.page.getByTestId('deny-request').click();
    await expect(olga.page.getByRole('dialog')).toHaveCount(0);
    await expect(olga.page).toHaveURL(/\/app\/settings\/members$/);
    expect((await unread(ada)).some((r) => r.href.includes(mel.id))).toBe(false);
    expect((await unread(mel)).some((r) => /CRM/.test(r.title))).toBe(true);

    // Vuelve a pedir, Ada aprueba y a Olga se le cierra el aviso.
    const again = await mel.ctx.request.post('/api/teams/access-request', { data: { app: 'crm' } });
    expect(await again.json()).toEqual({ ok: true });
    await ada.page.goto(`/en${href}`, { waitUntil: 'networkidle' });
    await ada.page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(ada.page.getByRole('dialog')).toHaveCount(0);
    expect((await unread(olga)).some((r) => r.href.includes(mel.id))).toBe(false);
    await mel.page.goto('/en/app/crm', { waitUntil: 'networkidle' });
    await expect(mel.page).toHaveURL(/\/en\/app\/crm/);

    // Se la sacan: pedirla de nuevo es un pedido nuevo, nada de "ya lo pediste".
    expect((await olga.ctx.request.patch(`/api/teams/members/${mel.id}`, { data: { apps: ['docs'] } })).ok()).toBe(true);
    expect(await (await mel.ctx.request.post('/api/teams/access-request', { data: { app: 'crm' } })).json()).toEqual({ ok: true });

    // Pedido de un admin: a Ada no le llega el aviso de otro admin, y su link lo explica.
    const lia = await join(browser, olga, 'Lia', 'admin', ['docs']);
    expect((await lia.ctx.request.post('/api/teams/access-request', { data: { app: 'crm' } })).ok()).toBe(true);
    expect((await unread(ada)).some((r) => r.href.includes(lia.id))).toBe(false);
    expect((await unread(olga)).some((r) => r.href.includes(lia.id))).toBe(true);
    await ada.page.goto(`/en/app/settings/members?person=${lia.id}&ws=${olga.teamId}`, { waitUntil: 'networkidle' });
    await expect(ada.page.getByTestId('request-other-workspace')).toContainText("Only the owner can change an admin's access");
    await expect(ada.page.getByRole('dialog')).toHaveCount(0);
    // Persona que ya no está: lo dice.
    expect((await olga.ctx.request.delete(`/api/teams/members/${mel.id}`)).ok()).toBe(true);
    await olga.page.goto(`/en${href}`, { waitUntil: 'networkidle' });
    await expect(olga.page.getByTestId('request-other-workspace')).toContainText('no longer in');
    await lia.ctx.close();
  } finally {
    await closeAll(olga, ada, mel);
  }
});

test('la pestaña que perdió el workspace no escribe en otro lado y lo dice; la persona se entera una vez', async ({ browser }) => {
  const olga = await owner(browser);
  const mel = await join(browser, olga, 'Mel', 'member', '*');
  try {
    await mel.page.goto('/en/app/settings/profile', { waitUntil: 'networkidle' }).catch(() => undefined);
    await mel.page.goto('/en/app/docs', { waitUntil: 'networkidle' });
    expect((await olga.ctx.request.delete(`/api/teams/members/${mel.id}`)).ok()).toBe(true);
    const before = Number((await sql('SELECT COUNT(*) AS c FROM docs_pages WHERE user_id = ?', [mel.id]))[0].c);
    const status = await mel.page.evaluate(async () => (await fetch('/api/docs/pages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Se perdería' }) })).status);
    expect(status).toBe(401);
    expect(Number((await sql('SELECT COUNT(*) AS c FROM docs_pages WHERE user_id = ?', [mel.id]))[0].c)).toBe(before);
    await expect(mel.page.getByTestId('workspace-guard')).toBeVisible();
    await mel.page.getByTestId('workspace-guard').getByRole('button').click();
    await mel.page.waitForLoadState('networkidle');
    // Recargada, escribe en su workspace como siempre.
    const ok = await mel.page.evaluate(async () => (await fetch('/api/docs/pages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Mía' }) })).status);
    expect(ok).toBe(201);
    await mel.page.goto('/en/app', { waitUntil: 'networkidle' });
    await expect(mel.page.getByTestId('home-lost-access')).toContainText('removed you');
    await expect(async () => {
      await mel.page.reload({ waitUntil: 'networkidle' });
      await expect(mel.page.getByTestId('home-lost-access')).toHaveCount(0, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
  } finally {
    await closeAll(olga, mel);
  }
});

test('pasar a guest lo saca y avisa; volver a member lo trae de vuelta', async ({ browser }) => {
  const olga = await owner(browser);
  const mara = await join(browser, olga, 'Mara', 'member', '*');
  try {
    const active = async () => ((await (await mara.ctx.request.get('/api/teams/workspace')).json()) as { id: string }).id;
    expect(await active()).toBe(olga.teamId);
    expect((await olga.ctx.request.patch(`/api/teams/members/${mara.id}`, { data: { role: 'guest' } })).ok()).toBe(true);
    await mara.page.goto('/en/app', { waitUntil: 'networkidle' });
    await expect(mara.page.getByTestId('home-lost-access')).toContainText('guest');
    expect(await active()).not.toBe(olga.teamId);
    expect((await olga.ctx.request.patch(`/api/teams/members/${mara.id}`, { data: { role: 'member' } })).ok()).toBe(true);
    expect(await active()).toBe(olga.teamId);
  } finally {
    await closeAll(olga, mara);
  }
});

test('un admin limitado no da apps que no tiene y su pantalla no las ofrece', async ({ browser }) => {
  const olga = await owner(browser);
  const lia = await join(browser, olga, 'Lia', 'admin', ['docs', 'crm']);
  const mel = await join(browser, olga, 'Mel', 'member', ['docs']);
  try {
    const invite = (apps: unknown) => lia.ctx.request.post('/api/teams/invites', { data: { emails: `x-${uid()}@real-e2e.io`, apps } });
    expect((await invite('*')).status()).toBe(403);
    expect((await invite(['track'])).status()).toBe(403);
    expect((await invite(['crm'])).status()).toBe(201);
    expect((await lia.ctx.request.patch(`/api/teams/members/${mel.id}`, { data: { apps: ['docs', 'track'] } })).status()).toBe(403);
    expect((await lia.ctx.request.patch(`/api/teams/members/${mel.id}`, { data: { apps: ['docs', 'crm'] } })).status()).toBe(200);
    await lia.page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await expect(lia.page.getByRole('checkbox', { name: 'All apps' })).toHaveCount(0);
    await expect(lia.page.getByRole('checkbox', { name: 'Track' })).toHaveCount(0);
    await expect(lia.page.getByRole('checkbox', { name: 'CRM' }).first()).toBeChecked();
  } finally {
    await closeAll(olga, lia, mel);
  }
});

test('sueldos: un admin no los lee ni se nombra HR; el owner lo nombra y entonces sí', async ({ browser }) => {
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', '*');
  try {
    expect((await ada.ctx.request.get('/api/people/export')).status()).toBe(403);
    expect((await ada.ctx.request.patch('/api/people/settings', { data: { hrAdmins: [ada.id] } })).status()).toBe(403);
    expect((await olga.ctx.request.get('/api/people/export')).status()).toBe(200);
    expect((await olga.ctx.request.patch('/api/people/settings', { data: { hrAdmins: [ada.id] } })).ok()).toBe(true);
    expect((await ada.ctx.request.get('/api/people/export')).status()).toBe(200);
  } finally {
    await closeAll(olga, ada);
  }
});

test('guest: lo compartido va primero y nombra el workspace; Docs con cuenta sin nada compartido lo dice', async ({ browser }) => {
  const olga = await owner(browser);
  const gus = await join(browser, olga, 'Gus', 'guest', '*');
  try {
    await gus.page.goto('/en/app/docs', { waitUntil: 'networkidle' });
    await expect(gus.page.getByTestId('docs-guest-note')).toContainText('guest of Acme');
    const title = `Compartida ${uid()}`;
    const shared = (await (await olga.ctx.request.post('/api/docs/pages', { data: { title } })).json()) as { id: string };
    expect((await olga.ctx.request.post(`/api/docs/pages/${shared.id}/share`, { data: { kind: 'user', email: gus.email, role: 'view' } })).status()).toBe(201);
    await gus.page.reload({ waitUntil: 'networkidle' });
    await expect(gus.page.getByTestId('docs-shared-first')).toContainText(title);
    await expect(gus.page.getByRole('heading', { name: 'No pages yet' })).toHaveCount(0);
  } finally {
    await closeAll(olga, gus);
  }
});

test('invitación revocada con la página abierta: al volver a la pestaña ya no ofrece sumarse', async ({ browser }) => {
  const olga = await owner(browser);
  const late = await signIn(browser, 'Late');
  try {
    const res = await olga.ctx.request.post('/api/teams/invites', { data: { emails: late.email } });
    const { results } = (await res.json()) as { results: Array<{ url: string; inviteId: string }> };
    const path = new URL(results[0].url).pathname;
    await late.page.goto(path, { waitUntil: 'networkidle' });
    await expect(late.page.getByRole('button', { name: /^Join/ })).toBeVisible();
    expect((await olga.ctx.request.delete(`/api/teams/invites/${results[0].inviteId}`)).ok()).toBe(true);
    await late.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(late.page.getByRole('heading', { name: 'This invitation no longer works' })).toBeVisible();
    await expect(late.page.getByRole('button', { name: /^Join/ })).toHaveCount(0);
  } finally {
    await closeAll(olga, late);
  }
});
