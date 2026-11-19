import { e2eDb } from './helpers/db';
import { expect, test, type APIResponse } from '@playwright/test';

/**
 * People: quién está fuera hoy. Una licencia aprobada que cubre hoy pone
 * "fuera hasta…" en la fila del directorio y en la ficha, y el filtro
 * "fuera hoy" deja solo a esa gente. Una pendiente no cuenta.
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

async function ok<T = Record<string, unknown>>(res: Promise<APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json().catch(() => ({}))) as T;
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Una licencia ya decidida (por SQL: el flujo de pedir y aprobar lo cubre people.spec.ts). Cubre hoy en cualquier zona horaria. */
async function leave(employeeId: string, policyId: string, status: 'approved' | 'pending') {
  const ws = String((await sql('SELECT workspace_id FROM people_employees WHERE id = ?', [employeeId]))[0].workspace_id);
  const now = new Date().toISOString();
  await sql(
    `INSERT INTO people_requests (id, workspace_id, employee_id, policy_id, start_date, end_date, half, days, note, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', 3, '', ?, 'demo', ?, ?)`,
    [`req_e2e_${uid()}`, ws, employeeId, policyId, day(-1), day(3), status, now, now],
  );
}

test('quien tiene una licencia aprobada hoy sale como fuera en el directorio y su ficha', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const { policies } = await ok<{ policies: Array<{ id: string; archived: boolean }> }>(request.get('/api/people/policies'));
  const policy = policies.find((p) => !p.archived);
  expect(policy, 'una política de licencias').toBeTruthy();

  const away = `Olga Out ${uid()}`;
  const pending = `Pedro Pending ${uid()}`;
  const { employee: a } = await ok<{ employee: { id: string } }>(request.post('/api/people/employees', { data: { name: away } }));
  const { employee: p } = await ok<{ employee: { id: string } }>(request.post('/api/people/employees', { data: { name: pending } }));
  await leave(a.id, policy!.id, 'approved');
  await leave(p.id, policy!.id, 'pending');

  await page.goto('/en/app/people', { waitUntil: 'networkidle' });
  const awayRow = page.getByTestId('people-row').filter({ hasText: away });
  const pendingRow = page.getByTestId('people-row').filter({ hasText: pending });
  await expect(awayRow.getByTestId('people-out')).toBeVisible();
  await expect(pendingRow).toBeVisible();
  await expect(pendingRow.getByTestId('people-out')).toHaveCount(0);

  // El filtro deja solo a quien está fuera, y se puede sacar.
  const filter = page.getByTestId('people-out-filter');
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
  await filter.click();
  await expect(page).toHaveURL(/[?&]out=1/);
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(awayRow).toBeVisible();
  await expect(pendingRow).toHaveCount(0);
  for (const row of await page.getByTestId('people-row').all()) await expect(row.getByTestId('people-out')).toBeVisible();
  await filter.click();
  await expect(page).not.toHaveURL(/[?&]out=1/);
  await expect(pendingRow).toBeVisible();

  // La ficha lo muestra al lado del nombre.
  await page.goto(`/en/app/people/${a.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 }).getByTestId('people-out')).toBeVisible();
  await page.goto(`/en/app/people/${p.id}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(pending);
  await expect(page.getByTestId('people-out')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
