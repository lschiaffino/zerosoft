/**
 * Capturas del sitio y las apps en modo claro y oscuro (1440x900), para
 * revisar el modo oscuro a ojo.
 *
 *   BASE=http://localhost:3200 OUT=screenshots/theme node scripts/theme-screenshots.mjs [filtro]
 *
 * Las páginas de /app necesitan sesión: correr el server con DEMO_MODE=true
 * (todo request es el usuario demo, como en tests/e2e).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3200';
const OUT = process.env.OUT || 'screenshots/theme';
const FILTER = process.argv[2] || '';
const SCHEMES = (process.env.SCHEMES || 'light,dark').split(',');

const PAGES = [
  '/es',
  '/es/products',
  '/es/products/docs',
  '/es/products/crm',
  '/es/tools',
  '/es/docs',
  '/es/blog',
  '/es/changelog',
  '/es/roadmap',
  '/es/feedback-board',
  '/es/brand',
  '/es/auth/signin',
  '/es/app',
  '/es/app/links',
  '/es/app/docs',
  '/es/app/crm',
  '/es/app/crm/contacts',
  '/es/app/crm/deals',
  '/es/app/crm/reports',
  '/es/app/calendar',
  '/es/app/calendar/event-types',
  '/es/app/track',
  '/es/app/track/issues',
  '/es/app/chat',
  '/es/app/flow',
  '/es/app/agents',
  '/es/app/notes',
  '/es/app/board',
  '/es/app/robots',
  '/es/app/settings',
];

const slug = (p) => p.replace(/^\//, '').replace(/[/?=&]/g, '_') || 'root';

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const scheme of SCHEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  for (const p of PAGES.filter((x) => x.includes(FILTER))) {
    try {
      await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 60_000 });
      await page.waitForTimeout(400);
      const file = join(OUT, `${slug(p)}.${scheme}.png`);
      // El sitio se revisa entero (bandas, pie); las apps, la primera pantalla.
      await page.screenshot({ path: file, fullPage: !p.includes('/app') });
      console.log(`${slug(p)}.${scheme}.png`);
    } catch (e) {
      console.error('FAIL', p, scheme, String(e).slice(0, 200));
    }
  }
  await ctx.close();
}
await browser.close();
