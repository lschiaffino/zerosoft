import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * Privacidad entre personas del mismo workspace: una nota es de quien la
 * escribe. Otra persona del equipo no la abre, no la encuentra con ⌘K y no la
 * ve en el inicio hasta que se la comparten; el editor dice quién la ve.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function teammate(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; email: string }> {
  const email = `priv-${uid()}@member-privacy-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  // Primer pedido: crea a la persona. Después se suma al equipo del usuario demo.
  await ctx.request.get('/api/notes');
  const db = e2eDb();
  try {
    const team = (await db.execute("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1")).rows[0]?.id;
    expect(team).toBeTruthy();
    await db.execute({ sql: "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT ?, id, 'admin' FROM users WHERE email = ?", args: [String(team), email] });
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE email = ?", args: [String(team), email] });
  } finally {
    db.close();
  }
  return { ctx, email };
}

test('una nota es de quien la escribe: un admin del equipo no la ve hasta que se la comparten', async ({ browser, page, request, baseURL }) => {
  test.setTimeout(120_000);
  // El inicio del demo crea la base y su workspace si esta suite corre sola.
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const title = `Diario ${uid()}`;
  const created = await request.post('/api/notes', { data: { title, content: [{ id: crypto.randomUUID(), type: 'paragraph', content: 'texto inventado' }] } });
  expect(created.ok()).toBeTruthy();
  const note = (await created.json()) as { id: string };

  // El editor dice que solo la ve quien la escribió.
  await page.goto(`/en/app/notes?note=${note.id}`);
  await expect(page.getByTestId('note-audience')).toHaveText('Only you');

  const { ctx, email } = await teammate(browser, baseURL!);
  try {
    // Un admin del mismo workspace: ni la nota, ni ⌘K, ni el export.
    expect((await ctx.request.get(`/api/notes/${note.id}`)).status()).toBe(404);
    const search = (await (await ctx.request.get(`/api/search?q=${encodeURIComponent(title)}`)).json()) as { items: Array<{ label: string }> };
    expect(search.items.map((i) => i.label)).not.toContain(title);
    const other = await ctx.newPage();
    await other.goto(`/en/app/notes?note=${note.id}`);
    await expect(other.getByTestId('note-access-gate')).toBeVisible();
    await expect(other.getByText(title)).toHaveCount(0);

    // Se la comparten: el editor del dueño lo dice y la otra persona la abre.
    const shares = (await (await request.get(`/api/notes/${note.id}/shares`)).json()) as { candidates: Array<{ id: string; email: string }>; audience: number };
    expect(shares.audience).toBe(0);
    const mate = shares.candidates.find((c) => c.email === email)!;
    expect((await request.patch(`/api/notes/${note.id}/shares`, { data: { personId: mate.id, role: 'view' } })).ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('note-audience')).toHaveText('Shared with 1 person');
    expect((await ctx.request.get(`/api/notes/${note.id}`)).status()).toBe(200);
  } finally {
    await ctx.close();
  }
});
