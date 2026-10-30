import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Social contra redes simuladas (SOCIAL_FAKE=1, lib/social-fake.ts): conectar
 * por OAuth, componer con texto propio por red, programar, que el cron
 * publique, links a lo publicado, comentarios en la bandeja con respuesta,
 * métricas, aprobaciones y acceso por app.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const CRON = { authorization: 'Bearer e2e-cron' };

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

type Account = { id: string; name: string; network: string };

/** Conecta una red por la API (el OAuth falso vuelve directo al callback) y devuelve las cuentas. */
async function connect(request: APIRequestContext, network: string): Promise<Account[]> {
  const { url } = await ok<{ url: string }>(request.post('/api/social/connect', { data: { network } }));
  await request.get(url);
  return (await ok<{ accounts: Account[] }>(request.get('/api/social/accounts'))).accounts;
}

async function runCron(request: APIRequestContext) {
  await ok(request.get('/api/cron/minute', { headers: CRON }));
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test.describe.configure({ mode: 'serial' });

test('conectar por OAuth desde la pantalla de cuentas', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/social/accounts', { waitUntil: 'networkidle' });
  await page.getByTestId('connect-facebook').click();
  await expect(page).toHaveURL(/\/en\/app\/social\/accounts\?connected=facebook/);
  await expect(page.getByTestId('connected-flash')).toContainText('Facebook');
  await expect(page.getByTestId('accounts-list')).toContainText('Fake Coffee Page');
  // Sin variables y sin modo falso la red diría "no configurada"; Bluesky va con contraseña de app.
  await page.getByPlaceholder('Handle (name.bsky.social)').fill(`brand${uid()}.bsky.social`);
  await page.getByPlaceholder('App password').fill('app-pass-1234');
  await page.getByTestId('network-bluesky').getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByTestId('accounts-list')).toContainText('.bsky.social');
  // Un state ajeno o vencido no conecta nada.
  await page.goto(`/api/social/oauth/callback?code=fake-x&state=${'a'.repeat(64)}`);
  await expect(page).toHaveURL(/error=invalid_state/);
  expect(errors).toEqual([]);
});

test('componer con texto por red, publicar, links, bandeja con respuesta y métricas', async ({ page, request }) => {
  test.setTimeout(150_000);
  await connect(request, 'linkedin');
  const accounts = await connect(request, 'facebook');
  const fb = accounts.find((a) => a.name === 'Fake Coffee Page')!;
  const li = accounts.find((a) => a.name === 'Fake Person')!;
  const text = `Launch day ${uid()} #launch`;
  const override = `On LinkedIn: ${uid()}`;

  const errors = watchErrors(page);
  await page.goto('/en/app/social/posts/new', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Fake Coffee Page/ }).click();
  await page.getByRole('button', { name: /Fake Person/ }).click();
  await page.getByTestId('compose-text').fill(text);
  await expect(page.getByTestId('counter-facebook')).toContainText(`${text.length}/63206`);
  await page.getByRole('tab', { name: 'LinkedIn' }).click();
  await page.getByTestId('customize-linkedin').click();
  await page.getByTestId('compose-text-linkedin').fill(override);
  await expect(page.getByTestId('preview-linkedin')).toContainText(override);
  await expect(page.getByTestId('preview-facebook')).toContainText(text);
  await expect(page.getByTestId('counter-linkedin')).toContainText(`${override.length}/3000`);
  await page.getByRole('radio', { name: 'Publish now' }).check();
  await page.getByTestId('compose-submit').click();
  await expect(page).toHaveURL(/\/en\/app\/social\/posts\/(?!new)[\w-]+$/);
  const postId = page.url().split('/').pop()!;
  await expect(page.getByTestId('post-text')).toContainText(text);

  // El cron publica (claim por destino) y deja los links a lo publicado.
  await runCron(request);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.sc-status').first()).toHaveText('Published');
  await expect(page.getByTestId('live-link')).toHaveCount(2);
  await expect(page.getByTestId('post-target').filter({ hasText: 'Fake Person' })).toContainText(override);

  // La corrida siguiente trae comentarios y métricas.
  await runCron(request);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('target-metrics').first()).toContainText('Impressions');

  await page.goto('/en/app/social/inbox', { waitUntil: 'networkidle' });
  const item = page.getByTestId('inbox-item').filter({ hasText: 'Love this! Where can I buy it?' }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/item=/);
  await page.getByTestId('inbox-reply-text').fill('Thanks! Link in bio.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('inbox-reply')).toContainText('Thanks! Link in bio.');
  await page.getByTestId('inbox-done').click();
  await expect(page.getByTestId('inbox-done')).toHaveText('Reopen');

  await page.goto('/en/app/social/analytics', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('analytics-posts')).toContainText(text.split(' #')[0]);
  expect(Number((await page.getByTestId('total-impressions').innerText()).replace(/\D/g, ''))).toBeGreaterThan(0);
  const csv = await request.get('/api/social/analytics?format=csv');
  expect(await csv.text()).toContain(override);

  // Programada: aparece en el calendario y se arrastra a otro día.
  const later = new Date(Date.now() + 2 * 86_400_000);
  later.setUTCHours(15, 0, 0, 0);
  const scheduled = await ok<{ id: string }>(request.post('/api/social/posts', { data: { text: `Scheduled ${uid()}`, accountIds: [fb.id, li.id], action: 'schedule', scheduledAt: later.toISOString() } }));
  const date = later.toISOString().slice(0, 10);
  await page.goto(`/en/app/social?view=week&date=${date}`, { waitUntil: 'networkidle' });
  const chip = page.locator(`[data-testid="calendar-post"][href$="${scheduled.id}"]`);
  await expect(chip).toBeVisible();
  // Siempre se arrastra: a otro día de la misma semana visible que no haya pasado.
  const today = new Date().toISOString().slice(0, 10);
  const days = await page.locator('.sc-day').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.day ?? ''));
  const target = days.find((d) => d !== date && d > today)!;
  expect(target).toBeTruthy();
  await chip.dragTo(page.locator(`.sc-day[data-day="${target}"]`));
  await expect.poll(async () => String((await sql('SELECT scheduled_at FROM social_posts WHERE id = ?', [scheduled.id]))[0].scheduled_at).slice(0, 10)).toBe(target);

  // Sin mouse: la fecha se cambia desde el detalle con el teclado.
  await page.goto(`/en/app/social/posts/${scheduled.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('post-reschedule-at').fill(`${date}T11:30`);
  await page.getByTestId('post-reschedule-at').press('Enter');
  await expect.poll(async () => String((await sql('SELECT scheduled_at FROM social_posts WHERE id = ?', [scheduled.id]))[0].scheduled_at).slice(0, 10)).toBe(date);
  expect(errors).toEqual([]);
  void postId;
});

test('validación por red en el compositor y error de la red en el destino', async ({ page, request }) => {
  const accounts = await connect(request, 'instagram');
  const ig = accounts.find((a) => a.network === 'instagram')!;
  await page.goto(`/en/app/social/posts/new?account=${ig.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('compose-text').fill('Only text');
  await expect(page.getByTestId('compose-issues')).toContainText('Needs a photo or a video.');
  await expect(page.getByTestId('compose-submit')).toBeDisabled();

  const fb = (await ok<{ accounts: Account[] }>(request.get('/api/social/accounts'))).accounts.find((a) => a.name === 'Fake Coffee Page')!;
  const bad = await ok<{ id: string }>(request.post('/api/social/posts', { data: { text: 'Rejected [fail]', accountIds: [fb.id], action: 'now' } }));
  await runCron(request);
  await page.goto(`/en/app/social/posts/${bad.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('target-error')).toContainText('The network rejected the post');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('aprobaciones: un member que necesita aprobación, el admin aprueba y rechaza con comentario', async ({ browser, baseURL, request }) => {
  test.setTimeout(120_000);
  const fb = (await ok<{ accounts: Account[] }>(request.get('/api/social/accounts'))).accounts.find((a) => a.name === 'Fake Coffee Page')!;
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `drafter-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["social"]')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);

    // Sin cuentas dadas no ve ni publica en ninguna.
    expect((await ok<{ accounts: Account[] }>(ctx.request.get('/api/social/accounts'))).accounts).toEqual([]);
    expect((await ctx.request.post('/api/social/posts', { data: { text: 'x', accountIds: [fb.id], action: 'now' } })).status()).toBe(403);
    expect((await ctx.request.post('/api/social/connect', { data: { network: 'facebook' } })).status()).toBe(403);

    const current = (await ok<{ accounts: Array<Account & { memberIds?: string[] }> }>(request.get('/api/social/accounts'))).accounts.find((a) => a.id === fb.id)!;
    await ok(request.patch(`/api/social/accounts/${fb.id}`, { data: { memberIds: [...(current.memberIds ?? []), me] } }));
    await ok(request.patch('/api/social/people', { data: { personId: me, role: 'drafter' } }));

    // El member compone: va a aprobación.
    const text = `Needs review ${uid()}`;
    await p.goto('/en/app/social/posts/new', { waitUntil: 'networkidle' });
    await expect(p.getByText('Your posts go to an admin for approval')).toBeVisible();
    await p.getByRole('button', { name: /Fake Coffee Page/ }).click();
    await p.getByTestId('compose-text').fill(text);
    await p.getByRole('radio', { name: 'Publish now' }).check();
    await p.getByTestId('compose-submit').click();
    await expect(p).toHaveURL(/\/social\/posts\/(?!new)[\w-]+$/);
    const postId = p.url().split('/').pop()!;
    await expect(p.locator('.sc-status').first()).toHaveText('Waiting for approval');
    expect((await ctx.request.post(`/api/social/posts/${postId}`, { data: { action: 'approve' } })).status()).toBe(403);

    // El cron no publica lo que espera aprobación.
    await runCron(request);
    expect(String((await sql('SELECT status FROM social_posts WHERE id = ?', [postId]))[0].status)).toBe('pending_approval');

    // El owner lo ve en "Para aprobar", con aviso, y aprueba.
    const owner = await browser.newPage({ baseURL });
    await owner.goto('/en/app/social/posts?status=needs_approval', { waitUntil: 'networkidle' });
    await expect(owner.getByTestId('posts-list')).toContainText(text);
    const notes = await ok<{ notifications?: Array<{ type: string; href: string }> }>(owner.request.get('/api/notifications'));
    expect(JSON.stringify(notes)).toContain(postId);
    await owner.goto(`/en/app/social/posts/${postId}`, { waitUntil: 'networkidle' });
    await owner.getByTestId('approval-comment').fill('Looks good');
    await owner.getByRole('button', { name: 'Approve' }).click();
    await expect(owner.locator('.sc-status').first()).toHaveText('Scheduled');
    await runCron(request);
    await owner.reload({ waitUntil: 'networkidle' });
    await expect(owner.locator('.sc-status').first()).toHaveText('Published');

    // Rechazo con comentario: el botón pide comentario y el member lo ve.
    const second = await ok<{ id: string; status: string }>(ctx.request.post('/api/social/posts', { data: { text: `Second ${uid()}`, accountIds: [fb.id], action: 'now' } }));
    expect(second.status).toBe('pending_approval');
    await owner.goto(`/en/app/social/posts/${second.id}`, { waitUntil: 'networkidle' });
    await expect(owner.getByRole('button', { name: 'Reject' })).toBeDisabled();
    await owner.getByTestId('approval-comment').fill('Change the tone');
    await owner.getByRole('button', { name: 'Reject' }).click();
    await expect(owner.locator('.sc-status').first()).toHaveText('Rejected');
    await p.goto(`/en/app/social/posts/${second.id}`, { waitUntil: 'networkidle' });
    await expect(p.getByTestId('approval-note')).toContainText('Change the tone');
    await owner.close();
  } finally {
    await ctx.close();
  }
});

test('acceso por app: una persona sin Social no ve páginas, APIs ni búsqueda', async ({ browser, baseURL, request }) => {
  const text = `Secret social ${uid()}`;
  const fb = (await ok<{ accounts: Account[] }>(request.get('/api/social/accounts'))).accounts.find((a) => a.name === 'Fake Coffee Page')!;
  await ok(request.post('/api/social/posts', { data: { text, accountIds: [fb.id], action: 'draft' } }));
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `nosocial-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["crm"]')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);
    await p.goto('/en/app/social', { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app\?blocked=social/);
    expect(await p.content()).not.toContain(text);
    for (const path of ['/api/social/posts', '/api/social/accounts', '/api/social/inbox', '/api/social/bootstrap', '/api/social/analytics']) {
      expect((await ctx.request.get(path)).status(), path).toBe(401);
    }
    const search = (await (await ctx.request.get(`/api/search?q=${encodeURIComponent(text)}`)).json()) as { items: Array<{ href: string }> };
    expect(search.items.filter((i) => i.href.startsWith('/app/social'))).toEqual([]);
    expect((await ctx.request.post('/api/keys', { data: { name: 'nope', scopes: ['social:read'] } })).status()).toBe(403);
  } finally {
    await ctx.close();
  }
});

test('webhook de Meta: sin firma válida no entra nada', async ({ request }) => {
  const res = await request.post('/api/social/webhooks/meta', { data: { object: 'page', entry: [] }, headers: { 'x-hub-signature-256': 'sha256=00' } });
  expect(res.status()).toBe(401);
  expect((await request.get('/api/social/webhooks/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status()).toBe(403);
});
