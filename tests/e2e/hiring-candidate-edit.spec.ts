import { e2eDb } from './helpers/db';
import { expect, test } from '@playwright/test';

/**
 * Cargar un candidato solo con nombre desde el pipeline, ver que el perfil
 * avisa que no tiene email y agregárselo con Editar.
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

test('Hiring: alta solo con nombre y edición del perfil', async ({ page, request }) => {
  const created = (await (await request.post('/api/hiring/jobs', { data: { title: `Edit ${uid()}`, template: 'customer-support' } })).json()) as { job: { id: string } };
  const name = `Nora ${uid()}`;

  await page.goto(`/en/app/hiring/jobs/${created.job.id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('hr-add-candidate').click();
  const form = page.getByTestId('hr-add-form');
  await form.locator('input[name="name"]').fill(name);
  const [added] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/hiring/applications') && r.request().method() === 'POST'), form.locator('button[type="submit"]').click()]);
  expect(added.status()).toBe(201);
  const rows = await sql('SELECT email FROM hiring_candidates WHERE name = ?', [name]);
  expect(rows).toHaveLength(1);
  expect(String(rows[0].email)).toBe('');
  const candidateId = String((await sql('SELECT id FROM hiring_candidates WHERE name = ?', [name]))[0].id);

  await page.goto(`/en/app/hiring/candidates/${candidateId}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('hr-no-email')).toBeVisible();
  await page.getByTestId('hr-edit-open').click();
  const edit = page.getByTestId('hr-edit-candidate');
  const email = `nora-${uid()}@example.com`;
  await edit.locator('input[name="email"]').fill(email);
  await edit.locator('input[name="location"]').fill('Montevideo');
  await edit.getByTestId('hr-edit-save').click();
  await expect(page.getByTestId('hr-no-email')).toHaveCount(0);
  await expect(page.getByText(email)).toBeVisible();
  expect((await sql('SELECT email, location FROM hiring_candidates WHERE id = ?', [candidateId]))[0]).toMatchObject({ email, location: 'Montevideo' });
});
