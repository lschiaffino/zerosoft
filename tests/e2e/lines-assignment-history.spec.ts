import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Lines: historial de asignaciones en el panel de detalles del chat (y su
 * endpoint). Contra el proveedor falso; nada sale a WhatsApp.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function fakeNumber(request: APIRequestContext): Promise<{ id: string; webhookUrl: string }> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `History ${uid()}` } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookUrl: info.webhookUrl };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

test('historial de asignaciones: vacío, asignar y sacar quedan en la lista', async ({ page, request }) => {
  const errors = watchErrors(page);
  const n = await fakeNumber(request);
  const who = `Hist${uid()}`;
  const res = await request.post(new URL(n.webhookUrl).pathname, {
    data: {
      events: [
        { type: 'message', chatId: `54911${Math.floor(Math.random() * 1e7)}@c.us`, isGroup: false, fromMe: false, senderPhone: '5491155550000', senderName: who, providerMessageId: `h-${uid()}`, body: 'hello' },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);

  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: who }).click();
  const history = page.getByTestId('assign-history');
  await expect(history.getByTestId('assign-history-empty')).toBeVisible();

  const assignee = page.getByTestId('chat-assignee');
  const me = await assignee.locator('option').nth(1).getAttribute('value');
  await assignee.selectOption(me!);
  await expect(history.getByTestId('assign-history-item')).toHaveCount(1);
  await expect(history.getByTestId('assign-history-item').first()).toHaveAttribute('data-reason', 'manual');
  await assignee.selectOption('');
  await expect(history.getByTestId('assign-history-item')).toHaveCount(2);

  // El endpoint devuelve lo mismo, del más nuevo al más viejo.
  const chatId = page.url().split('/inbox/')[1]?.split(/[?#]/)[0];
  expect(chatId).toBeTruthy();
  const api = (await (await request.get(`/api/groups/assignments?chat=${chatId}`)).json()) as { events: Array<{ from: string | null; to: string | null; reason: string }> };
  expect(api.events.map((e) => [e.reason, e.from, e.to])).toEqual([
    ['manual', me, null],
    ['manual', null, me],
  ]);
  expect((await request.get('/api/groups/assignments?chat=no-existe')).status()).toBe(404);
  expect(errors).toEqual([]);
});
