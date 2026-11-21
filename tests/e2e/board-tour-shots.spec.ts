import { mkdirSync } from 'node:fs';
import { expect, test, type Browser } from '@playwright/test';
import { e2eDb } from './helpers/db';

// TEMPORAL (QA visual del tour de Board): capturas de cada paso en e2e-results/shots. Se borra antes de mergear.

const uid = () => Math.random().toString(36).slice(2, 8);

async function run(browser: Browser, opts: { width: number; scheme: 'light' | 'dark'; look: string; mode: 'personal' | 'team' }) {
  const baseURL = test.info().project.use.baseURL as string;
  const ctx = await browser.newContext({ baseURL, viewport: { width: opts.width, height: opts.width < 500 ? 844 : 900 }, colorScheme: opts.scheme });
  const email = `shots-${uid()}@${uid()}.board-tour-shots-e2e.test`;
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  expect((await ctx.request.post('/api/onboarding', { data: { kind: 'full', mode: opts.mode, name: 'Tour', locale: 'en', apps: ['board'] } })).ok()).toBe(true);
  for (const name of ['Sprint retro', 'Product map']) expect((await ctx.request.post('/api/boards', { data: { name } })).ok()).toBe(true);
  const db = e2eDb();
  try {
    const rows = (await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] })).rows;
    await db.execute({ sql: 'UPDATE users SET ui_look = ? WHERE id = ?', args: [opts.look, String(rows[0].id)] });
  } finally {
    db.close();
  }
  await ctx.addCookies([{ name: 'zs_look', value: opts.look, url: baseURL }]);
  const p = await ctx.newPage();
  const dir = `e2e-results/shots/${opts.width}-${opts.look}-${opts.scheme}-${opts.mode}`;
  mkdirSync(dir, { recursive: true });
  try {
    await p.goto('/en/app/board', { waitUntil: 'networkidle' });
    await expect(p.getByTestId('tour')).toBeVisible({ timeout: 20_000 });
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const card = p.getByTestId('tour');
      if ((await card.count()) === 0) break;
      const id = await card.getAttribute('data-tour-step');
      await p.waitForTimeout(400);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await p.screenshot({ path: `${dir}/${String(++n).padStart(2, '0')}-${id}${overflow > 0 ? '-OVERFLOW' : ''}.png` });
      if (id === 'openBoard') {
        await p.locator('[data-tour="board-item"]').first().getByRole('link').first().click();
        await expect(card).not.toHaveAttribute('data-tour-step', 'openBoard', { timeout: 20_000 });
        continue;
      }
      await p.getByTestId('tour-next').click();
      await expect(async () => {
        const now = (await card.count()) ? await card.getAttribute('data-tour-step') : null;
        expect(now).not.toBe(id);
      }).toPass({ timeout: 15_000 });
    }
    await p.screenshot({ path: `${dir}/99-after.png` });
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
    test(`shots ${width} ${look} ${scheme}`, async ({ browser }) => {
      test.setTimeout(180_000);
      await run(browser, { width, scheme, look, mode: look === 'current' && scheme === 'dark' ? 'team' : 'personal' });
    });
  }
}
