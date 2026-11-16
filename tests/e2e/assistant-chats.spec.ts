import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Asistente (modelo falso) y los chats de la persona: "¿qué tengo atrasado?"
 * lista lo que espera sin leer mensajes; "leelos" pide permiso en una
 * tarjeta; "permitir siempre" sigue solo, lee y propone acciones en una
 * tarjeta; confirmar deja el borrador y pospone. En Ajustes se apaga el
 * permiso y el próximo pedido vuelve a preguntar.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

async function inbound(request: APIRequestContext, acc: { id: string; secret: string }, name: string, phone: string, hoursAgo: number) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        {
          type: 'message',
          chatId: `${phone}@s.whatsapp.net`,
          isGroup: false,
          fromMe: false,
          senderPhone: phone,
          senderName: name,
          providerMessageId: `ch-${uid()}`,
          body: '¿Me confirmás el pedido?',
          timestamp: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

async function ask(panel: Locator, text: string) {
  const input = panel.getByRole('textbox', { name: /Ask anything/ });
  // Mientras la respuesta anterior sigue llegando, Enter no manda.
  await expect(panel.locator('.asst-messages')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await input.fill(text);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('¿qué tengo atrasado?: lista sin leer, permiso, leer, proponer y confirmar; en Ajustes se apaga', async ({ page, request }) => {
  const errors = watchErrors(page);
  const acc = await linkWhatsapp(request);
  const tag = uid();
  // Dos chats esperando respuesta hace mucho (quedan primeros en la lista de atrasados).
  await inbound(request, acc, `Ana ${tag}`, `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, 24 * 300);
  await inbound(request, acc, `Beto ${tag}`, `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, 24 * 299);
  // Sin permiso de una corrida anterior.
  await sql("DELETE FROM assistant_chat_grants WHERE person_id IN (SELECT id FROM users WHERE email = 'demo@zerosoft.ai')");

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  await ask(panel, '¿qué tengo atrasado?');
  const list = panel.getByTestId('assistant-msg-assistant').last();
  await expect(list.getByTestId('assistant-markdown')).toContainText(`Ana ${tag}`, { timeout: 60_000 });
  await expect(list.getByTestId('assistant-action')).toHaveCount(0);

  // Leer: primero la tarjeta de permiso; nada leído todavía.
  await ask(panel, 'sí, leelos');
  // Las tarjetas por su id: al permitir, el asistente sigue en un mensaje nuevo (el "último" cambia).
  const consent = panel.locator('[data-testid="assistant-action"][data-kind="consent"]').first();
  await expect(consent).toHaveAttribute('data-status', 'pending', { timeout: 30_000 });
  await expect(panel.getByTestId('assistant-msg-assistant').last().locator('[data-testid="assistant-tool-card"][data-tool="inbox_read_chats"]')).toHaveCount(1);
  await consent.getByTestId('assistant-consent-always').click();
  await expect(consent).toHaveAttribute('data-status', 'done', { timeout: 30_000 });

  // Sigue solo: lee y propone las acciones en una tarjeta.
  const proposal = panel.locator('[data-testid="assistant-action"][data-kind="change"]').first();
  await expect(proposal).toHaveAttribute('data-status', 'pending', { timeout: 60_000 });
  await proposal.getByRole('button', { name: 'Confirm' }).click();
  await expect(proposal).toHaveAttribute('data-status', 'done', { timeout: 30_000 });
  const [ana] = await sql('SELECT draft, snoozed_until FROM inbox_threads WHERE title = ?', [`Ana ${tag}`]);
  const [beto] = await sql('SELECT draft, snoozed_until FROM inbox_threads WHERE title = ?', [`Beto ${tag}`]);
  expect(String(ana.draft).length).toBeGreaterThan(0);
  expect(beto.snoozed_until).not.toBeNull();
  // Nada se envió: ningún mensaje mío en esos chats.
  expect(await sql("SELECT COUNT(*) AS n FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.title IN (?, ?) AND m.from_me = 1", [`Ana ${tag}`, `Beto ${tag}`])).toEqual([{ n: 0 }]);
  // La charla guardada no tiene el texto de los mensajes leídos.
  expect(await sql("SELECT COUNT(*) AS n FROM assistant_messages WHERE parts LIKE '%Me confirmás el pedido%'")).toEqual([{ n: 0 }]);

  // Ajustes › Cuenta: permitido siempre; apagarlo.
  await page.keyboard.press('Escape');
  await page.goto('/en/app/settings', { waitUntil: 'networkidle' });
  const row = page.getByTestId('assistant-chat-access').locator('[data-app="inbox"]');
  await expect(row).toHaveAttribute('data-allowed', 'always');
  await row.getByRole('button').click();
  await expect(row).toHaveAttribute('data-allowed', 'ask');
  expect(await sql("SELECT COUNT(*) AS n FROM assistant_chat_grants WHERE person_id IN (SELECT id FROM users WHERE email = 'demo@zerosoft.ai')")).toEqual([{ n: 0 }]);

  // El próximo pedido vuelve a preguntar.
  await page.keyboard.press('ControlOrMeta+j');
  await panel.getByRole('button', { name: 'New chat' }).click();
  await ask(panel, 'sí, leelos');
  await expect(panel.getByTestId('assistant-msg-assistant').last().locator('[data-testid="assistant-action"][data-kind="consent"]')).toHaveAttribute('data-status', 'pending', { timeout: 30_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('390 px: la tarjeta de permiso entra sin scroll horizontal y "No permitir" no lee nada', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await sql("DELETE FROM assistant_chat_grants WHERE person_id IN (SELECT id FROM users WHERE email = 'demo@zerosoft.ai')");
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.keyboard.press('ControlOrMeta+j');
  const panel = page.getByTestId('assistant-panel');
  await ask(panel, 'read them');
  const consent = panel.getByTestId('assistant-msg-assistant').last().locator('[data-testid="assistant-action"][data-kind="consent"]');
  await expect(consent).toHaveAttribute('data-status', 'pending', { timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await consent.getByTestId('assistant-consent-deny').click();
  await expect(consent).toHaveAttribute('data-status', 'cancelled', { timeout: 30_000 });
  expect(await sql("SELECT COUNT(*) AS n FROM assistant_chat_grants WHERE person_id IN (SELECT id FROM users WHERE email = 'demo@zerosoft.ai')")).toEqual([{ n: 0 }]);
});
