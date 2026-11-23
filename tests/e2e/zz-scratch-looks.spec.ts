import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { e2eDb } from './helpers/db';
import { waLinkIp } from './helpers/wa-link';

// SCRATCH: no se commitea. Capturas para la pasada visual de Líquido y Retro.
const DIR = process.env.SHOTS ?? 'e2e-results/shots';
// CSS en prueba (se inyecta en cada página).
const CSS = `/* ============================================================
   Lines e Inbox en los aspectos Líquido y Retro (lib/look.ts).
   La bandeja tiene su paleta propia (--wa-* en styles/groups-wa.css, con
   el estilo de chats WhatsApp o zerosoft), así que las reglas generales de
   styles/looks.css y styles/looks-retro.css no le llegaban: acá se le
   pasan los tokens y las formas de cada aspecto. Lo cargan los layouts de
   Lines y de Inbox, después de groups-wa.css.
   \`html[data-look]\` (0,2,2 con .gr-inbox) gana a los bloques oscuros de
   groups-wa.css (0,2,1); el estilo zerosoft (0,3,0) lleva su propio bloque.
   ============================================================ */

/* ---------- Líquido ---------- */

/* Chips, pestañas y etiquetas chicas: con la esquina de 10px del aspecto quedaban como pastillas. */
html[data-look='liquid'] :is(.gr-inbox, .wa-contact-sheet) :is(.gr-view, .gr-filter, .gr-line-badge, .wa-gm-badge, .wa-archived-tag, .ib-tabs .ui-tab, .gr-row-meta .badge) {
  border-radius: 6px;
}
/* El panel de emoji, GIF y stickers flota sobre el chat como los demás menús: vidrio. */
html[data-look='liquid'] .gr-inbox .wa-emoji {
  background-color: var(--pop-bg);
  background-image: var(--glass-sheen);
  border: 1px solid var(--pop-edge);
  border-radius: var(--radius-pop);
  box-shadow: var(--pop-shadow);
  -webkit-backdrop-filter: var(--pop-blur);
  backdrop-filter: var(--pop-blur);
}
html[data-look='liquid'] .gr-inbox .wa-emoji-title { background: transparent; }

/* ---------- Retro: tokens de la bandeja ---------- */

/* Estilo WhatsApp: la lista es un campo blanco hundido, encabezado y composer en la cara gris, el chat sobre el
   verde azulado del escritorio. Las burbujas salientes conservan su verde (es el estilo WhatsApp). */
html[data-look='retro'] :is(.gr-inbox, .wa-contact-sheet, .wa-rx-pop, .ib-wa-react-full.is-floating) {
  --wa-panel: var(--rt-field);
  --wa-panel-header: var(--rt-face);
  --wa-conv-bg: var(--rt-desk);
  --wa-doodle: transparent;
  --wa-bubble-in: var(--rt-field);
  --wa-primary: var(--rt-select);
  --wa-primary-ink: var(--ink);
  --wa-badge: var(--rt-select);
  --wa-badge-ink: var(--rt-select-fg);
  --wa-text: var(--ink);
  --wa-text-2: var(--brand-gray-3);
  --wa-icon: var(--ink);
  --wa-border: transparent;
  --wa-border-strong: var(--rt-shadow);
  --wa-row-hover: var(--brand-enamel);
  --wa-row-active: var(--rt-select);
  --wa-search-bg: var(--rt-field);
  --wa-chip-bg: var(--rt-face);
  --wa-chip-on-bg: var(--brand-enamel);
  --wa-chip-on-ink: var(--ink);
  --wa-mention-ink: var(--ink);
  --wa-system-chip: var(--rt-face);
  --wa-shadow-bubble: none;
  --wa-input: var(--rt-field);
  --wa-menu: var(--rt-face);
  --wa-reply-surface: var(--rt-face);
  --wa-font: var(--font-ui);
}
/* Estilo zerosoft: lo mismo con las burbujas de la app (entrantes blancas, salientes en el color de selección). */
html[data-look='retro'] .gr-inbox[data-chat-style='zerosoft'] {
  --wa-panel: var(--rt-field);
  --wa-panel-header: var(--rt-face);
  --wa-conv-bg: var(--rt-desk);
  --wa-bubble-in: var(--rt-field);
  --wa-bubble-out: var(--ui-selected);
  --wa-meta-out: var(--brand-gray-2);
  --wa-primary: var(--rt-select);
  --wa-badge: var(--rt-select);
  --wa-badge-ink: var(--rt-select-fg);
  --wa-tick-blue: var(--rt-select);
  --wa-text-2: var(--brand-gray-3);
  --wa-border: transparent;
  --wa-border-strong: var(--rt-shadow);
  --wa-row-hover: var(--brand-enamel);
  --wa-row-active: var(--rt-select);
  --wa-search-bg: var(--rt-field);
  --wa-chip-bg: var(--rt-face);
  --wa-chip-on-bg: var(--brand-enamel);
  --wa-system-chip: var(--rt-face);
  --wa-quote-bg: var(--rt-face);
  --wa-input: var(--rt-field);
  --wa-menu: var(--rt-face);
  --wa-reply-surface: var(--rt-face);
}
/* La fila abierta es una selección de Windows: azul con texto blanco (los tokens de la fila pasan a sus hijos). */
html[data-look='retro'] .gr-inbox :is(.gr-row.is-active, li.ib-item.is-open > .ib-row-btn, li.ib-item.is-selected > .ib-row-btn) {
  --wa-text: var(--rt-select-fg);
  --wa-text-2: var(--rt-select-fg);
  --wa-icon: var(--rt-select-fg);
  --wa-tick-blue: var(--rt-select-fg);
  --wa-meta-out: var(--rt-select-fg);
  color: var(--rt-select-fg);
}
html[data-look='retro'] .gr-inbox :is(.gr-row.is-active, li.ib-item.is-open > .ib-row-btn) :is(.gr-line-badge, .badge) { color: var(--ink); background: var(--rt-face); }

/* ---------- Retro: paneles ---------- */

html[data-look='retro'] .gr-inbox :is(.gr-list-head, .ib-list-head) { background: var(--rt-face); }
html[data-look='retro'] .gr-inbox :is(.gr-rows, .ib-list) { box-shadow: var(--rt-sunken); }
html[data-look='retro'] .gr-inbox :is(.gr-list, .ib-list-pane, .gr-thread) { border-right: 0; }
html[data-look='retro'] .gr-inbox .gr-details,
html[data-look='retro'] .ib-app.gr-inbox .ib-details { background: var(--rt-face); box-shadow: inset 1px 0 var(--rt-light), inset 2px 0 var(--rt-hi); }
/* Encabezado del chat y composer: barras de herramientas con el filete grabado. */
html[data-look='retro'] .gr-inbox .wa-head { border-bottom: 0; box-shadow: inset 0 -1px var(--rt-shadow), inset 0 -2px var(--rt-light); }
html[data-look='retro'] .gr-inbox .wa-composer { box-shadow: inset 0 1px var(--rt-light); }
html[data-look='retro'] .gr-inbox .gr-pinned { border-bottom: 0; box-shadow: inset 0 -1px var(--rt-shadow); }

/* ---------- Retro: campos y botones ---------- */

html[data-look='retro'] .gr-inbox :is(.gr-search, .wa-input, .ib-search .input) {
  background: var(--rt-field);
  border: 0;
  border-radius: 0;
  box-shadow: var(--rt-sunken);
}
html[data-look='retro'] .gr-inbox :is(.gr-search, .wa-input, .ib-search .input):focus-visible { outline: 1px dotted var(--ink); outline-offset: -4px; }
html[data-look='retro'] .wa-composer.is-note .wa-input { background: var(--wa-note); }

/* Pestañas de filtro y listas guardadas: botones en relieve; la elegida, hundida y en negrita. */
html[data-look='retro'] .gr-inbox :is(.gr-filter, .gr-view, .ib-tabs .ui-tab) {
  color: var(--ink);
  background: var(--rt-face);
  border: 0;
  border-radius: 0;
  box-shadow: var(--rt-raised);
}
html[data-look='retro'] .gr-inbox :is(.gr-filter, .gr-view, .ib-tabs .ui-tab):hover { color: var(--ink); background: var(--rt-face); }
html[data-look='retro'] .gr-inbox :is(.gr-filter.is-on, .gr-view.is-on, .ib-tabs .ui-tab.is-active) {
  color: var(--ink);
  background: var(--brand-enamel);
  box-shadow: var(--rt-pressed);
  font-weight: 700;
}
html[data-look='retro'] .gr-inbox :is(.gr-filter, .gr-view, .ib-tabs .ui-tab):focus-visible { outline: 1px dotted var(--ink); outline-offset: -4px; }

/* Botones de ícono: planos como en una barra de herramientas; en relieve al pasar, hundidos al estar activos. */
html[data-look='retro'] :is(.gr-inbox, .wa-contact-sheet) :is(.wa-icon-btn, .wa-react-btn) { border-radius: 0; }
html[data-look='retro'] :is(.gr-inbox, .wa-contact-sheet) :is(.wa-icon-btn, .wa-react-btn):hover { background: transparent; box-shadow: var(--rt-raised); }
html[data-look='retro'] :is(.gr-inbox, .wa-contact-sheet) .wa-icon-btn:is(.is-on, [aria-pressed='true'], [aria-expanded='true']) {
  color: var(--ink);
  background: var(--brand-enamel);
  box-shadow: var(--rt-pressed);
}
html[data-look='retro'] :is(.gr-inbox, .wa-contact-sheet) :is(.wa-icon-btn, .wa-react-btn, .wa-send):focus-visible { outline: 1px dotted var(--ink); outline-offset: -5px; }
/* Enviar y grabar: el botón por defecto de la ventana (relieve con marco). */
html[data-look='retro'] .gr-inbox .wa-send,
html[data-look='retro'] .gr-inbox[data-chat-style='zerosoft'] .wa-send {
  color: var(--ink);
  background: var(--rt-face);
  border-radius: 0;
  box-shadow: 0 0 0 1px var(--rt-dark), var(--rt-raised);
}
html[data-look='retro'] .gr-inbox :is(.wa-send.is-mic, .wa-send:disabled),
html[data-look='retro'] .gr-inbox[data-chat-style='zerosoft'] :is(.wa-send.is-mic, .wa-send:disabled) { color: var(--ink); background: var(--rt-face); box-shadow: var(--rt-raised); }
html[data-look='retro'] .gr-inbox .wa-send:disabled { color: var(--rt-shadow); text-shadow: 1px 1px var(--rt-light); }
html[data-look='retro'] .gr-inbox .wa-send:active:not(:disabled) { box-shadow: 0 0 0 1px var(--rt-dark), var(--rt-pressed); transform: none; }
html[data-look='retro'] .gr-inbox .wa-to-end { border-radius: 0; background: var(--rt-face); box-shadow: var(--rt-raised); }

/* ---------- Retro: mensajes ---------- */

/* Burbujas: ventanitas cuadradas con borde en relieve, sin cola. */
html[data-look='retro'] .gr-inbox .gr-bubble,
html[data-look='retro'] .gr-inbox[data-chat-style='zerosoft'] .gr-bubble { border: 0; border-radius: 0; box-shadow: var(--rt-window); }
html[data-look='retro'] .gr-inbox .gr-msg.has-tail .gr-bubble { border-radius: 0; }
html[data-look='retro'] .gr-inbox .gr-msg.has-tail .gr-bubble::before { display: none; }
html[data-look='retro'] .gr-inbox .gr-msg.is-bare .gr-bubble { box-shadow: none; }
html[data-look='retro'] .gr-inbox .gr-msg.is-bare .gr-msg-foot { border-radius: 0; }
html[data-look='retro'] .gr-inbox .gr-msg-note .gr-bubble { border: 0; border-radius: 0; box-shadow: var(--rt-window); }
/* Fechas, avisos del grupo y "mensajes sin leer": etiquetas en relieve sobre el escritorio. */
html[data-look='retro'] .gr-inbox :is(.wa-day > span, .gr-system, .wa-empty-thread, .wa-unread-sep > span, .wa-older-chip) {
  color: var(--ink);
  background: var(--rt-face);
  border-radius: 0;
  box-shadow: var(--rt-raised);
}
html[data-look='retro'] .gr-inbox .wa-unread-sep { background: transparent; }
html[data-look='retro'] .gr-inbox :is(.gr-quote, .wa-replying, .wa-image, .wa-video-thumb, .wa-video, .wa-doc, .wa-location, .wa-media-ph, .wa-tray, .wa-tray-item > img) { border-radius: 0; }
html[data-look='retro'] .gr-inbox .gr-bubble.is-media:not(:has(.wa-text)) .gr-msg-foot { border-radius: 0; }
html[data-look='retro'] .gr-inbox .wa-chevron { border-radius: 0; }
html[data-look='retro'] .gr-inbox .gr-reactions { background: var(--rt-face); border: 0; border-radius: 0; box-shadow: var(--rt-raised); }
html[data-look='retro'] .gr-inbox :is(.gr-unread, .wa-unread, .wa-to-end-n, .wa-gm-badge, .gr-line-badge) { border-radius: 0; }
html[data-look='retro'] .gr-inbox .gr-emoji-picker button { border-radius: 0; }
html[data-look='retro'] .gr-inbox .gr-emoji-picker button:is(:hover, :focus-visible) { background: transparent; box-shadow: var(--rt-raised); transform: none; }

/* Panel de emoji, GIF y stickers: una ventana más. */
html[data-look='retro'] .gr-inbox .wa-emoji { background: var(--rt-face); border-radius: 0; box-shadow: var(--pop-shadow); }
html[data-look='retro'] .gr-inbox .wa-emoji-grid button { border-radius: 0; }
html[data-look='retro'] .gr-inbox .wa-emoji-grid button:is(:hover, :focus-visible) { color: var(--rt-select-fg); background: var(--rt-select); }
`;
const LOOKS = (process.env.LOOKS ?? 'liquid,retro').split(',');
const CONFIGS = (process.env.CONFIGS ?? 'dark-1280,light-390,light-1280,dark-390').split(',');
const STYLES = (process.env.STYLES ?? 'whatsapp,zerosoft').split(',');
const APPS = (process.env.APPS ?? 'lines,inbox').split(',');
const STATES = process.env.STATES ? process.env.STATES.split(',') : null;
const RT = process.env.RT === '1';

const uid = () => Math.random().toString(36).slice(2, 8);
type Ev = Record<string, unknown>;

function msgs(gid: string, title: string, tag: string): Ev[] {
  const t0 = Date.now() - 2 * 86_400_000;
  const at = (m: number) => new Date(t0 + m * 60_000).toISOString();
  const base = (o: Ev): Ev => ({ type: 'message', chatId: gid, isGroup: true, fromMe: false, senderPhone: '15550001002', senderName: 'Beto Prueba', body: '', ...o });
  const ref = (id: string) => ({ providerMessageId: id, chatId: gid, fromMe: false });
  return [
    base({ chatName: title, providerMessageId: `g1-${tag}`, body: '¿Quién viene el sábado? *Traigan* _algo_ para tomar', timestamp: at(0) }),
    base({ providerMessageId: `g2-${tag}`, senderPhone: '15550001003', senderName: 'Carla Prueba', body: 'Yo voy 🙋‍♀️', timestamp: at(1) }),
    base({ providerMessageId: `img-${tag}`, body: 'Así quedó la terraza', media: { url: '', type: 'image/png', name: '', fetchRef: ref(`img-${tag}`), info: { kind: 'image', width: 480, height: 320 } }, timestamp: at(3) }),
    base({ providerMessageId: `aud-${tag}`, senderPhone: '15550001004', senderName: 'Dani Prueba', media: { url: '', type: 'audio/ogg', name: '', fetchRef: ref(`aud-${tag}`), info: { kind: 'voice', ptt: true, duration: 2 } }, timestamp: at(4) }),
    base({ providerMessageId: `doc-${tag}`, senderPhone: '15550001004', senderName: 'Dani Prueba', media: { url: '', type: 'application/pdf', name: 'Lista de compras.pdf', fetchRef: ref(`doc-${tag}`), info: { kind: 'document', pages: 2, size: 48_000 } }, timestamp: at(5) }),
    base({ providerMessageId: `g4-${tag}`, fromMe: true, senderPhone: '', senderName: '', body: 'Yo llevo la carne', status: 'read', replyToProviderId: `g1-${tag}`, timestamp: at(6) }),
    base({ providerMessageId: `g5-${tag}`, location: { lat: -34.6, lng: -58.38, name: 'Plaza de prueba', address: 'Av. Inventada 123' }, timestamp: at(7) }),
    base({ providerMessageId: `g7-${tag}`, poll: { question: '¿A qué hora?', options: ['12:00', '13:00', '14:00'], multi: false }, timestamp: at(9) }),
    base({ providerMessageId: `g8-${tag}`, senderPhone: '15550001004', senderName: 'Dani Prueba', body: 'Les paso esto que me llegó', forwarded: true, timestamp: at(10) }),
    base({ providerMessageId: `g9-${tag}`, senderPhone: '15550001003', senderName: 'Carla Prueba', body: 'La receta: https://example.test/receta', timestamp: at(11) }),
    base({ providerMessageId: `g10-${tag}`, fromMe: true, senderPhone: '', senderName: '', body: '👍', status: 'delivered', timestamp: new Date().toISOString() }),
  ];
}
function dm(name: string, phone: string, tag: string): Ev[] {
  return [
    { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `d1-${tag}`, body: 'Hola, ¿me pasás el presupuesto actualizado con los cambios que hablamos ayer?', timestamp: new Date().toISOString() },
  ];
}

async function seedLines(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Looks ${uid()}` } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect.poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 }).toBe('connected');
  const { webhookUrl } = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  const send = (l: Ev[]) => request.post(new URL(webhookUrl).pathname, { data: { events: l } });
  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  await send(msgs(gid, 'Asado del sábado con todo el equipo de ventas y operaciones', tag));
  await send(dm('Mariana Fernández de la Torre Guzmán', `1555${Math.floor(1e6 + Math.random() * 8e6)}`, tag));
  await send(dm('Leo Prueba', `1555${Math.floor(1e6 + Math.random() * 8e6)}`, `${tag}b`));
}

async function seedInbox(request: APIRequestContext) {
  await request.post('/api/inbox/whatsapp', waLinkIp());
  await expect.poll(async () => ((await (await request.get('/api/inbox/whatsapp')).json()) as { state: { status: string } }).state.status, { timeout: 10_000 }).toBe('connected');
  const db = e2eDb();
  const [row] = (await db.execute("SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'")).rows as unknown as Array<Record<string, unknown>>;
  db.close();
  const send = (l: Ev[]) => request.post(`/api/inbox/webhook/${row.id}/${row.webhook_secret}`, { data: { events: l } });
  const tag = uid();
  const gid = `1203630${Math.floor(1e9 + Math.random() * 8e9)}@g.us`;
  await send(msgs(gid, 'Asado del sábado con todo el equipo de ventas y operaciones', tag));
  await send(dm('Mariana Fernández de la Torre Guzmán', `1555${Math.floor(1e6 + Math.random() * 8e6)}`, tag));
  await send(dm('Leo Prueba', `1555${Math.floor(1e6 + Math.random() * 8e6)}`, `${tag}b`));
}

test.use({ actionTimeout: 8_000, navigationTimeout: 45_000 });

const notes: string[] = [];
async function shot(page: Page, name: string) {
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  if (overflow > 1) notes.push(`${name}: scroll lateral ${overflow}px`);
  await page.screenshot({ path: `${DIR}/${name}.png` });
  console.log(`[shot] ${name}`);
  notes.length && console.log(notes[notes.length - 1]);
}
async function tryStep(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    notes.push(`${name}: FALLÓ ${(e as Error).message.split('\n')[0]}`);
  }
}
const want = (s: string) => !STATES || STATES.includes(s);

async function run(page: Page, context: import('@playwright/test').BrowserContext, request: APIRequestContext, baseURL: string, look: string, style: string, cfg: string, rt: boolean, only: string[] | null) {
  await request.put('/api/profile/look', { data: { look } });
  await request.put('/api/chat-style', { data: { style } });
  const [theme, w] = cfg.split('-');
  const width = Number(w);
  await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
  await page.setViewportSize({ width, height: width > 500 ? 800 : 844 });
  const mobile = width < 500;
  const has = (s: string) => (!only || only.includes(s)) && want(s);
  for (const app of APPS) {
    const p = `${app}-${look}-${style}-${cfg}${rt ? '-rt' : ''}`;
    const listUrl = app === 'lines' ? '/en/app/lines/inbox' : '/en/app/inbox';
    const row = app === 'lines' ? page.getByTestId('chat-row') : page.locator('.ib-item');
    const openChat = async (text: string) => {
      await page.goto(listUrl, { waitUntil: 'networkidle' });
      const r = row.filter({ hasText: text }).first();
      await (app === 'lines' ? r.click() : r.locator('.ib-row-btn').click());
      await expect(page.locator('.wa-composer')).toBeVisible({ timeout: 20_000 });
    };
    if (has('list')) await tryStep(`${p}-list`, async () => {
      await page.goto(listUrl, { waitUntil: 'networkidle' });
      await expect(row.first()).toBeVisible({ timeout: 30_000 });
      await shot(page, `${p}-01-list`);
      await row.nth(1).hover();
      await shot(page, `${p}-01b-list-hover`);
    });
    if (has('chat')) await tryStep(`${p}-chat`, async () => {
      await openChat('Asado');
      await shot(page, `${p}-02-chat`);
      const msg = page.locator('.gr-msg-in').filter({ hasText: 'Les paso' }).first();
      if (!mobile) {
        await msg.hover();
        await msg.locator('.wa-chevron').click();
        await shot(page, `${p}-03-msgmenu`);
        await page.keyboard.press('Escape');
      }
      await page.locator('.wa-composer [data-emoji-toggle]').click();
      await shot(page, `${p}-04-emoji`);
      await page.keyboard.press('Escape');
      await page.locator('.wa-composer .wa-attach').first().click();
      await shot(page, `${p}-05-plus`);
      await page.keyboard.press('Escape');
      await page.locator('.wa-head-avatar').first().click();
      await shot(page, `${p}-06-info`);
    });
    if (has('select')) await tryStep(`${p}-select`, async () => {
      await openChat('Asado');
      const msg = page.locator('.gr-msg-in').filter({ hasText: 'Les paso' }).first();
      await msg.hover();
      await msg.locator('.wa-chevron').click({ force: true });
      await page.getByTestId('menu-select').click();
      await shot(page, `${p}-07-select`);
    });
    if (has('dm')) await tryStep(`${p}-dm`, async () => {
      await openChat('Mariana');
      await page.locator('.wa-composer textarea').first().fill('Te lo mando hoy a la tarde sin falta');
      await shot(page, `${p}-08-dm`);
      await page.getByTestId('chat-search-open').first().click();
      await page.getByTestId('chat-search-input').fill('presu');
      await shot(page, `${p}-09-search`);
    });
    if (has('settings')) await tryStep(`${p}-settings`, async () => {
      await page.goto(app === 'lines' ? '/en/app/lines/settings?tab=appearance' : '/en/app/inbox/settings', { waitUntil: 'networkidle' });
      await shot(page, `${p}-10-settings`);
    });
    if (app === 'lines' && has('tables')) await tryStep(`${p}-tables`, async () => {
      await page.goto('/en/app/lines/list', { waitUntil: 'networkidle' });
      await shot(page, `${p}-11-groups`);
      await page.goto('/en/app/lines/settings?tab=numbers', { waitUntil: 'networkidle' });
      await shot(page, `${p}-12-numbers`);
    });
  }
}

test('scratch looks', async ({ page, context, request, baseURL }) => {
  test.setTimeout(3_600_000);
  if (CSS) await page.addInitScript((css) => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }), CSS);
  if (APPS.includes('lines')) await seedLines(request);
  if (APPS.includes('inbox')) await seedInbox(request);
  for (const look of LOOKS) {
    for (const cfg of CONFIGS) {
      for (const style of STYLES) await run(page, context, request, baseURL!, look, style, cfg, false, style === 'whatsapp' ? null : ['list', 'chat']);
    }
  }
  if (RT || LOOKS.includes('liquid')) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    for (const cfg of ['dark-1280', 'light-390']) await run(page, context, request, baseURL!, 'liquid', 'whatsapp', cfg, true, ['list', 'chat']);
  }
  await request.put('/api/profile/look', { data: { look: 'current' } });
  console.log('NOTES\n' + notes.join('\n'));
});
