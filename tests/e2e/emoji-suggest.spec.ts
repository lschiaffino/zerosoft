import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Lines (y el mismo componente en Inbox): escribir ":fue" muestra emojis
 * encima del composer; las flechas eligen, Enter lo pone en lugar de ":fue"
 * y no manda el mensaje; Esc cierra la tira; "10:30" no la abre.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

/** Un número falso conectado con un chat. Devuelve el nombre del chat. */
async function seedChat(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Paneles ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const name = `Paula ${uid()}`;
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: {
      events: [
        { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `pr-${uid()}`, body: 'Hola, ¿me pasan el presupuesto?', timestamp: Date.now() },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  return name;
}

test('emojis por nombre en el composer: :fue → 🔥 con Enter, Esc cierra, las horas no cuentan', async ({ page, request }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const name = await seedChat(request);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  const input = page.locator('textarea.gr-input');
  await expect(input).toBeVisible({ timeout: 45_000 });

  await input.fill('');
  await input.pressSequentially('Hola :fue', { delay: 30 });
  const strip = page.getByTestId('emoji-suggest');
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expect(strip.getByRole('option', { name: 'fire' })).toBeVisible();
  // Elegir con el teclado: Enter pone el emoji y no manda.
  const options = await strip.getByRole('option').allInnerTexts();
  const target = options.indexOf('🔥');
  for (let i = 0; i < target; i++) await input.press('ArrowRight');
  await input.press('Enter');
  await expect(input).toHaveValue('Hola 🔥');
  await expect(strip).toHaveCount(0);

  // Esc cierra y deja lo escrito.
  await input.pressSequentially(' :cor', { delay: 30 });
  await expect(strip).toBeVisible();
  await input.press('Escape');
  await expect(strip).toHaveCount(0);
  await expect(input).toHaveValue('Hola 🔥 :cor');

  // Las horas no abren nada.
  await input.fill('');
  await input.pressSequentially('a las 10:30', { delay: 20 });
  await expect(strip).toHaveCount(0);
  expect(errors).toEqual([]);
});
