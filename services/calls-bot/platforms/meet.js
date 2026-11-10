// Google Meet adapter. Joins anonymously (no Google account), so a host has to
// admit the bot unless the meeting has open access.
//
// Selectors favour aria-labels and visible text in English (the browser runs
// with locale en-US, so Meet renders in English), with Spanish and Portuguese
// fallbacks. The fake meeting in fake-meet/ mimics exactly these selectors.
import { AdapterError } from './errors.js';

/** @param {string[]} list */
const any = (list) => list.join(', ');

export const SEL = {
  nameInput: any([
    'input[aria-label="Your name" i]',
    'input[placeholder="Your name" i]',
    'input[aria-label="Tu nombre" i]',
    'input[aria-label="Seu nome" i]',
  ]),
  micOff: any([
    '[role="button"][aria-label^="Turn off microphone" i]',
    'button[aria-label^="Turn off microphone" i]',
    '[role="button"][aria-label^="Desactivar micrófono" i]',
    '[role="button"][aria-label^="Desativar microfone" i]',
  ]),
  camOff: any([
    '[role="button"][aria-label^="Turn off camera" i]',
    'button[aria-label^="Turn off camera" i]',
    '[role="button"][aria-label^="Desactivar cámara" i]',
    '[role="button"][aria-label^="Desativar câmera" i]',
  ]),
  leave: any([
    'button[aria-label^="Leave call" i]',
    'button[aria-label^="Salir de la llamada" i]',
    'button[aria-label^="Abandonar la llamada" i]',
    'button[aria-label^="Sair da chamada" i]',
  ]),
  chatButton: any([
    'button[aria-label^="Chat with everyone" i]',
    'button[aria-label^="Open chat" i]',
    'button[aria-label="Chat" i]',
    'button[aria-label^="Chatear con todos" i]',
    'button[aria-label^="Conversar com todos" i]',
  ]),
  chatInput: any([
    'textarea[aria-label^="Send a message" i]',
    'textarea[placeholder^="Send a message" i]',
    'textarea[aria-label^="Enviar un mensaje" i]',
    'textarea[aria-label^="Enviar uma mensagem" i]',
  ]),
  captionsOn: any([
    'button[aria-label^="Turn on captions" i]',
    'button[aria-label^="Activar subtítulos" i]',
    'button[aria-label^="Ativar legendas" i]',
  ]),
  captionsOff: any([
    'button[aria-label^="Turn off captions" i]',
    'button[aria-label^="Desactivar subtítulos" i]',
    'button[aria-label^="Desativar legendas" i]',
  ]),
  captionRegion: any([
    '[role="region"][aria-label="Captions" i]',
    '[role="region"][aria-label="Subtítulos" i]',
    '[role="region"][aria-label="Legendas" i]',
  ]),
  tile: '[data-participant-id]',
  tileName: '[data-self-name]',
  // Active-speaker indicator. Meet's real markup for this changes often and
  // has not been verified against live Meet; captions are the main source of
  // the speaker timeline. Override with CALLS_BOT_MEET_SPEAKING_SELECTOR.
  speaking: process.env.CALLS_BOT_MEET_SPEAKING_SELECTOR || '[data-speaking="true"]',
  peopleButton: any([
    'button[aria-label^="Show everyone" i]',
    'button[aria-label^="People" i]',
    'button[aria-label^="Mostrar a todos" i]',
    'button[aria-label^="Personas" i]',
    'button[aria-label^="Mostrar todos" i]',
    'button[aria-label^="Pessoas" i]',
  ]),
};

const DISMISS_RX = /^(got it|dismiss|close|ok|accept all|continue without microphone and camera|entendido|descartar|cerrar|aceptar todo|continuar sin micrófono ni cámara|entendi|dispensar|fechar|aceitar tudo|continuar sem microfone e câmera)$/i;
const JOIN_RX = /^(ask to join|join now|join anyway|switch here|pedir unirse|solicitar unirse|unirse ahora|unirse de todos modos|pedir para participar|solicitar participação|participar agora|participar mesmo assim)$/i;
const ASK_RX = /ask|pedir|solicitar/i;

export const RX = {
  invalid: /check your meeting code|invalid video call name|this meeting code is invalid|revisa el código de la reunión|verifique o código da reunião|meeting not found/i,
  blocked: /you can['’]t join this (video )?call|no puedes unirte a esta (video)?llamada|não é possível participar desta (video)?chamada/i,
  denied: /denied your request|your request to join was (denied|declined)|no one responded to your request|someone in the call denied|rechazó tu solicitud|nadie respondió a tu solicitud|negou sua solicitação|ninguém respondeu à sua solicitação/i,
  waiting: /asking to be let in|someone will let you in|please wait until a meeting host|pidiendo que te dejen entrar|alguien te dejará entrar|pedindo para participar|alguém vai permitir/i,
  removed: /you['’]ve been removed|you were removed|someone removed you|te quitaron de la reunión|se te ha quitado|você foi removido/i,
  ended: /you['’]ve left the (meeting|call)|you left the (meeting|call)|the call has ended|the meeting has ended|ended the (meeting|call) for everyone|call ended|la llamada (ha )?finalizado|la reunión (ha )?finalizado|saliste de la reunión|has salido de la reunión|a chamada terminou|a reunião terminou|você saiu da reunião/i,
  alone: /you['’]re the only one here|eres la única persona aquí|você é a única pessoa aqui/i,
};

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {import('playwright-core').Page} page */
async function bodyText(page) {
  return page.evaluate(() => (document.body ? document.body.innerText.slice(0, 20000) : ''));
}

/** @param {import('playwright-core').Locator} loc */
async function visible(loc) {
  try {
    return await loc.first().isVisible();
  } catch {
    return false;
  }
}

/** @param {import('playwright-core').Page} page */
async function clickAll(page, selector) {
  const loc = page.locator(selector);
  const n = Math.min(await loc.count().catch(() => 0), 4);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await visible(el)) await el.click({ timeout: 3000 }).catch(() => {});
  }
}

/** @param {import('playwright-core').Page} page */
async function dismissDialogs(page) {
  const btn = page.getByRole('button', { name: DISMISS_RX });
  const n = Math.min(await btn.count().catch(() => 0), 3);
  for (let i = 0; i < n; i++) {
    const el = btn.nth(i);
    if (await visible(el)) await el.click({ timeout: 3000 }).catch(() => {});
  }
}

/** @param {import('playwright-core').Page} page */
async function inCall(page) {
  return visible(page.locator(SEL.leave));
}

/**
 * Injected into the page: watches the captions region and participant tiles
 * and pushes updates into window.__zs, which readState drains.
 * @param {{ captionRegion: string, tile: string, tileName: string, speaking: string, peopleButton: string, leave: string }} cfg
 */
function installObserver(cfg) {
  const w = /** @type {any} */ (window);
  if (w.__zs) return;
  const st = (w.__zs = { captions: [], samples: [], ids: new WeakMap(), next: 1, last: new Map() });
  /** @param {Element} el */
  const lines = (el) =>
    (/** @type {HTMLElement} */ (el).innerText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  const scanCaptions = () => {
    const now = Date.now();
    for (const region of document.querySelectorAll(cfg.captionRegion)) {
      for (const d of region.querySelectorAll('div')) {
        const l = lines(d);
        if (l.length < 2) continue;
        let leaf = true;
        for (const c of d.children) {
          if (lines(c).length >= 2) {
            leaf = false;
            break;
          }
        }
        if (!leaf) continue;
        let id = st.ids.get(d);
        if (!id) {
          id = st.next++;
          st.ids.set(d, id);
        }
        const speaker = l[0].slice(0, 120);
        const text = l.slice(1).join(' ').slice(0, 2000);
        if (st.last.get(id) !== text) {
          st.last.set(id, text);
          st.captions.push({ id, speaker, text, t: now });
          st.samples.push({ name: speaker, t: now });
          if (st.captions.length > 5000) st.captions.splice(0, 1000);
        }
      }
    }
  };
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      try {
        scanCaptions();
      } catch {}
    }, 300);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(() => {
    try {
      const now = Date.now();
      for (const tile of document.querySelectorAll(cfg.tile)) {
        if (!(tile.matches(cfg.speaking) || tile.querySelector(cfg.speaking))) continue;
        const nameEl = tile.querySelector(cfg.tileName);
        const name = ((nameEl && /** @type {HTMLElement} */ (nameEl).innerText) || lines(tile)[0] || '').trim();
        if (name) st.samples.push({ name: name.slice(0, 120), t: now });
      }
      if (st.samples.length > 20000) st.samples.splice(0, 5000);
    } catch {}
  }, 500);
}

export const meet = {
  name: 'meet',
  allowedHosts: ['meet.google.com', 'accounts.google.com', 'workspace.google.com', 'support.google.com', 'www.google.com'],

  /**
   * Fills the pre-join screen and clicks "Ask to join" / "Join now".
   * @param {import('playwright-core').Page} page
   * @param {{ botName: string, timeoutMs?: number, shouldStop?: () => boolean }} opts
   * @returns {Promise<'asked'|'direct'|'stopped'>}
   */
  async join(page, { botName, timeoutMs = 60000, shouldStop }) {
    const deadline = Date.now() + timeoutMs;
    let named = false;
    while (Date.now() < deadline) {
      if (shouldStop?.()) return 'stopped';
      const text = await bodyText(page);
      if (RX.invalid.test(text)) throw new AdapterError('invalid_meeting');
      if (RX.blocked.test(text)) throw new AdapterError('denied');
      if (await inCall(page)) return 'direct';
      await dismissDialogs(page);
      const input = page.locator(SEL.nameInput).first();
      const hasInput = await visible(input);
      if (hasInput && !named) {
        await input.fill(botName, { timeout: 5000 });
        named = true;
      }
      const btn = page.getByRole('button', { name: JOIN_RX }).first();
      if ((named || !hasInput) && (await visible(btn))) {
        await clickAll(page, SEL.micOff);
        await clickAll(page, SEL.camOff);
        const label = ((await btn.textContent().catch(() => '')) || '').trim();
        await btn.click({ timeout: 5000 });
        return ASK_RX.test(label) ? 'asked' : 'direct';
      }
      await sleep(1000);
    }
    throw new AdapterError('join_error');
  },

  /**
   * @param {import('playwright-core').Page} page
   * @param {number} timeoutMs
   * @param {{ shouldStop?: () => boolean }} [opts]
   * @returns {Promise<'admitted'|'denied'|'timeout'|'ended'|'stopped'>}
   */
  async waitAdmitted(page, timeoutMs, opts = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (opts.shouldStop?.()) return 'stopped';
      if (await inCall(page)) return 'admitted';
      const text = await bodyText(page);
      if (RX.denied.test(text) || RX.blocked.test(text) || RX.removed.test(text)) return 'denied';
      if (RX.ended.test(text)) return 'ended';
      await dismissDialogs(page);
      await sleep(1000);
    }
    return 'timeout';
  },

  /**
   * Opens the chat panel, sends the message and closes the panel again.
   * @param {import('playwright-core').Page} page
   * @param {string} message
   */
  async sendChat(page, message) {
    const input = page.locator(SEL.chatInput).first();
    let opened = false;
    if (!(await visible(input))) {
      await page.locator(SEL.chatButton).first().click({ timeout: 5000 });
      opened = true;
      await input.waitFor({ state: 'visible', timeout: 8000 });
    }
    await input.fill(message, { timeout: 5000 });
    await input.press('Enter');
    // Meet clears the input once the message is sent.
    const deadline = Date.now() + 8000;
    while ((await input.inputValue().catch(() => '')) !== '') {
      if (Date.now() > deadline) throw new AdapterError('chat_not_sent');
      await sleep(250);
    }
    if (opened) await page.locator(SEL.chatButton).first().click({ timeout: 3000 }).catch(() => {});
  },

  /**
   * @param {import('playwright-core').Page} page
   * @returns {Promise<boolean>} true if captions are on
   */
  async enableCaptions(page) {
    if (await visible(page.locator(SEL.captionsOff))) return true;
    const on = page.locator(SEL.captionsOn).first();
    if (await visible(on)) {
      await on.click({ timeout: 5000 });
    } else {
      // Keyboard shortcut "c" toggles captions in Meet.
      await page.keyboard.press('c').catch(() => {});
    }
    await sleep(1500);
    await dismissDialogs(page);
    return visible(page.locator(SEL.captionsOff));
  },

  /**
   * Polled about once per second while in the call.
   * @param {import('playwright-core').Page} page
   * @param {{ botName: string }} opts
   */
  async readState(page, { botName }) {
    const cfg = {
      captionRegion: SEL.captionRegion,
      tile: SEL.tile,
      tileName: SEL.tileName,
      speaking: SEL.speaking,
      peopleButton: SEL.peopleButton,
      leave: SEL.leave,
    };
    // Evaluated through the DevTools protocol, so Meet's CSP/Trusted Types
    // don't apply (no eval inside the page). No-op once installed.
    await page.evaluate(installObserver, cfg);
    const raw = await page.evaluate(
      ({ cfg }) => {
        const w = /** @type {any} */ (window);
        const st = w.__zs;
        const captions = st.captions.splice(0);
        const samples = st.samples.splice(0);
        const hasLeave = !!document.querySelector(cfg.leave);
        /** @type {Map<string, string>} */
        const tiles = new Map();
        for (const t of document.querySelectorAll(cfg.tile)) {
          const id = t.getAttribute('data-participant-id') || '';
          const nameEl = t.querySelector(cfg.tileName);
          const name = ((nameEl && /** @type {HTMLElement} */ (nameEl).innerText) || '').trim();
          if (id && !tiles.has(id)) tiles.set(id, name);
        }
        let badge = 0;
        const pb = document.querySelector(cfg.peopleButton);
        if (pb) {
          const m = /(\d+)/.exec(/** @type {HTMLElement} */ (pb).innerText || pb.getAttribute('aria-label') || '');
          if (m) badge = Number(m[1]);
        }
        const text = hasLeave ? '' : (document.body ? document.body.innerText.slice(0, 5000) : '');
        const aloneText = hasLeave && document.body ? document.body.innerText.slice(0, 20000) : '';
        return { captions, samples, hasLeave, tiles: [...tiles.values()], badge, text, aloneText, now: Date.now() };
      },
      { cfg },
    );
    const names = [...new Set(raw.tiles.filter((n) => n && n !== botName))].slice(0, 200);
    // 0 = unknown (selectors not found): never treated as "alone".
    const participantCount = Math.max(raw.tiles.length, raw.badge);
    return {
      inCall: raw.hasLeave,
      ended: !raw.hasLeave && RX.ended.test(raw.text),
      removed: !raw.hasLeave && RX.removed.test(raw.text),
      alone: participantCount === 1 || (raw.hasLeave && RX.alone.test(raw.aloneText)),
      participantCount,
      participants: names.map((name) => ({ name })),
      captions: raw.captions,
      samples: raw.samples,
      pageNow: raw.now,
    };
  },

  /** @param {import('playwright-core').Page} page */
  async leave(page) {
    const btn = page.locator(SEL.leave).first();
    if (await visible(btn)) await btn.click({ timeout: 3000 }).catch(() => {});
  },
};
