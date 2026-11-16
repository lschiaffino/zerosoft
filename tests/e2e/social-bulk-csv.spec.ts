import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Social: programación masiva desde un CSV. Se elige la cuenta, se carga el
 * archivo, la vista previa marca la fila con problemas y se programan las
 * demás; quedan como publicaciones programadas para esa cuenta.
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

async function facebookPage(request: APIRequestContext) {
  const res = await request.post('/api/social/connect', { data: { network: 'facebook' } });
  expect(res.ok()).toBe(true);
  await request.get(((await res.json()) as { url: string }).url);
  const { accounts } = (await (await request.get('/api/social/accounts')).json()) as { accounts: Array<{ id: string; name: string; network: string }> };
  return accounts.find((a) => a.network === 'facebook' && a.name === 'Fake Coffee Page')!;
}

test('importar un CSV: vista previa con la fila mala marcada y programar las demás', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  const account = await facebookPage(request);
  const tag = uid();
  // Fechas fijas lejos del presente (2031 en el futuro, 2020 en el pasado): no dependen del día de la corrida.
  const csv = ['date,time,text,link', `2031-03-10,09:30,"Bulk one ${tag}, with a comma",https://example.com/a`, `2031-03-11,18:00,Bulk two ${tag},`, `2020-01-01,10:00,Bulk old ${tag},`].join('\n');

  await page.goto('/en/app/social/posts', { waitUntil: 'networkidle' });
  await page.getByTestId('posts-import').click();
  await expect(page).toHaveURL(/\/en\/app\/social\/posts\/import$/);
  await page.getByTestId('bulk-accounts').getByRole('button', { name: new RegExp(account.name) }).click();
  await page.getByTestId('bulk-file').setInputFiles({ name: 'posts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  const rows = page.getByTestId('bulk-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-ok', 'true');
  await expect(rows.nth(0)).toContainText('https://example.com/a');
  await expect(rows.nth(1)).toHaveAttribute('data-ok', 'true');
  await expect(rows.nth(2)).toHaveAttribute('data-ok', 'false');

  await page.getByTestId('bulk-submit').click();
  await expect(page.getByTestId('bulk-done')).toBeVisible();

  const posts = await sql(
    `SELECT p.text, p.status, p.scheduled_at FROM social_posts p JOIN social_post_targets t ON t.post_id = p.id
     WHERE t.account_id = ? AND p.text LIKE ? ORDER BY p.scheduled_at`,
    [account.id, `%${tag}%`],
  );
  expect(posts.map((p) => [p.text, p.status])).toEqual([
    [`Bulk one ${tag}, with a comma\n\nhttps://example.com/a`, 'scheduled'],
    [`Bulk two ${tag}`, 'scheduled'],
  ]);
  expect(String(posts[0].scheduled_at).slice(0, 4)).toBe('2031');

  // Pegar filas con punto y coma también se lee; como borradores, una fecha vieja no impide guardarla.
  await page.getByTestId('bulk-again').click();
  await page.getByTestId('bulk-action').selectOption('draft');
  await expect(page.getByTestId('bulk-needs-media')).toHaveCount(0);
  await page.getByTestId('bulk-csv').fill(`fecha;hora;texto\n2020-05-01;10:00;"Draft ${tag}; with semicolon"`);
  await expect(page.getByTestId('bulk-row')).toHaveCount(1);
  await expect(page.getByTestId('bulk-row').first()).toHaveAttribute('data-ok', 'true');
  await page.getByTestId('bulk-submit').click();
  await expect(page.getByTestId('bulk-done')).toBeVisible();
  const drafts = await sql(`SELECT text, status FROM social_posts WHERE text LIKE ?`, [`Draft ${tag}%`]);
  expect(drafts.map((d) => [d.text, d.status])).toEqual([[`Draft ${tag}; with semicolon`, 'draft']]);
  expect(errors).toEqual([]);
});
