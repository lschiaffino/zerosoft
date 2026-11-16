import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * Lines e Inbox: un chat vencido lleva un filete de color al borde de la fila (data-overdue y
 * row-overdue-edge) con tooltip, sin cambiar el alto de la fila, seleccionado o no. Y los botones
 * primarios (Aplicar del panel de filtros, Confirmar de posponer, Enviar del composer) llevan el
 * color de la app: el mismo fondo que el token --app-btn, no un color fijo.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function sql(statement: string, args: Array<string | number | null> = []): Promise<Array<Record<string, unknown>>> {
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
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

/** El fondo del botón es el del token --app-btn (lo pone components/app/AppAccent.tsx por app y por tema). */
async function expectAppAccent(btn: Locator) {
  await expect(btn).toBeVisible();
  await expect
    .poll(() =>
      btn.evaluate((el) => {
        const token = getComputedStyle(el).getPropertyValue('--app-btn').trim();
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--app-btn)';
        el.parentElement!.appendChild(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return token !== '' && getComputedStyle(el).backgroundColor === want;
      }),
    )
    .toBe(true);
}

/** El filete de vencido (su ::before) es del color de la app, no el rojo de antes. */
async function expectEdgeAccent(edge: Locator) {
  await expect
    .poll(() =>
      edge.evaluate((el) => {
        const token = getComputedStyle(el).getPropertyValue('--app-btn').trim();
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--app-btn)';
        el.parentElement!.appendChild(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return token !== '' && getComputedStyle(el, '::before').backgroundColor === want;
      }),
    )
    .toBe(true);
}

async function rowHeight(row: Locator): Promise<number> {
  return Math.round((await row.boundingBox())!.height);
}

/* ---------- Lines ---------- */

async function fakeNumber(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `OD ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return { id, webhookPath: new URL(info.webhookUrl).pathname };
}

async function linesInbound(request: APIRequestContext, webhookPath: string, name: string) {
  const res = await request.post(webhookPath, {
    data: {
      events: [{ type: 'message', chatId: `${phone()}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone(), senderName: name, providerMessageId: `od-${uid()}`, body: 'Hello' }],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function linesChatId(request: APIRequestContext, name: string): Promise<string> {
  let id = '';
  await expect
    .poll(async () => {
      const data = (await (await request.get(`/api/groups/chats?q=${encodeURIComponent(name)}`)).json()) as { chats?: Array<{ id: string; name: string }>; rows?: Array<{ id: string; name: string }> };
      id = (data.chats ?? data.rows ?? []).find((c) => c.name === name)?.id ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

for (const width of [1280, 390]) {
  test(`Lines: vencido con filete, tooltip y mismo alto (${width}px)`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 800 });
    const n = await fakeNumber(request);
    const late = `Late ${uid()}`;
    const fine = `Fine ${uid()}`;
    await linesInbound(request, n.webhookPath, late);
    await linesInbound(request, n.webhookPath, fine);
    const lateId = await linesChatId(request, late);
    const fineId = await linesChatId(request, fine);
    const past = new Date(Date.now() - 3 * 3600_000).toISOString();
    await sql('UPDATE groups_chats SET awaiting_since = ?, flagged_at = ? WHERE id = ?', [past, past, lateId]);

    await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
    const lateItem = page.locator(`[data-testid="chat-row"][data-chat-id="${lateId}"]`);
    const fineItem = page.locator(`[data-testid="chat-row"][data-chat-id="${fineId}"]`);
    await expect(lateItem).toHaveAttribute('data-overdue', 'true');
    await expect(fineItem).not.toHaveAttribute('data-overdue', /.*/);
    const edge = lateItem.getByTestId('row-overdue-edge');
    await expect(edge).toBeVisible();
    await expectEdgeAccent(edge);
    await expect(edge).toHaveAttribute('title', /\S/);
    await expect(fineItem.getByTestId('row-overdue-edge')).toHaveCount(0);
    expect(await rowHeight(lateItem.locator('.gr-row'))).toBe(await rowHeight(fineItem.locator('.gr-row')));

    // Abierto (seleccionado): el filete sigue y el alto no cambia.
    if (width > 720) {
      await lateItem.locator('.gr-row').click();
      await expect(lateItem.locator('.gr-row')).toHaveAttribute('aria-current', 'page');
      await expect(edge).toBeVisible();
      expect(await rowHeight(lateItem.locator('.gr-row'))).toBe(await rowHeight(fineItem.locator('.gr-row')));
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('Lines: Aplicar del panel de filtros y Enviar llevan el color de la app', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const n = await fakeNumber(request);
  const name = `Accent ${uid()}`;
  await linesInbound(request, n.webhookPath, name);
  const id = await linesChatId(request, name);
  await page.goto(`/en/app/lines/inbox/${id}`, { waitUntil: 'networkidle' });

  await page.getByTestId('lines-filter-button').click();
  const panel = page.getByTestId('filter-panel');
  await expectAppAccent(panel.locator('.btn-primary'));
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  const field = page.getByTestId('composer-input').first();
  await field.click();
  await field.pressSequentially('hola');
  await expectAppAccent(page.getByTestId('composer-send').first());
});

/* ---------- Inbox ---------- */

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  const status = async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status;
  // Vincular tiene tope por IP (20 cada 10 min, compartido por todo el shard): solo si hace falta.
  if ((await status()) !== 'connected') {
    const linked = await request.post('/api/inbox/whatsapp', waLinkIp());
    expect(linked.ok(), await linked.text()).toBe(true);
  }
  await expect.poll(status, { timeout: 10_000 }).toBe('connected');
  const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

async function inboxInbound(request: APIRequestContext, acc: { id: string; secret: string }, who: { phone: string; name: string }) {
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        {
          type: 'message',
          chatId: `${who.phone}@s.whatsapp.net`,
          isGroup: false,
          fromMe: false,
          senderPhone: who.phone,
          senderName: who.name,
          providerMessageId: `od-${uid()}`,
          body: 'Hello',
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

for (const width of [1280, 390]) {
  test(`Inbox: vencido con filete, tooltip y mismo alto (${width}px)`, async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 800 });
    const acc = await linkWhatsapp(request);
    const late = { phone: phone(), name: `Late ${uid()}` };
    const fine = { phone: phone(), name: `Fine ${uid()}` };
    await inboxInbound(request, acc, late);
    await inboxInbound(request, acc, fine);
    await sql("UPDATE inbox_threads SET woke_at = ?, woke_reason = 'snooze' WHERE account_id = ? AND handle = ?", [new Date(Date.now() - 3600_000).toISOString(), acc.id, late.phone]);

    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    const lateItem = page.getByTestId('inbox-row').filter({ hasText: late.name });
    const fineItem = page.getByTestId('inbox-row').filter({ hasText: fine.name });
    await expect(lateItem).toHaveAttribute('data-overdue', 'true');
    await expect(fineItem).not.toHaveAttribute('data-overdue', /.*/);
    const edge = lateItem.getByTestId('row-overdue-edge');
    await expect(edge).toBeVisible();
    await expectEdgeAccent(edge);
    await expect(edge).toHaveAttribute('title', /\S/);
    await expect(fineItem.getByTestId('row-overdue-edge')).toHaveCount(0);
    expect(await rowHeight(lateItem.locator('.ib-row-btn'))).toBe(await rowHeight(fineItem.locator('.ib-row-btn')));

    // Seleccionado (casilla): el filete sigue y el alto no cambia.
    if (width > 720) {
      await lateItem.getByRole('checkbox').check();
      await expect(lateItem).toHaveClass(/is-selected/);
      await expect(edge).toBeVisible();
      expect(await rowHeight(lateItem.locator('.ib-row-btn'))).toBe(await rowHeight(fineItem.locator('.ib-row-btn')));
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('Inbox: Confirmar de posponer y Enviar llevan el color de la app', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const acc = await linkWhatsapp(request);
  const who = { phone: phone(), name: `Accent ${uid()}` };
  await inboxInbound(request, acc, who);
  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  const row = page.getByTestId('inbox-row').filter({ hasText: who.name });
  await row.locator('.ib-row-btn').focus();
  await page.keyboard.press('h');
  const dialog = page.locator('dialog.ui-when[open]');
  await expectAppAccent(dialog.locator('.btn-primary'));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await row.locator('.ib-row-btn').click();
  const field = page.getByTestId('composer-input').first();
  await field.click();
  await field.pressSequentially('hola');
  await expectAppAccent(page.getByTestId('composer-send').first());
});
