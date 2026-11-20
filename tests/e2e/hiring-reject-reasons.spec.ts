import { e2eDb } from './helpers/db';
import { expect, test } from '@playwright/test';

/**
 * Motivos de rechazo propios: un admin suma uno en Ajustes y pide motivo; al
 * rechazar desde el perfil, la lista ofrece el nuevo y sin motivo el servidor
 * no deja. Al terminar vuelve a los de fábrica (la base es compartida).
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

test('Hiring: motivos de rechazo propios y obligatorios', async ({ page, request }) => {
  const reason = `Visa ${uid()}`;
  try {
    const created = (await (await request.post('/api/hiring/jobs', { data: { title: `Reasons ${uid()}`, template: 'customer-support' } })).json()) as { job: { id: string } };
    const added = await request.post('/api/hiring/applications', { data: { jobId: created.job.id, name: `Rita ${uid()}`, email: `rita-${uid()}@example.com` } });
    expect(added.status(), await added.text()).toBe(201);
    const { candidateId, applicationId } = (await added.json()) as { candidateId: string; applicationId: string };

    // Ajustes: sumar un motivo con Enter y pedir motivo.
    await page.goto('/en/app/hiring/settings', { waitUntil: 'networkidle' });
    const section = page.getByTestId('hiring-reject-reasons-settings');
    await section.getByTestId('hr-reason-new').fill(reason);
    await section.getByTestId('hr-reason-new').press('Enter');
    await section.getByTestId('hr-reason-required').check();
    await page.getByTestId('hiring-settings-save').click();
    await expect.poll(async () => (await sql('SELECT require_reject_reason FROM hiring_settings WHERE reject_reasons LIKE ?', [`%${reason}%`])).length).toBe(1);

    // Sin motivo, el servidor no rechaza.
    const bare = await request.patch(`/api/hiring/applications/${applicationId}`, { data: { action: 'reject', reason: '' } });
    expect(bare.status()).toBe(400);
    expect(((await bare.json()) as { error: string }).error).toBe('reason_required');

    // Desde el perfil: el motivo nuevo está en la lista.
    await page.goto(`/en/app/hiring/candidates/${candidateId}?app=${applicationId}`, { waitUntil: 'networkidle' });
    await page.getByTestId('hr-reject-open').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('hr-reject-reason').selectOption(reason);
    await dialog.getByTestId('hr-reject-submit').click();
    await expect.poll(async () => (await sql('SELECT status, reject_reason FROM hiring_applications WHERE id = ?', [applicationId]))[0]).toMatchObject({ status: 'rejected', reject_reason: reason });
  } finally {
    expect((await request.put('/api/hiring/settings', { data: { rejectReasons: null, requireRejectReason: false } })).ok()).toBe(true);
  }
});
