import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Fleet de punta a punta: conectar GitHub y Vercel (falsos, FLEET_FAKE), crear el token del hook, eventos de Claude
 * Code / Orca que llegan por la ingesta, tarjetas que cambian en vivo, el chat con respuesta en cola que entrega el
 * Stop hook (tildes) y la fila Agentes en Inbox y Lines. Con FLEET_SHOTS=<carpeta> guarda capturas en 1280 y 390,
 * claro y oscuro, para la pasada visual.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.FLEET_SHOTS;
  if (!dir) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 860 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${dir}/${name}-${width}-${scheme}.png`, fullPage: width === 390 });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 860 });
}

let token = '';
async function ingestToken(request: APIRequestContext): Promise<string> {
  if (token) return token;
  const res = await request.post('/api/fleet/tokens', { data: { label: `e2e ${uid()}` } });
  expect(res.status()).toBe(201);
  token = ((await res.json()) as { token: string }).token;
  return token;
}

async function hook(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post('/api/fleet/ingest', { headers: { authorization: `Bearer ${await ingestToken(request)}` }, data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { session: string; status: string; output: Record<string, unknown> };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
});

test('ajustes: token del hook con el comando, y GitHub y Vercel conectados con tokens', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/en/app/fleet/settings', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('fleet-settings')).toBeVisible();

  await page.getByTestId('fleet-token-label').fill('Mac mini');
  await page.getByTestId('fleet-token-create').click();
  const command = page.getByTestId('fleet-install-command');
  await expect(command).toContainText('/api/fleet/install | sh -s -- zsf_', { timeout: 30_000 });
  await expect(page.getByTestId('fleet-token').first()).toBeVisible();

  // GitHub: un token rechazado muestra el error y no se guarda.
  await page.getByTestId('fleet-github-token').fill('fake-bad');
  await page.getByTestId('fleet-github-connect').click();
  await expect(page.getByTestId('fleet-github-error')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('fleet-github-token').fill(`fake-gh-${uid()}`);
  await page.getByTestId('fleet-github-connect').click();
  await expect(page.getByTestId('fleet-github-section').getByTestId('fleet-connection')).toHaveCount(1, { timeout: 30_000 });

  // Elegir repos: el picker lista lo que ve el token.
  await page.getByTestId('fleet-github-section').getByTestId('fleet-connection-pick').click();
  const picker = page.getByTestId('fleet-picker');
  await expect(picker.getByRole('checkbox')).toHaveCount(3, { timeout: 30_000 });
  await picker.getByRole('checkbox').nth(2).check();
  await picker.getByTestId('fleet-picker-save').click();
  await expect(picker).toHaveCount(0);

  // Vercel: revisar el token, elegir el equipo y conectar.
  await page.getByTestId('fleet-vercel-token').fill(`fake-vc-${uid()}`);
  await page.getByTestId('fleet-vercel-connect').click();
  await expect(page.getByTestId('fleet-vercel-team')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('fleet-vercel-connect').click();
  await expect(page.getByTestId('fleet-vercel-section').getByTestId('fleet-connection')).toHaveCount(1, { timeout: 30_000 });
  await shot(page, 'settings');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('tablero: las sesiones del hook aparecen como tarjetas y cambian en vivo', async ({ page, request }) => {
  const errors = watchErrors(page);
  const a = `e2e-${uid()}`;
  const b = `e2e-${uid()}`;
  await hook(request, { event: 'SessionStart', session: a, project: 'web', branch: 'agent/fix-login', orca_pane: 'pane-1', orca_worktree: 'wt-1', detail: 'startup' });
  await hook(request, { event: 'UserPromptSubmit', session: a, project: 'web', branch: 'agent/fix-login', text: `Fix the login redirect ${a}` });
  await hook(request, { event: 'UserPromptSubmit', session: b, project: 'api', branch: 'agent/rate-limit', text: `Rate limit the ingest ${b}` });
  await hook(request, { event: 'Notification', session: b, text: 'Claude needs your permission to use Bash', detail: 'permission_prompt' });

  await page.goto('/en/app/fleet', { waitUntil: 'networkidle' });
  const cardA = page.locator(`[data-testid="fleet-session-card"]`).filter({ hasText: a });
  const cardB = page.locator(`[data-testid="fleet-session-card"]`).filter({ hasText: b });
  await expect(cardA).toHaveAttribute('data-status', 'working');
  await expect(cardB).toHaveAttribute('data-status', 'waiting');
  await expect(page.getByTestId('fleet-tile-waiting')).toBeVisible();

  // Llega el Stop: la tarjeta pasa a "listo" sin recargar.
  await hook(request, { event: 'Stop', session: a, text: 'The redirect loop is fixed and the tests pass.' });
  await expect(cardA).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  await expect(cardA.getByTestId('fleet-card-unread')).toBeVisible();

  // Filtro por estado.
  await page.getByTestId('fleet-filter-status').selectOption('waiting');
  await expect(cardA).toHaveCount(0);
  await expect(cardB).toBeVisible();
  await page.getByTestId('fleet-filter-status').selectOption('all');
  await shot(page, 'now');

  await page.goto('/en/app/fleet/prs', { waitUntil: 'networkidle' });
  await shot(page, 'prs');
  await page.goto('/en/app/fleet/deploys', { waitUntil: 'networkidle' });
  await shot(page, 'deploys');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('chat: la respuesta queda en cola, el Stop hook la entrega y cambian las tildes', async ({ page, request }) => {
  const errors = watchErrors(page);
  const s = `e2e-${uid()}`;
  const first = await hook(request, { event: 'UserPromptSubmit', session: s, project: 'web', branch: 'main', text: `Build the pricing page ${s}` });
  await hook(request, {
    event: 'Stop',
    session: s,
    text: 'Built the page.\n\n- Added `PricingTable`\n- **Tests** pass\n\n```sh\nnpm test\n```',
  });
  await page.goto(`/en/app/fleet/chats/${first.session}`, { waitUntil: 'networkidle' });
  const thread = page.getByTestId('fleet-thread');
  await expect(thread.locator('[data-role="prompt"]')).toHaveCount(1);
  await expect(thread.locator('[data-role="agent"]')).toHaveCount(1);
  await expect(thread.locator('[data-role="agent"] pre')).toBeVisible();

  await page.getByTestId('fleet-composer').fill('Also add a test for the yearly toggle');
  await page.keyboard.press('Enter');
  const reply = thread.locator('[data-role="reply"]').last();
  await expect(reply).toHaveAttribute('data-status', 'pending');
  await expect(reply.getByTestId('fleet-ticks')).toHaveAttribute('data-tick', 'pending');
  await shot(page, 'chat');

  // El Stop hook del agente pregunta y recibe la respuesta.
  const stop = await hook(request, { event: 'Stop', session: s, text: 'Done.' });
  expect(stop.output).toEqual({ decision: 'block', reason: 'Also add a test for the yearly toggle' });
  await expect(reply).toHaveAttribute('data-status', 'delivered', { timeout: 15_000 });
  await expect(reply.getByTestId('fleet-ticks')).toHaveAttribute('data-tick', 'delivered');

  // El agente responde después: tildes azules.
  await hook(request, { event: 'Stop', session: s, text: 'Added the yearly toggle test.' });
  await expect(reply.getByTestId('fleet-ticks')).toHaveAttribute('data-tick', 'read', { timeout: 15_000 });

  // Renombrar desde el menú.
  await page.getByTestId('fleet-thread-menu').click();
  await page.getByTestId('fleet-rename').click();
  await page.getByTestId('fleet-rename-input').fill(`Pricing ${s}`);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fleet-thread-title')).toHaveText(`Pricing ${s}`);
  await expect(page.locator(`[data-testid="fleet-chat-row"][data-session="${first.session}"]`)).toContainText(`Pricing ${s}`);

  // 390: un panel por vez, con volver.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('fleet-composer')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox y Lines: la fila Agentes abre los chats con los agentes', async ({ page, request }) => {
  const errors = watchErrors(page);
  const s = `e2e-${uid()}`;
  const first = await hook(request, { event: 'Notification', session: s, project: 'web', text: 'Claude is waiting for your input', detail: 'permission_prompt' });
  await page.goto('/en/app/fleet/settings#link', { waitUntil: 'networkidle' });
  const inbox = page.getByTestId('fleet-mirror-inbox');
  if (!(await inbox.isChecked())) await inbox.check();
  const lines = page.getByTestId('fleet-mirror-lines');
  if (!(await lines.isChecked())) await lines.check();
  await expect
    .poll(async () => ((await (await request.get('/api/fleet/prefs')).json()) as { prefs: { mirrorInbox: boolean; mirrorLines: boolean } }).prefs)
    .toMatchObject({ mirrorInbox: true, mirrorLines: true });

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.getByTestId('fleet-agents-row');
  await expect(row).toBeVisible();
  await shot(page, 'inbox-row');
  await row.click();
  await expect(page).toHaveURL(/\/app\/inbox\/agents/);
  await page.locator(`[data-testid="fleet-chat-row"][data-session="${first.session}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/app/inbox/agents/${first.session}`), { timeout: 30_000 });
  await expect(page.getByTestId('fleet-thread')).toBeVisible();
  await shot(page, 'inbox-agents');

  await page.goto('/en/app/lines/agents', { waitUntil: 'networkidle' });
  await page.locator(`[data-testid="fleet-chat-row"][data-session="${first.session}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/app/lines/agents\\?s=${first.session}`), { timeout: 30_000 });
  await expect(page.getByTestId('fleet-composer')).toBeVisible();
  await shot(page, 'lines-agents');
  expect(errors, errors.join('\n')).toEqual([]);
});
