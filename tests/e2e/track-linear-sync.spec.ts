import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Track ↔ Linear en vivo contra el workspace falso de lib/track-linear-fake.ts
 * (TRACK_LINEAR_FAKE=1 en playwright.config.ts): conectar con una API key,
 * elegir un team, el import inicial y una edición de ida y vuelta (Track →
 * Linear, y Linear → Track por el webhook firmado que manda el fake).
 *
 * Corre como otra persona (cookie zs_e2e_as, solo en CI) para no cruzarse con
 * el import de tests/e2e/track-linear-import.spec.ts.
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 });

const TOKEN = 'lin_api_fake_sync';
const WHO = 'linear-sync@e2e.zerosoft.test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: 'zs_e2e_as', value: WHO, url: baseURL! }]);
  // El primer pedido crea la persona; después se salta el onboarding de la primera vez.
  await context.request.get('/api/track/integrations/linear');
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    await db.execute({ sql: "UPDATE users SET onboarded_at = COALESCE(onboarded_at, datetime('now')) WHERE email = ?", args: [WHO] });
  } finally {
    db.close();
  }
});

async function linear<T>(request: APIRequestContext, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await request.post('/api/track/integrations/linear/fake', { data: { token: TOKEN, query, variables } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { data: T }).data;
}

async function findIssue(request: APIRequestContext, title: string) {
  const res = await request.get(`/api/track/issues?q=${encodeURIComponent(title)}&pageSize=50`);
  const rows = ((await res.json()) as { rows: Array<{ id: string; title: string; identifier: string }> }).rows;
  return rows.find((r) => r.title === title) ?? null;
}

async function openIntegrations(page: Page) {
  await page.goto('/en/app/track/settings?tab=integrations');
  await expect(page.getByTestId('track-integrations-settings')).toBeVisible({ timeout: 60_000 });
}

test('Linear: una key equivocada avisa y no queda a la vista', async ({ page }) => {
  const request = page.request;
  await request.delete('/api/track/integrations/linear');
  await openIntegrations(page);
  const section = page.getByTestId('track-linear-connect');
  await section.getByLabel('Linear API key').fill('lin_api_fake_wrong_key');
  await section.getByRole('button', { name: 'Connect with API key' }).click();
  await expect(page.getByTestId('track-linear-note')).toContainText('Linear rejected the key', { timeout: 30_000 });
  await expect(section.getByLabel('Linear API key')).toHaveAttribute('type', 'password');
});

test('Linear: conectar con API key, importar un team y editar de ida y vuelta', async ({ page }) => {
  const request = page.request;
  await openIntegrations(page);
  await page.getByTestId('track-linear-connect').getByLabel('Linear API key').fill(TOKEN);
  await page.getByRole('button', { name: 'Connect with API key' }).click();

  const settings = page.getByTestId('track-linear-settings');
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Connected to Acme as Demo User.')).toBeVisible();
  // La key no vuelve a la página.
  expect(await page.content()).not.toContain(TOKEN);

  const teams = page.getByTestId('track-linear-teams');
  await expect(teams.getByText('Engineering')).toBeVisible({ timeout: 30_000 });
  await expect(teams.getByText('Design')).toBeVisible();
  await teams.getByRole('checkbox', { name: /Engineering/ }).check();
  await expect(page.getByLabel('Direction')).toHaveValue('two_way');
  await page.getByTestId('track-linear-start').click();

  await expect(page.getByTestId('track-linear-status')).toHaveText('Sync on (Two-way).', { timeout: 150_000 });
  await expect(page.getByTestId('track-linear-meta')).toContainText('changes in Linear arrive in seconds');

  // Solo el team elegido: Engineering entra, Design no.
  await expect.poll(async () => (await findIssue(request, 'Resolve conflicts on reconnect'))?.identifier ?? null, { timeout: 30_000 }).toBe('ENG-3');
  expect(await findIssue(request, 'Offline state illustrations')).toBeNull();

  // Track → Linear.
  const eng3 = (await findIssue(request, 'Resolve conflicts on reconnect'))!;
  const patched = await request.patch(`/api/track/issues/${eng3.id}`, { data: { title: 'Resolve conflicts on reconnect (edited in Track)', priority: 'urgent' } });
  expect(patched.ok()).toBeTruthy();
  await expect
    .poll(async () => (await linear<{ issue: { title: string; priority: number } }>(request, 'query { issue(id: "i-3") { title priority } }')).issue, { timeout: 30_000 })
    .toEqual({ title: 'Resolve conflicts on reconnect (edited in Track)', priority: 1 });

  // Linear → Track: el fake manda el webhook firmado a /api/integrations/linear/webhook.
  await linear(request, 'mutation M($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }', {
    id: 'i-4',
    input: { title: 'Crash when opening a deleted issue (edited in Linear)' },
  });
  await expect.poll(async () => (await findIssue(request, 'Crash when opening a deleted issue (edited in Linear)'))?.identifier ?? null, { timeout: 30_000 }).toBe('ENG-4');
  // Lo que mandamos no vuelve: Linear sigue con el título de Track.
  expect((await linear<{ issue: { title: string } }>(request, 'query { issue(id: "i-3") { title } }')).issue.title).toBe('Resolve conflicts on reconnect (edited in Track)');

  // El registro muestra los dos sentidos.
  await openIntegrations(page);
  const log = page.getByTestId('track-linear-log');
  await expect(log).toContainText('ENG-3', { timeout: 30_000 });
  await expect(log).toContainText('ENG-4');

  // Pausar y reanudar.
  await page.getByTestId('track-linear-pause').click();
  await expect(page.getByTestId('track-linear-status')).toHaveText('Paused. Changes wait until you resume.');
  await page.getByTestId('track-linear-pause').click();
  await expect(page.getByTestId('track-linear-status')).toHaveText('Sync on (Two-way).');
});

test('Linear: se ve bien a 390 px y desconectar deja lo importado', async ({ page }) => {
  const request = page.request;
  await page.setViewportSize({ width: 390, height: 844 });
  await openIntegrations(page);
  await expect(page.getByTestId('track-linear-settings')).toBeVisible({ timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('track-linear-disconnect').click();
  await expect(page.getByTestId('track-linear-connect')).toBeVisible({ timeout: 30_000 });
  expect(await findIssue(request, 'Crash when opening a deleted issue (edited in Linear)')).not.toBeNull();
});
