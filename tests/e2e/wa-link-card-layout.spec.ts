import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

/**
 * La tarjeta de un link como en WhatsApp, en Lines e Inbox: ocupa el ancho de
 * la burbuja (el texto largo del mensaje se acomoda abajo, nunca más ancho que
 * la tarjeta), título en negrita sin subrayar, descripción de dos líneas como
 * mucho, la imagen grande arriba o la miniatura a la izquierda. Entrantes y
 * salientes, a 1280 y 390, en los cinco aspectos (claro u oscuro).
 * Lector de links falso (DOCS_UNFURL_FAKE): /logo da un logo chico,
 * /no-image-long solo texto con una descripción larga, /twitter-image solo
 * twitter:image relativa. Con LP_SHOTS=<carpeta> guarda capturas.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
/** Cada aspecto con un modo de color (los dos se ven): actual en claro, retro en oscuro. */
const LOOKS = [
  ['current', 'light'],
  ['lines', 'dark'],
  ['classic', 'light'],
  ['liquid', 'dark'],
  ['retro', 'dark'],
] as const;
const DEFAULTS = { textSize: 'default', density: 'comfortable', linkPreviews: 'large', mediaSize: 'default', bubbleWidth: 'default', wallpaper: 'pattern', groupAvatars: true };

const LONG = 'Les paso el link de la charla de la semana que viene, es larga y tiene varios invitados, anótense antes del jueves';
/** Los mensajes: [texto, entrante o saliente, la variante que se espera]. */
const MESSAGES: Array<[string, boolean, 'large' | 'compact' | 'text']> = [
  [`${LONG} https://events.test/charla`, false, 'large'],
  ['La marca https://brand.test/logo', false, 'compact'],
  [`${LONG} https://plain.test/no-image-long`, false, 'text'],
  ['Solo twitter https://social.test/twitter-image', false, 'large'],
  [`${LONG} https://events.test/mia`, true, 'large'],
  [`Mirá https://brand.test/logo-mio y ${LONG}`, true, 'compact'],
];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

function events(phone: string, name: string, tag: string) {
  const t0 = Date.now() - 60_000;
  return MESSAGES.map(([body, out], i) => ({
    type: 'message',
    chatId: `${phone}@s.whatsapp.net`,
    isGroup: false,
    fromMe: out,
    senderPhone: phone,
    senderName: name,
    providerMessageId: `card-${tag}-${i}`,
    body,
    timestamp: new Date(t0 + i * 1000).toISOString(),
  }));
}

async function linesChat(request: APIRequestContext): Promise<string> {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Cards ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const name = `Card ${uid()}`;
  const phone = `1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const res = await request.post(new URL(webhookUrl).pathname, { data: { events: events(phone, name, uid()) } });
  expect(res.ok()).toBe(true);
  return name;
}

async function inboxChat(request: APIRequestContext): Promise<string> {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  try {
    const [acc] = (await db.execute({ sql: "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'", args: [] })).rows;
    const name = `Card ${uid()}`;
    const phone = `54911${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.webhook_secret}`, { data: { events: events(phone, name, uid()) } });
    expect(res.ok()).toBe(true);
    return name;
  } finally {
    db.close();
  }
}

/** Cada tarjeta: su variante, el ancho contra el texto de la burbuja, sin subrayado y la descripción en dos líneas. */
async function checkCards(scope: Locator, label: string) {
  for (const [body, out, layout] of MESSAGES) {
    const url = /https:\/\/\S+/.exec(body)![0];
    const msg = scope.locator(out ? '.gr-msg-out' : '.gr-msg-in', { hasText: url }).last();
    const card = msg.locator('.wa-linkcard');
    await expect(card, `${label}: ${url}`).toHaveAttribute('data-layout', layout, { timeout: 45_000 });
    if (layout === 'large') await expect(card.locator('.wa-linkcard-media img')).toBeVisible();
    if (layout === 'compact') await expect(card.locator('.wa-linkcard-thumb')).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    const m = await card.evaluate((el) => {
      const bubble = el.closest('.gr-bubble')!;
      const text = bubble.querySelector('.wa-text')!;
      const title = el.querySelector('strong')!;
      const desc = el.querySelector<HTMLElement>('.wa-linkcard-desc');
      const thumb = el.querySelector('.wa-linkcard-thumb');
      const lh = desc ? parseFloat(getComputedStyle(desc).lineHeight) : 0;
      return {
        card: el.getBoundingClientRect().width,
        text: text.getBoundingClientRect().width,
        cardLeft: el.getBoundingClientRect().left,
        thumbLeft: thumb ? thumb.getBoundingClientRect().left : null,
        underline: [getComputedStyle(el).textDecorationLine, getComputedStyle(title).textDecorationLine],
        weight: Number(getComputedStyle(title).fontWeight),
        descLines: desc ? Math.round(desc.getBoundingClientRect().height / lh) : 0,
      };
    });
    expect(m.card, `${label} ${url}: card ${m.card} vs text ${m.text}`).toBeGreaterThanOrEqual(m.text * 0.95);
    expect(m.underline).toEqual(['none', 'none']);
    expect(m.weight).toBeGreaterThanOrEqual(600);
    expect(m.descLines).toBeLessThanOrEqual(2);
    if (m.thumbLeft !== null) expect(Math.abs(m.thumbLeft - m.cardLeft)).toBeLessThanOrEqual(1);
  }
  // Al pasar el mouse tampoco se subraya.
  const first = scope.locator('.wa-linkcard').first();
  await first.hover();
  expect(await first.locator('strong').evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

async function shot(page: Page, name: string, el: Locator) {
  const dir = process.env.LP_SHOTS;
  if (dir) await el.screenshot({ path: `${dir}/card-${name}.png` });
}

test.describe.configure({ timeout: 300_000 });

test.afterEach(async ({ request }) => {
  await request.put('/api/profile/look', { data: { look: 'current' } });
});

test('la tarjeta del link ocupa la burbuja, sin subrayado y con dos líneas de descripción (Lines e Inbox, 5 aspectos)', async ({ page, context, baseURL, request }) => {
  const errors = watchErrors(page);
  await request.put('/api/chat-style', { data: { style: 'whatsapp', display: DEFAULTS } });
  const lines = await linesChat(request);
  const inbox = await inboxChat(request);
  const apps = [
    { app: 'lines', name: lines, scope: () => page.locator('.wa-messages') },
    { app: 'inbox', name: inbox, scope: () => page.locator('.ib-wa-thread') },
  ];
  for (const [look, theme] of LOOKS) {
    await request.put('/api/profile/look', { data: { look } });
    await context.addCookies([
      { name: 'zs_theme', value: theme, url: baseURL! },
      { name: 'zs_look', value: look, url: baseURL! },
    ]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 860 : 844 });
      for (const { app, name, scope } of apps) {
        if (app === 'lines') {
          await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
          const link = page.getByRole('link', { name: new RegExp(name) }).first();
          await expect(link).toBeVisible({ timeout: 30_000 });
          await page.goto((await link.getAttribute('href'))!, { waitUntil: 'networkidle' });
        } else {
          await page.goto('/en/app/inbox', { waitUntil: 'networkidle' });
          await page.locator('.ib-item', { hasText: name }).locator('.ib-row-btn').click();
        }
        await expect(page.locator('html')).toHaveAttribute('data-look', look);
        const label = `${app} ${look} ${theme} ${width}`;
        await checkCards(scope(), label);
        await noHorizontalScroll(page);
        if (look === 'current' || look === 'retro') {
          const big = scope().locator('.gr-msg-in', { hasText: 'events.test/charla' }).last();
          await big.scrollIntoViewIfNeeded();
          await shot(page, `${app}-${look}-${theme}-${width}`, scope());
        }
      }
    }
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
