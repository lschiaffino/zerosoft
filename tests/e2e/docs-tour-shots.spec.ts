import { mkdirSync } from 'node:fs';
import { expect, test, type Browser } from '@playwright/test';
import { e2eDb } from './helpers/db';

// TEMPORAL (QA visual del árbol de páginas en el tour de Docs): capturas en e2e-results/shots. Se borra antes de mergear.

const uid = () => Math.random().toString(36).slice(2, 8);

async function run(browser: Browser, opts: { width: number; scheme: 'light' | 'dark'; look: string; pages: number }) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: opts.width, height: opts.width < 500 ? 844 : 900 }, colorScheme: opts.scheme });
  const email = `shots-${uid()}@${uid()}.docs-tour-shots-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  expect((await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: 'Tour', locale: 'en', apps: ['docs'] } })).ok()).toBe(true);
  for (const title of ['Roadmap', 'Meeting notes', 'Onboarding guide'].slice(0, opts.pages)) {
    expect((await ctx.request.post('/api/docs/pages', { data: { title } })).ok()).toBe(true);
  }
  const db = e2eDb();
  try {
    const rows = (await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] })).rows;
    await db.execute({ sql: 'UPDATE users SET ui_look = ? WHERE id = ?', args: [opts.look, String(rows[0].id)] });
  } finally {
    db.close();
  }
  await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  const p = await ctx.newPage();
  const dir = `e2e-results/shots/docs-${opts.width}-${opts.look}-${opts.scheme}-${opts.pages}p`;
  mkdirSync(dir, { recursive: true });
  try {
    await p.goto('/en/app/docs', { waitUntil: 'networkidle' });
    const card = p.getByTestId('tour');
    await expect(card).toBeVisible({ timeout: 20_000 });
    for (let i = 0; i < 6; i++) {
      const id = await card.getAttribute('data-tour-step');
      if (id === 'pages' || id === 'search') {
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${dir}/${id}.png` });
      }
      if (id === 'search' || id === 'openPage') break;
      await p.getByTestId('tour-next').click();
      await expect(card).not.toHaveAttribute('data-tour-step', id ?? '', { timeout: 15_000 });
    }
  } finally {
    await ctx.close();
  }
}

for (const width of [1280, 390]) {
  for (const [look, scheme] of [
    ['current', 'light'],
    ['current', 'dark'],
    ['lines', 'dark'],
    ['classic', 'light'],
    ['liquid', 'dark'],
    ['retro', 'light'],
  ] as const) {
    test(`shots docs ${width} ${look} ${scheme}`, async ({ browser }) => {
      test.setTimeout(120_000);
      await run(browser, { width, scheme, look, pages: 3 });
    });
  }
}

test('shots docs 1280 sin páginas', async ({ browser }) => {
  test.setTimeout(120_000);
  await run(browser, { width: 1280, scheme: 'light', look: 'current', pages: 0 });
});
