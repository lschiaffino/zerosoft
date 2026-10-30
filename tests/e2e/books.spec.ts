import { createHmac } from 'crypto';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Books de punta a punta con los cobros en modo de prueba (BOOKS_PAYMENTS_FAKE=1):
 * cliente y factura desde la UI, enviarla, la vista pública, pagar con Stripe
 * (falso) y el webhook firmado la marca pagada y genera el asiento, el P&L lo
 * muestra, importar un extracto CSV y conciliar con la sugerencia, nota de
 * crédito, el rol "sales" no ve informes y una persona sin Books no entra.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
// Claves falsas armadas por partes: nada con forma de clave real en el repo.
const FAKE_STRIPE_KEY = ['sk', 'test', `e2e${uid()}abcdefgh`].join('_');
const FAKE_WHSEC = ['whsec', 'bookse2eabcdefgh123'].join('_');

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json()) as T;
}

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function stripeSignature(body: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

interface Doc {
  id: string;
  status: string;
  numberLabel: string;
  total: number;
  amountDue: number;
  currency: string;
  publicToken: string | null;
  journalId: string | null;
}

async function getDoc(request: APIRequestContext, id: string): Promise<Doc> {
  return (await ok<{ doc: Doc }>(request.get(`/api/books/documents/${id}`))).doc;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test('facturar, cobrar online, P&L, conciliar y nota de crédito', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  const { payments } = await ok<{ payments: { stripe: { webhookUrl: string } } }>(
    request.patch('/api/books/settings/payments', { data: { stripe: { secretKey: FAKE_STRIPE_KEY, webhookSecret: FAKE_WHSEC } } }),
  );
  const customer = `Cliente ${uid()}`;
  const email = `cliente-${uid()}@example.com`;

  // 1. Cliente desde la UI.
  await page.goto('/en/app/books/contacts', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'New contact' }).first().click();
  await page.getByLabel('Name or business name').fill(customer);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/books\/contacts\/con_[\w-]+$/);
  await page.goto('/en/app/books/contacts', { waitUntil: 'networkidle' });
  await expect(page.locator('main.app-content').getByText(customer)).toBeVisible();

  // 2. Factura desde la UI: cliente, línea, aprobar y enviar.
  const reference = `E2E ${uid()}`;
  await page.goto('/en/app/books/invoices/new', { waitUntil: 'networkidle' });
  await page.locator('label.ui-field', { hasText: 'Customer' }).locator('select').first().selectOption({ label: customer });
  await page.getByLabel('Reference').fill(reference);
  await page.getByLabel('Description').first().fill('Consulting hours');
  await page.getByLabel('Qty').first().fill('2');
  await page.getByLabel('Unit price').first().fill('150.25');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/books\/invoices\/inv_[\w-]+$/);
  const invoiceId = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Approve and send' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('To')).toHaveValue(email);
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(`Sent to ${email}`)).toBeVisible();
  let doc = await getDoc(request, invoiceId);
  // 2 × 150,25 = 300,50 más el impuesto por defecto del workspace genérico (20 %).
  expect(doc).toMatchObject({ status: 'sent', total: 36060 });
  expect(doc.numberLabel).toMatch(/^F-0001-\d{6}$/);
  expect(doc.journalId).toBeTruthy();

  // 3. Vista pública (sin sesión): noindex, total y pagar con Stripe.
  const anon = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const pub = await anon.newPage();
  const res = await pub.goto(`/en/invoice/${doc.publicToken}`, { waitUntil: 'networkidle' });
  expect(res?.status()).toBe(200);
  await expect(pub.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(pub.getByText(doc.numberLabel).first()).toBeVisible();
  await expect(pub.getByText('$360.60').first()).toBeVisible();
  await pub.getByRole('button', { name: /Pay with card/ }).click();
  await pub.waitForURL(/return=1/);
  const session = `fake_cs_${invoiceId}_${doc.amountDue}`;
  const body = JSON.stringify({
    id: `evt_${uid()}`,
    type: 'checkout.session.completed',
    data: { object: { id: session, payment_status: 'paid', currency: 'usd', amount_total: doc.amountDue, payment_intent: `pi_${uid()}`, metadata: { source: 'zerosoft_books', invoice_id: invoiceId, amount: String(doc.amountDue) } } },
  });
  const webhookPath = new URL(payments.stripe.webhookUrl).pathname;
  const hook = await ok<{ result: string }>(anon.request.post(webhookPath, { data: body, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(body, FAKE_WHSEC) } }));
  expect(hook.result).toBe('paid');
  // El mismo evento otra vez no cobra dos veces.
  const again = await ok<{ result: string }>(anon.request.post(webhookPath, { data: body, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(body, FAKE_WHSEC) } }));
  expect(again.result).toBe('duplicate');
  await pub.reload({ waitUntil: 'networkidle' });
  await expect(pub.getByText('Paid').first()).toBeVisible();
  // Revocado, el link deja de funcionar (y el PDF público tampoco sale).
  await ok(request.post(`/api/books/documents/${invoiceId}/link`, { data: { action: 'revoke' } }));
  expect((await pub.goto(`/en/invoice/${doc.publicToken}`))?.status()).toBe(404);
  expect((await anon.request.get(`/api/books/public/${doc.publicToken}/pdf`)).status()).toBe(404);
  await anon.close();

  doc = await getDoc(request, invoiceId);
  expect(doc.status).toBe('paid');
  const journals = await ok<{ journals: Array<{ sourceType: string; total: number }> }>(request.get('/api/books/journals?source=payment'));
  expect(journals.journals.some((j) => j.total === 36060)).toBe(true);
  await page.goto(`/en/app/books/invoices/${invoiceId}`, { waitUntil: 'networkidle' });
  await expect(page.locator('main.app-content').getByText('Paid').first()).toBeVisible();

  // 4. El P&L lo muestra.
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`/en/app/books/reports/pnl?from=${today.slice(0, 4)}-01-01&to=${today}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('books-net-profit')).toBeVisible();
  const pnl = await ok<{ report: { totalIncome: number } }>(request.get(`/api/books/reports?kind=pnl&from=${today.slice(0, 4)}-01-01&to=${today}`));
  expect(pnl.report.totalIncome).toBeGreaterThanOrEqual(30050);
  await expect(page.locator('main.app-content')).toContainText('Total income');

  // 5. Extracto CSV y conciliación con la sugerencia.
  const contactId = (await ok<{ contacts: Array<{ id: string; name: string }> }>(request.get(`/api/books/contacts?q=${encodeURIComponent(customer)}`))).contacts[0].id;
  const second = (await ok<{ doc: Doc }>(request.post('/api/books/documents', { data: { docType: 'invoice', contactId, issueDate: today, lines: [{ description: 'Support plan', unitPrice: 77777 }] } }))).doc;
  const issued = (await ok<{ doc: Doc }>(request.post(`/api/books/documents/${second.id}/approve`))).doc;
  const bank = (await ok<{ account: { id: string } }>(request.post('/api/books/bank-accounts', { data: { name: `E2E bank ${uid()}` } }))).account;
  await page.goto(`/en/app/books/banking/${bank.id}`, { waitUntil: 'networkidle' });
  const csv = `date,description,amount\n${today},Transfer ${customer} ${issued.numberLabel},777.77\n${today},Bank fee,-3.10\n`;
  await page.locator('input[type="file"]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/2 lines imported/)).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`Collect ${issued.numberLabel}`) }).click();
  await expect.poll(async () => (await getDoc(request, second.id)).status).toBe('paid');
  // El mismo archivo otra vez no duplica.
  await page.locator('input[type="file"]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/0 lines imported, 2 already there/)).toBeVisible();

  // 6. Nota de crédito desde una factura emitida.
  const third = (await ok<{ doc: Doc }>(request.post('/api/books/documents', { data: { docType: 'invoice', contactId, lines: [{ description: 'Hardware', unitPrice: 50000 }] } }))).doc;
  await ok(request.post(`/api/books/documents/${third.id}/approve`));
  await page.goto(`/en/app/books/invoices/${third.id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create credit note' }).click();
  await expect(page).toHaveURL(/\/books\/credit-notes\/cn_[\w-]+$/);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(async () => (await getDoc(request, third.id)).status).toBe('paid');
  const after = await getDoc(request, third.id);
  expect(after.amountDue).toBe(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

async function memberContext(browser: import('@playwright/test').Browser, baseURL: string, apps: string[]) {
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `books-member-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
  await sql('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)', [demoTeam, me, 'member', JSON.stringify(apps)]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);
  return { ctx, page: p, me };
}

test('el rol sales factura pero no ve informes ni bancos', async ({ browser, baseURL, request }) => {
  const { ctx, page, me } = await memberContext(browser, baseURL!, ['books']);
  try {
    await ok(request.put('/api/books/settings/roles', { data: { personId: me, role: 'sales' } }));
    expect((await ctx.request.get('/api/books/reports?kind=pnl')).status()).toBe(403);
    expect((await ctx.request.get('/api/books/bank-accounts')).status()).toBe(403);
    expect((await ctx.request.get('/api/books/documents?type=invoice')).status()).toBe(200);
    await page.goto('/en/app/books/reports/pnl', { waitUntil: 'networkidle' });
    await expect(page.getByText('Your Books role does not include this section')).toBeVisible();
    await page.goto('/en/app/books/invoices', { waitUntil: 'networkidle' });
    await expect(page.getByText('Your Books role does not include this section')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('una persona sin Books en el workspace no entra', async ({ browser, baseURL }) => {
  const { ctx, page } = await memberContext(browser, baseURL!, ['crm']);
  try {
    await page.goto('/en/app/books/invoices', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/en\/app\?blocked=books/);
    expect((await ctx.request.get('/api/books/documents?type=invoice')).status()).toBe(401);
    expect((await ctx.request.get('/api/books/settings')).status()).toBe(401);
  } finally {
    await ctx.close();
  }
});
