import { readFileSync } from 'fs';
import path from 'path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

/**
 * Extensión de Chrome para Gmail (extensions/chrome) cargada de verdad en
 * Chromium, contra un Gmail simulado (tests/e2e/fixtures/gmail.html servido
 * en https://mail.google.com por route) y la app del e2e. El token es una API
 * key personal del usuario demo.
 */

const EXT = path.join(process.cwd(), 'extensions', 'chrome');
const FIXTURE = readFileSync(path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'gmail.html'), 'utf8');

test.describe.configure({ mode: 'serial' });

test('settings: la extensión se descarga como zip con instrucciones', async ({ page, request }) => {
  await page.goto('/en/app/crm/settings?tab=integrations');
  const section = page.locator('#chrome-extension');
  await expect(page.getByRole('heading', { name: 'Chrome extension for Gmail' })).toBeVisible();
  await expect(section.getByRole('link', { name: 'Download extension (.zip)' })).toHaveAttribute('href', '/api/crm/extension/download');
  await expect(section).toContainText('chrome://extensions');

  const res = await request.get('/api/crm/extension/download');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/zip');
  const body = await res.body();
  expect(body.subarray(0, 2).toString()).toBe('PK');
  expect(body.includes(Buffer.from('zerosoft-crm/manifest.json'))).toBe(true);
  expect(body.includes(Buffer.from('zerosoft-crm/_locales/es/messages.json'))).toBe(true);

  // 390 px sin scroll horizontal.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await expect(section).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Gmail: panel del remitente, crear contacto, registrar y trackear', async ({ request, baseURL }) => {
  test.setTimeout(120_000);
  const key = (await (await request.post('/api/keys', { data: { name: 'gmail-extension' } })).json()).key as string;
  expect(key).toMatch(/^zs_/);
  const auth = { authorization: `Bearer ${key}` };

  const run = Math.random().toString(36).slice(2, 8);
  const tpl = await request.post('/api/crm/email-templates', {
    data: { name: `Follow-up ${run}`, subject: 'Follow-up', body: 'Hi {{contact.first_name}}, here is the proposal.' },
  });
  expect(tpl.ok()).toBe(true);
  const sender = `carla.${run}@cliente-${run}.com`;
  const subject = `Propuesta ${run}`;
  const replySubject = `Re: Propuesta ${run}`;
  const html = FIXTURE.replaceAll('{{SENDER}}', sender)
    .replaceAll('{{SUBJECT}}', subject)
    .replaceAll('{{REPLY_SUBJECT}}', replySubject)
    .replaceAll('{{MESSAGE_ID}}', `18c${run}a1b2c3d4e`.slice(0, 16))
    .replaceAll('{{THREAD_ID}}', `18c${run}f0f0f0f0`.slice(0, 16));

  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=en-US'],
    });
    await context.route('https://mail.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
    );
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = sw.url().split('/')[2];

    // Opciones: URL de la app + token.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByLabel('App URL').fill(baseURL!);
    await options.getByLabel('Personal API token').fill(key);
    await options.getByRole('button', { name: 'Save and connect' }).click();
    await expect(options.getByRole('status')).toContainText('Connected as demo@zerosoft.ai');

    const gmail = await context.newPage();
    await gmail.goto('https://mail.google.com/mail/u/0/#inbox/abc');
    const panel = gmail.locator('#zs-crm');
    await expect(panel).toBeVisible();

    // No está en el CRM: se crea con el nombre del remitente.
    await expect(panel).toContainText('This person is not in your CRM yet.');
    await expect(panel.getByLabel('First name')).toHaveValue('Carla');
    await expect(panel.getByLabel('Last name')).toHaveValue('Gómez');
    await panel.getByRole('button', { name: 'Create contact' }).click();
    await expect(panel.getByRole('link', { name: 'Carla Gómez' })).toBeVisible();
    await expect(panel).toContainText('No deals yet.');

    // Tarea desde el panel (Esc cancela, Enter guarda).
    await panel.getByRole('button', { name: 'Add task' }).click();
    await panel.getByLabel('Task', { exact: true }).press('Escape');
    await expect(panel.getByLabel('Task', { exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Add task' }).click();
    await panel.getByLabel('Task', { exact: true }).fill(`Mandar propuesta ${run}`);
    await panel.getByLabel('Task', { exact: true }).press('Enter');
    await expect(panel.getByText(`Mandar propuesta ${run}`)).toBeVisible();

    // Registrar el email abierto (dos veces: no duplica).
    await panel.getByRole('button', { name: 'Log email in CRM' }).click();
    await expect(panel).toContainText('Logged in the contact timeline.');
    await panel.getByRole('button', { name: 'Log email in CRM' }).click();
    await expect(panel).toContainText('This email was already logged.');

    // Template del CRM desde la redacción, con las variables del destinatario.
    const picker = gmail.getByLabel('Insert template');
    await picker.focus();
    await expect(picker.locator('option', { hasText: `Follow-up ${run}` })).toHaveCount(1);
    await picker.selectOption({ label: `Follow-up ${run}` });
    await expect(gmail.getByRole('textbox', { name: 'Message Body' })).toContainText('Hi Carla, here is the proposal.');

    // Redacción con "Log and track": el pixel entra en el cuerpo antes de enviar.
    const track = gmail.getByLabel('Log and track');
    await expect(track).toBeChecked();
    await gmail.locator('.aoO').click();
    const sent = gmail.locator('#sent[data-sent="1"]');
    await expect(sent).toHaveCount(1);
    const pixel = sent.locator('img[data-zs-pixel]');
    await expect(pixel).toHaveAttribute('src', /\/api\/crm\/t\/o\/[a-f0-9]{32}\.gif$/);

    // En la app: el contacto tiene el email registrado y el enviado con tracking.
    const side = await (await request.get(`/api/v1/crm/extension/sidebar?email=${encodeURIComponent(sender)}`, { headers: auth })).json();
    expect(side.contact.name).toBe('Carla Gómez');
    expect(side.emailsLogged).toBe(2);
    expect(side.tasks.map((t: { subject: string }) => t.subject)).toContain(`Mandar propuesta ${run}`);

    const app = await context.newPage();
    await app.goto(`${baseURL}/en${side.contact.url}`);
    await expect(app.getByText(subject, { exact: false }).first()).toBeVisible();
    await expect(app.getByText('Hi Carla, here is the proposal.', { exact: false }).first()).toBeVisible();
  } finally {
    await context?.close();
  }
});

test('API de la extensión: token requerido y email válido', async ({ request }) => {
  expect((await request.get('/api/v1/crm/extension/sidebar?email=a@b.com')).status()).toBe(401);
  const key = (await (await request.post('/api/keys', { data: { name: 'ext-ro', scopes: ['crm:read'] } })).json()).key as string;
  const auth = { authorization: `Bearer ${key}` };
  expect((await request.get('/api/v1/crm/extension/sidebar?email=nope', { headers: auth })).status()).toBe(400);
  const none = await request.get('/api/v1/crm/extension/sidebar?email=nadie-existe@x.com', { headers: auth });
  expect(none.status()).toBe(200);
  expect((await none.json()).contact).toBeNull();
  // Solo lectura: no puede registrar.
  const log = await request.post('/api/v1/crm/extension/log-email', {
    headers: auth,
    data: { messageId: 'abcabcabcabcabca', from: 'x@y.com' },
  });
  expect(log.status()).toBe(403);
});
