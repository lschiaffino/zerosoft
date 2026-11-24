import { expect, test, type APIRequestContext } from '@playwright/test';
import es from '../../messages/es/groups.json';

/**
 * Lines: debajo del nombre de un grupo van los miembros como en WhatsApp Web
 * ("Ana, Beto, Vos"): primero los que tienen nombre y "Vos" al final, nunca el
 * número de la línea. El WhatsApp falso pone la línea (15550000001) como
 * miembro de cada grupo. 1280 y 390. Nombres y números inventados.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${Math.floor(Math.random() * 10)}`;
const LINE_DIGITS = '15550000001';

async function fakeLine(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Linea ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return new URL(webhookUrl).pathname;
}

test('Lines: el subtítulo de un grupo termina en "Vos", sin el número de la línea', async ({ page, request }) => {
  const hook = await fakeLine(request);
  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  const title = `Subtitulo ${tag}`;
  const base = { type: 'message', chatId: gid, isGroup: true, chatName: title, fromMe: false, timestamp: new Date().toISOString() };
  const res = await request.post(hook, {
    data: {
      events: [
        { ...base, senderPhone: phone(), senderName: `Ana ${tag}`, providerMessageId: `s1-${tag}`, body: `hola ${tag}` },
        { ...base, senderPhone: phone(), senderName: `Beto ${tag}`, providerMessageId: `s2-${tag}`, body: `chau ${tag}` },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
    await page.goto('/es/app/lines/inbox', { waitUntil: 'networkidle' });
    await page.locator('.gr-row', { hasText: title }).first().click({ timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 60_000 });
    const sub = page.getByTestId('wa-head-sub');
    await expect(sub).toContainText(`Ana ${tag}`, { timeout: 20_000 });
    await expect(sub).toContainText(`Beto ${tag}`);
    await expect(sub).not.toContainText(LINE_DIGITS.slice(-4));
    const parts = ((await sub.textContent()) ?? '').replace(/…$/, '').split(', ');
    // La línea va última y se llama como en el resto del chat ("Vos").
    expect(parts.at(-1)).toBe(es.wa.you);
    expect(parts.slice(0, 2).sort()).toEqual([`Ana ${tag}`, `Beto ${tag}`].sort());
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
});
