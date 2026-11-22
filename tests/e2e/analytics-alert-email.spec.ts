import fs from 'fs';
import { expect, test } from '@playwright/test';

/**
 * Alertas de Pulse por email: se piden al crear la alerta, se apagan desde la
 * lista del insight y, al dispararse con el cron, llega el email con el link.
 */
const uid = () => Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;
const CRON = { authorization: 'Bearer e2e-cron' };

test('alerta con email: se crea, llega el email al dispararse y se apaga desde la lista', async ({ page, request, baseURL }) => {
  const { project } = (await (await request.post('/api/analytics/projects', { data: { name: `Alert mail ${uid()}` } })).json()) as { project: { id: string; publicKey: string } };
  for (const who of ['a', 'b', 'c']) {
    const res = await request.post('/api/ingest/e', {
      headers: { origin: 'http://shop.test' },
      data: { api_key: project.publicKey, event: 'signed_up', distinct_id: `${who}-${uid()}`, timestamp: new Date(Date.now() - DAY).toISOString() },
    });
    expect(res.status()).toBe(200);
  }
  const name = `Signups ${uid()}`;
  const { insight } = await (await request.post('/api/analytics/insights', { data: { projectId: project.id, name, query: { kind: 'trends', series: [{ event: 'signed_up' }], dateRange: { from: '-7d' } } } })).json();

  await page.context().addCookies([{ name: 'zs_analytics_project', value: project.id, url: baseURL! }]);
  await page.goto(`/en/app/pulse/insights/${insight.id}`, { waitUntil: 'networkidle' });
  const panel = page.getByTestId('an-alerts-panel');
  await expect(panel.getByTestId('an-alert-email-new')).toBeChecked();
  await panel.getByRole('spinbutton').fill('0');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/analytics/alerts') && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Add alert' }).click();
  const { alert } = (await (await created).json()) as { alert: { id: string; email: boolean; name: string } };
  expect(alert.email).toBe(true);
  const toggle = panel.getByTestId('an-alert-email');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toBeChecked();

  // El cron de cada hora la controla: ayer hubo 3, más que 0.
  expect((await request.get('/api/cron/tick', { headers: CRON })).ok()).toBe(true);
  const file = process.env.E2E_MAIL_FILE;
  if (file && fs.existsSync(file)) {
    const mail = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { subject: string; text: string })
      .find((m) => m.subject.includes(alert.name));
    expect(mail?.text).toContain(`/app/pulse/insights/${insight.id}`);
  }
  const fired = (await (await request.get(`/api/analytics/alerts/${alert.id}`)).json()) as { alert: { state: string } };
  expect(fired.alert.state).toBe('firing');

  // Apagar el email desde la lista no toca el resto.
  const patched = page.waitForResponse((r) => r.url().includes(`/api/analytics/alerts/${alert.id}`) && r.request().method() === 'PATCH');
  await toggle.uncheck();
  expect((await patched).ok()).toBe(true);
  await expect(toggle).not.toBeChecked();
  const after = (await (await request.get(`/api/analytics/alerts/${alert.id}`)).json()) as { alert: { email: boolean; state: string; enabled: boolean } };
  expect(after.alert).toMatchObject({ email: false, state: 'firing', enabled: true });

  // Sin email al crear: queda solo en la app.
  await panel.getByTestId('an-alert-email-new').uncheck();
  const second = page.waitForResponse((r) => r.url().endsWith('/api/analytics/alerts') && r.request().method() === 'POST');
  await panel.getByRole('spinbutton').fill('1000');
  await panel.getByRole('button', { name: 'Add alert' }).click();
  expect(((await (await second).json()) as { alert: { email: boolean } }).alert.email).toBe(false);
  await expect(panel.getByTestId('an-alert-email')).toHaveCount(2);
});
