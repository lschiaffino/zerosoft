import { test } from '@playwright/test';
import { readFileSync } from 'fs';
import { PDFDocument } from 'pdf-lib';

const OUT = '/private/tmp/claude-501/-Users-lautamacmini1-AI-zerosoftware-ai/47e4112c-84db-417f-88d9-7e30941974e8/scratchpad';

test('shots', async ({ page, request, browser, baseURL, context }) => {
  test.setTimeout(120_000);
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('Services agreement', { x: 60, y: 720, size: 18 });
  const pdf = Buffer.from(await doc.save());
  const id = ((await (await request.post('/api/sign/envelopes', { data: { title: 'Shot agreement' } })).json()) as { envelope: { id: string } }).envelope.id;
  await request.post(`/api/sign/envelopes/${id}/document`, { multipart: { file: { name: 'a.pdf', mimeType: 'application/pdf', buffer: pdf } } });
  await request.patch(`/api/sign/envelopes/${id}`, { data: { otpRequired: false } });
  const rec = (await (await request.put(`/api/sign/envelopes/${id}/recipients`, { data: { recipients: [{ role: 'signer', name: 'Ana Shot', email: 'ana-shot@example.com', routingOrder: 1 }, { role: 'cc', name: 'Legal', email: 'legal@example.com', routingOrder: 2 }] } })).json()) as { envelope: { recipients: Array<{ id: string }> } };
  const r = rec.envelope.recipients[0].id;
  await request.put(`/api/sign/envelopes/${id}/fields`, { data: { fields: [
    { recipientId: r, kind: 'signature', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06 },
    { recipientId: r, kind: 'date', page: 1, x: 0.5, y: 0.82, w: 0.2, h: 0.03 },
    { recipientId: r, kind: 'text', page: 1, x: 0.1, y: 0.5, w: 0.3, h: 0.03, label: 'Job title' },
    { recipientId: r, kind: 'checkbox', page: 1, x: 0.1, y: 0.6, w: 0.035, h: 0.025 },
  ] } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/en/app/sign/envelopes/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Fields/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/shot-fields.png`, fullPage: false });
  await page.getByRole('tab', { name: /Review and send/ }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/shot-detail.png` });
  const mail = readFileSync(process.env.E2E_MAIL_FILE!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === 'ana-shot@example.com').at(-1);
  const link = /\/en\/sign\/[A-Za-z0-9_-]{43}/.exec(mail.text)![0];
  const mob = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await mob.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  const m = await mob.newPage();
  await m.goto(link, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1500);
  await m.screenshot({ path: `${OUT}/shot-sign-mobile.png`, fullPage: true });
  await mob.close();
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/en/app/sign', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/shot-list-dark-mobile.png` });
  await page.goto('/en/app/hiring/jobs', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/shot-hiring-dark-mobile.png` });
});
