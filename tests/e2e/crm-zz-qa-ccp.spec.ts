// Temporal: capturas para la QA visual de este PR (se borra antes del merge).
import { expect, test } from '@playwright/test';
import { e2eDb } from './helpers/db';

const uid = () => Math.random().toString(36).slice(2, 8);
const OUT = 'e2e-results/qa-ccp';

test('qa screenshots', async ({ browser, page, request, baseURL }) => {
  test.setTimeout(400_000);
  await page.goto('/en/app', { waitUntil: 'networkidle' });
  const email = `qa-${uid()}@crm-chat-privacy-e2e.io`;
  const probe = await browser.newContext({ baseURL });
  await probe.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  await probe.request.get('/api/notes');
  await probe.close();
  const db = e2eDb();
  const team = String((await db.execute("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1")).rows[0]?.id);
  await db.execute({ sql: "INSERT OR IGNORE INTO team_members (team_id, user_id, role) SELECT ?, id, 'member' FROM users WHERE email = ?", args: [team, email] });
  await db.execute({ sql: "UPDATE users SET onboarded_at = datetime('now'), active_team_id = ? WHERE email = ?", args: [team, email] });
  const memberId = String((await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email] })).rows[0]?.id);

  const contact = (await (await request.post('/api/crm/contacts', { data: { firstName: 'Ada', lastName: 'Example', ownerId: memberId } })).json()) as { id: string };
  const mk = async (subject: string, days: number) =>
    (await (
      await request.post('/api/crm/activities', {
        data: { type: 'task', subject, body: `Notes for ${subject}`, dueAt: new Date(Date.now() + days * 86_400_000).toISOString(), ownerId: memberId, contactId: contact.id },
      })
    ).json()) as { id: string };
  const secret = await mk('Call back about the private order zqxsecret', 0.2);
  await mk('Send the proposal', 0.3);
  const numberId = `qa-num-${uid()}`;
  const chatId = `qa-chat-${uid()}`;
  await db.execute({ sql: "INSERT INTO groups_numbers (id, user_id, name, provider, webhook_secret, visibility, owner_id) VALUES (?, 'demo', 'Private line', 'fake', ?, 'restricted', 'demo')", args: [numberId, uid()] });
  await db.execute({ sql: "INSERT INTO groups_chats (id, user_id, number_id, provider_chat_id, kind) VALUES (?, 'demo', ?, ?, 'dm')", args: [chatId, numberId, `${uid()}@c.us`] });
  await db.execute({ sql: "INSERT INTO groups_tasks (id, user_id, chat_id, activity_id, created_by) VALUES (?, 'demo', ?, ?, 'demo')", args: [secret.id, chatId, secret.id] });
  db.close();

  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390]) {
      const ctx = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
      await ctx.addCookies([
        { name: 'zs_e2e_as', value: email, url: baseURL! },
        { name: 'zs_theme', value: theme, url: baseURL! },
      ]);
      const p = await ctx.newPage();
      const shots: Array<[string, string]> = [
        ['tasks', '/en/app/crm/tasks?bucket=today'],
        ['detail', `/en/app/crm/tasks/${secret.id}`],
        ['contact', `/en/app/crm/contacts/${contact.id}`],
        ['overview', '/en/app/crm'],
        ['queue', '/en/app/crm/tasks/queue'],
      ];
      for (const [name, url] of shots) {
        await p.goto(url, { waitUntil: 'networkidle' });
        const html = await p.content();
        console.log(`${theme} ${width} ${name}: leak=${html.includes('zqxsecret')} marker=${await p.getByTestId('crm-private-chat-task').count()} hscroll=${await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)}`);
        await p.screenshot({ path: `${OUT}/${theme}-${width}-${name}.png`, fullPage: false });
      }
      await ctx.close();
    }
  }
  // El dueño (ve la línea): el texto tal cual.
  await page.goto('/en/app/crm/tasks?bucket=today', { waitUntil: 'networkidle' });
  console.log(`owner sees text: ${(await page.content()).includes('zqxsecret')}`);
  await page.screenshot({ path: `${OUT}/owner-tasks.png` });
  expect(true).toBe(true);
});
