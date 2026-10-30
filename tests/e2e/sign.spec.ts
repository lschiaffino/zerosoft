import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

/**
 * Sign de punta a punta: subir un PDF, dos firmantes en orden con sus campos,
 * enviar; el primero firma con código por email (emails capturados), recién
 * ahí le llega al segundo; un tercero con el link no firma por nadie; el PDF
 * final con las dos firmas y el certificado, y los hashes a la vista. Además
 * un rechazo con motivo y un miembro sin la app bloqueado.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function pdf(pages = 2): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Services agreement, page ${i + 1}`, { x: 60, y: 720, size: 14 });
  return Buffer.from(await doc.save());
}

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function mails(to: string): Array<{ to: string; subject: string; text: string; attachments: string[] }> {
  const file = process.env.E2E_MAIL_FILE!;
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((m) => m.to === to);
}
async function waitMail(to: string, re: RegExp): Promise<string> {
  let found = '';
  await expect
    .poll(() => {
      const m = mails(to).reverse().find((x) => re.test(x.text));
      found = m ? (re.exec(m.text)?.[1] ?? '') : '';
      return found;
    }, { timeout: 15_000 })
    .not.toBe('');
  return found;
}
const LINK = /\/(?:en|es|pt)(\/sign\/[A-Za-z0-9_-]{43})/;
const CODE = /\b(\d{6})\b/;

/** Otra persona del workspace demo (cookie zs_e2e_as) con las apps dadas. */
async function member(browser: Browser, baseURL: string, label: string, apps: string): Promise<{ ctx: BrowserContext }> {
  const email = `${label}-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  const p = await ctx.newPage();
  await p.goto('/en/app', { waitUntil: 'networkidle' });
  await p.close();
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const id = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
  await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [id]);
  await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)`, [demoTeam, id, apps]);
  await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, id]);
  return { ctx };
}

/** El destinatario abre su link, pide el código, lo ingresa, acepta y firma escribiendo su nombre. */
async function signAs(page: Page, path: string, email: string, name: string) {
  await page.goto(`/en${path}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Confirm it is you' })).toBeVisible();
  const before = mails(email).length;
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect.poll(() => mails(email).length).toBeGreaterThan(before);
  const code = CODE.exec(mails(email).at(-1)!.text)![1];
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByLabel('I agree to use electronic records and signatures for this document.').check();
  await page.getByRole('button', { name: /sign here/i }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Adopt your signature' });
  await expect(dialog.getByLabel('Your full name')).toHaveValue(name);
  await dialog.getByRole('button', { name: 'Adopt and sign' }).click();
  await expect(page.getByText('All required fields are done')).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).first().click();
}

async function apiEnvelope(request: APIRequestContext, opts: { otp: boolean; order: 'sequential' | 'parallel'; signers: Array<{ name: string; email: string }> }) {
  const created = (await (await request.post('/api/sign/envelopes', { data: { title: `Decline ${uid()}` } })).json()) as { envelope: { id: string } };
  const id = created.envelope.id;
  expect((await request.post(`/api/sign/envelopes/${id}/document`, { multipart: { file: { name: 'doc.pdf', mimeType: 'application/pdf', buffer: await pdf(1) } } })).ok()).toBe(true);
  expect((await request.patch(`/api/sign/envelopes/${id}`, { data: { otpRequired: opts.otp, signingOrder: opts.order } })).ok()).toBe(true);
  const rec = (await (await request.put(`/api/sign/envelopes/${id}/recipients`, { data: { recipients: opts.signers.map((s, i) => ({ role: 'signer', ...s, routingOrder: i + 1 })) } })).json()) as {
    envelope: { recipients: Array<{ id: string }> };
  };
  const fields = rec.envelope.recipients.map((r, i) => ({ recipientId: r.id, kind: 'signature', page: 1, x: 0.1, y: 0.7 + i * 0.1, w: 0.3, h: 0.06 }));
  expect((await request.put(`/api/sign/envelopes/${id}/fields`, { data: { fields } })).ok()).toBe(true);
  expect((await request.post(`/api/sign/envelopes/${id}/actions`, { data: { action: 'send' } })).ok()).toBe(true);
  return id;
}

test('Sign: dos firmantes en orden, código por email, certificado y hashes', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(300_000);
  const title = `Services agreement ${uid()}`;
  const a = { name: 'Ana Primera', email: `ana-${uid()}@example.com` };
  const b = { name: 'Bruno Segundo', email: `bruno-${uid()}@example.com` };

  // 1. Subir el PDF.
  await page.goto('/en/app/sign/new', { waitUntil: 'networkidle' });
  await page.getByLabel('Envelope title').fill(title);
  await page.getByLabel('PDF file').setInputFiles({ name: 'agreement.pdf', mimeType: 'application/pdf', buffer: await pdf(2) });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/en\/app\/sign\/envelopes\/env_/);
  const envId = /envelopes\/(env_[\w-]+)/.exec(page.url())![1];

  // 2. Dos firmantes en orden.
  await page.getByRole('button', { name: 'Add recipient' }).click();
  await page.locator('input[name="name-0"]').fill(a.name);
  await page.locator('input[name="email-0"]').fill(a.email);
  await page.getByRole('button', { name: 'Add recipient' }).click();
  await page.locator('input[name="name-1"]').fill(b.name);
  await page.locator('input[name="email-1"]').fill(b.email);
  await page.getByRole('button', { name: 'Next' }).click();

  // 3. Campos: una firma para cada uno, en la página 1.
  const page1 = page.locator('[data-page="1"] .sg-page-overlay');
  await expect(page1).toBeVisible();
  await page.locator('.sg-party-pick select').selectOption({ label: a.name });
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page1.click({ position: { x: 150, y: 500 } });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.locator('.sg-party-pick select').selectOption({ label: b.name });
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page1.click({ position: { x: 150, y: 600 } });
  await expect(page.getByRole('button', { name: `Signature field for ${b.name}` })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // 4. Enviar.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.badge[data-status="sent"]').first()).toBeVisible();

  // 5. Solo el primero recibe el link.
  const linkA = await waitMail(a.email, LINK);
  expect(mails(b.email)).toHaveLength(0);

  const ctxA = await browser.newContext({ baseURL });
  const pa = await ctxA.newPage();
  await signAs(pa, linkA, a.email, a.name);
  await expect(pa.getByText('Thanks, you are done')).toBeVisible();

  // 6. Recién ahora le llega al segundo.
  const linkB = await waitMail(b.email, LINK);
  const tokenB = linkB.split('/').at(-1)!;

  // 7. Un tercero con el link no firma por nadie: sin el código, ni la página ni la API.
  const stranger = await browser.newContext({ baseURL });
  const ps = await stranger.newPage();
  await ps.goto(`/en${linkB}`, { waitUntil: 'networkidle' });
  await expect(ps.getByRole('heading', { name: 'Confirm it is you' })).toBeVisible();
  await expect(ps.locator('.sg-page')).toHaveCount(0);
  const sigField = String((await sql("SELECT f.id FROM sign_fields f JOIN sign_recipients r ON r.id = f.recipient_id WHERE r.email = ? AND f.kind = 'signature'", [b.email]))[0].id);
  const forged = await stranger.request.post(`/api/sign/public/${tokenB}/submit`, { data: { action: 'sign', consent: true, values: { [sigField]: 'signed' }, signature: null } });
  expect(forged.status()).toBe(401);
  expect((await stranger.request.get(`/api/sign/public/${tokenB}/document`)).status()).toBe(401);
  // La sesión del primer firmante (su cookie) no sirve para el link del segundo.
  expect((await ctxA.request.post(`/api/sign/public/${tokenB}/submit`, { data: { action: 'sign', consent: true, values: {}, signature: null } })).status()).toBe(401);
  // Un código inventado no entra.
  expect((await stranger.request.post(`/api/sign/public/${tokenB}/otp`, { data: { action: 'verify', code: '000000' } })).status()).toBe(400);
  await stranger.close();

  // 8. El segundo firma.
  const ctxB = await browser.newContext({ baseURL });
  const pb = await ctxB.newPage();
  await signAs(pb, linkB, b.email, b.name);
  await expect(pb.getByText('Everyone signed')).toBeVisible();
  await ctxA.close();
  await ctxB.close();

  // 9. Completo: hashes a la vista y el PDF final con las dos firmas y el certificado.
  await page.goto(`/en/app/sign/envelopes/${envId}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.badge[data-status="completed"]').first()).toBeVisible();
  const original = (await page.getByTestId('hash-original').textContent())!.trim();
  const finalHash = (await page.getByTestId('hash-final').textContent())!.trim();
  expect(original).toMatch(/^[0-9a-f]{64}$/);
  expect(finalHash).toMatch(/^[0-9a-f]{64}$/);
  const res = await request.get(`/api/sign/envelopes/${envId}/document?v=final&download=1`);
  expect(res.ok()).toBe(true);
  const bytes = Buffer.from(await res.body());
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(finalHash);
  const final = await PDFDocument.load(bytes);
  expect(final.getPageCount()).toBeGreaterThanOrEqual(3);
  // Dos firmas dibujadas (más sus copias en el certificado).
  expect((bytes.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThanOrEqual(2);
  const orig = Buffer.from(await (await request.get(`/api/sign/envelopes/${envId}/document?v=original`)).body());
  expect(createHash('sha256').update(orig).digest('hex')).toBe(original);
  // Todos reciben la copia firmada.
  for (const to of [a.email, b.email]) expect(mails(to).at(-1)!.attachments[0]).toMatch(/-signed\.pdf$/);
  // Inmutable: un enviado no cambia.
  expect((await request.patch(`/api/sign/envelopes/${envId}`, { data: { title: 'changed' } })).status()).toBe(409);
});

test('Sign: rechazar con motivo', async ({ request, browser, baseURL }) => {
  const s = { name: 'Carla Rechaza', email: `carla-${uid()}@example.com` };
  const id = await apiEnvelope(request, { otp: false, order: 'parallel', signers: [s] });
  const link = await waitMail(s.email, LINK);
  const ctx = await browser.newContext({ baseURL });
  const p = await ctx.newPage();
  await p.goto(`/en${link}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Decline to sign' }).click();
  const dialog = p.getByRole('dialog', { name: 'Decline to sign?' });
  await dialog.getByLabel('Reason').fill('The start date is wrong');
  await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(p.getByText('This envelope was declined')).toBeVisible();
  await ctx.close();
  const env = (await (await request.get(`/api/sign/envelopes/${id}`)).json()) as { envelope: { status: string; recipients: Array<{ declineReason: string }> } };
  expect(env.envelope.status).toBe('declined');
  expect(env.envelope.recipients[0].declineReason).toBe('The start date is wrong');
});

test('Sign: un miembro sin la app queda afuera', async ({ browser, baseURL, request }) => {
  const noApp = await member(browser, baseURL!, 'nosign', '["crm"]');
  const created = (await (await request.post('/api/sign/envelopes', { data: { title: `Private ${uid()}` } })).json()) as { envelope: { id: string } };
  const p = await noApp.ctx.newPage();
  await p.goto('/en/app/sign', { waitUntil: 'networkidle' });
  await expect(p).toHaveURL(/\/en\/app\?blocked=sign/);
  expect((await noApp.ctx.request.get('/api/sign/envelopes')).status()).toBe(401);
  expect((await noApp.ctx.request.get(`/api/sign/envelopes/${created.envelope.id}`)).status()).toBe(401);
  expect((await noApp.ctx.request.get(`/api/sign/envelopes/${created.envelope.id}/document`)).status()).toBe(401);
  await noApp.ctx.close();
});

test('Sign: la firma pública se ve bien a 390px', async ({ request, browser, baseURL }) => {
  const s = { name: 'Dario Movil', email: `dario-${uid()}@example.com` };
  await apiEnvelope(request, { otp: false, order: 'parallel', signers: [s] });
  const link = await waitMail(s.email, LINK);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(`/en${link}`, { waitUntil: 'networkidle' });
  await expect(p.locator('.sg-page').first()).toBeVisible();
  const { scroll, inner } = await p.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner + 1);
  await ctx.close();
});
