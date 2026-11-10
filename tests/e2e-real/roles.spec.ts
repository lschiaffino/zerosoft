import fs from 'fs';
import { createClient } from '@libsql/client';
import { PDFDocument } from 'pdf-lib';
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
  // En su propia línea: el email del texto también puede tener seis dígitos seguidos (owner-300846@...).
  return /^(\d{6})$/m.exec(mail!.text)![1];
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

/**
 * Owner con un workspace de equipo. El onboarding "para mi equipo" crea uno con
 * titular propio (lib/workspace-principal.ts): `teamId` es su ficha y `wsId` el
 * id del que cuelgan sus datos (no es el de la persona).
 */
async function owner(browser: Browser): Promise<Person & { teamId: string; wsId: string }> {
  const p = await signIn(browser, 'owner');
  const res = await p.ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'team', teamName: `Acme ${uid()}`, size: '2-10', name: 'Olga Owner' } });
  expect(res.ok(), await res.text()).toBe(true);
  const team = (await sql("SELECT t.id, t.owner_id FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? AND m.role = 'owner' AND t.owner_id != ?", [p.id, p.id]))[0];
  return { ...p, teamId: String(team.id), wsId: String(team.owner_id) };
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

/** Cerrar un contexto con el service worker del CRM a veces se traba en Chromium: no es parte de lo que se prueba. */
const closeAll = async (...people: Person[]) => {
  for (const p of people) await Promise.race([p.ctx.close().catch(() => undefined), new Promise((done) => setTimeout(done, 5000))]);
};

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
    // Lo pedido se da con un botón (las apps se prenden al instante: nada queda tildado sin guardar).
    await expect(dialog.getByTestId('approve-request')).toContainText('Track');
    await expect(dialog.getByRole('checkbox', { name: /^Track/ })).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/settings\/members$/, { timeout: 15_000 });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Quitar sigue a la vista a 1280: la tabla no scrollea por dentro.
    const wrap = page.locator('.ws-members').first();
    expect(await wrap.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    // "Qué puede ver" también cierra con Esc desde que abre.
    await page.locator('tr', { has: page.locator(`[data-email="${mel.email}"]`) }).getByRole('button', { name: /^See what/ }).click();
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
    await expect(olga.page).toHaveURL(/\/app\/settings\/members$/, { timeout: 15_000 });
    expect((await unread(ada)).some((r) => r.href.includes(mel.id))).toBe(false);
    expect((await unread(mel)).some((r) => /CRM/.test(r.title))).toBe(true);

    // Vuelve a pedir, Ada aprueba y a Olga se le cierra el aviso.
    const again = await mel.ctx.request.post('/api/teams/access-request', { data: { app: 'crm' } });
    expect(await again.json()).toEqual({ ok: true });
    await ada.page.goto(`/en${href}`, { waitUntil: 'networkidle' });
    await ada.page.getByRole('dialog').getByTestId('approve-request').click();
    await expect(ada.page.getByRole('dialog').getByRole('checkbox', { name: /^CRM/ })).toBeChecked();
    await ada.page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
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
    await expect(mel.page.getByTestId('workspace-guard')).toContainText('no longer have access');
    await mel.page.getByTestId('workspace-guard').getByRole('link', { name: 'Go to Home' }).click();
    await mel.page.waitForURL(/\/en\/app$/);
    // Recargada, escribe en su workspace como siempre.
    const ok = await mel.page.evaluate(async () => (await fetch('/api/docs/pages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Mía' }) })).status);
    expect(ok).toBe(201);
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

test('permisos de sueldos: un admin sin marca no cambia el email ni el período de una ficha con sueldo', async ({ browser }) => {
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', '*');
  try {
    await olga.ctx.request.get('/api/people/me');
    const { employee } = (await (await olga.ctx.request.post('/api/people/employees', { data: { name: 'Sin cuenta' } })).json()) as { employee: { id: string } };
    expect((await olga.ctx.request.post(`/api/people/employees/${employee.id}/compensation`, { data: { amount: 5000, currency: 'USD', period: 'month', effectiveDate: '2026-01-01' } })).ok()).toBe(true);
    const adaPatch = (data: unknown) => ada.ctx.request.patch(`/api/people/employees/${employee.id}`, { data });
    expect((await adaPatch({ workEmail: `alt-${uid()}@real-e2e.io` })).status()).toBe(403);
    expect((await adaPatch({ payPeriod: 'weekly' })).status()).toBe(403);
    // El resto de la ficha sigue siendo suyo, y el período no le llega.
    expect((await adaPatch({ jobTitle: 'Analista' })).ok()).toBe(true);
    const seen = (await (await ada.ctx.request.get(`/api/people/employees/${employee.id}`)).json()) as { employee?: { payPeriod?: string }; payPeriod?: string };
    expect(seen.employee?.payPeriod ?? seen.payPeriod ?? '').toBe('');
    expect((await ada.ctx.request.get(`/api/people/employees/${employee.id}/compensation`)).status()).toBe(403);
    // El alta normal de un ingreso: crearla con su email sigue siendo de un admin.
    const { employee: fresh } = (await (await ada.ctx.request.post('/api/people/employees', { data: { name: 'Ingreso', workEmail: `ingreso-${uid()}@real-e2e.io` } })).json()) as { employee: { id: string } };
    // Cambiar el email de una ficha sin cuenta, no: decide quién queda enlazado.
    expect((await ada.ctx.request.patch(`/api/people/employees/${fresh.id}`, { data: { workEmail: `otro-${uid()}@real-e2e.io` } })).status()).toBe(403);
    expect((await olga.ctx.request.patch(`/api/people/employees/${fresh.id}`, { data: { workEmail: `otro-${uid()}@real-e2e.io` } })).ok()).toBe(true);
    // El owner sí puede corregir el email de la ficha con sueldo.
    expect((await olga.ctx.request.patch(`/api/people/employees/${employee.id}`, { data: { workEmail: `bien-${uid()}@real-e2e.io` } })).ok()).toBe(true);
  } finally {
    await closeAll(olga, ada);
  }
});

test('permisos de admins: invitaciones ajenas y ajustes de ingreso por dominio', async ({ browser }) => {
  const olga = await owner(browser);
  const lia = await join(browser, olga, 'Lia', 'admin', ['docs']);
  const ada = await join(browser, olga, 'Ada', 'admin', '*');
  try {
    const invite = async (by: Person, data: Record<string, unknown>) => {
      const res = await by.ctx.request.post('/api/teams/invites', { data: { emails: `i-${uid()}@real-e2e.io`, ...data } });
      expect(res.status()).toBe(201);
      return ((await res.json()) as { results: Array<{ inviteId: string }> }).results[0].inviteId;
    };
    const wide = await invite(olga, { apps: '*' });
    const narrow = await invite(olga, { apps: ['docs'] });
    const mine = await invite(lia, { apps: ['docs'] });
    const post = (who: Person, id: string, data: unknown) => who.ctx.request.post(`/api/teams/invites/${id}`, { data });

    // Una invitación con más apps que las mías: ni reenviar ni ver el link, con ningún cuerpo.
    expect((await post(lia, wide, {})).status()).toBe(403);
    expect((await post(lia, wide, { action: 'resend', allowAnyEmail: true })).status()).toBe(403);
    const list = (await (await lia.ctx.request.get('/api/teams/invites')).json()) as { rows: Array<{ id: string; url?: string; canResend: boolean; canAllowAnyEmail: boolean }> };
    const row = (id: string) => list.rows.find((i) => i.id === id)!;
    expect(row(wide).url).toBeUndefined();
    expect(row(wide).canResend).toBe(false);
    expect(row(narrow).url).toBeTruthy();

    // Abrirla a otro email: quien la hizo o el owner, aunque tenga las apps.
    expect(row(narrow).canAllowAnyEmail).toBe(false);
    expect((await post(lia, narrow, { allowAnyEmail: true })).status()).toBe(403);
    expect((await post(ada, narrow, { allowAnyEmail: true })).status()).toBe(403);
    expect(row(mine).canAllowAnyEmail).toBe(true);
    expect((await post(lia, mine, { allowAnyEmail: true })).ok()).toBe(true);

    // Ingreso por dominio: con el ajuste en todas las apps, no lo prende ni lo abre.
    const ws = (who: Person, data: unknown) => who.ctx.request.patch('/api/teams/workspace', { data });
    const domains = ['real-e2e.io'];
    expect((await ws(lia, { allowedDomains: domains, joinApproval: false })).status()).toBe(403);
    expect((await ws(lia, { allowedDomains: domains, joinApps: '*' })).status()).toBe(403);
    expect((await ws(lia, { allowedDomains: domains, joinApps: ['docs', 'crm'] })).status()).toBe(403);
    // Con sus apps sí. Y después de eso no puede ampliarlas ni cambiar lo que dejó el owner por encima.
    expect((await ws(lia, { allowedDomains: domains, joinApps: ['docs'], joinApproval: false })).ok()).toBe(true);
    expect((await ws(lia, { joinApps: '*' })).status()).toBe(403);
    expect((await ws(olga, { joinApps: '*' })).ok()).toBe(true);
    expect((await ws(lia, { joinApproval: true })).status()).toBe(403);
    // Sacar el dominio achica: se puede.
    expect((await ws(lia, { allowedDomains: [] })).ok()).toBe(true);
    // Lo demás de la ficha no se traba.
    expect((await ws(lia, { name: 'Acme QA' })).ok()).toBe(true);

    // Su pantalla no muestra "Todas las apps" tildada en el ingreso por dominio.
    await lia.page.goto('/en/app/settings/workspace', { waitUntil: 'networkidle' });
    await expect(lia.page.getByRole('checkbox', { name: 'All apps' })).toHaveCount(0);
    await expect(lia.page.getByRole('checkbox', { name: 'Docs' })).toBeChecked();
  } finally {
    await closeAll(olga, lia, ada);
  }
});

test('una server action de la pestaña que quedó atrás avisa: Docs y CRM, al cambiar en otra pestaña y al perder el acceso', async ({ browser }) => {
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', '*');
  const mel = await join(browser, olga, 'Mel', 'member', '*');
  try {
    const count = async (id: string) => Number((await sql('SELECT COUNT(*) AS c FROM docs_pages WHERE user_id = ?', [id]))[0].c);
    const guard = ada.page.getByTestId('workspace-guard');

    // Docs: cambia en otra pestaña (misma sesión) y el botón de esta no hace nada callado.
    await ada.page.goto('/en/app/docs', { waitUntil: 'networkidle' });
    expect((await ada.ctx.request.post('/api/teams/switch', { data: { teamId: null } })).ok()).toBe(true);
    const before = [await count(ada.id), await count(olga.wsId)];
    await ada.page.getByRole('button', { name: /New page/ }).first().click();
    await expect(guard).toContainText('changed in another tab', { timeout: 20_000 });
    expect([await count(ada.id), await count(olga.wsId)]).toEqual(before);
    await guard.getByRole('button', { name: /Switch back to/ }).click();
    await expect(guard).toHaveCount(0, { timeout: 20_000 });
    await ada.page.waitForLoadState('networkidle');
    await ada.page.getByRole('button', { name: /New page/ }).first().click();
    await ada.page.waitForURL(/\/app\/docs\/[^/?]+/);
    expect(await count(olga.wsId)).toBe(before[1] + 1);

    // CRM: quitar el contacto de un lead.
    const contact = (await (await olga.ctx.request.post('/api/crm/contacts', { data: { firstName: 'Ana', lastName: uid() } })).json()) as { id: string; firstName?: string; lastName?: string };
    const lead = (await (await olga.ctx.request.post('/api/crm/leads', { data: { name: `Lead ${uid()}`, contactId: contact.id } })).json()) as { id: string };
    await ada.page.goto(`/en/app/crm/leads/${lead.id}?tab=related`, { waitUntil: 'networkidle' });
    expect((await ada.ctx.request.post('/api/teams/switch', { data: { teamId: null } })).ok()).toBe(true);
    await ada.page.getByRole('button', { name: /^Remove Ana/ }).first().click({ timeout: 20_000 });
    await expect(guard).toContainText('changed in another tab', { timeout: 20_000 });
    const row = (await sql('SELECT contact_id FROM crm_leads WHERE id = ?', [lead.id]))[0];
    expect(row.contact_id).toBe(contact.id);
    // Esa página no existe en el otro workspace: el aviso llega igual y volver la recupera.
    await guard.getByRole('button', { name: /Switch back to/ }).click();
    await ada.page.waitForURL(/\/app\/crm\/leads\//);
    await expect(ada.page.getByRole('heading', { name: /Lead / }).first()).toBeVisible({ timeout: 20_000 });

    // Perder el acceso: Docs y CRM dicen eso y ofrecen salir.
    const melGuard = mel.page.getByTestId('workspace-guard');
    await mel.page.goto('/en/app/docs', { waitUntil: 'networkidle' });
    expect((await olga.ctx.request.delete(`/api/teams/members/${mel.id}`)).ok()).toBe(true);
    const melBefore = await count(mel.id);
    await mel.page.getByRole('button', { name: /New page/ }).first().click();
    await expect(melGuard).toContainText('no longer have access', { timeout: 20_000 });
    expect(await count(mel.id)).toBe(melBefore);
  } finally {
    await closeAll(olga, ada, mel);
  }
});

test('pedido respondido en parte: el aviso dice lo que falta y la fila de Miembros lo muestra', async ({ browser }) => {
  const olga = await owner(browser);
  const mel = await join(browser, olga, 'Mel', 'member', ['docs']);
  try {
    for (const app of ['track', 'link']) expect((await mel.ctx.request.post('/api/teams/access-request', { data: { app } })).ok()).toBe(true);
    const unread = async () => ((await (await olga.ctx.request.get('/api/notifications?type=workspace_access&unreadOnly=1&limit=20')).json()) as { rows: Array<{ id: string; title: string }> }).rows;
    const [n] = await unread();
    expect(n.title).toContain('Track');
    expect(n.title).toContain('Link');
    expect((await olga.ctx.request.patch(`/api/teams/members/${mel.id}`, { data: { apps: ['docs', 'track'] } })).ok()).toBe(true);
    const [after] = await unread();
    expect(after.title).toContain('Link');
    expect(after.title).not.toContain('Track');

    // Con el aviso leído, el pedido sigue a la vista y abre el diálogo.
    expect((await olga.ctx.request.patch(`/api/notifications/${after.id}`, { data: { read: true } })).ok()).toBe(true);
    await olga.page.goto('/en/app/settings/members', { waitUntil: 'networkidle' });
    await olga.page.getByTestId('request-marker').click();
    await expect(olga.page.getByTestId('request-line')).toContainText('Link');
    await expect(olga.page.getByRole('dialog').getByTestId('approve-request')).toContainText('Link');
  } finally {
    await closeAll(olga, mel);
  }
});

test('"No sos vos" después de aceptar dice que esa cuenta ya entró y deja salir del workspace', async ({ browser }) => {
  const olga = await owner(browser);
  const late = await signIn(browser, 'Late');
  try {
    const res = await olga.ctx.request.post('/api/teams/invites', { data: { emails: late.email } });
    const { results } = (await res.json()) as { results: Array<{ url: string }> };
    await late.page.goto(new URL(results[0].url).pathname, { waitUntil: 'networkidle' });
    await late.page.getByRole('button', { name: /^Join/ }).click();
    await late.page.waitForURL(/welcome/);
    await late.page.getByRole('button', { name: 'Not you? Sign out' }).click();
    await expect(late.page.getByTestId('welcome-not-you')).toContainText('You already joined');
    await late.page.getByRole('button', { name: /^Leave .* and sign out/ }).click();
    await late.page.waitForURL(/\/auth\/signin/);
    const left = await sql('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?', [olga.teamId, late.id]);
    expect(left).toEqual([]);
  } finally {
    await closeAll(olga, late);
  }
});

test('permisos de sueldos: la cuenta enlazada manda, se ve y se confirma antes de cargar sueldo; borrar con sueldo es de quien lo lee', async ({ browser }) => {
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', '*');
  const alt = await signIn(browser, 'Alt');
  try {
    await olga.ctx.request.get('/api/people/me');
    const original = `original-${uid()}@real-e2e.io`;
    const create = async (by: Person, data: Record<string, unknown>) => ((await (await by.ctx.request.post('/api/people/employees', { data })).json()) as { employee: { id: string } }).employee.id;
    const pay = (who: Person, id: string) =>
      who.ctx.request.post(`/api/people/employees/${id}/compensation`, { data: { amount: 5000, currency: 'USD', period: 'month', effectiveDate: '2026-01-01' } });

    // La secuencia: una ficha sin cuenta y sin sueldo, y un admin que quiere cambiarle el email.
    const pending = await create(olga, { name: 'Sin cuenta', workEmail: original });
    expect((await ada.ctx.request.patch(`/api/people/employees/${pending}`, { data: { workEmail: alt.email } })).status()).toBe(403);

    // Lo que queda: una ficha creada con otro email, que enlaza esa cuenta y después se "arregla" a mano.
    const hire = await create(ada, { name: 'Ingreso', workEmail: alt.email });
    const inv = await ada.ctx.request.post('/api/teams/invites', { data: { emails: alt.email, apps: ['people'] } });
    const { results } = (await inv.json()) as { results: Array<{ url: string }> };
    expect((await alt.ctx.request.post('/api/teams/accept', { data: { token: results[0].url.split('/invite/')[1].split('?')[0] } })).ok()).toBe(true);
    expect((await alt.ctx.request.post('/api/onboarding', { data: { kind: 'invited', name: 'Alt' } })).ok()).toBe(true);
    await alt.ctx.request.get('/api/people/me');
    const row = (await sql('SELECT user_id FROM people_employees WHERE id = ?', [hire]))[0];
    expect(row.user_id).toBe(alt.id);
    expect((await ada.ctx.request.patch(`/api/people/employees/${hire}`, { data: { workEmail: original } })).ok()).toBe(true);

    // El owner carga sueldo: se frena y nombra la cuenta.
    const refused = await pay(olga, hire);
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'linked_account_mismatch', linkedEmail: alt.email });
    expect((await alt.ctx.request.get(`/api/people/employees/${hire}/compensation`)).ok() ? ((await (await alt.ctx.request.get(`/api/people/employees/${hire}/compensation`)).json()) as { entries?: unknown[] }).entries ?? [] : []).toEqual([]);

    // La ficha le muestra la cuenta al owner y no a un admin sin marca, que tampoco confirma.
    const adaView = (await (await ada.ctx.request.get(`/api/people/employees/${hire}`)).json()) as { employee: { linkedAccount: unknown } };
    expect(adaView.employee.linkedAccount).toBeNull();
    expect((await ada.ctx.request.patch(`/api/people/employees/${hire}`, { data: { confirmLinkedAccount: true } })).status()).toBe(403);
    await olga.page.goto(`/en/app/people/${hire}`, { waitUntil: 'networkidle' });
    await expect(olga.page.getByTestId('people-linked-account')).toContainText(alt.email);
    await olga.page.getByRole('button', { name: 'Confirm this account' }).click();
    await expect(olga.page.getByRole('button', { name: 'Confirm this account' })).toHaveCount(0);
    await expect(olga.page.getByTestId('people-linked-account')).toContainText(alt.email);
    expect((await pay(olga, hire)).ok()).toBe(true);

    // Borrar: con sueldo, solo quien lo puede leer; y el botón no se le ofrece.
    expect((await ada.ctx.request.delete(`/api/people/employees/${hire}`)).status()).toBe(403);
    await ada.page.goto(`/en/app/people/${hire}`, { waitUntil: 'networkidle' });
    await expect(ada.page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    const empty = await create(ada, { name: 'Sin sueldo' });
    expect((await ada.ctx.request.delete(`/api/people/employees/${empty}`)).ok()).toBe(true);
    expect((await olga.ctx.request.delete(`/api/people/employees/${hire}`)).ok()).toBe(true);
  } finally {
    await closeAll(olga, ada, alt);
  }
});

test('el aviso de pestaña vieja se cierra, no sale en el sitio público y no sobrevive a cerrar sesión', async ({ browser }) => {
  const olga = await owner(browser);
  const ada = await join(browser, olga, 'Ada', 'admin', '*');
  try {
    const p = ada.page;
    const guard = p.getByTestId('workspace-guard');
    const trip = async () => {
      await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
      expect((await ada.ctx.request.post('/api/teams/switch', { data: { teamId: null } })).ok()).toBe(true);
      expect(await p.evaluate(async () => (await fetch('/api/docs/pages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"x"}' })).status)).toBe(401);
      await expect(guard).toBeVisible();
    };
    const stored = () => p.evaluate(() => sessionStorage.getItem('zs-workspace-guard'));
    const rejoin = () => ada.ctx.request.post('/api/teams/switch', { data: { teamId: olga.teamId } });

    await trip();
    await guard.getByRole('button', { name: 'Dismiss' }).click();
    await expect(guard).toHaveCount(0);
    expect(await stored()).toBeNull();

    await rejoin();
    await trip();
    expect(await stored()).toBeTruthy();
    await p.goto('/en', { waitUntil: 'networkidle' });
    await expect(guard).toHaveCount(0);

    await p.goto('/en/app', { waitUntil: 'networkidle' });
    await expect(guard).toBeVisible();
    await p.getByRole('button', { name: 'Sign out' }).first().click({ timeout: 10_000 }).catch(async () => {
      await p.locator('.ws-switcher-btn').click();
      await p.getByRole('menuitem', { name: 'Sign out' }).click();
    });
    await p.waitForURL((u) => !u.pathname.includes('/app'), { timeout: 20_000 });
    expect(await stored()).toBeNull();
  } finally {
    await closeAll(olga, ada);
  }
});

test('un admin sin apps ve en el inicio solo lo que puede hacer', async ({ browser }) => {
  const olga = await owner(browser);
  const nia = await join(browser, olga, 'Nia', 'admin', []);
  try {
    await nia.page.goto('/en/app', { waitUntil: 'networkidle' });
    await expect(nia.page.getByTestId('home-no-apps')).toBeVisible();
    await expect(nia.page.getByTestId('home-invite')).toHaveCount(0);
    await expect(nia.page.getByTestId('home-import')).toHaveCount(0);
  } finally {
    await closeAll(olga, nia);
  }
});

test('Analytics: sin sesión, con un token inventado o sin la app, la API dice 401', async ({ browser }) => {
  const olga = await owner(browser);
  const nia = await join(browser, olga, 'Nia', 'member', []);
  const baseURL = test.info().project.use.baseURL as string;
  const anon = await browser.newContext({ baseURL });
  try {
    const paths = ['/api/analytics/projects', '/api/analytics/dashboards?project=x', '/api/analytics/insights?project=x'];
    for (const path of paths) {
      expect((await anon.request.get(path)).status(), path).toBe(401);
      expect((await anon.request.get(path, { headers: { authorization: 'Bearer zsk_inventado' } })).status(), path).toBe(401);
      // Sin la app la sesión cuenta como que no alcanza para esa API (lib/session.ts).
      expect((await nia.ctx.request.get(path)).status(), path).toBe(401);
    }
    expect((await anon.request.post('/api/analytics/query', { data: { projectId: 'x', query: { kind: 'sql', sql: 'SELECT 1' } } })).status()).toBe(401);
    // Y el que sí tiene la app entra.
    expect((await olga.ctx.request.get('/api/analytics/projects')).status()).toBe(200);
    // La página no se abre sin sesión.
    const page = await anon.newPage();
    await page.goto('/en/app/pulse');
    await page.waitForURL((u) => !u.pathname.includes('/app/'), { timeout: 20_000 });
  } finally {
    await anon.close();
    await closeAll(olga, nia);
  }
});

test('Analytics: lo que está en un link público y los flags los cambia un admin; lo demás, cualquiera con la app', async ({ browser }) => {
  const olga = await owner(browser);
  const mia = await join(browser, olga, 'Mia', 'member', ['pulse']);
  const post = async (path: string, data: unknown) => {
    const res = await olga.ctx.request.post(path, { data });
    expect(res.status(), await res.text()).toBeLessThan(300);
    return res.json();
  };
  try {
    const { project } = await post('/api/analytics/projects', { name: `Real ${uid()}` });
    const projectId = project.id as string;
    const query = { kind: 'trends', series: [{ event: 'x' }] };
    const { insight: shared } = await post('/api/analytics/insights', { projectId, name: 'Shared', query });
    const { insight: onBoard } = await post('/api/analytics/insights', { projectId, name: 'On board', query });
    const { insight: free } = await post('/api/analytics/insights', { projectId, name: 'Free', query });
    const { dashboard: board } = await post('/api/analytics/dashboards', { projectId, name: 'Public board' });
    const { dashboard: plain } = await post('/api/analytics/dashboards', { projectId, name: 'Plain' });
    await olga.ctx.request.patch(`/api/analytics/dashboards/${board.id}`, { data: { insightIds: [onBoard.id] } });
    await post('/api/analytics/shares', { projectId, insightId: shared.id });
    await post('/api/analytics/shares', { projectId, dashboardId: board.id });

    const m = mia.ctx.request;
    const settings = { filters: [], order: [], tiles: {}, texts: [{ id: 't', body: 'hola' }] };
    expect((await m.patch(`/api/analytics/insights/${shared.id}`, { data: { name: 'Otro' } })).status()).toBe(403);
    expect((await m.patch(`/api/analytics/insights/${onBoard.id}`, { data: { name: 'Otro' } })).status()).toBe(403);
    expect((await m.delete(`/api/analytics/insights/${shared.id}`)).status()).toBe(403);
    expect((await m.patch(`/api/analytics/dashboards/${board.id}`, { data: { settings } })).status()).toBe(403);
    expect((await m.patch(`/api/analytics/dashboards/${board.id}`, { data: { insightIds: [] } })).status()).toBe(403);
    expect((await m.delete(`/api/analytics/dashboards/${board.id}`)).status()).toBe(403);
    expect((await m.patch(`/api/analytics/dashboards/${plain.id}`, { data: { transfer: { targetId: board.id, kind: 'insight', tileId: free.id, move: false } } })).status()).toBe(403);
    // Lo que sale por email también: un miembro no cambia lo que le llega a alguien de afuera, ni ve a quién.
    const { insight: mailed } = await post('/api/analytics/insights', { projectId, name: 'Mailed', query });
    await post('/api/analytics/subscriptions', { projectId, name: 'Weekly', insightId: mailed.id, recipients: ['outside@other.org'], schedule: { frequency: 'daily', interval: 1, hour: 9 } });
    expect((await m.patch(`/api/analytics/insights/${mailed.id}`, { data: { name: 'Otro' } })).status()).toBe(403);
    expect((await m.post('/api/analytics/subscriptions', { data: { projectId, name: 'No', insightId: free.id, recipients: ['x@other.org'], schedule: { frequency: 'daily', interval: 1, hour: 9 } } })).status()).toBe(403);
    const seen = await (await m.get(`/api/analytics/subscriptions?project=${projectId}`)).text();
    expect(seen).not.toContain('outside@other.org');
    // Sin link público, se trabaja normal.
    expect((await m.patch(`/api/analytics/insights/${free.id}`, { data: { name: 'Libre' } })).status()).toBe(200);
    expect((await m.patch(`/api/analytics/dashboards/${plain.id}`, { data: { settings } })).status()).toBe(200);
    // Un admin sí puede.
    expect((await olga.ctx.request.patch(`/api/analytics/insights/${shared.id}`, { data: { name: 'Otro' } })).status()).toBe(200);

    // Flags: crear, cambiar y borrar son de admin.
    const { flag } = await post('/api/analytics/flags', { projectId, key: `f-${uid()}`, name: '', active: false, rollout: 100, variants: [], conditions: [] });
    expect((await m.post('/api/analytics/flags', { data: { projectId, key: `m-${uid()}`, name: '', active: true, rollout: 100, variants: [], conditions: [] } })).status()).toBe(403);
    expect((await m.patch(`/api/analytics/flags/${flag.id}`, { data: { active: true } })).status()).toBe(403);
    expect((await m.delete(`/api/analytics/flags/${flag.id}`)).status()).toBe(403);
    expect((await m.get(`/api/analytics/flags/${flag.id}`)).status()).toBe(200);
  } finally {
    await closeAll(olga, mia);
  }
});

/** Send: un PDF de una página, subido como lo hace el navegador. */
async function sendDoc(p: Person, title: string): Promise<{ id: string; versionId: string }> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const bytes = Buffer.from(await doc.save());
  const created = await p.ctx.request.post('/api/send/documents', { data: { title, file: { name: 'd.pdf', mime: 'application/pdf', size: bytes.length } } });
  expect(created.status(), await created.text()).toBe(201);
  const { document, version } = (await created.json()) as { document: { id: string }; version: { id: string } };
  expect((await p.ctx.request.put(`/api/send/versions/${version.id}/parts/0`, { data: bytes, headers: { 'content-type': 'application/octet-stream' } })).ok()).toBe(true);
  expect((await p.ctx.request.post(`/api/send/versions/${version.id}/complete`, { data: {} })).ok()).toBe(true);
  expect(((await (await p.ctx.request.post(`/api/send/versions/${version.id}/process`)).json()) as { version: { status: string } }).version.status).toBe('ready');
  return { id: document.id, versionId: version.id };
}

const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

test('Send: cada rol ve y hace solo lo suyo, y un link no sirve lo que su autor ya no ve', async ({ browser, baseURL }) => {
  const olga = await owner(browser);
  const adam = await join(browser, olga, 'Adam', 'admin', '*');
  const mel = await join(browser, olga, 'Mel', 'member', ['send']);
  const nia = await join(browser, olga, 'Nia', 'member', ['crm']);
  const gus = await join(browser, olga, 'Gus', 'guest', []);
  const anon = await browser.newContext({ baseURL, extraHTTPHeaders: { 'user-agent': REAL_UA } });
  try {
    const priv = await sendDoc(olga, `Private ${uid()}`);
    const shared = await sendDoc(olga, `Shared ${uid()}`);
    expect((await olga.ctx.request.patch(`/api/send/documents/${shared.id}`, { data: { sharing: 'workspace' } })).ok()).toBe(true);
    const ownLink = (await (await olga.ctx.request.post(`/api/send/documents/${shared.id}/links`, { data: { name: 'Owner' } })).json()) as { link: { id: string; path: string } };

    // Sin la app: nada.
    expect((await nia.ctx.request.get('/api/send/documents')).status()).toBe(401);
    expect((await nia.ctx.request.get(`/api/send/documents/${shared.id}`)).status()).toBe(401);
    expect((await nia.ctx.request.post('/api/send/documents', { data: { title: 'x', file: { name: 'a.pdf', mime: 'application/pdf', size: 10 } } })).status()).toBe(401);
    // Un invitado queda en su workspace propio: lo de este no existe para él.
    expect(JSON.stringify(await (await gus.ctx.request.get('/api/send/documents')).json())).not.toContain(shared.id);
    expect((await gus.ctx.request.get(`/api/send/documents/${shared.id}`)).status()).toBe(404);
    expect((await gus.ctx.request.get(`/api/send/versions/${shared.versionId}/pages/1`)).status()).toBe(404);

    // Admin: ve todo, exporta y cambia la marca.
    expect((await adam.ctx.request.get(`/api/send/documents/${priv.id}`)).ok()).toBe(true);
    expect((await adam.ctx.request.get(`/api/send/documents/${priv.id}/export`)).ok()).toBe(true);
    expect((await adam.ctx.request.put('/api/send/settings', { data: { brandName: 'Acme', logoUrl: '', brandColor: '', siteUrl: '' } })).ok()).toBe(true);

    // Member, lo privado: ni existe.
    for (const url of [`/api/send/documents/${priv.id}`, `/api/send/documents/${priv.id}/analytics`, `/api/send/documents/${priv.id}/links`, `/api/send/versions/${priv.versionId}/pages/1`, `/api/send/versions/${priv.versionId}/file`]) {
      expect((await mel.ctx.request.get(url)).status(), url).toBe(404);
    }
    expect((await mel.ctx.request.post(`/api/send/documents/${priv.id}/links`, { data: {} })).status()).toBe(404);
    expect(JSON.stringify(await (await mel.ctx.request.get('/api/send/documents')).json())).not.toContain(priv.id);

    // Member, lo compartido: lee y arma links propios, no administra.
    expect((await mel.ctx.request.get(`/api/send/documents/${shared.id}`)).ok()).toBe(true);
    expect((await mel.ctx.request.patch(`/api/send/documents/${shared.id}`, { data: { title: 'Mine now' } })).status()).toBe(403);
    expect((await mel.ctx.request.delete(`/api/send/documents/${shared.id}`)).status()).toBe(403);
    expect((await mel.ctx.request.get(`/api/send/documents/${shared.id}/export`)).status()).toBe(403);
    expect((await mel.ctx.request.patch(`/api/send/links/${ownLink.link.id}`, { data: { disabled: true } })).status()).toBe(403);
    expect((await mel.ctx.request.put('/api/send/settings', { data: { brandName: 'X', logoUrl: '', brandColor: '', siteUrl: '' } })).status()).toBe(403);
    const links = (await (await mel.ctx.request.get(`/api/send/documents/${shared.id}/links`)).json()) as { links: Array<{ id: string; path: string | null }> };
    expect(links.links.find((l) => l.id === ownLink.link.id)?.path).toBeNull();

    // Su link funciona, y deja de servir en cuanto el dueño vuelve privado el documento.
    const melLink = (await (await mel.ctx.request.post(`/api/send/documents/${shared.id}/links`, { data: { name: 'Mel', allowDownload: true } })).json()) as { link: { path: string } };
    const melToken = melLink.link.path.split('/').pop()!;
    expect(((await (await anon.request.post(`/api/send/public/${melToken}`, { data: {} })).json()) as { documents: unknown[] }).documents).toHaveLength(1);
    expect((await anon.request.get(`/api/send/public/${melToken}/pages/${shared.versionId}/1`)).ok()).toBe(true);
    expect((await olga.ctx.request.patch(`/api/send/documents/${shared.id}`, { data: { sharing: 'private' } })).ok()).toBe(true);
    expect((await anon.request.get(`/api/send/public/${melToken}/pages/${shared.versionId}/1`)).status()).toBe(409);
    expect((await anon.request.get(`/api/send/public/${melToken}/download?document=${shared.id}&piece=0`)).status()).toBe(404);
    // Quien lo abre ve que ya no está; el dueño ve por qué y qué hacer.
    expect(((await (await anon.request.get(`/api/send/public/${melToken}`)).json()) as { state: string; reason: string })).toMatchObject({ state: 'closed', reason: 'unavailable' });
    const owned = (await (await olga.ctx.request.get(`/api/send/documents/${shared.id}/links`)).json()) as { links: Array<{ name: string; problem: string | null }> };
    expect(owned.links.find((l) => l.name === 'Mel')?.problem).toBe('document_private');
    expect(owned.links.find((l) => l.name === 'Owner')?.problem).toBeNull();
    // El link del dueño sigue.
    const ownToken = ownLink.link.path.split('/').pop()!;
    expect(((await (await anon.request.post(`/api/send/public/${ownToken}`, { data: {} })).json()) as { documents: unknown[] }).documents).toHaveLength(1);

    // Un documento privado dentro de un espacio compartido no llega a un member.
    const open = await sendDoc(olga, `Open ${uid()}`);
    expect((await olga.ctx.request.patch(`/api/send/documents/${open.id}`, { data: { sharing: 'workspace' } })).ok()).toBe(true);
    const room = (await (await olga.ctx.request.post('/api/send/spaces', { data: { title: `Room ${uid()}` } })).json()) as { space: { id: string } };
    expect((await olga.ctx.request.patch(`/api/send/spaces/${room.space.id}`, { data: { sharing: 'workspace', items: [{ documentId: priv.id }, { documentId: open.id }] } })).ok()).toBe(true);
    const seen = JSON.stringify(await (await mel.ctx.request.get(`/api/send/spaces/${room.space.id}`)).json());
    expect(seen).toContain(open.id);
    expect(seen).not.toContain(priv.id);
    // Su link del espacio publica solo lo que él ve.
    const spaceLink = (await (await mel.ctx.request.post(`/api/send/spaces/${room.space.id}/links`, { data: { name: 'Mel', allowDownload: true } })).json()) as { link: { path: string } };
    const spaceToken = spaceLink.link.path.split('/').pop()!;
    const viewer = await browser.newContext({ baseURL, extraHTTPHeaders: { 'user-agent': REAL_UA } });
    const state = (await (await viewer.request.post(`/api/send/public/${spaceToken}`, { data: {} })).json()) as { documents: Array<{ id: string }> };
    expect(state.documents.map((d) => d.id)).toEqual([open.id]);
    expect((await viewer.request.get(`/api/send/public/${spaceToken}/pages/${priv.versionId}/1`)).status()).toBe(409);
    expect((await viewer.request.get(`/api/send/public/${spaceToken}/download?document=${priv.id}&piece=0`)).status()).toBe(404);
    // Sus números tampoco: el dueño lo abre por su link y el member no ve ese documento en el espacio.
    const ownRoom = (await (await olga.ctx.request.post(`/api/send/spaces/${room.space.id}/links`, { data: { name: 'Olga' } })).json()) as { link: { path: string } };
    const ownRoomToken = ownRoom.link.path.split('/').pop()!;
    const reader = await browser.newContext({ baseURL, extraHTTPHeaders: { 'user-agent': REAL_UA } });
    await reader.request.post(`/api/send/public/${ownRoomToken}`, { data: {} });
    await reader.request.get(`/api/send/public/${ownRoomToken}/pages/${priv.versionId}/1`);
    await new Promise((r) => setTimeout(r, 1000));
    expect(((await (await reader.request.post(`/api/send/public/${ownRoomToken}/ping`, { data: { documentId: priv.id, versionId: priv.versionId, deltas: [{ page: 1, seconds: 2.4 }] } })).json()) as { counted: boolean }).counted).toBe(true);
    const melNumbers = JSON.stringify(await (await mel.ctx.request.get(`/api/send/spaces/${room.space.id}/analytics`)).json());
    expect(melNumbers).not.toContain(priv.id);
    expect(JSON.stringify(await (await olga.ctx.request.get(`/api/send/spaces/${room.space.id}/analytics`)).json())).toContain(priv.id);
    await viewer.close();
    await reader.close();
  } finally {
    await anon.close();
    await closeAll(olga, adam, mel, nia, gus);
  }
});

test('Send: los avisos de más salen en un resumen', async ({ browser, baseURL }) => {
  const olga = await owner(browser);
  try {
    const doc = await sendDoc(olga, `Digest ${uid()}`);
    const created = (await (await olga.ctx.request.post(`/api/send/documents/${doc.id}/links`, { data: { name: 'Campaign' } })).json()) as { link: { id: string; path: string } };
    const token = created.link.path.split('/').pop()!;
    for (let i = 0; i < 5; i++) {
      const c = await browser.newContext({ baseURL, extraHTTPHeaders: { 'user-agent': REAL_UA, 'x-forwarded-for': `10.30.1.${i + 1}` } });
      await c.request.post(`/api/send/public/${token}`, { data: {} });
      await c.request.get(`/api/send/public/${token}/pages/${doc.versionId}/1`);
      await new Promise((r) => setTimeout(r, 1000));
      await c.request.post(`/api/send/public/${token}/ping`, { data: { documentId: doc.id, versionId: doc.versionId, deltas: [{ page: 1, seconds: 2.4 }] } });
      await c.close();
    }
    await sql('UPDATE send_links SET alert_window_at = ? WHERE id = ?', [Date.now() - 2 * 3_600_000, created.link.id]);
    expect((await olga.ctx.request.get('/api/cron/minute', { headers: { authorization: 'Bearer e2e-cron' } })).ok()).toBe(true);
    const mails = fs.readFileSync(process.env.E2E_MAIL_FILE!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { to: string; subject: string }).filter((m) => m.to === olga.email && m.subject.includes('Digest'));
    expect(mails.filter((m) => /is reading/.test(m.subject))).toHaveLength(3);
    expect(mails.filter((m) => /2 more/.test(m.subject))).toHaveLength(1);
  } finally {
    await closeAll(olga);
  }
});

test('Send: quien se va, pierde la app o pasa a guest deja de publicar; lo compartido pasa al owner', async ({ browser, baseURL }) => {
  const olga = await owner(browser);
  const left = await join(browser, olga, 'Lena', 'member', ['send']);
  const lost = await join(browser, olga, 'Lucho', 'member', ['send', 'crm']);
  const down = await join(browser, olga, 'Dora', 'member', ['send']);
  const open = async (token: string) => {
    const c = await browser.newContext({ baseURL, extraHTTPHeaders: { 'user-agent': REAL_UA } });
    const state = (await (await c.request.post(`/api/send/public/${token}`, { data: {} })).json()) as { state: string; reason?: string };
    await c.close();
    return state;
  };
  const makeLink = async (p: Person, id: string, name: string) => ((await (await p.ctx.request.post(`/api/send/documents/${id}/links`, { data: { name } })).json()) as { link: { path: string } }).link.path.split('/').pop()!;
  try {
    const shared = await sendDoc(olga, `Team ${uid()}`);
    expect((await olga.ctx.request.patch(`/api/send/documents/${shared.id}`, { data: { sharing: 'workspace' } })).ok()).toBe(true);

    // Se va: su link sobre lo compartido sigue, ahora del owner; el de su documento privado se frena.
    const hers = await sendDoc(left, `Hers ${uid()}`);
    const herShared = await sendDoc(left, `Hers shared ${uid()}`);
    expect((await left.ctx.request.patch(`/api/send/documents/${herShared.id}`, { data: { sharing: 'workspace' } })).ok()).toBe(true);
    const onShared = await makeLink(left, shared.id, 'On shared');
    const onHerShared = await makeLink(left, herShared.id, 'On her shared');
    const onHerPrivate = await makeLink(left, hers.id, 'On her private');
    expect((await open(onHerPrivate)).state).toBe('open');
    expect((await olga.ctx.request.delete(`/api/teams/members/${left.id}`)).ok()).toBe(true);
    expect((await open(onShared)).state).toBe('open');
    expect((await open(onHerShared)).state).toBe('open');
    expect(await open(onHerPrivate)).toMatchObject({ state: 'closed', reason: 'unavailable' });
    const links = (await (await olga.ctx.request.get(`/api/send/documents/${hers.id}/links`)).json()) as { links: Array<{ name: string; problem: string | null; mine: boolean }> };
    expect(links.links[0]).toMatchObject({ problem: 'document_private', mine: true });
    expect((await sql('SELECT created_by, transferred_from FROM send_links WHERE name = ?', ['On shared']))[0]).toMatchObject({ created_by: olga.id, transferred_from: left.id });
    const bell = JSON.stringify(await (await olga.ctx.request.get('/api/notifications?limit=30')).json());
    expect(bell).toContain('passed to you');
    expect(bell).toContain('stopped');
    // Compartir el documento lo vuelve a servir: lo decide el owner.
    expect((await olga.ctx.request.patch(`/api/send/documents/${hers.id}`, { data: { sharing: 'workspace' } })).ok()).toBe(true);
    expect((await open(onHerPrivate)).state).toBe('open');

    // Pierde la app: deja de servir, también sobre lo compartido; el owner ve por qué.
    const his = await makeLink(lost, shared.id, 'Lucho link');
    expect((await open(his)).state).toBe('open');
    expect((await olga.ctx.request.patch(`/api/teams/members/${lost.id}`, { data: { apps: ['crm'] } })).ok()).toBe(true);
    expect(await open(his)).toMatchObject({ state: 'closed', reason: 'unavailable' });
    const hisLinks = (await (await olga.ctx.request.get(`/api/send/documents/${shared.id}/links`)).json()) as { links: Array<{ name: string; problem: string | null }> };
    expect(hisLinks.links.find((l) => l.name === 'Lucho link')?.problem).toBe('creator_no_access');
    // Se la devuelven: vuelve.
    expect((await olga.ctx.request.patch(`/api/teams/members/${lost.id}`, { data: { apps: ['send', 'crm'] } })).ok()).toBe(true);
    expect((await open(his)).state).toBe('open');

    // Pasa a guest: como irse.
    const dorasDoc = await sendDoc(down, `Dora ${uid()}`);
    const onDorasPrivate = await makeLink(down, dorasDoc.id, 'Dora private');
    const onSharedByDora = await makeLink(down, shared.id, 'Dora shared');
    expect((await olga.ctx.request.patch(`/api/teams/members/${down.id}`, { data: { role: 'guest' } })).ok()).toBe(true);
    expect((await open(onDorasPrivate)).state).toBe('closed');
    expect((await open(onSharedByDora)).state).toBe('open');
    expect((await sql('SELECT created_by FROM send_links WHERE name = ?', ['Dora shared']))[0].created_by).toBe(olga.id);
  } finally {
    await closeAll(olga, left, lost, down);
  }
});
