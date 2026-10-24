import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * CRM integraciones (tanda C5): apps (Slack, Zoom, Stripe en modo de prueba
 * con CRM_APPS_FAKE), firma y cobro de cotizaciones, formularios en pasos con
 * condiciones y CAPTCHA (CAPTCHA_FAKE), documentos con seguimiento, videos
 * 1:1 y el log de entregas de los webhooks.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = unknown>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.status()} ${r.url()} ${await r.text().catch(() => '')}`).toBe(true);
  return (r.status() === 204 ? null : await r.json()) as T;
}

async function firstPipeline(request: APIRequestContext) {
  const pipelines = await ok<{ rows: Array<{ id: string; stages: Array<{ id: string; is_won: number }> }> }>(request.get('/api/crm/pipelines'));
  return pipelines.rows[0];
}

test('integraciones: conectar Slack, mandar prueba y desconectar con confirmación', async ({ page, request }) => {
  await request.delete('/api/crm/apps/slack').catch(() => null);
  await page.goto('/en/app/crm/settings?tab=integrations', { waitUntil: 'networkidle' });
  const card = page.getByTestId('crm-app-slack');
  await expect(card.getByText('Not connected')).toBeVisible();
  await card.getByRole('button', { name: 'Connect' }).click();
  await card.getByLabel('Incoming webhook URL').fill('https://example.com/nope');
  await card.getByRole('button', { name: 'Connect' }).click();
  await expect(card.getByRole('alert')).toContainText('hooks.slack.com');
  await card.getByLabel('Incoming webhook URL').fill('https://hooks.slack.com/services/T000/B000/e2esecret');
  await card.getByRole('button', { name: 'Connect' }).click();
  await expect(card.getByText('Connected', { exact: true })).toBeVisible();
  await expect(card).not.toContainText('e2esecret');
  await card.getByRole('button', { name: 'Send test message' }).click();
  await expect(card.getByText('Test message sent.')).toBeVisible();
  await card.getByRole('button', { name: 'Disconnect' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Disconnect' }).click();
  await expect(card.getByText('Not connected')).toBeVisible();
  // Las demás apps y la tarjeta de webhooks están.
  for (const app of ['zoom', 'stripe', 'zapier', 'make', 'webhooks']) await expect(page.getByTestId(`crm-app-${app}`)).toBeVisible();
});

test('Zoom: el botón de la reunión del timeline crea el link', async ({ page, request }) => {
  await ok(request.post('/api/crm/apps/zoom', { data: { accountId: 'acc', clientId: 'cid', clientSecret: 'sec' } }));
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Zoe', lastName: `Zoom${uid()}`, email: `zoe${uid()}@e2e.dev` } }));
  await ok(request.post('/api/crm/activities', { data: { type: 'meeting', subject: 'Kickoff call', contactId: contact.id } }));
  await page.goto(`/en/app/crm/contacts/${contact.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Zoom link' }).first().click();
  await expect(page.getByText(/Zoom: https:\/\/zoom\.us\/j\/\d+/).first()).toBeVisible();
});

test('cotización: firma dibujada, certificado y pago con Stripe marcan pagada y deal ganado', async ({ page, request }) => {
  await ok(request.post('/api/crm/apps/stripe', { data: { secretKey: 'sk_test_e2eabcdefghij' } }));
  const pipeline = await firstPipeline(request);
  const deal = await ok<{ id: string }>(
    request.post('/api/crm/deals', { data: { name: `Quote deal ${uid()}`, pipelineId: pipeline.id, stageId: pipeline.stages[0].id } }),
  );
  await ok(request.post(`/api/crm/deals/${deal.id}/line-items`, { data: { name: 'Plan Pro', unitPrice: 120, quantity: 1 } }));
  const quote = await ok<{ id: string; token: string }>(request.post('/api/crm/quotes', { data: { dealId: deal.id, recipientEmail: 'buyer@e2e.dev' } }));
  await ok(request.patch(`/api/crm/quotes/${quote.id}`, { data: { status: 'sent', collectPayment: true } }));

  await page.goto(`/en/q/${quote.token}`, { waitUntil: 'networkidle' });
  const sign = page.getByRole('button', { name: 'Sign and accept' });
  await page.getByLabel('Full name').fill('Bea Buyer');
  await page.getByRole('checkbox').check();
  await expect(sign).toBeDisabled();
  const pad = page.getByTestId('signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 30, { steps: 8 });
  await page.mouse.move(box.x + 220, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(sign).toBeEnabled();
  await sign.click();
  await expect(page.getByText('Bea Buyer').first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Signature of Bea Buyer' })).toBeVisible();

  const cert = await request.get(`/api/crm/quotes/public/${quote.token}/certificate`);
  expect(cert.headers()['content-type']).toBe('application/pdf');
  expect((await cert.body()).subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

  await page.getByRole('button', { name: /^Pay / }).click();
  await expect(page).toHaveURL(/paid=1/);
  await expect(page.getByTestId('quote-paid')).toBeVisible();
  const after = await ok<{ stage: { is_won: number } | null }>(request.get(`/api/crm/deals/${deal.id}`));
  expect(after.stage?.is_won).toBe(1);

  await page.goto(`/en/app/crm/quotes/${quote.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Paid with Stripe').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Signature certificate' })).toBeVisible();
});

test('formulario: pasos, campo condicional y CAPTCHA crean el contacto', async ({ page, request }) => {
  const form = await ok<{ id: string; token: string }>(
    request.post('/api/crm/forms', {
      data: {
        name: `Steps ${uid()}`,
        fields: [
          { id: 'email', type: 'email', label: 'Work email', property: 'email', required: true },
          { id: 'kind', type: 'select', label: 'Kind', property: '', required: true, options: ['Company', 'Personal'] },
          { id: 's2', type: 'step', label: 'About the company', property: '', required: false },
          { id: 'company', type: 'text', label: 'Company name', property: 'company.name', required: true, showIf: { field: 'kind', op: 'equals', value: 'Company' } },
          { id: 'notes', type: 'textarea', label: 'Anything else', property: '', required: false },
        ],
        settings: { captcha: true, minSubmitSeconds: 0 },
      },
    }),
  );
  await page.goto(`/en/f/${form.token}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Step 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('This field is required').first()).toBeVisible();
  const email = `steps${uid()}@e2e.dev`;
  await page.getByLabel(/Work email/).fill(email);
  await page.getByLabel(/Kind/).selectOption('Personal');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('About the company')).toBeVisible();
  await expect(page.getByLabel(/Company name/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByLabel(/Kind/).selectOption('Company');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Company name/).fill('Steps Inc');
  const submit = page.getByRole('button', { name: 'Submit' });
  await expect(submit).toBeDisabled();
  await page.getByTestId('form-captcha').getByRole('checkbox').check();
  await submit.click();
  await expect(page.getByTestId('form-success')).toBeVisible();
  const contacts = await ok<{ rows: Array<{ email: string }> }>(request.get(`/api/crm/contacts?q=${encodeURIComponent(email)}`));
  expect(contacts.rows.map((c) => c.email)).toContain(email);
});

test('documentos: subir PDF, link por contacto y la vista queda en el link', async ({ page, request }) => {
  await page.goto('/en/app/crm/documents', { waitUntil: 'networkidle' });
  const name = `Proposal ${uid()}`;
  await page.getByTestId('document-file').setInputFiles({
    name: `${name}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
  });
  await expect(page).toHaveURL(/\/app\/crm\/documents\/[\w-]+$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByTestId('document-create-link').click();
  const url = page.getByTestId('document-links').locator('code').first();
  await expect(url).toContainText('/en/view/');
  const token = (await url.textContent())!.split('/view/')[1];
  // El visor público abre sin login y cuenta la vista.
  const viewer = await page.context().newPage();
  await viewer.goto(`/en/view/${token}`, { waitUntil: 'domcontentloaded' });
  await expect(viewer.getByRole('heading', { name })).toBeVisible();
  const v = await ok<{ viewId: string }>(request.post(`/api/crm/d/${token}/track`, { data: {} }));
  await ok(request.post(`/api/crm/d/${token}/track`, { data: { viewId: v.viewId, seconds: 12, pages: { '1': 12 }, pageCount: 1 } }));
  await viewer.close();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('document-links')).toContainText('12s viewing');
});

test('videos: subir un video, página propia y reproducciones', async ({ page, request }) => {
  const title = `Intro ${uid()}`;
  const video = await ok<{ id: string; token: string }>(
    request.post('/api/crm/videos', {
      multipart: { file: { name: 'intro.webm', mimeType: 'video/webm', buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]) }, title, message: 'Hola, te cuento en 1 minuto.' },
    }),
  );
  await page.goto('/en/app/crm/videos', { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.getByTestId('video-record').click();
  await expect(page.getByRole('dialog', { name: 'Record a video' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Record a video' })).toBeHidden();

  const watch = await page.context().newPage();
  await watch.goto(`/en/watch/${video.token}`, { waitUntil: 'domcontentloaded' });
  await expect(watch.getByRole('heading', { name: title })).toBeVisible();
  await expect(watch.getByText('Hola, te cuento en 1 minuto.')).toBeVisible();
  await watch.close();
  const v = await ok<{ viewId: string }>(request.post(`/api/crm/v/${video.token}/track`, { data: { duration: 60 } }));
  await ok(request.post(`/api/crm/v/${video.token}/track`, { data: { viewId: v.viewId, watched: 30, position: 30, duration: 60 } }));
  await page.goto(`/en/app/crm/videos/${video.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('video-views')).toContainText('50% of the video');
});

test('webhooks: filtro de propiedades, log de entregas y reenviar', async ({ page, request }) => {
  const hook = await ok<{ id: string }>(
    request.post('/api/webhooks', { data: { url: 'http://127.0.0.1:9/e2e', events: ['contact.property_changed'], properties: ['city'] } }),
  );
  const contact = await ok<{ id: string }>(request.post('/api/crm/contacts', { data: { firstName: 'Hook', lastName: uid(), email: `hook${uid()}@e2e.dev` } }));
  await ok(request.patch(`/api/crm/contacts/${contact.id}`, { data: { city: 'Rosario', jobTitle: 'CEO' } }));
  await expect
    .poll(async () => (await ok<{ rows: unknown[] }>(request.get(`/api/webhooks/${hook.id}/deliveries`))).rows.length)
    .toBe(1);

  await page.goto('/en/app/settings/workspace', { waitUntil: 'networkidle' });
  await page.getByRole('group', { name: 'Contacts' }).getByRole('checkbox', { name: 'Contact property changed' }).check();
  await expect(page.getByTestId('webhook-property-filter')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'http://127.0.0.1:9/e2e' }).first();
  await expect(row).toContainText('1 property');
  await row.getByRole('button', { name: 'Log' }).click();
  const log = page.getByRole('dialog', { name: 'Deliveries' });
  await expect(log.getByTestId('webhook-deliveries').getByRole('listitem')).toHaveCount(1);
  await log.getByRole('button', { name: 'contact.property_changed' }).click();
  await expect(log.getByText('"property":"city"')).toBeVisible();
  await log.getByRole('button', { name: 'Resend' }).click();
  await expect(log.getByTestId('webhook-deliveries').getByRole('listitem')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(row.getByText('Paused')).toBeVisible();
  await ok(request.delete(`/api/webhooks/${hook.id}`));
});
