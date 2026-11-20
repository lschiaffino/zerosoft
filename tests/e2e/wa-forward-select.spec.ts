import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { waLinkIp } from './helpers/wa-link';

/**
 * "Reenviar" en un mensaje entra en modo selección, como WhatsApp (Inbox y Lines, WhatsApp falso con
 * GROUPS_FAKE=1), a 1280 y a 390: ese mensaje queda tildado, se suma otro (con el mouse y con el teclado), la
 * barra cuenta cuántos van, Esc sale y deja el foco en el campo, lo borrado no tiene casilla, y dos mensajes
 * reenviados llegan al otro chat en el orden en que se mandaron, con la marca "Forwarded" (el segundo ya llegó
 * reenviado 4 veces: la copia suma uno y dice "Forwarded many times", como WhatsApp desde 5). Con WA_SHOTS=<carpeta>
 * guarda capturas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const digits = (end: string) => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${end}`;

async function shot(page: Page, name: string) {
  if (process.env.WA_SHOTS) await page.screenshot({ path: `${process.env.WA_SHOTS}/${name}.png` });
}

/** Solo con WA_SHOTS: la misma pantalla en los cinco aspectos, claro y oscuro, y en los dos estilos de chat. */
async function shotLooks(page: Page, name: string) {
  if (!process.env.WA_SHOTS) return;
  const set = (look: string, theme: string, style: string) =>
    page.evaluate(
      ([l, t, s]) => {
        document.documentElement.setAttribute('data-look', l);
        document.documentElement.setAttribute('data-theme', t);
        document.querySelector('.gr-inbox')?.setAttribute('data-chat-style', s);
      },
      [look, theme, style],
    );
  for (const look of ['lines', 'classic', 'liquid', 'retro', 'current'])
    for (const theme of ['dark', 'light'])
      for (const style of ['zerosoft', 'whatsapp']) {
        await set(look, theme, style);
        await shot(page, `${name}-${look}-${theme}-${style}`);
      }
}

async function noSideScroll(page: Page) {
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(w.scroll).toBeLessThanOrEqual(w.inner + 1);
}

interface App {
  name: string;
  /** Abre el chat con ese nombre desde la lista. */
  open: (name: string) => Promise<void>;
  /** El mensaje (entrante o saliente) con ese texto en el chat abierto. */
  msg: (text: string) => Locator;
  outgoing: Locator;
  openMenu: (msg: Locator) => Promise<void>;
  composer: Locator;
  /** Con el diálogo de destino abierto: elige ese chat y manda. */
  sendTo: (name: string) => Promise<void>;
  toast: Locator;
}

/** El mismo recorrido en las dos apps: `texts` son tres mensajes del chat `from` (el tercero, borrado). */
async function forwardBySelecting(page: Page, app: App, width: number, from: string, to: string, texts: [string, string, string]) {
  const [one, two, gone] = texts;
  const bar = page.getByTestId('selection-bar');
  const check = (text: string) => app.msg(text).getByRole('checkbox');
  await app.open(from);
  await expect(app.msg(two)).toBeVisible({ timeout: 30_000 });

  // "Forward" en un mensaje: modo selección con ese mensaje tildado y el foco en su casilla; la barra reemplaza al campo.
  await app.openMenu(app.msg(one));
  await page.getByRole('menuitem', { name: 'Forward' }).click();
  await expect(page.getByRole('toolbar', { name: '1 selected' })).toBeVisible();
  await expect(check(one)).toBeChecked();
  await expect(check(one)).toBeFocused();
  await expect(check(one)).toHaveAccessibleName(new RegExp(`^Select message: ${one}`));
  await expect(check(two)).not.toBeChecked();
  await expect(app.composer).toHaveCount(0);
  // Lo borrado no se puede reenviar: sin casilla, y tocarlo no lo suma.
  await expect(page.locator('.gr-msg.is-deleted')).toBeVisible();
  await expect(page.locator('.gr-msg.is-deleted').getByRole('checkbox')).toHaveCount(0);
  await page.locator('.gr-msg.is-deleted').click();
  await expect(page.getByRole('toolbar', { name: '1 selected' })).toBeVisible();

  // Tocar otro mensaje lo suma; con el teclado, Espacio en su casilla lo saca y lo vuelve a poner.
  await app.msg(two).click();
  await expect(page.getByRole('toolbar', { name: '2 selected' })).toBeVisible();
  await expect(check(two)).toBeChecked();
  await check(two).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('toolbar', { name: '1 selected' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('toolbar', { name: '2 selected' })).toBeVisible();
  await noSideScroll(page);
  await expect(bar.locator('[data-action="forward"]')).toBeInViewport({ ratio: 1 });
  await expect(bar.locator('[data-action="copy"]')).toBeInViewport({ ratio: 1 });
  await shotLooks(page, `${app.name}-${width}-selecting`);

  // Sin ninguno elegido el modo sigue, con "Forward" apagado.
  await check(one).click();
  await check(two).click();
  await expect(page.getByRole('toolbar', { name: '0 selected' })).toBeVisible();
  await expect(bar.locator('[data-action="forward"]')).toBeDisabled();

  // Esc sale: vuelve el campo, con el foco.
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(app.composer).toBeFocused();
  await expect(app.msg(one)).toBeVisible();

  // De nuevo, empezando por el segundo y sumando el primero: salen en el orden del chat, el más viejo primero.
  await app.openMenu(app.msg(two));
  await page.getByRole('menuitem', { name: 'Forward' }).click();
  await expect(check(two)).toBeChecked();
  await check(one).check();
  await expect(page.getByRole('toolbar', { name: '2 selected' })).toBeVisible();
  await bar.locator('[data-action="forward"]').click();
  await app.sendTo(to);
  await expect(app.toast.filter({ hasText: 'Forwarded to 1 chat' })).toBeVisible();
  // Reenviado: se sale del modo.
  await expect(bar).toHaveCount(0);

  await app.open(to);
  await expect(app.outgoing).toHaveText([new RegExp(one), new RegExp(two)], { timeout: 30_000 });
  await expect(app.outgoing.locator('.gr-forwarded')).toHaveCount(2);
  // La copia suma uno al score del original: el primero queda "Forwarded", el segundo (4 + 1) "Forwarded many times".
  await expect(app.outgoing.filter({ hasText: one }).locator('.gr-forwarded')).toHaveAttribute('data-forwarded', 'once');
  await expect(app.outgoing.filter({ hasText: two }).locator('.gr-forwarded')).toHaveAttribute('data-forwarded', 'many');
  await noSideScroll(page);
  await shot(page, `${app.name}-${width}-arrived`);
}

async function linkWhatsapp(request: APIRequestContext): Promise<{ id: string; secret: string }> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [row] = (
      await db.execute("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'")
    ).rows as unknown as Array<Record<string, unknown>>;
    return { id: String(row.id), secret: String(row.webhook_secret) };
  } finally {
    db.close();
  }
}

/** Un chat con tres mensajes entrantes (el tercero, borrado por quien lo mandó) y otro chat adonde reenviar. */
function seed(tag: string, jid: (end: string) => string) {
  const from = `Origen ${tag}`;
  const to = `Destino ${tag}`;
  const a = jid('3');
  const b = jid('4');
  const texts: [string, string, string] = [`Primero ${tag}`, `Segundo ${tag}`, `Tercero ${tag}`];
  const at = (i: number) => new Date(Date.now() - (10 - i) * 60_000).toISOString();
  const inMsg = (chatId: string, senderName: string, body: string, i: number, id = `fs-${tag}-${i}`, extra: Record<string, unknown> = {}) => ({
    type: 'message',
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName,
    providerMessageId: id,
    body,
    timestamp: at(i),
    ...extra,
  });
  const events = [
    inMsg(b, to, `Hola ${tag}`, 0),
    inMsg(a, from, texts[0], 1),
    // Ya llegó reenviado 4 veces (contextInfo.forwardingScore).
    inMsg(a, from, texts[1], 2, undefined, { forwarded: true, forwardingScore: 4 }),
    inMsg(a, from, texts[2], 3),
    { type: 'revoke', chatId: a, providerMessageId: `fs-${tag}-3` },
  ];
  return { from, to, texts, events };
}

for (const width of [1280, 390]) {
  test(`Inbox a ${width}: Forward entra en selección y reenvía dos mensajes en orden`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const acc = await linkWhatsapp(request);
    const s = seed(uid(), (end) => `${digits(end)}@s.whatsapp.net`);
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, { data: { events: s.events } });
    expect(res.ok(), await res.text()).toBe(true);

    const thread = page.locator('.ib-wa-thread');
    const app: App = {
      name: 'inbox',
      open: async (name) => {
        await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
        await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
        await expect(thread).toBeVisible();
      },
      msg: (text) => thread.locator('.gr-msg', { hasText: text }),
      outgoing: thread.locator('.gr-msg-out'),
      openMenu: async (msg) => {
        await msg.hover();
        await msg.locator('.wa-chevron').click();
      },
      composer: page.getByTestId('composer-input'),
      sendTo: async (name) => {
        const fwd = page.getByRole('dialog', { name: 'Forward to' });
        await expect(fwd.locator('.ib-wa-fwd-preview')).toHaveText('2 messages');
        await fwd.getByRole('textbox').fill(name.slice(0, 12));
        await fwd.getByText(name).click();
        await fwd.getByRole('button', { name: 'Send to 1 chat' }).click();
      },
      toast: page.locator('.ib-toast'),
    };
    await forwardBySelecting(page, app, width, s.from, s.to, s.texts);

    // Cambiar de chat sale del modo.
    await app.open(s.from);
    await app.openMenu(app.msg(s.texts[0]));
    await page.getByRole('menuitem', { name: 'Forward' }).click();
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await app.open(s.to);
    await expect(app.outgoing.first()).toBeVisible();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`Lines a ${width}: Forward entra en selección y reenvía dos mensajes en orden`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Selección ${uid()}` } });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    try {
      await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
      await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
      const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
      const s = seed(uid(), (end) => `${digits(end)}@c.us`);
      const res = await request.post(new URL(webhookUrl).pathname, { data: { events: s.events } });
      expect(res.ok(), await res.text()).toBe(true);

      const app: App = {
        name: 'lines',
        open: async (name) => {
          await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
          // Por nombre en el buscador: en la base compartida otros tests dejan chats más nuevos arriba de la lista.
          await page.getByRole('searchbox', { name: 'Search chats and messages' }).fill(name);
          await page.locator('.gr-row', { hasText: name }).click();
          await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
        },
        msg: (text) => page.locator('.gr-msg', { hasText: text }),
        outgoing: page.locator('.gr-msg-out'),
        openMenu: async (msg) => {
          await msg.hover();
          await msg.getByRole('button', { name: 'More actions' }).click();
        },
        composer: page.locator('textarea.wa-input'),
        sendTo: async (name) => {
          const fw = page.getByRole('dialog', { name: 'Forward message' });
          await expect(fw.locator('.gr-quote')).toHaveText('2 messages');
          await fw.getByLabel('Search chats and groups').fill(name);
          await fw.getByRole('checkbox').first().check();
          await fw.getByRole('button', { name: 'Forward to 1 chat' }).click();
        },
        toast: page.getByText('Forwarded to 1 chat'),
      };
      await forwardBySelecting(page, app, width, s.from, s.to, s.texts);
      expect(errors).toEqual([]);
    } finally {
      await request.delete(`/api/groups/numbers/${id}`).catch(() => null);
    }
  });
}
