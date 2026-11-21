import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { ownWorkspace } from './helpers/own-workspace';
import { waLinkIp } from './helpers/wa-link';

/**
 * @menciones en el pie de un archivo (la vista previa de adjuntos) en un grupo
 * de WhatsApp, en Lines e Inbox, con el WhatsApp falso: "@" abre los
 * participantes, filtra, Esc y un clic afuera la cierran (la vista previa
 * sigue), la mención se ve en verde en el pie y la foto sale con la mención
 * real ("@<teléfono>" y la lista de mencionados). En la burbuja vuelve como
 * "@Nombre". Con CAPTION_SHOTS=<carpeta> guarda la lista abierta en los cinco
 * aspectos, claro y oscuro, a 1280 y 390. Nombres y números inventados.
 */

test.describe.configure({ timeout: 300_000 });

ownWorkspace('wa-mentions-caption');

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const groupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;

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

function message(chatId: string, over: Record<string, unknown> = {}) {
  return { type: 'message', chatId, isGroup: true, fromMe: false, senderPhone: '', senderName: '', providerMessageId: `e2e-${uid()}`, body: 'hola', timestamp: new Date().toISOString(), ...over };
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Pega una foto chica en el campo del chat: abre la vista previa de adjuntos. */
async function pastePhoto(page: Page, scope: string) {
  await page.evaluate(async (scope) => {
    const file = await new Promise<File>((resolve) => {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const g = c.getContext('2d')!;
      g.fillStyle = '#2980b9';
      g.fillRect(0, 0, 16, 16);
      c.toBlob((b) => resolve(new File([b!], 'obra.png', { type: 'image/png' })), 'image/png');
    });
    const el = document.querySelector<HTMLElement>(`${scope} [data-testid="composer-input"]`);
    if (!el) throw new Error('no composer');
    el.focus();
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, scope);
}

async function linesGroup(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Pie ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const post = async (events: unknown[]) => {
    const res = await request.post(new URL(webhookUrl).pathname, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const tag = uid();
  const eze = phone();
  const dani = phone();
  const gid = groupId();
  const title = `Obra ${tag}`;
  await post([{ type: 'fake_contacts', contacts: [{ phone: eze, name: `Ezequiel Sculli ${tag}`, groups: [gid] }, { phone: dani, name: `Dani Paz ${tag}`, groups: [gid] }] }]);
  await post([message(gid, { chatName: title, senderPhone: dani, senderName: `Dani Paz ${tag}`, body: 'Mañana arrancamos' })]);
  const [chat] = await sql('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?', [id, gid]);
  return { numberId: id, chatId: String(chat.id), tag, eze, title };
}

async function openLinesGroup(page: Page, chatId: string, title: string, member: string) {
  await page.goto(`/en/app/lines/inbox/${chatId}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 120_000 });
  // Los participantes ya cargaron: la lista de "@" los tiene.
  await expect(page.locator('.wa-head-sub')).toContainText(member, { timeout: 30_000 });
}

test('Lines: @ en el pie de una foto elige a la persona, se cierra con Esc y afuera, y sale como mención', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const g = await linesGroup(request);
  const name = `Ezequiel Sculli ${g.tag}`;
  try {
    await openLinesGroup(page, g.chatId, g.title, name);
    await pastePhoto(page, '.wa-thread');
    const pane = page.getByTestId('attach-preview');
    await expect(pane).toBeVisible();
    const caption = pane.getByTestId('attach-caption');
    await expect(caption).toBeFocused();
    await caption.pressSequentially('Mirá @scul');
    const list = pane.getByTestId('caption-mentions');
    await expect(list).toBeVisible();
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await expect(list).toContainText(`+${g.eze}`);

    // Esc cierra la lista; la vista previa sigue abierta.
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(pane).toBeVisible();
    // Un clic afuera del pie también la cierra.
    for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
    await caption.pressSequentially('@');
    await expect(list).toBeVisible();
    await pane.locator('.wa-attach-stage').click({ position: { x: 5, y: 5 } });
    await expect(list).toBeHidden();
    await expect(pane).toBeVisible();

    // Elegir con el teclado: en el pie la mención en verde.
    await caption.click();
    await caption.press('End');
    await caption.pressSequentially('scul');
    await expect(list).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(list).toBeHidden();
    await expect(caption).toHaveValue(`Mirá @${name} `);
    const mark = pane.locator('.wa-input-mirror .wa-input-mention');
    await expect(mark).toHaveText(`@${name}`);
    // Lo que se tipea enseguida va después de la mención (el cursor queda al final, no salta).
    await caption.pressSequentially('quedó así');
    await expect(caption).toHaveValue(`Mirá @${name} quedó así`);

    // Sale como mención real: "@<teléfono>" en el pie y la lista de mencionados.
    const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/groups\/chats\/[^/]+\/messages$/.test(r.url()) && !!r.postDataJSON()?.media);
    await page.keyboard.press('Enter');
    const payload = (await sent).postDataJSON() as { body: string; mentions?: string[] };
    expect(payload.body).toBe(`Mirá @${g.eze} quedó así`);
    expect(payload.mentions).toEqual([g.eze]);
    await expect(pane).toBeHidden();

    // En la burbuja: "@Nombre", con estilo de mención, sin el teléfono.
    const bubble = page.locator('.gr-msg', { hasText: 'quedó así' }).last();
    await expect(bubble.locator('.wa-mention')).toHaveText(`@${name}`, { timeout: 30_000 });
    await expect(bubble).not.toContainText(g.eze);
    // Guardada con la mención, y al WhatsApp (falso) le llegó el JID mencionado.
    const row = async () => (await sql("SELECT meta, provider_message_id FROM groups_messages WHERE chat_id = ? AND direction = 'out' AND media_url IS NOT NULL AND media_url <> ''", [g.chatId]))[0] ?? null;
    await expect.poll(async () => String((await row())?.provider_message_id ?? ''), { timeout: 30_000 }).toContain('~');
    const out = (await row())!;
    expect(JSON.parse(String(out.meta)).mentions).toEqual([g.eze]);
    expect(String(out.provider_message_id).split('~')[1]).toBe(`${g.eze}@s.whatsapp.net`);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await request.delete(`/api/groups/numbers/${g.numberId}`).catch(() => null);
  }
});

test('Lines: en el teléfono la lista del pie entra en la pantalla, sin scroll lateral', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const g = await linesGroup(request);
  try {
    await openLinesGroup(page, g.chatId, g.title, `Ezequiel Sculli ${g.tag}`);
    await pastePhoto(page, '.wa-thread');
    const pane = page.getByTestId('attach-preview');
    await expect(pane).toBeVisible();
    await pane.getByTestId('attach-caption').pressSequentially('@');
    const list = pane.getByTestId('caption-mentions');
    await expect(list).toBeVisible();
    await expect(list.getByRole('option')).toHaveCount(2);
    const box = (await list.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    // Hover estable: pasar el mouse marca la opción, sin moverla (medido con la entrada de la lista ya terminada).
    await list.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const second = list.getByRole('option').nth(1);
    const before = await second.boundingBox();
    await second.hover();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    expect(await second.boundingBox()).toEqual(before);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await request.delete(`/api/groups/numbers/${g.numberId}`).catch(() => null);
  }
});

test('Inbox: @ en el pie de una foto sale como mención de WhatsApp', async ({ page, request }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
  const { account } = (await (await request.get('/api/inbox/whatsapp')).json()) as { account: { id: string } };
  const [acc] = await sql('SELECT id, webhook_secret FROM inbox_accounts WHERE id = ?', [account.id]);
  const post = async (events: unknown[]) => {
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events } });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const tag = uid();
  const eze = phone();
  const gid = groupId();
  const title = `Consorcio ${tag}`;
  const name = `Ezequiel Sculli ${tag}`;
  await post([{ type: 'fake_contacts', contacts: [{ phone: eze, name, groups: [gid] }] }]);
  await post([message(gid, { chatName: title, senderPhone: eze, senderName: name, body: 'Buenas' })]);

  await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
  await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click({ timeout: 90_000 });
  const thread = page.locator('.ib-wa-thread');
  const input = thread.getByTestId('composer-input');
  await expect(async () => {
    const retry = page.getByRole('button', { name: 'Try again' });
    if (await retry.isVisible()) await retry.click();
    await expect(input).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 180_000 });
  // Los participantes ya cargaron: el "@" del campo los muestra.
  await input.click();
  await input.pressSequentially('@ezeq');
  await expect(page.locator('.ib-wa-mentions')).toBeVisible({ timeout: 30_000 });
  await input.fill('');

  await pastePhoto(page, '.ib-wa-thread');
  const pane = page.getByTestId('attach-preview');
  await expect(pane).toBeVisible();
  const caption = pane.getByTestId('attach-caption');
  await caption.click();
  await caption.pressSequentially('Gracias @ezeq');
  const list = pane.getByTestId('caption-mentions');
  await expect(list).toBeVisible();
  await expect(list).toContainText(name);
  await page.keyboard.press('Tab');
  await expect(caption).toHaveValue(`Gracias @${name} `);
  await expect(pane.locator('.wa-input-mirror .wa-input-mention')).toHaveText(`@${name}`);

  const sent = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/inbox\/threads\/[^/]+\/media$/.test(r.url()));
  await page.keyboard.press('Enter');
  expect((await sent).ok()).toBe(true);
  await expect(pane).toBeHidden();

  // Guardado con "@<teléfono>" en el pie (el hilo muestra el nombre) y al WhatsApp (falso) le llegó el JID mencionado.
  const sentRow = async () =>
    (await sql('SELECT m.body, m.external_id FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id WHERE t.external_id = ? AND m.from_me = 1', [gid]))[0] ?? null;
  await expect.poll(sentRow, { timeout: 30_000 }).not.toBeNull();
  const out = (await sentRow())!;
  expect(out.body).toBe(`Gracias @${eze}`);
  expect(String(out.external_id).split('~')[1]).toBe(`${eze}@s.whatsapp.net`);
  const bubble = thread.locator('.gr-msg', { hasText: 'Gracias' }).last();
  await expect(bubble.locator('.wa-mention')).toHaveText(`@${name}`, { timeout: 30_000 });
  await expect(bubble).not.toContainText(eze);
  expect(errors, errors.join('\n')).toEqual([]);
});

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;

test('Capturas de la lista del pie en los cinco aspectos (solo con CAPTION_SHOTS)', async ({ page, request, context, baseURL }) => {
  const dir = process.env.CAPTION_SHOTS;
  test.skip(!dir, 'Solo para mirar a mano');
  test.setTimeout(3_600_000);
  const g = await linesGroup(request);
  try {
    for (const look of LOOKS) {
      expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      for (const theme of ['light', 'dark'] as const) {
        await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL! }]);
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 860 });
          const pane = page.getByTestId('attach-preview');
          // Solo capturas a mano: con `next dev` en una máquina chica el servidor se reinicia a veces; se vuelve a abrir.
          await expect(async () => {
            await openLinesGroup(page, g.chatId, g.title, `Ezequiel Sculli ${g.tag}`);
            await pastePhoto(page, '.wa-thread');
            await expect(pane).toBeVisible();
            const caption = pane.getByTestId('attach-caption');
            await caption.pressSequentially('Mirá @Ezequiel');
            await page.keyboard.press('Enter');
            await caption.pressSequentially('y @');
            await expect(caption).toHaveValue(/ y @$/);
            await expect(pane.getByTestId('caption-mentions')).toBeVisible();
          }).toPass({ timeout: 600_000 });
          await pane.getByTestId('caption-mentions').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
          if (width === 390) expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
          await page.screenshot({ path: `${dir}/caption-${look}-${theme}-${width}.png` });
          await page.keyboard.press('Escape');
          await page.keyboard.press('Escape');
          await expect(pane).toBeHidden();
        }
      }
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } }).catch(() => null);
    await request.delete(`/api/groups/numbers/${g.numberId}`).catch(() => null);
  }
});
