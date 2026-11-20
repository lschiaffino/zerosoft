import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';
import { setTheme } from './responsive-audit';

/**
 * Invitación a un grupo de WhatsApp en un chat (Lines e Inbox): la tarjeta
 * propia con la foto redonda, el nombre del grupo (sin "WhatsApp Group
 * Invite"), el subtítulo y los botones; "Unirme al grupo" pide confirmación,
 * entra con el WhatsApp falso y muestra "Abrir grupo"; un link vencido dice
 * por qué. En los cinco aspectos, claro y oscuro, a 1280 y 390, sin scroll
 * de costado. El lector de links falso arma la página de la invitación
 * ("Club de Lectura"). Códigos inventados. Con INV_SHOTS=<carpeta> guarda capturas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const DEFAULTS = {
  textSize: 'default',
  density: 'comfortable',
  linkPreviews: 'large',
  mediaSize: 'default',
  bubbleWidth: 'default',
  wallpaper: 'pattern',
  groupAvatars: true,
};

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const dir = process.env.INV_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/invite-${name}.png` });
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

const inviteText = (code: string) => `You have been invited to join my WhatsApp group: https://chat.whatsapp.com/${code}`;

/** Un número falso de Lines conectado con un chat que trae dos invitaciones (una buena y una vencida). */
async function linesChat(request: APIRequestContext, good: string, bad: string): Promise<{ name: string; line: string }> {
  const line = `Ventas ${uid()}`;
  const created = await request.post('/api/groups/numbers', {
    data: { provider: 'fake', name: line },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, {
    data: { action: 'connect' },
  });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const name = `Invita ${uid()}`;
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const t0 = Date.now() - 60_000;
  const res = await request.post(new URL(webhookUrl).pathname, {
    data: {
      events: [`Vencida: https://chat.whatsapp.com/${bad}`, inviteText(good)].map((body, i) => ({
        type: 'message',
        chatId: `${phone}@s.whatsapp.net`,
        isGroup: false,
        fromMe: false,
        senderPhone: phone,
        senderName: name,
        providerMessageId: `inv-${uid()}-${i}`,
        body,
        timestamp: new Date(t0 + i * 1000).toISOString(),
      })),
    },
  });
  expect(res.ok()).toBe(true);
  return { name, line };
}

/** La tarjeta en los cinco aspectos, claro y oscuro, a 1280 y 390: nombre, subtítulo, botón y sin scroll de costado. */
async function everyLook(page: Page, context: BrowserContext, baseURL: string, request: APIRequestContext, card: () => ReturnType<Page['locator']>, app: string, open: () => Promise<void>) {
  try {
    // Cada aspecto en claro y oscuro, a 1280 y 390 (alternados para que entre en el tiempo), más retro oscuro a 1280.
    const combos = LOOKS.flatMap((look, i) =>
      i % 2 === 0
        ? [
            { look, theme: 'light' as const, width: 1280 },
            { look, theme: 'dark' as const, width: 390 },
          ]
        : [
            { look, theme: 'dark' as const, width: 1280 },
            { look, theme: 'light' as const, width: 390 },
          ],
    );
    combos.push({ look: 'retro', theme: 'dark', width: 1280 });
    for (const { look, theme, width } of combos) {
      expect((await request.put('/api/profile/look', { data: { look } })).ok()).toBe(true);
      {
        await setTheme(context, baseURL, theme);
        {
          await page.setViewportSize({
            width,
            height: width > 500 ? 860 : 844,
          });
          await open();
          await expect(page.locator('html')).toHaveAttribute('data-look', look);
          const c = card();
          await expect(c.getByTestId('wa-invite-name')).toHaveText('Club de Lectura', { timeout: 30_000 });
          await expect(c.getByTestId('wa-invite-subtitle')).toHaveText('WhatsApp group invite');
          await expect(c.getByTestId('wa-invite-join')).toBeVisible();
          await expect(c.getByTestId('wa-invite-open')).toHaveAttribute('href', /^https:\/\/chat\.whatsapp\.com\//);
          // La foto entera y redonda (cuadrada en la caja), no una columna recortada.
          const photo = c.locator('.wa-invite-photo img');
          await expect(photo).toBeVisible();
          await c.scrollIntoViewIfNeeded();
          await expect(photo).toHaveAttribute('src', /^\/api\/wa\/link-preview\/image\?url=https%3A%2F%2Fchat\.whatsapp\.com/);
          // La foto llega (la cuadrada de 640 del lector falso), no queda el círculo vacío.
          await expect.poll(() => photo.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 60_000 }).toBe(640);
          const pb = (await photo.boundingBox())!;
          expect(Math.abs(pb.width - pb.height)).toBeLessThanOrEqual(1);
          await c.scrollIntoViewIfNeeded();
          const cb = (await c.boundingBox())!;
          expect(cb.width).toBeLessThanOrEqual(320);
          expect(cb.x + cb.width).toBeLessThanOrEqual(width);
          await noHorizontalScroll(page);
          if ((look === 'current' && theme === 'light') || (look === 'retro' && theme === 'dark')) await shot(page, `${app}-${look}-${theme}-${width}`);
        }
      }
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } });
    await setTheme(context, baseURL, 'light');
  }
}

test.describe.configure({ timeout: 600_000 });

test.beforeEach(async ({ request }) => {
  await request.put('/api/chat-style', {
    data: { style: 'whatsapp', display: DEFAULTS },
  });
});

test('Lines: la invitación tiene su tarjeta; Unirme pide confirmación, entra y abre el grupo', async ({ page, context, baseURL, request }) => {
  const errors = watchErrors(page);
  const good = `E2eInv${uid()}${uid()}`;
  const { name, line } = await linesChat(request, good, `badInv${uid()}${uid()}`);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  const link = page.getByRole('link', { name: new RegExp(name) }).first();
  await expect(link).toBeVisible({ timeout: 90_000 });
  const chatUrl = (await link.getAttribute('href'))!;
  const msgs = page.locator('.wa-messages');
  const card = () => msgs.locator('.gr-msg', { hasText: 'invited to join' }).getByTestId('wa-invite-card');
  await everyLook(page, context, baseURL!, request, card, 'lines', () => page.goto(chatUrl, { waitUntil: 'networkidle' }).then(() => undefined));

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(chatUrl, { waitUntil: 'networkidle' });
  // El texto del mensaje queda, con el link.
  await expect(msgs.locator('.gr-msg', { hasText: 'invited to join' })).toContainText(`chat.whatsapp.com/${good}`);
  // Unirme: primero la confirmación (entrar se ve en el grupo); Cancelar no hace nada.
  await card().getByTestId('wa-invite-join').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(`Join «Club de Lectura» from ${line}?`);
  await dialog.getByTestId('confirm-dialog-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(card().getByTestId('wa-invite-status')).toHaveCount(0);
  await card().getByTestId('wa-invite-join').click();
  await dialog.getByTestId('confirm-dialog-confirm').click();
  await expect(card().getByTestId('wa-invite-status')).toHaveAttribute('data-state', 'joined', { timeout: 45_000 });
  await expect(card().getByTestId('wa-invite-join')).toHaveCount(0);
  await shot(page, 'lines-joined-1280');
  // Abrir grupo lleva al chat del grupo nuevo.
  await card().getByTestId('wa-invite-open-chat').click();
  await expect(page).not.toHaveURL(chatUrl);
  await expect(page).toHaveURL(/\/app\/lines\/inbox\/[^/?#]+/);

  // El link vencido: dice por qué.
  await page.goto(chatUrl, { waitUntil: 'networkidle' });
  const bad = msgs.locator('.gr-msg', { hasText: 'Vencida' }).getByTestId('wa-invite-card');
  await bad.getByTestId('wa-invite-join').click();
  await page.getByRole('alertdialog').getByTestId('confirm-dialog-confirm').click();
  await expect(bad.getByTestId('wa-invite-status')).toHaveAttribute('data-state', 'error', { timeout: 45_000 });
  await expect(bad.getByTestId('wa-invite-status')).toContainText('invalid');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Inbox: la misma tarjeta; Unirme pide confirmación y entra con la cuenta (también a 390)', async ({ page, context, baseURL, request }) => {
  const errors = watchErrors(page);
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect
    .poll(
      async () =>
        (
          (await (await request.get('/api/inbox/whatsapp')).json()) as {
            state: { status: string };
          }
        ).state.status,
      { timeout: 10_000 },
    )
    .toBe('connected');
  const tag = uid();
  const good = `E2eInb${uid()}${uid()}`;
  const db = e2eDb();
  try {
    const [acc] = (
      await db.execute({
        sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'",
        args: [],
      })
    ).rows;
    const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, {
      data: {
        events: [
          {
            type: 'message',
            chatId: `${phone}@s.whatsapp.net`,
            isGroup: false,
            fromMe: false,
            senderPhone: phone,
            senderName: `Bruno ${tag}`,
            providerMessageId: `inv-${tag}`,
            body: inviteText(good),
            timestamp: new Date().toISOString(),
          },
        ],
      },
    });
    expect(res.ok()).toBe(true);
  } finally {
    db.close();
  }
  const thread = page.locator('.ib-wa-thread');
  const card = () => thread.locator('.gr-msg', { hasText: 'invited to join' }).getByTestId('wa-invite-card');
  const open = async () => {
    await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
    // Un clic antes de que la página termine de hidratar se pierde: se repite hasta que abre el chat.
    await expect(async () => {
      await page
        .locator('.ib-item', { hasText: `Bruno ${tag}` })
        .locator('.ib-row-btn')
        .click();
      await expect(thread).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
  };
  await everyLook(page, context, baseURL!, request, card, 'inbox', open);

  // A 390: confirmar y entrar.
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  await card().getByTestId('wa-invite-join').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Join «Club de Lectura»');
  await dialog.getByTestId('confirm-dialog-confirm').click();
  await expect(card().getByTestId('wa-invite-status')).toHaveAttribute('data-state', 'joined', { timeout: 45_000 });
  await noHorizontalScroll(page);
  await shot(page, 'inbox-joined-390');
  await card().getByTestId('wa-invite-open-chat').click();
  await expect(thread.locator('.gr-msg', { hasText: 'invited to join' })).toHaveCount(0, { timeout: 20_000 });
  // Otra vez con el mismo link: ya está en el grupo.
  await open();
  await card().getByTestId('wa-invite-join').click();
  await page.getByRole('alertdialog').getByTestId('confirm-dialog-confirm').click();
  await expect(card().getByTestId('wa-invite-status')).toHaveAttribute('data-state', 'error', { timeout: 45_000 });
  await expect(card().getByTestId('wa-invite-status')).toContainText('already');
  expect(errors, errors.join('\n')).toEqual([]);
});
