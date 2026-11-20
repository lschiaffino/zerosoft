import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { e2eDb } from './helpers/db';

/**
 * CRM: una tarea que salió de un chat de Lines muestra su título y sus notas solo a quien ve ese chat.
 * Dos personas del mismo workspace: el dueño (ve todas las líneas) y un miembro sin la línea del chat.
 * El miembro ve que la tarea existe (con un marcador), puede completarla, pero no lee ni busca ni exporta
 * su texto, y no puede reescribirlo. Textos inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function teammate(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; id: string }> {
  const email = `chat-task-${uid()}@crm-chat-privacy-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL }]);
  // Primer pedido: crea a la persona. Después se suma al equipo del usuario demo como miembro.
  await ctx.request.get('/api/notes');
  const db = e2eDb();
  try {
    const team = (await db.execute("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1")).rows[0]?.id;
    expect(team).toBeTruthy();
    await db.execute({ sql: "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT ?, id, 'member' FROM users WHERE email = ?", args: [String(team), email] });
    await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE email = ?", args: [String(team), email] });
    const id = String((await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] })).rows[0]?.id ?? '');
    expect(id).toBeTruthy();
    return { ctx, id };
  } finally {
    db.close();
  }
}

/** Una línea restringida (nadie más que el dueño), un chat y la tarea como salida de ese chat. */
async function linkToRestrictedChat(taskId: string): Promise<void> {
  const db = e2eDb();
  const numberId = `e2e-num-${uid()}`;
  const chatId = `e2e-chat-${uid()}`;
  try {
    await db.execute({
      sql: "INSERT INTO groups_numbers (id, user_id, name, provider, webhook_secret, visibility, owner_id) VALUES (?, 'demo', 'Private line', 'fake', ?, 'restricted', 'demo')",
      args: [numberId, uid()],
    });
    await db.execute({
      sql: "INSERT INTO groups_chats (id, user_id, number_id, provider_chat_id, kind) VALUES (?, 'demo', ?, ?, 'dm')",
      args: [chatId, numberId, `${uid()}@c.us`],
    });
    await db.execute({
      sql: "INSERT INTO groups_tasks (id, user_id, chat_id, activity_id, created_by) VALUES (?, 'demo', ?, ?, 'demo')",
      args: [taskId, chatId, taskId],
    });
  } finally {
    db.close();
  }
}

test('a task from a Lines chat: its text only for whoever sees the chat', async ({ browser, page, request, baseURL }) => {
  test.setTimeout(150_000);
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const secret = `zqx${uid()}`;
  const { ctx, id: memberId } = await teammate(browser, baseURL!);
  try {
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const created = await request.post('/api/crm/activities', {
      data: { type: 'task', subject: `Title ${secret}`, body: `Notes ${secret}`, dueAt: due, ownerId: memberId },
    });
    expect(created.ok()).toBeTruthy();
    const task = (await created.json()) as { id: string };
    await linkToRestrictedChat(task.id);

    // El dueño ve la línea: lee el texto tal cual.
    const ownerRows = (await (await request.get('/api/crm/activities?bucket=upcoming')).json()) as { rows: Array<{ id: string; subject: string; chat_private?: 1 }> };
    const ownerRow = ownerRows.rows.find((r) => r.id === task.id)!;
    expect(ownerRow.subject).toContain(secret);
    expect(ownerRow.chat_private).toBeUndefined();

    // El miembro no ve la línea: la tarea está, con el marcador y sin notas.
    const rows = (await (await ctx.request.get('/api/crm/activities?bucket=upcoming')).json()) as { rows: Array<{ id: string; subject: string; body: string; chat_private?: 1 }> };
    const row = rows.rows.find((r) => r.id === task.id)!;
    expect(row).toBeTruthy();
    expect(row.chat_private).toBe(1);
    expect(JSON.stringify(rows)).not.toContain(secret);

    const other = await ctx.newPage();
    await other.goto('/en/app/crm/tasks?bucket=upcoming');
    const listed = other.getByTestId('crm-task-row').filter({ has: other.locator(`a[href$="/app/crm/tasks/${task.id}"]`) });
    await expect(listed).toHaveAttribute('data-chat-private', 'true');
    await expect(listed.getByTestId('crm-private-chat-task')).toBeVisible();
    expect(await other.content()).not.toContain(secret);

    await other.goto(`/en/app/crm/tasks/${task.id}`);
    await expect(other.getByTestId('crm-private-chat-task').first()).toBeVisible();
    expect(await other.content()).not.toContain(secret);

    // ⌘K no la encuentra por ese texto.
    const search = (await (await ctx.request.get(`/api/search?q=${secret}`)).json()) as { items?: Array<{ id?: string; href?: string }> };
    expect(JSON.stringify(search)).not.toContain(task.id);

    // Export (si su rol exporta): sin el texto.
    const exported = await ctx.request.get('/api/crm/export?entity=activities&format=json');
    if (exported.ok()) expect(await exported.text()).not.toContain(secret);

    // No reescribe un texto que no ve; sí la completa, y la respuesta tampoco trae el texto.
    const rename = await ctx.request.patch(`/api/crm/activities/${task.id}`, { data: { subject: 'renamed' } });
    expect(rename.status()).toBe(403);
    const done = await ctx.request.patch(`/api/crm/activities/${task.id}`, { data: { done: true } });
    expect(done.ok()).toBeTruthy();
    expect(await done.text()).not.toContain(secret);
  } finally {
    await ctx.close();
  }
});
