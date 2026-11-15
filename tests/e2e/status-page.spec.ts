import { expect, test, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * status.zerosoft.ai (/status): la página con datos sembrados por la API del
 * watcher (un incidente abierto en WhatsApp con una nota pública y otra
 * interna) y directo en la base (barras de 90 días y un incidente resuelto).
 * En en y es, a 390 y 1280, claro y oscuro; sin nada interno en el HTML.
 * Capturas en STATUS_SHOTS_DIR si está definido.
 */

const TOKEN = 'e2e-status-agent-token-0123456789';
const auth = { authorization: `Bearer ${TOKEN}` };
const SECRET_DETAIL = 'pg crashed: No space left on device at evo-pg.railway.internal:5432';
const INTERNAL_NOTE = 'Resizing volume vol_8f2k on project 4411 (internal only)';
const PUBLIC_NOTE = 'We found the cause and are bringing message delivery back.';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  // Dos reportes "down" del Postgres de Evolution: abre el incidente (misma lógica que el cron).
  for (let i = 0; i < 2; i++) {
    const res = await request.post('/api/status/report', { headers: auth, data: { component: 'evolution-db', status: 'down', detail: SECRET_DETAIL } });
    expect(res.status()).toBe(200);
  }
  const open = (await (await request.get('/api/status/incidents?state=open', { headers: auth })).json()) as Array<{ id: string; component: string }>;
  const inc = open.find((i) => i.component === 'evolution-db');
  expect(inc).toBeTruthy();
  for (const [text, isPublic] of [
    [INTERNAL_NOTE, false],
    [PUBLIC_NOTE, true],
  ] as const) {
    const res = await request.post(`/api/status/incidents/${inc!.id}/notes`, { headers: auth, data: { by: 'claude', text, public: isPublic } });
    expect(res.status()).toBe(201);
  }

  // Lo que el cron habría guardado: los demás componentes medidos ahora, 90 días de barras y un incidente viejo.
  const db = e2eDb();
  const now = Date.now();
  const today = Math.floor(now / 86_400_000);
  await db.execute({ sql: "UPDATE status_components SET status = 'up', checked_at = ?, severity = NULL, fail_streak = 0 WHERE id IN ('web', 'database', 'whatsapp', 'email')", args: [now] });
  for (const id of ['website', 'apps', 'whatsapp', 'email']) {
    const days = [];
    for (let d = today - 60; d <= today; d++) {
      const down = (id === 'whatsapp' && d === today) || (id === 'website' && d === today - 12) ? 14 : 0;
      const degraded = id === 'apps' && d === today - 30 ? 40 : 0;
      days.push([d, 1440 - down - degraded, degraded, down]);
    }
    await db.execute({ sql: 'INSERT INTO status_public (id, days, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET days = excluded.days', args: [id, JSON.stringify(days), now] });
  }
  const past = 'e2e-past-website';
  const started = now - 12 * 86_400_000;
  await db.execute({
    sql: `INSERT OR REPLACE INTO status_incidents (id, component, public_id, title, severity, state, is_public, started_at, last_failure_at, resolved_at, failures, last_error)
          VALUES (?, 'web', 'website', 'Website down', 'down', 'resolved', 1, ?, ?, ?, 14, 'home returned HTTP 502 from cdg1')`,
    args: [past, started, started + 13 * 60_000, started + 14 * 60_000],
  });
  await db.execute({ sql: 'DELETE FROM status_incident_notes WHERE incident_id = ?', args: [past] });
  for (const [kind, at] of [
    ['opened', started],
    ['resolved', started + 14 * 60_000],
  ] as const) {
    await db.execute({
      sql: "INSERT INTO status_incident_notes (id, incident_id, at, by, kind, text, is_public) VALUES (?, ?, ?, 'system', ?, 'home returned HTTP 502 from cdg1', 1)",
      args: [`${past}-${kind}`, past, at, kind],
    });
  }
});

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  const dir = process.env.STATUS_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

for (const locale of ['en', 'es'] as const) {
  for (const width of [390, 1280]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`/status ${locale} ${width} ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        const res = await page.goto(`/${locale}/status`, { waitUntil: 'networkidle' });
        expect(res?.status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);

        await expect(page.getByTestId('status-banner')).toHaveAttribute('data-state', 'down');
        await expect(page.getByTestId('status-component-whatsapp')).toHaveAttribute('data-state', 'down');
        for (const id of ['website', 'apps', 'email']) await expect(page.getByTestId(`status-component-${id}`)).toHaveAttribute('data-state', 'up');
        await expect(page.getByTestId('status-component-website').locator('li')).toHaveCount(90);

        const current = page.getByTestId('status-current').getByTestId('status-incident');
        await expect(current.first()).toHaveAttribute('data-severity', 'down');
        await expect(page.getByTestId('status-current')).toContainText(PUBLIC_NOTE);
        await expect(page.getByTestId('status-past').getByTestId('status-incident').first()).toHaveAttribute('data-state', 'resolved');
        // Sin chrome de marketing: solo el encabezado propio.
        await expect(page.locator('.site-header')).toHaveCount(0);

        await noHorizontalScroll(page);
        await shot(page, `status-${locale}-${width}-${scheme}`);
      });
    }
  }
}

test('el HTML público no trae nada interno', async ({ request }) => {
  for (const locale of ['en', 'es', 'pt']) {
    const html = await (await request.get(`/${locale}/status`)).text();
    for (const leak of [SECRET_DETAIL, 'railway', 'evo-pg', INTERNAL_NOTE, 'vol_8f2k', 'cdg1', 'Evolution', 'evolution-db', TOKEN, 'e2e-bridge-global-key', '127.0.0.1']) {
      expect(html, `${locale}: ${leak}`).not.toContain(leak);
    }
  }
});

test('status.localhost sirve la página de estado en la raíz', async ({ page, baseURL }) => {
  const port = new URL(baseURL!).port;
  const res = await page.goto(`http://status.localhost:${port}/es`, { waitUntil: 'networkidle' });
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('status-banner')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('la API del watcher pide el token', async ({ request }) => {
  expect((await request.get('/api/status/incidents?state=open')).status()).toBe(401);
  expect((await request.get('/api/status/incidents?state=open', { headers: { authorization: 'Bearer wrong' } })).status()).toBe(401);
  expect((await request.post('/api/status/report', { data: { component: 'evolution-db', status: 'up' } })).status()).toBe(401);
});
