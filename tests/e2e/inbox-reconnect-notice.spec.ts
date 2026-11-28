import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Inbox: si abrir un chat falla por la red, se ve el aviso con "Reintentar"; cuando el chat vuelve a cargar solo (la
 * relectura callada de cada pocos segundos o al volver a la pestaña), el aviso se va sin tocar nada. WhatsApp falso;
 * nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

test('Inbox: el aviso de error de un chat se va cuando el chat vuelve a cargar solo', async ({ page, request }) => {
  const tag = uid();
  const acc = await linkWhatsapp(request);
  const name = `Reconnect ${tag}`;
  const p = phone();
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        { type: 'message', chatId: `${p}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: p, senderName: name, providerMessageId: `in-${tag}`, body: 'hello there', timestamp: new Date().toISOString() },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  const hit = (await (await request.get(`/api/inbox/threads?q=${encodeURIComponent(name)}`)).json()) as { threads: Array<{ id: string; title: string }> };
  const thread = hit.threads.find((t) => t.title === name);
  expect(thread).toBeTruthy();

  // Sin red para ese chat: abrirlo muestra el aviso.
  const detail = new RegExp(`/api/inbox/threads/${thread!.id}(\\?|$)`);
  await page.route(detail, (route) => (route.request().method() === 'GET' ? route.abort('internetdisconnected') : route.continue()));
  await page.goto(`/en/app/inbox?t=${encodeURIComponent(thread!.id)}`, { waitUntil: 'domcontentloaded' });
  const notice = page.locator('.ib-convo-msg[role="alert"]');
  await expect(notice).toBeVisible({ timeout: 20_000 });

  // Vuelve la red: la próxima relectura callada carga el chat y el aviso se va solo.
  await page.unroute(detail);
  const reloaded = page.waitForResponse((r) => detail.test(new URL(r.url()).pathname + new URL(r.url()).search) && r.status() < 400);
  await page.evaluate(() => window.dispatchEvent(new Event('zs:inbox-changed')));
  await reloaded;
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('wa-message').filter({ hasText: 'hello there' })).toBeVisible();
});
