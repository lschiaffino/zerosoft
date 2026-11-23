// Scratch, no se commitea: capturas de la pestaña IA en los cinco aspectos, claro/oscuro, 1280/390.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';
import { ensureDetailsTab } from './helpers/details-tab';

test.describe.configure({ timeout: 1_500_000, retries: 0 });
const email = ownWorkspace('l2-shots');
const OUT = 'test-results/l2-shots';
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

function dm(from: string, tag: string) {
  const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const base = { type: 'message', chatId: `${from}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: from, senderName: `Rita ${tag}` };
  return [
    { ...base, providerMessageId: `a1-${tag}`, body: '¿Me mandás la factura de octubre?', timestamp: at(300) },
    { ...base, providerMessageId: `a2-${tag}`, body: 'Necesito también el presupuesto nuevo para la sucursal del centro, con los precios actualizados', timestamp: at(200) },
    { ...base, providerMessageId: `a3-${tag}`, body: 'La entrega vino mal, es un problema', timestamp: at(100) },
  ];
}

async function seed(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: 'Shots' } });
  const { id: numberId } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${numberId}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${numberId}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${numberId}`)).json()) as { webhookUrl: string };
  const f1 = '15550101010';
  await request.post(new URL(webhookUrl).pathname, { data: { events: dm(f1, 'L') } });
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const lines = String((await db.execute({ sql: 'SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', args: [numberId, `${f1}@s.whatsapp.net`] })).rows[0].id);
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = ?", args: [email] })).rows;
    const f2 = '15550202020';
    await request.post(`/api/inbox/webhook/${String(acc.id)}/${String(acc.webhook_secret)}`, { data: { events: dm(f2, 'I') } });
    const inbox = String((await db.execute({ sql: 'SELECT id FROM inbox_threads WHERE account_id = ? AND external_id = ?', args: [String(acc.id), `${f2}@s.whatsapp.net`] })).rows[0].id);
    return { lines, inbox };
  } finally {
    db.close();
  }
}

async function shoot(page: Page, app: 'lines' | 'inbox', url: string, name: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('.gr-msg').first()).toBeVisible({ timeout: 45_000 });
  await ensureDetailsTab(page, 'ai', () => page.locator(app === 'lines' ? '.gr-thread-head .wa-head-avatar' : '.ib-wa-thread .wa-head-who').first().click());
  const ai = page.getByTestId('chat-ai').filter({ visible: true }).first();
  await ai.getByTestId('chat-ai-suggest-asked').click();
  await expect(ai.getByTestId('chat-ai-answer')).toHaveCount(1);
  await ai.getByTestId('chat-ai-analyze').click();
  await expect(ai.getByTestId('chat-ai-proposal')).toHaveCount(2);
  const sw = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  if (sw > 1) console.log('SIDE SCROLL', name, sw);
  await page.screenshot({ path: `${OUT}/${name}-top.png` });
  await ai.getByTestId('chat-ai-proposals').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${name}-props.png` });
}

test('capturas', async ({ request, browser, baseURL }) => {
  const s = await seed(request);
  const only: readonly string[] = process.env.SHOT_LOOKS ? process.env.SHOT_LOOKS.split(',') : LOOKS;
  const problems: string[] = [];
  try {
    for (const look of LOOKS.filter((l) => only.includes(l))) {
      await request.put('/api/profile/look', { data: { look } });
      for (const theme of ['light', 'dark'] as const) {
        for (const width of [1280, 390]) {
          const ctx = await browser.newContext({ baseURL, viewport: { width, height: 844 }, storageState: { cookies: [{ name: 'zs_e2e_as', value: email, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] } });
          await ctx.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
          const page = await ctx.newPage();
          for (const app of ['lines', 'inbox'] as const) {
            const name = `${app}-${look}-${theme}-${width}`;
            try {
              await shoot(page, app, app === 'lines' ? `/en/app/lines/inbox/${s.lines}` : `/en/app/inbox?t=${s.inbox}`, name);
            } catch (e) {
              problems.push(`${name}: ${(e as Error).message.split('\n')[0]}`);
              await page.screenshot({ path: `${OUT}/${name}-ERROR.png` }).catch(() => {});
            }
          }
          await ctx.close();
        }
      }
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } });
  }
  // Scratch: falla a propósito para que CI suba test-results/ con las capturas.
  expect(problems, 'scratch shots').toEqual(['upload']);
});
