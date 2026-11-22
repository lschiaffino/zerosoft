import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Lines: un grupo que llega sin asunto (historial, gateway que no lo manda)
 * nunca muestra su id "@g.us" en la lista: el asunto se pide a WhatsApp al
 * llegar el mensaje, como Inbox. 1280 y 390. Números y nombres inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function fakeLine(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Asunto ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return new URL(webhookUrl).pathname;
}

test('Lines: un grupo sin asunto muestra su nombre, nunca el id', async ({ page, request }) => {
  const hook = await fakeLine(request);
  const digits = `120363${Math.floor(1e11 + Math.random() * 8e11)}`;
  const tag = uid();
  const res = await request.post(hook, {
    data: {
      events: [
        { type: 'message', chatId: `${digits}@g.us`, isGroup: true, fromMe: false, senderPhone: '15550001009', senderName: 'Persona Prueba', providerMessageId: `gs-${tag}`, body: `asunto ${tag}`, timestamp: new Date().toISOString() },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  // El WhatsApp falso contesta "Grupo <últimos 4 dígitos>" al pedir el asunto.
  const subject = `Grupo ${digits.slice(-4)}`;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const row = page.getByRole('link', { name: new RegExp(subject) }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: new RegExp(digits) })).toHaveCount(0);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
});
