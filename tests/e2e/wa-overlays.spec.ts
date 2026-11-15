import { e2eDb } from './helpers/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Los overlays pasajeros del chat de Inbox y de Lines (WhatsApp falso,
 * GROUPS_FAKE=1), a 1280 con mouse y a 390 con el dedo: barra rápida de
 * reacciones, todos los emojis ("+"), menú del mensaje, menú de adjuntar,
 * bandeja de emojis/GIFs/stickers, el cuadro de quién reaccionó y la ficha
 * del contacto. Cada uno se cierra con un toque afuera (y ese toque no lo
 * vuelve a abrir), con Esc y al elegir algo; abrir uno cierra el otro.
 * Comparten components/groups/wa/useDismiss.ts. Nombres y números inventados.
 */

async function sql(statement: string, args: Array<string | number> = []): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}${Math.floor(Math.random() * 10)}`;
const groupId = () => `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;

function message(chatId: string, over: Record<string, unknown> = {}) {
  return {
    type: 'message',
    chatId,
    isGroup: true,
    fromMe: false,
    senderPhone: phone(),
    senderName: '',
    providerMessageId: `e2e-${uid()}`,
    body: 'hola',
    timestamp: new Date().toISOString(),
    ...over,
  };
}

/** Un grupo con un mensaje de Ana (con una reacción suya) y otro de Beto después. */
async function seed(send: (list: unknown[]) => Promise<void>, tag: string) {
  const gid = groupId();
  const ana = phone();
  const title = `Overlays ${tag}`;
  const target = `rx-${tag}`;
  await send([message(gid, { chatName: title, senderPhone: ana, senderName: `Ana ${tag}`, body: `primero ${tag}`, providerMessageId: target, timestamp: new Date(Date.now() - 60_000).toISOString() })]);
  await send([{ type: 'reaction', chatId: gid, targetProviderMessageId: target, emoji: '❤️', senderPhone: ana, senderName: `Ana ${tag}`, fromMe: false }]);
  await send([message(gid, { chatName: title, senderName: `Beto ${tag}`, body: `segundo ${tag}` })]);
  return { title, text: `primero ${tag}` };
}

interface Overlay {
  name: string;
  open: () => Promise<void>;
  el: () => Locator;
  /** El botón que lo abre y lo cierra (alterna), si tiene. */
  trigger?: () => Locator;
  /** Elegir algo: lo cierra (o, en la bandeja, inserta y sigue abierta como WhatsApp). */
  pick?: () => Promise<void>;
  /** Un toque afuera lo cierra (la ficha a 390 ocupa toda la pantalla: no hay afuera). */
  outside?: boolean;
}

function overlays(page: Page, thread: Locator, text: string, touch: boolean): Overlay[] {
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const bubble = () => thread.locator('.gr-msg', { hasText: text });
  const chip = () => bubble().getByTestId('wa-reactions-chip');
  const quick = () => page.getByTestId('wa-quick-react');
  const openQuick = async () => {
    if (touch) {
      // Con el dedo: desde el cuadro de reacciones (el botón de reaccionar aparece al pasar el mouse).
      if (!(await page.getByTestId('wa-reactions-popover').isVisible())) await press(chip());
      await press(page.getByTestId('wa-reactions-react'));
    } else {
      await bubble().hover();
      await bubble().locator('.wa-react-btn').click();
    }
    await expect(quick()).toBeVisible();
  };
  const field = () => thread.locator('.wa-bar textarea').first();
  return [
    {
      name: 'quick reactions',
      open: openQuick,
      el: quick,
      trigger: touch ? undefined : () => bubble().locator('.wa-react-btn'),
      pick: async () => {
        await press(quick().getByRole('button', { name: '👍', exact: true }));
        await expect(chip()).toContainText('👍');
      },
      outside: true,
    },
    {
      name: 'all emoji',
      open: async () => {
        await openQuick();
        await press(quick().getByRole('button', { name: 'More emoji' }));
      },
      el: () => page.getByTestId('wa-react-full').locator('.wa-emoji'),
      pick: async () => {
        // Entra entero en la ventana aunque el mensaje esté arriba de todo.
        const first = page.getByTestId('wa-react-full').locator('button[data-emoji]').first();
        await expect(first).toBeInViewport({ timeout: 15_000 });
        await press(first);
      },
      outside: true,
    },
    {
      name: 'message menu',
      open: async () => {
        if (!touch) await bubble().hover();
        await press(bubble().locator('.wa-chevron'));
      },
      el: () => page.getByRole('menu'),
      trigger: () => bubble().locator('.wa-chevron'),
      pick: () => press(page.getByTestId('menu-star')),
      outside: true,
    },
    {
      name: 'attach menu',
      open: () => press(thread.locator('.wa-bar .wa-attach')),
      el: () => page.getByRole('menu'),
      trigger: () => thread.locator('.wa-bar .wa-attach'),
      pick: async () => {
        const chooser = page.waitForEvent('filechooser');
        await press(page.getByTestId('menu-doc'));
        await chooser;
      },
      outside: true,
    },
    {
      name: 'emoji tray',
      open: () => press(thread.locator('.wa-bar').getByRole('button', { name: 'Emoji', exact: true })),
      el: () => page.locator('.wa-bar .wa-emoji'),
      trigger: () => thread.locator('.wa-bar').getByRole('button', { name: 'Emoji', exact: true }),
      pick: async () => {
        // Como WhatsApp: el emoji va al campo y la bandeja sigue abierta para elegir otro.
        const first = page.locator('.wa-bar .wa-emoji button[data-emoji]').first();
        await expect(first).toBeVisible({ timeout: 15_000 });
        const emoji = (await first.getAttribute('data-emoji')) ?? '';
        await press(first);
        await expect(field()).toHaveValue(new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        await expect(page.locator('.wa-bar .wa-emoji')).toBeVisible();
        await page.keyboard.press('Escape');
        await field().fill('');
      },
      outside: true,
    },
    {
      name: 'reactions popover',
      open: () => press(chip()),
      el: () => page.getByTestId('wa-reactions-popover'),
      trigger: chip,
      pick: async () => {
        // "Reaccionar" cierra el cuadro y abre la barra rápida.
        await press(page.getByTestId('wa-reactions-react'));
        await expect(quick()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(quick()).toBeHidden();
      },
      outside: true,
    },
    {
      name: 'contact sheet',
      open: () => press(bubble().getByTestId('wa-sender-avatar')),
      el: () => page.getByTestId('wa-contact-sheet'),
      pick: () => press(page.getByTestId('wa-contact-sheet').getByRole('button', { name: 'Close' }).first()),
      outside: !touch,
    },
  ];
}

/** Recorre cada overlay: afuera, el botón que lo abre, Esc, elegir algo, y abrir el siguiente cierra el anterior. */
async function checkAll(page: Page, thread: Locator, text: string, touch: boolean) {
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  const list = overlays(page, thread, text, touch);
  // Un lugar neutro "afuera" (por coordenadas: un modal lo tapa): la fecha arriba de los mensajes o el
  // mensaje de abajo, el que no quede debajo del overlay. Para la ficha (modal), la esquina de la pantalla.
  const outside = async (o: Overlay) => {
    let x = 5;
    let y = 5;
    if (o.name !== 'contact sheet') {
      const over = await o.el().first().boundingBox();
      const spots = [thread.locator('.wa-day').first(), thread.locator('.gr-msg', { hasText: 'segundo' }).locator('.gr-bubble').first()];
      for (const s of spots) {
        const b = await s.boundingBox();
        if (!b) continue;
        const px = b.x + b.width / 2;
        const py = b.y + b.height / 2;
        if (over && px >= over.x && px <= over.x + over.width && py >= over.y && py <= over.y + over.height) continue;
        x = px;
        y = py;
        break;
      }
      expect(x !== 5 || y !== 5, `${o.name}: hay un lugar afuera para tocar`).toBe(true);
    }
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  const stays = async (l: Locator) => {
    await expect(l).toBeHidden();
    // El mismo toque no lo vuelve a abrir.
    await page.waitForTimeout(400);
    await expect(l).toBeHidden();
  };
  for (const o of list) {
    await test.step(o.name, async () => {
      if (o.outside) {
        await o.open();
        await expect(o.el(), `${o.name} abre`).toBeVisible();
        await outside(o);
        await stays(o.el());
      }
      if (o.trigger) {
        await o.open();
        await expect(o.el()).toBeVisible();
        await press(o.trigger());
        await stays(o.el());
      }
      await o.open();
      await expect(o.el()).toBeVisible();
      await page.keyboard.press('Escape');
      await stays(o.el());
      if (o.pick) {
        await o.open();
        await expect(o.el()).toBeVisible();
        await o.pick();
        await stays(o.el());
      }
    });
  }
  // Abrir uno cierra el que estaba abierto (sin la ficha, que es modal).
  const transient = list.filter((o) => o.name !== 'contact sheet');
  for (let i = 0; i < transient.length; i++) {
    const a = transient[i];
    const b = transient[(i + 1) % transient.length];
    // "Todos los emojis" se abre desde la barra rápida: ya la cierra por diseño.
    if (a.name === 'quick reactions' && b.name === 'all emoji') continue;
    await test.step(`${a.name} → ${b.name}`, async () => {
      await a.open();
      await expect(a.el()).toBeVisible();
      await b.open();
      await expect(b.el()).toBeVisible();
      // Dos menús: queda uno solo (el nuevo).
      await expect(a.el()).toHaveCount(a.name.endsWith('menu') && b.name.endsWith('menu') ? 1 : 0);
      await page.keyboard.press('Escape');
      await expect(b.el()).toBeHidden();
    });
  }
}

const VIEWS = [
  { label: '1280', viewport: { width: 1280, height: 800 }, touch: false },
  { label: '390 touch', viewport: { width: 390, height: 844 }, touch: true },
];

for (const view of VIEWS) {
  test.describe(`overlays ${view.label}`, () => {
    test.use({ viewport: view.viewport, hasTouch: view.touch, isMobile: view.touch });

    test('Inbox: cada overlay se cierra afuera, con Esc y al elegir; uno cierra al otro', async ({ page, request }) => {
      test.setTimeout(300_000);
      await request.post('/api/inbox/whatsapp');
      await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 30_000 }).toBe('connected');
      const [row] = await sql("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'");
      const send = async (list: unknown[]) => expect((await request.post(`/api/inbox/webhook/${row.id}/${row.webhook_secret}`, { data: { events: list } })).ok()).toBe(true);
      const { title, text } = await seed(send, uid());
      await request.get('/api/inbox/threads/ibt_warmup');
      await request.get('/api/inbox/threads/ibt_warmup/wa?part=reactions&messages=x');
      await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
      await page.locator('.ib-item', { hasText: title }).locator('.ib-row-btn').click();
      const thread = page.locator('.ib-wa-thread');
      await expect(thread.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 90_000 });
      await expect(thread.locator('.gr-msg', { hasText: text }).getByTestId('wa-reactions-chip')).toBeVisible({ timeout: 20_000 });
      await checkAll(page, thread, text, view.touch);
    });

    test('Lines: cada overlay se cierra afuera, con Esc y al elegir; uno cierra al otro', async ({ page, request }) => {
      test.setTimeout(300_000);
      const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Overlays ${uid()}` } });
      const id = ((await created.json()) as { id: string }).id;
      await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
      await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 30_000 }).toBe('connected');
      const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
      const send = async (list: unknown[]) => expect((await request.post(new URL(info.webhookUrl).pathname, { data: { events: list } })).ok()).toBe(true);
      const { title, text } = await seed(send, uid());
      await request.get('/api/groups/chats/warmup/members?reactions=x');
      await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
      await page.locator('.gr-row', { hasText: title }).click({ timeout: 60_000 });
      const thread = page.locator('.wa-thread');
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({ timeout: 30_000 });
      await expect(thread.locator('.gr-msg', { hasText: text }).getByTestId('wa-reactions-chip')).toBeVisible({ timeout: 20_000 });
      await checkAll(page, thread, text, view.touch);
    });
  });
}
