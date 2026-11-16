import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Social: respuestas guardadas de la bandeja (biblioteca, tipo "reply").
 * Se crea una en la biblioteca, se inserta en un comentario con {name} y
 * {account} completos, se manda, y se guarda otra desde la misma bandeja.
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

async function facebookPage(request: APIRequestContext): Promise<{ id: string; name: string; workspaceId: string }> {
  const res = await request.post('/api/social/connect', { data: { network: 'facebook' } });
  expect(res.ok()).toBe(true);
  await request.get(((await res.json()) as { url: string }).url);
  const { accounts } = (await (await request.get('/api/social/accounts')).json()) as { accounts: Array<{ id: string; name: string; network: string }> };
  const page = accounts.find((a) => a.network === 'facebook' && a.name === 'Fake Coffee Page')!;
  const [row] = await sql('SELECT workspace_id FROM social_accounts WHERE id = ?', [page.id]);
  return { id: page.id, name: page.name, workspaceId: String(row.workspace_id) };
}

test('respuestas guardadas: crear en la biblioteca, insertar con variables, mandar y guardar desde la bandeja', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });

  const account = await facebookPage(request);
  const itemId = `e2e-inbox-${uid()}`;
  const author = `Ana${uid()} Pérez`;
  const now = new Date().toISOString();
  await sql(
    `INSERT INTO social_inbox (id, workspace_id, account_id, kind, external_id, author_name, text, received_at, status, created_at)
     VALUES (?, ?, ?, 'comment', ?, ?, 'Do you ship to Uruguay?', ?, 'open', ?)`,
    [itemId, account.workspaceId, account.id, itemId, author, now, now],
  );

  // 1. Una respuesta guardada desde la biblioteca.
  const name = `Shipping ${uid()}`;
  await page.goto('/en/app/social/library?kind=reply', { waitUntil: 'networkidle' });
  await page.getByTestId('library-kind').selectOption('reply');
  await page.getByTestId('library-name').fill(name);
  await page.getByTestId('library-body').fill('Hi {name}, thanks for writing to {account}. We ship everywhere.');
  await page.getByTestId('library-save').click();
  await expect(page.getByTestId('library-list')).toContainText(name);

  // 2. En la bandeja se inserta con el nombre de pila y la cuenta completos.
  await page.goto(`/en/app/social/inbox?item=${itemId}`, { waitUntil: 'networkidle' });
  const detail = page.getByTestId('inbox-detail');
  await expect(detail).toContainText(author);
  await detail.getByTestId('inbox-saved-replies').selectOption({ label: name });
  const box = detail.getByTestId('inbox-reply-text');
  await expect(box).toHaveValue(`Hi ${author.split(' ')[0]}, thanks for writing to ${account.name}. We ship everywhere.`);
  await expect(box).toBeFocused();
  await box.press('ControlOrMeta+Enter');
  await expect(detail.getByTestId('inbox-reply')).toContainText(`Hi ${author.split(' ')[0]}`);
  await expect(box).toHaveValue('');

  // 3. Lo escrito a mano se guarda como respuesta (Enter confirma, Esc cancela).
  const second = `Thanks ${uid()}`;
  await box.fill('Thanks for the kind words!');
  await detail.getByTestId('inbox-save-reply').click();
  const nameInput = detail.getByTestId('inbox-save-reply-name');
  await expect(nameInput).toBeFocused();
  await nameInput.press('Escape');
  await expect(detail.getByTestId('inbox-save-reply-form')).toHaveCount(0);
  await detail.getByTestId('inbox-save-reply').click();
  await nameInput.fill(second);
  await nameInput.press('Enter');
  await expect(detail.getByTestId('inbox-save-reply-form')).toHaveCount(0);
  // Enter en el nombre guarda la respuesta; no manda el comentario.
  await expect(box).toHaveValue('Thanks for the kind words!');
  await expect(detail.getByTestId('inbox-reply')).toHaveCount(1);
  await expect(detail.getByTestId('inbox-saved-replies').locator('option', { hasText: second })).toHaveCount(1);
  const saved = await sql("SELECT body FROM social_library WHERE workspace_id = ? AND kind = 'reply' AND name = ?", [account.workspaceId, second]);
  expect(saved.map((r) => r.body)).toEqual(['Thanks for the kind words!']);

  // 4. El compositor no las ofrece (son de la bandeja).
  await page.goto('/en/app/social/posts/new', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('compose-text')).toBeVisible();
  await expect(page.locator('option', { hasText: name })).toHaveCount(0);
  expect(errors).toEqual([]);
});
