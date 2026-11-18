import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Tarea desde un mensaje en Lines: lo que se escribe en el modal sigue ahí aunque el chat se actualice por
 * detrás (llega otro mensaje, se marca leído, se recarga la lista). Antes el modal volvía a cero cada vez que
 * el chat le pasaba un objeto de mensaje nuevo.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function fakeNumber(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Task drafts ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return new URL(info.webhookUrl).pathname;
}

async function inbound(request: APIRequestContext, webhookPath: string, chatId: string, body: string, chatName: string) {
  const res = await request.post(webhookPath, {
    data: {
      events: [
        { type: 'message', chatId, isGroup: true, chatName, fromMe: false, senderPhone: '5491155550000', senderName: 'Ana', providerMessageId: `td-${uid()}`, body },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test('Lines: lo escrito en una tarea desde un mensaje sigue cuando llega otro mensaje', async ({ page, request }) => {
  const webhook = await fakeNumber(request);
  const tag = uid();
  const waId = `120363${Date.now()}7@g.us`;
  const name = `Task drafts ${tag}`;
  await inbound(request, webhook, waId, `First message ${tag}`, name);
  const list = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}&limit=5`)).json()) as { rows: Array<{ id: string; name: string }> };
  const chat = list.rows.find((r) => r.name === name)!;

  await page.goto(`/en/app/lines/inbox/${chat.id}`, { waitUntil: 'networkidle' });
  const msg = page.locator('.gr-msg-in').first();
  await msg.hover();
  await msg.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Task', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Task from message' });
  const title = dialog.getByRole('textbox', { name: 'Task', exact: true });
  const notes = dialog.getByRole('textbox', { name: 'Notes', exact: true });
  await title.fill('Título a medio escribir');
  await notes.fill('Notas sin guardar');

  // Llega otro mensaje: el hilo lo trae (al volver el foco relee en el acto), lo marca leído y recarga la lista.
  await inbound(request, webhook, waId, `Second message ${tag}`, name);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.gr-msg-in')).toHaveCount(2, { timeout: 30_000 });

  await expect(dialog).toBeVisible();
  await expect(title).toHaveValue('Título a medio escribir');
  await expect(notes).toHaveValue('Notas sin guardar');
});
