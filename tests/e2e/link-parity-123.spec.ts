import { createHmac } from 'crypto';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

async function apiKey(request: APIRequestContext): Promise<string> {
  return (await (await request.post('/api/keys', { data: { name: `e2e ${uid()}` } })).json()).key as string;
}

async function newLink(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post('/api/links', { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; slug: string; short_url: string };
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('Link: conversiones de punta a punta (click id, lead, venta, analytics y eventos en vivo)', async ({ request, page }) => {
  const key = await apiKey(request);
  const slug = `conv${uid()}`;
  const link = await newLink(request, { url: 'https://shop.example.com/landing', slug, trackConversion: true, title: 'Campaña conv' });

  const visit = await request.get(`/${slug}`, { headers: { 'user-agent': BROWSER_UA }, maxRedirects: 0 });
  const location = new URL(visit.headers()['location']);
  const clickId = location.searchParams.get('zs_id')!;
  expect(clickId).toMatch(/^[A-Za-z0-9]{20}$/);

  const auth = { authorization: `Bearer ${key}` };
  const lead = await request.post('/api/v1/links/track/lead', { headers: auth, data: { clickId, customerExternalId: 'cust_1', eventName: 'Sign up' } });
  expect(lead.status(), await lead.text()).toBe(201);
  const sale = await request.post('/api/v1/links/track/sale', {
    headers: auth,
    data: { customerExternalId: 'cust_1', amount: 4900, currency: 'USD', invoiceId: `inv_${uid()}` },
  });
  expect(sale.status(), await sale.text()).toBe(201);

  await page.goto(`/en/app/links/${link.id}`, { waitUntil: 'networkidle' });
  const conv = page.getByTestId('detail-conversions');
  await expect(conv.getByTestId('detail-leads')).toHaveText('1');
  await expect(conv.getByTestId('detail-sales')).toHaveText('1');
  await expect(conv.getByTestId('detail-revenue')).toHaveText('$49.00');

  await page.goto(`/en/app/links/analytics?link=${link.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('analytics-leads')).toHaveText('1');
  await expect(page.getByTestId('analytics-revenue')).toHaveText('$49.00');
  await expect(page.getByTestId('analytics-conversions').getByRole('link', { name: new RegExp(slug) })).toBeVisible();

  // Eventos en vivo: un click nuevo aparece sin recargar.
  await page.getByRole('navigation', { name: 'Analytics views' }).getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/view=events/);
  const events = page.getByTestId('link-events');
  await expect(events.getByText('Sale', { exact: true }).first()).toBeVisible();
  await expect(events.getByText('Lead', { exact: true }).first()).toBeVisible();
  const before = await events.locator('tbody tr').count();
  await request.get(`/${slug}`, { headers: { 'user-agent': BROWSER_UA }, maxRedirects: 0 });
  await expect.poll(async () => events.locator('tbody tr').count(), { timeout: 15_000 }).toBeGreaterThan(before);
  await events.getByRole('button', { name: 'Pause' }).click();
  await expect(events.getByRole('status')).toHaveText('Paused');

  // 390 px: sin scroll horizontal en eventos.
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);
});

test('Link: protección contra phishing al crear y editar', async ({ request, page }) => {
  const bad = await request.post('/api/links', { data: { url: 'https://testsafebrowsing.appspot.com/s/phishing.html' } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toBe('unsafe_url');
  // Credenciales en la URL (truco para disfrazar el dominio).
  const disguised = await request.post('/api/links', { data: { url: 'https://paypal.com@evil.example/login' } });
  expect((await disguised.json()).error).toBe('unsafe_url');

  await page.goto('/en/app/links/new', { waitUntil: 'networkidle' });
  await page.locator('#nl-url').fill('https://testsafebrowsing.appspot.com/s/malware.html');
  await page.locator('#nl-url').press('Enter');
  await expect(page.getByText('That destination is reported as phishing or malware, or its domain is blocked.')).toBeVisible();
});

test('Link: atajos por fila, actividad del link y del workspace', async ({ request, page }) => {
  const a = await newLink(request, { url: 'https://example.com/kb-a', slug: `kba${uid()}`, title: 'Atajo A' });
  await newLink(request, { url: 'https://example.com/kb-b', slug: `kbb${uid()}`, title: 'Atajo B' });

  await page.goto('/en/app/links', { waitUntil: 'networkidle' });
  await page.locator('body').press('j');
  await expect(page.locator('.links-table tbody tr[data-active]')).toHaveCount(1);
  await page.keyboard.press('?');
  const help = page.getByTestId('links-shortcuts');
  await expect(help.getByText('Edit the link')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  // x abre la confirmación con el foco en Borrar; Esc la cierra sin borrar.
  await page.locator('.links-table tbody tr[data-active]').focus();
  await page.keyboard.press('x');
  await expect(page.locator('.links-table [data-confirm-delete]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.links-table [data-confirm-delete]')).toHaveCount(0);

  // e abre los ajustes del link activo (Esc soltó la fila: j la vuelve a tomar).
  await page.keyboard.press('j');
  await expect(page.locator('.links-table tbody tr[data-active]')).toBeFocused();
  await page.keyboard.press('e');
  await expect(page).toHaveURL(/tab=settings/);

  // Editar deja el antes y el después en la actividad.
  await request.patch(`/api/links/${a.id}`, { data: { url: 'https://example.com/kb-a-v2' } });
  await page.goto(`/en/app/links/${a.id}?tab=activity`, { waitUntil: 'networkidle' });
  const act = page.getByTestId('link-activity');
  await expect(act.getByText('Edited').first()).toBeVisible();
  await expect(act.getByText('https://example.com/kb-a-v2').first()).toBeVisible();
  await expect(act.getByText('Created').first()).toBeVisible();

  await page.goto('/en/app/links/settings?tab=activity', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('link-activity').getByRole('link', { name: `/${a.slug}` }).first()).toBeVisible();
});

test('Link: QR con marco y plantillas del workspace', async ({ request, page }) => {
  const link = await newLink(request, { url: 'https://example.com/qr-frame', slug: `qrf${uid()}` });
  await page.goto(`/en/app/links/${link.id}?tab=qr`, { waitUntil: 'networkidle' });
  await page.getByLabel('Frame', { exact: true }).selectOption('label');
  await page.getByLabel('Frame text').fill('Escaneame ya');
  await expect(page.getByTestId('qr-preview').locator('svg text')).toHaveText('Escaneame ya');
  const name = `Marca ${uid()}`;
  await page.getByLabel('Save this design as a template').fill(name);
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText(`Saved “${name}” as a template.`)).toBeVisible();

  // Otro link usa la plantilla.
  const other = await newLink(request, { url: 'https://example.com/qr-other', slug: `qro${uid()}` });
  await page.goto(`/en/app/links/${other.id}?tab=qr`, { waitUntil: 'networkidle' });
  await page.getByTestId('qr-templates').getByRole('button', { name, exact: true }).click();
  await expect(page.getByLabel('Frame', { exact: true })).toHaveValue('label');
  await page.getByRole('button', { name: `Delete template ${name}` }).click();
  await expect(page.getByTestId('qr-templates').getByRole('button', { name, exact: true })).toHaveCount(0);
});

test('Link: bio con tema, color, vista previa y un link externo', async ({ request, page }) => {
  const bio = (await (await request.get('/api/links/bio')).json()) as { handle: string };
  await page.goto('/en/app/links/bio', { waitUntil: 'networkidle' });
  await page.locator('#bio-theme').selectOption('dark');
  const preview = page.getByTestId('bio-preview');
  await expect(preview.locator('.bio-page')).toHaveAttribute('data-bio-theme', 'dark');
  const label = `Mi tienda ${uid()}`;
  await page.getByTestId('bio-add-url').fill('https://shop.example.com/bio');
  await page.getByLabel('Button text (optional)').fill(label);
  await page.getByRole('button', { name: 'Add link' }).click();
  await expect(preview.getByText(label)).toBeVisible();
  const publish = page.getByRole('switch', { name: 'Publish page' });
  if (!(await publish.isChecked())) await publish.check();
  await page.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByText('Changes saved')).toBeVisible();

  await page.goto(`/@${bio.handle}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.bio-page')).toHaveAttribute('data-bio-theme', 'dark');
  await expect(page.getByRole('link', { name: label })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/links/bio', { waitUntil: 'networkidle' });
  await noHorizontalScroll(page);
});

test('Link: integraciones (Segment, Shopify, Slack y MCP) e importar de Rebrandly', async ({ request, page }) => {
  await page.goto('/en/app/links/settings?tab=integrations', { waitUntil: 'networkidle' });
  for (const app of ['slack', 'stripe', 'zapier', 'make']) await expect(page.getByTestId(`crm-app-${app}`)).toBeVisible();
  await expect(page.getByTestId('crm-app-zoom')).toHaveCount(0);
  const segment = page.getByTestId('link-integration-segment');
  await segment.getByRole('button', { name: 'Connect' }).click();
  await segment.getByLabel('Write key').fill('abcdEFGH1234ijkl5678');
  await segment.getByRole('button', { name: 'Connect' }).click();
  await expect(segment.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByText('/api/v1/links/mcp')).toBeVisible();

  // Shopify: el webhook firmado registra la venta del click.
  await page.goto('/en/app/links/settings?tab=conversions', { waitUntil: 'networkidle' });
  await expect(page.getByText('link-tracking.js', { exact: false }).first()).toBeVisible();
  const shop = page.getByTestId('link-integration-shopify');
  await shop.getByRole('button', { name: 'Connect' }).click();
  const secret = `shpss_${uid()}${uid()}${uid()}`;
  await shop.getByLabel('Webhook signing secret').fill(secret);
  await shop.getByRole('button', { name: 'Connect' }).click();
  const hookUrl = (await shop.locator('code').innerText()).trim();
  expect(hookUrl).toContain('/api/links/shopify-webhook?token=');

  const slug = `shop${uid()}`;
  await newLink(request, { url: 'https://store.example.com/', slug, trackConversion: true });
  const visit = await request.get(`/${slug}`, { headers: { 'user-agent': BROWSER_UA }, maxRedirects: 0 });
  const clickId = new URL(visit.headers()['location']).searchParams.get('zs_id')!;
  const body = JSON.stringify({ id: Date.now(), total_price: '19.90', currency: 'USD', landing_site: `/?zs_id=${clickId}` });
  const hmac = createHmac('sha256', secret).update(body).digest('base64');
  const path = new URL(hookUrl).pathname + new URL(hookUrl).search;
  const res = await request.post(path, { headers: { 'x-shopify-hmac-sha256': hmac, 'x-shopify-topic': 'orders/paid', 'content-type': 'application/json' }, data: body });
  expect(await res.json()).toMatchObject({ outcome: 'sale' });
  const bad = await request.post(path, { headers: { 'x-shopify-hmac-sha256': 'nope', 'content-type': 'application/json' }, data: body });
  expect(bad.status()).toBe(401);

  // Importar desde Rebrandly (fake): 3 links con su back-half.
  await page.goto('/en/app/links/settings?tab=import', { waitUntil: 'networkidle' });
  await page.getByLabel('Shortener').selectOption('rebrandly');
  await expect(page.getByRole('heading', { name: 'Import from Rebrandly' })).toBeVisible();
  await page.getByLabel('Rebrandly API key').fill(`rb${uid()}${uid()}`);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported 3 links/)).toBeVisible();

  // MCP con la API key.
  const key = await apiKey(request);
  const mcp = await request.post('/api/v1/links/mcp', {
    headers: { authorization: `Bearer ${key}` },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  const tools = (await mcp.json()).result.tools.map((t: { name: string }) => t.name);
  expect(tools).toContain('create_link');
});

test('Link: preguntas a la IA sobre las analytics (fake y sin IA)', async ({ page, context }) => {
  await page.goto('/en/app/links/analytics', { waitUntil: 'networkidle' });
  const ai = page.getByTestId('link-ask-ai');
  await ai.getByLabel('Question about these analytics').fill('How many clicks did I get?');
  await ai.getByRole('button', { name: 'Ask' }).click();
  await expect(ai.getByTestId('link-ai-answer')).toContainText('clicks in this range');

  await context.addCookies([{ name: 'link_ai_fake', value: 'off', domain: 'localhost', path: '/' }]);
  await ai.getByRole('button', { name: 'Ask' }).click();
  await expect(ai.getByRole('alert')).toHaveText('AI is not set up on this workspace.');
});

test('Link: deep linking diferido y cloaking en dominio propio', async ({ request }) => {
  const slug = `app${uid()}`;
  await newLink(request, {
    url: 'https://acme.example.com/promo',
    slug,
    trackConversion: true,
  });
  const created = await request.get(`/api/links?q=${slug}`);
  const id = (await created.json()).links[0].id as string;
  await request.patch(`/api/links/${id}`, { data: { targeting: { ios: { app: 'acme://promo/42', fallback: 'https://apps.apple.com/app/id1' } } } });
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const tap = await request.get(`/${slug}`, { headers: { 'user-agent': IPHONE_UA, 'x-forwarded-for': ip }, maxRedirects: 0 });
  expect(await tap.text()).toContain('acme://promo/42');
  await expect
    .poll(async () => (await request.post('/api/v1/links/track/open', { headers: { 'x-forwarded-for': ip }, data: { platform: 'ios' } })).status(), {
      timeout: 10_000,
    })
    .toBe(200);
  // Ya se usó: la segunda apertura no coincide.
  const again = await request.post('/api/v1/links/track/open', { headers: { 'x-forwarded-for': ip }, data: { platform: 'ios' } });
  expect(again.status()).toBe(404);

  // Cloaking: solo con dominio propio verificado.
  const noDomain = await request.post('/api/links', { data: { url: 'https://example.com/c', cloak: true } });
  expect((await noDomain.json()).error).toBe('cloak_needs_domain');
  const hostname = `cl-${uid()}.example.com`;
  const domain = await (await request.post('/api/links/domains', { data: { hostname } })).json();
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  await db.execute({ sql: 'UPDATE link_domains SET verified = 1 WHERE id = ?', args: [domain.id] });
  db.close();
  const cslug = `cloak${uid()}`;
  await newLink(request, { url: 'https://example.com/cloaked', slug: cslug, domainId: domain.id, cloak: true });
  const res = await request.get(`/${cslug}`, { headers: { host: hostname, 'user-agent': BROWSER_UA }, maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect(await res.text()).toContain('<iframe src="https://example.com/cloaked"');
});
