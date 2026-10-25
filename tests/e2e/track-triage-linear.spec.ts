import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Triage como Linear, todo con el teclado: G T abre el triage del team, J/K
 * mueven y dan foco, 1 acepta sin clickear antes, 3 abre el picker de
 * duplicado con el sugerido arriba y Enter, H pospone con fechas distintas, y
 * el sidebar marca el team (Issues / Triage con su conteo).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function ok<T>(res: ReturnType<APIRequestContext['post']>): Promise<T> {
  const r = await res;
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as T;
}

async function setup(request: APIRequestContext) {
  const project = await ok<{ id: string; slug: string; name: string }>(request.post('/api/track/projects', { data: { name: `Triage L ${uid()}` } }));
  await ok(request.patch(`/api/track/projects/${project.id}`, { data: { triageEnabled: true } }));
  const key = (await ok<{ key: string }>(request.post('/api/keys', { data: { name: `tl ${uid()}` } }))).key;
  const intake = async (title: string) =>
    (
      await ok<{ data: { issue: { id: string; identifier: string } } }>(
        request.post('/api/v1/track/requests', {
          headers: { authorization: `Bearer ${key}` },
          data: { projectId: project.id, title, body: title, customer: { email: `ana${uid()}@acme.io`, name: 'Ana' }, source: 'email' },
        }),
      )
    ).data.issue;
  return { project, intake };
}

test.describe('Track: triage con teclado como Linear', () => {
  test('G T, J y 1 aceptan sin clic; el sidebar marca el team con el conteo', async ({ page, request }) => {
    const { project, intake } = await setup(request);
    await intake(`Export invoices ${uid()}`);
    await intake(`Login loop ${uid()}`);

    await page.goto(`/en/app/track/team/${project.id}`, { waitUntil: 'networkidle' });
    // Sidebar: el team abierto marca Issues (no "Teams") y muestra Triage con 2.
    await expect(page.getByTestId('track-branch-issues').first()).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('track-branch-triage').first()).toContainText('2');
    await expect(page.locator('.band-section-name')).toHaveText(project.name);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/tab=triage/);
    const items = page.getByTestId('track-triage-item');
    await expect(items).toHaveCount(2);
    await expect(page.getByTestId('track-branch-triage').first()).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('track-triage-detail')).toBeVisible();
    await shot(page, 'tl2_triage_split');

    // J pasa a la segunda y le da foco; 1 la acepta sin clickear.
    await page.keyboard.press('j');
    await expect(items.nth(1)).toBeFocused();
    const second = await items.nth(1).getAttribute('data-issue-id');
    await page.keyboard.press('1');
    await expect(items).toHaveCount(1);
    expect((await ok<{ triage: number }>(request.get(`/api/track/issues/${second}`))).triage).toBe(0);
    await expect(page.getByTestId('track-branch-triage').first()).toContainText('1');
  });

  test('3 abre el picker de duplicado con el sugerido y Enter lo marca', async ({ page, request }) => {
    const { project, intake } = await setup(request);
    const word = `zebra${uid()}`;
    const original = await ok<{ id: string; identifier: string }>(
      request.post(`/api/track/projects/${project.id}/issues`, { data: { title: `Checkout ${word} broken on Safari` } }),
    );
    const dup = await intake(`Checkout ${word} broken Safari mobile`);

    await page.goto(`/en/app/track/team/${project.id}?tab=triage`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-triage-item')).toHaveCount(1);
    await page.keyboard.press('3');
    const menu = page.getByTestId('track-triage-dup-picker-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option').first()).toContainText(original.identifier);
    await expect(menu.getByText('Suggested')).toBeVisible();
    await shot(page, 'tl2_triage_duplicate');
    await page.keyboard.press('Enter');
    await expect(page.getByText('No issues waiting for triage.')).toBeVisible();
    const after = await ok<{ status_category: string; triage: number }>(request.get(`/api/track/issues/${dup.id}`));
    expect(after.status_category).toBe('cancelled');
  });

  test('H pospone con fechas distintas y tipeo; Esc cierra', async ({ page, request }) => {
    const { project, intake } = await setup(request);
    await intake(`Snooze me ${uid()}`);
    await page.goto(`/en/app/track/team/${project.id}?tab=triage`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('track-triage-item')).toHaveCount(1);
    await page.keyboard.press('h');
    const menu = page.getByTestId('track-triage-snooze-picker-menu');
    await expect(menu).toBeVisible();
    const opts = menu.getByRole('option');
    await expect(opts).toHaveCount(3);
    const tomorrow = (await opts.nth(1).locator('.track-menu-meta').textContent()) ?? '';
    const nextWeek = (await opts.nth(2).locator('.track-menu-meta').textContent()) ?? '';
    expect(tomorrow).not.toBe('');
    expect(tomorrow.slice(0, 10)).not.toBe(nextWeek.slice(0, 10));
    // Labels enteros, sin cortar.
    await expect(opts.nth(0)).toContainText('1 hour');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('h');
    await page.keyboard.type('tomo');
    await page.keyboard.press('Enter');
    await expect(page.getByText('No issues waiting for triage.')).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`triage en dos columnas a 390px en ${scheme}`, async ({ browser, request }) => {
      const { project, intake } = await setup(request);
      await intake(`Mobile crash ${uid()}`);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto(`/en/app/track/team/${project.id}?tab=triage`, { waitUntil: 'networkidle' });
      await expect(page.getByTestId('track-triage-detail')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await shot(page, `tl2_triage_390_${scheme}`);
      await ctx.close();
    });
  }
});
