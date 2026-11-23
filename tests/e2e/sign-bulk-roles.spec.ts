import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { e2eDb } from './helpers/db';

/**
 * Sign: envío masivo con todos los roles en el CSV. "Empezar una lista con
 * todos los roles" arma el encabezado, los roles que llegan del CSV dejan de
 * pedirse abajo, y cada fila sale como un sobre con sus destinatarios.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

test('Sign: envío masivo con cliente y manager desde el CSV', async ({ page, request }) => {
  test.setTimeout(180_000);
  const tag = uid();
  const created = (await (await request.post('/api/sign/templates', { data: { name: `Bulk roles ${tag}` } })).json()) as { template: { id: string } };
  const id = created.template.id;
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('Agreement', { x: 60, y: 720, size: 14 });
  expect((await request.post(`/api/sign/templates/${id}/document`, { multipart: { file: { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) } } })).ok()).toBe(true);
  const patched = await request.patch(`/api/sign/templates/${id}`, {
    data: {
      roles: [
        { key: 'client', name: 'Client', role: 'signer', order: 1 },
        { key: 'mgr', name: 'Manager', role: 'signer', order: 2 },
      ],
      fields: [
        { roleKey: 'client', kind: 'signature', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06, required: true, label: '', options: [] },
        { roleKey: 'mgr', kind: 'signature', page: 1, x: 0.6, y: 0.8, w: 0.3, h: 0.06, required: true, label: '', options: [] },
      ],
    },
  });
  expect(patched.ok()).toBe(true);

  await page.goto(`/en/app/sign/templates/${id}?tab=bulk`, { waitUntil: 'networkidle' });
  const csv = page.getByTestId('sign-bulk-csv');
  // Con name,email solo el cliente llega del CSV: el manager se pide abajo.
  await expect(page.getByTestId('sign-bulk-from-csv')).toBeVisible();
  await expect(page.locator('fieldset.sg-fieldset')).toHaveCount(1);

  await page.getByTestId('sign-bulk-all-roles').click();
  await expect(csv).toHaveValue(/^Client name,Client email,Manager name,Manager email,title\n$/);
  await expect(page.locator('fieldset.sg-fieldset')).toHaveCount(0);

  await csv.fill(
    [
      'Client name,Client email,Manager name,Manager email,title',
      `Ana,ana-${tag}@example.com,Marta,marta-${tag}@example.com,Lease ${tag} A`,
      `Bruno,bruno-${tag}@example.com,Mario,mario-${tag}@example.com,Lease ${tag} B`,
    ].join('\n'),
  );
  const sent = page.waitForResponse((r) => r.url().endsWith(`/api/sign/templates/${id}/use`) && r.request().method() === 'POST');
  await page.getByTestId('sign-bulk-send').click();
  expect((await sent).ok()).toBe(true);
  await expect(page.getByTestId('sign-bulk-result')).toBeVisible();

  const rows = await sql(
    `SELECT e.title AS title, r.role_name AS role, r.email AS email FROM sign_envelopes e JOIN sign_recipients r ON r.envelope_id = e.id
     WHERE e.template_id = ? AND e.status = 'sent' ORDER BY e.title, r.routing_order`,
    [id],
  );
  expect(rows.map((r) => [r.title, r.role, r.email])).toEqual([
    [`Lease ${tag} A`, 'Client', `ana-${tag}@example.com`],
    [`Lease ${tag} A`, 'Manager', `marta-${tag}@example.com`],
    [`Lease ${tag} B`, 'Client', `bruno-${tag}@example.com`],
    [`Lease ${tag} B`, 'Manager', `mario-${tag}@example.com`],
  ]);
});
