/**
 * Robots — intérprete de pasos y arnés del navegador.
 *
 * IMPORTANTE: `robotInterpreter`, `robotHarness` y `isPrivateAddress` son
 * funciones AUTOCONTENIDAS (sin imports ni variables del módulo): el backend
 * de Vercel Sandbox las serializa con Function.prototype.toString() dentro del
 * script que corre en la microVM (ver lib/robots-sandbox.ts). Solo pueden usar
 * globales de JS (JSON, Math, Date, Promise, setTimeout, URL…) y lo que
 * reciben por parámetro. Los tipos de TypeScript desaparecen al compilar.
 *
 * El intérprete trabaja contra una interfaz mínima de Playwright (`RobotPage`)
 * para poder testearlo con una página falsa (tests/unit/robots.test.ts).
 */

export interface RobotLocator {
  first(): RobotLocator;
  count(): Promise<number>;
  click(opts?: { timeout?: number }): Promise<void>;
  fill(value: string, opts?: { timeout?: number }): Promise<void>;
  selectOption(value: string, opts?: { timeout?: number }): Promise<unknown>;
  press(key: string, opts?: { timeout?: number }): Promise<void>;
  innerText(opts?: { timeout?: number }): Promise<string>;
  getAttribute(name: string, opts?: { timeout?: number }): Promise<string | null>;
  allInnerTexts(): Promise<string[]>;
  evaluateAll<R>(fn: (els: Element[], arg: string) => R, arg: string): Promise<R>;
  evaluate<R>(fn: (el: Element) => R, arg?: unknown, opts?: { timeout?: number }): Promise<R>;
  waitFor(opts?: { state?: 'attached' | 'visible'; timeout?: number }): Promise<void>;
  scrollIntoViewIfNeeded(opts?: { timeout?: number }): Promise<void>;
  setInputFiles?(files: { name: string; mimeType: string; buffer: unknown }, opts?: { timeout?: number }): Promise<void>;
}

export interface RobotDownload {
  suggestedFilename(): string;
  createReadStream(): Promise<AsyncIterable<Uint8Array> | null>;
}

export interface RobotPage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' }): Promise<unknown>;
  url(): string;
  locator(selector: string): RobotLocator;
  getByText(text: string, opts?: { exact?: boolean }): RobotLocator;
  keyboard: { press(key: string): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts?: { type?: 'jpeg' | 'png'; quality?: number; timeout?: number }): Promise<Uint8Array>;
  /** Función serializada, o expresión de texto (paso evaluate: no la frena la CSP de la página). */
  evaluate<R>(fn: ((arg: number) => R) | string, arg?: number): Promise<R>;
  waitForEvent?(event: 'download', opts?: { timeout?: number }): Promise<RobotDownload>;
  pdf?(opts?: { format?: string; printBackground?: boolean }): Promise<Uint8Array>;
}

export interface RobotLogEntry {
  /** Número de paso (1-based); en loops, "3.2" = paso 2 del loop del paso 3. */
  step: string;
  type: string;
  /** warning = falló pero el paso (o el elemento del loop) sigue: continueOnError. */
  status: 'success' | 'failed' | 'skipped' | 'warning';
  ms: number;
  detail?: string;
  error?: string;
}

export interface RobotScreenshot {
  name: string;
  /** base64 (jpeg). */
  data: string;
  type: 'image/jpeg';
}

/** Archivo producido por download / pdf (base64); el servidor lo sube a Blob. */
export interface RobotFile {
  /** Variable donde queda el resultado ({{vars.<name>.url}}). */
  name: string;
  filename: string;
  contentType: string;
  size: number;
  data: string;
}

/**
 * Lo que había en la página cuando falló el paso: URL, título, un recorte del
 * DOM (el elemento del selector o el body, sin scripts ni estilos) y una
 * captura (base64 jpeg; el servidor la sube con lib/uploads.ts).
 */
export interface RobotFailure {
  step: string;
  type: string;
  error: string;
  url: string;
  title?: string;
  /** El selector del paso existía en la página. */
  matched?: boolean;
  dom?: string;
  screenshot?: string;
}

export interface InterpreterResult {
  status: 'success' | 'failed';
  error: string | null;
  /** Pasos o elementos de loop que fallaron con continueOnError (la corrida siguió). */
  warnings?: number;
  /** Solo si la corrida falló: captura, URL y DOM del paso que falló. */
  failure?: RobotFailure;
  vars: Record<string, unknown>;
  logs: RobotLogEntry[];
  screenshots: RobotScreenshot[];
  pages: number;
  files?: RobotFile[];
  /** Cookies + localStorage al terminar (solo si se pidió guardar la sesión). */
  storageState?: unknown;
  /** Pasos que usaron un selector alternativo (autorreparación). */
  healed?: Array<{ step: string; from: string; to: string }>;
}

export interface InterpreterOptions {
  /** Epoch ms en el que se corta la corrida. */
  deadline: number;
  /** null = URL permitida; si no, código de error (private_host, invalid_url…). */
  checkUrl: (url: string) => Promise<string | null>;
  maxPages?: number;
  maxScreenshots?: number;
  maxExecuted?: number;
  maxLoopItems?: number;
  /** Timeout por acción (ms). */
  actionTimeout?: number;
  robotName?: string;
  /** Credenciales referenciadas: {{credentials.<name>.<campo>}}. */
  credentials?: Record<string, Record<string, string>>;
  maxFiles?: number;
  maxFileBytes?: number;
  /** Reloj (epoch ms) para los códigos TOTP; tests. */
  now?: () => number;
}

export interface InterpreterStep {
  type: string;
  [key: string]: unknown;
}

/**
 * Ejecuta los pasos del robot sobre `page`. Nunca lanza: los errores quedan
 * en `error` y en el log del paso.
 */
export async function robotInterpreter(
  page: RobotPage,
  steps: InterpreterStep[],
  inputs: Record<string, unknown>,
  opts: InterpreterOptions,
): Promise<InterpreterResult> {
  const maxPages = opts.maxPages ?? 20;
  const maxShots = opts.maxScreenshots ?? 5;
  const maxExecuted = opts.maxExecuted ?? 500;
  const maxLoopItems = opts.maxLoopItems ?? 50;
  const actionTimeout = opts.actionTimeout ?? 15_000;
  const maxFiles = opts.maxFiles ?? 5;
  const maxFileBytes = opts.maxFileBytes ?? 10 * 1024 * 1024;
  const vars: Record<string, unknown> = {};
  const logs: RobotLogEntry[] = [];
  const screenshots: RobotScreenshot[] = [];
  const files: RobotFile[] = [];
  let pages = 0;
  let executed = 0;
  let warnings = 0;
  let failure: RobotFailure | undefined;
  // Buffer existe en Node (arnés y sandbox); en tests se usa el global también.
  const B = (globalThis as unknown as {
    Buffer?: {
      from(b: Uint8Array | ArrayBuffer): { toString(enc: string): string; length: number };
      concat(list: Uint8Array[]): Uint8Array & { toString(enc: string): string; length: number };
    };
  }).Buffer;
  const mimeFor = (filename: string): string => {
    const ext = filename.toLowerCase().split('.').pop() ?? '';
    const map: Record<string, string> = {
      pdf: 'application/pdf',
      csv: 'text/csv',
      txt: 'text/plain',
      json: 'application/json',
      zip: 'application/zip',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return map[ext] ?? 'application/octet-stream';
  };

  class RobotError extends Error {}
  const fail = (code: string): never => {
    throw new RobotError(code);
  };

  // ---- Plantillas: {{inputs.x}}, {{vars.x}}, {{loop.item}} | filtro ----
  const TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const SINGLE_RE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
  const getPath = (obj: unknown, path: string): unknown => {
    let cur: unknown = obj;
    for (const raw of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
      const part = raw.trim();
      if (!part) continue;
      if (cur === null || cur === undefined) return undefined;
      if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
      if (Array.isArray(cur)) {
        if (part === 'length') {
          cur = cur.length;
          continue;
        }
        const i = Number(part);
        cur = Number.isInteger(i) ? cur[i] : undefined;
      } else if (typeof cur === 'object') {
        cur = Object.prototype.hasOwnProperty.call(cur, part) ? (cur as Record<string, unknown>)[part] : undefined;
      } else {
        return undefined;
      }
    }
    return cur;
  };
  const toText = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  };
  const evalExpr = (expr: string, ctx: Record<string, unknown>): unknown => {
    const [path, ...filters] = expr.split('|').map((s) => s.trim());
    let v: unknown = path === 'now' ? new Date().toISOString() : getPath(ctx, path);
    for (const f of filters) {
      const idx = f.indexOf(':');
      const name = (idx < 0 ? f : f.slice(0, idx)).trim().toLowerCase();
      const arg = idx < 0 ? '' : f.slice(idx + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
      if (name === 'trim') v = toText(v).trim();
      else if (name === 'upper') v = toText(v).toUpperCase();
      else if (name === 'lower') v = toText(v).toLowerCase();
      else if (name === 'json') v = JSON.stringify(v === undefined ? null : v);
      else if (name === 'urlencode') v = encodeURIComponent(toText(v));
      else if (name === 'default') v = v === undefined || v === null || v === '' ? arg : v;
      else if (name === 'first') v = Array.isArray(v) ? v[0] : v;
      else if (name === 'last') v = Array.isArray(v) ? v[v.length - 1] : v;
      else if (name === 'join') v = Array.isArray(v) ? v.map(toText).join(arg || ', ') : toText(v);
      else if (name === 'length') v = Array.isArray(v) || typeof v === 'string' ? v.length : 0;
    }
    return v;
  };
  const render = (tpl: unknown, ctx: Record<string, unknown>): string =>
    typeof tpl === 'string' ? tpl.replace(TEMPLATE_RE, (_m, e: string) => toText(evalExpr(e, ctx))) : toText(tpl);
  const renderRaw = (tpl: unknown, ctx: Record<string, unknown>): unknown => {
    if (typeof tpl !== 'string') return tpl;
    const m = SINGLE_RE.exec(tpl);
    return m ? evalExpr(m[1], ctx) : render(tpl, ctx);
  };

  const remaining = () => opts.deadline - Date.now();
  const timeout = () => {
    const left = remaining();
    if (left <= 0) fail('timeout');
    return Math.max(500, Math.min(actionTimeout, left));
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  /** Selector primero; si no hay o no aparece, el texto visible. */
  const resolveTarget = async (selector: string, text: string): Promise<RobotLocator> => {
    if (selector) {
      const loc = page.locator(selector).first();
      if (!text) return loc;
      if ((await loc.count()) > 0) return loc;
    }
    if (text) return page.getByText(text, { exact: false }).first();
    return fail('missing_selector');
  };

  const exists = async (selector: string, text: string): Promise<boolean> => {
    if (selector && (await page.locator(selector).count()) > 0) return true;
    if (text && (await page.getByText(text, { exact: false }).count()) > 0) return true;
    return false;
  };

  const clip = (v: string, n = 5000) => (v.length > n ? v.slice(0, n) : v);

  /** Último selector alternativo que usó un paso (autorreparación); lo lee runList. */
  let lastHeal: { from: string; to: string } | null = null;
  const healed: Array<{ step: string; from: string; to: string }> = [];

  /**
   * Autorreparación: si el paso tiene selectores alternativos y el principal
   * no aparece, espera (hasta 10 s) a que aparezca cualquiera y usa el
   * primero que esté, prefiriendo siempre el principal. Si no aparece
   * ninguno, sigue con el principal (y el paso falla como siempre).
   */
  const heal = async (s: InterpreterStep, ctx: Record<string, unknown>, selector: string): Promise<string> => {
    const alts = (Array.isArray(s.fallbacks) ? (s.fallbacks as unknown[]) : [])
      .map((f) => render(str(f), ctx).trim())
      .filter((f) => f && f !== selector)
      .slice(0, 4);
    if (!selector || !alts.length) return selector;
    const candidates = [selector, ...alts];
    const until = Date.now() + Math.min(timeout(), 10_000);
    for (;;) {
      for (const c of candidates) {
        let n = 0;
        try {
          n = await page.locator(c).count();
        } catch {
          n = 0;
        }
        if (n > 0) {
          if (c !== selector) lastHeal = { from: selector, to: c };
          return c;
        }
      }
      if (Date.now() >= until || remaining() <= 1000) return selector;
      await page.waitForTimeout(250);
    }
  };

  type Outcome = { jump?: number; skip?: number; stop?: boolean; detail?: string };

  /**
   * Lee una página de filas y, si el paso tiene paginación (maxPages > 1 y un
   * Siguiente), hace clic y sigue juntando hasta que Siguiente falta o está
   * deshabilitado, la página repite las mismas filas o se llega al tope.
   * Cada clic cuenta como una página de la corrida (maxPages).
   */
  const paginate = async (
    s: InterpreterStep,
    ctx: Record<string, unknown>,
    rowsSelector: string,
    read: () => Promise<unknown[]>,
  ): Promise<{ rows: unknown[]; pagesRead: number }> => {
    const limit = Math.min(Math.max(Math.floor(Number(s.maxPages) || 1), 1), 20);
    const nextSel = render(str(s.nextSelector), ctx).trim();
    const nextText = render(str(s.nextText), ctx).trim();
    const waitMs = Math.min(Math.max(Math.floor(Number(s.pageWaitMs ?? 1000) || 0), 0), 30_000);
    const rows: unknown[] = [];
    let previous = '';
    let pagesRead = 0;
    const mode = str(s.paginateMode) || 'next';
    if (mode === 'load_more' || mode === 'scroll') {
      // Todo queda en la misma página: se carga más (clic o scroll) hasta que
      // no aparecen filas nuevas, el botón falta o se llega al tope, y se lee una vez.
      const countRows = async () => page.locator(rowsSelector).count().catch(() => 0);
      let loaded = 1;
      while (loaded < limit) {
        const before = await countRows();
        if (before >= 1000) break;
        if (mode === 'load_more') {
          if (!nextSel && !nextText) break;
          if (!(await exists(nextSel, nextText))) break;
          const more = await resolveTarget(nextSel, nextText);
          const disabled = await more
            .evaluate(
              (el: Element) => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
              undefined,
              { timeout: timeout() },
            )
            .catch(() => false);
          if (disabled === true) break;
          await more.click({ timeout: timeout() });
        } else {
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
            return true;
          });
        }
        if (waitMs > remaining()) fail('timeout');
        await page.waitForTimeout(Math.max(waitMs, 200));
        if ((await countRows()) <= before) break;
        loaded += 1;
      }
      for (const r of await read()) {
        if (rows.length >= 1000) break;
        rows.push(r);
      }
      return { rows, pagesRead: loaded };
    }
    for (;;) {
      const batch = await read();
      const key = JSON.stringify(batch);
      // La misma página otra vez (el clic no avanzó): se corta sin duplicar.
      if (pagesRead > 0 && key === previous) break;
      previous = key;
      pagesRead += 1;
      for (const r of batch) {
        if (rows.length >= 1000) break;
        rows.push(r);
      }
      if (rows.length >= 1000 || pagesRead >= limit || (!nextSel && !nextText)) break;
      if (!(await exists(nextSel, nextText))) break;
      const next = await resolveTarget(nextSel, nextText);
      const disabled = await next
        .evaluate(
          (el: Element) =>
            (el as HTMLButtonElement).disabled === true ||
            el.getAttribute('aria-disabled') === 'true' ||
            /(^|\s)disabled(\s|$)/.test(el.getAttribute('class') || ''),
          undefined,
          { timeout: timeout() },
        )
        .catch(() => false);
      if (disabled === true) break;
      if (pages + 1 > maxPages) break;
      pages += 1;
      await next.click({ timeout: timeout() });
      if (waitMs > remaining()) fail('timeout');
      if (waitMs) await page.waitForTimeout(waitMs);
      // Si en la página nueva no hay filas, se termina (no es un error).
      const appeared = await page
        .locator(rowsSelector)
        .first()
        .waitFor({ state: 'attached', timeout: timeout() })
        .then(() => true)
        .catch(() => false);
      if (!appeared) break;
    }
    return { rows, pagesRead };
  };

  // ---- TOTP (RFC 6238): {{credentials.<name>.totp}} ----
  const now = opts.now ?? (() => Date.now());
  /** Códigos generados en esta corrida: se tachan de los logs. */
  const otpCodes = new Set<string>();
  const base32Bytes = (b32: string): Uint8Array<ArrayBuffer> => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of b32.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
      value = ((value << 5) | alphabet.indexOf(ch)) & 0xffff;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  };
  const totpCode = async (stored: string): Promise<string> => {
    const [secret, d, p, a] = stored.split(':');
    const digits = Math.min(Math.max(Number(d) || 6, 6), 8);
    const period = Math.min(Math.max(Number(p) || 30, 15), 300);
    const algo = a === 'SHA256' ? 'SHA-256' : a === 'SHA512' ? 'SHA-512' : 'SHA-1';
    const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (!subtle) return fail('unsupported');
    const msg = new Uint8Array(8);
    let c = Math.floor(now() / 1000 / period);
    for (let i = 7; i >= 0; i--) {
      msg[i] = c % 256;
      c = Math.floor(c / 256);
    }
    const key = await subtle.importKey('raw', base32Bytes(secret), { name: 'HMAC', hash: algo }, false, ['sign']);
    const mac = new Uint8Array(await subtle.sign('HMAC', key, msg));
    const off = mac[mac.length - 1] & 15;
    const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    const code = String(bin % 10 ** digits).padStart(digits, '0');
    otpCodes.add(code);
    return code;
  };
  /** Si el paso usa {{credentials.x.totp}}, agrega el código actual a esa credencial. */
  const withTotp = async (s: InterpreterStep, ctx: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const creds = ctx.credentials as Record<string, Record<string, string>> | undefined;
    if (!creds) return ctx;
    const json = JSON.stringify(s);
    if (!json.includes('totp')) return ctx;
    let changed: Record<string, Record<string, string>> | null = null;
    for (const m of json.matchAll(/credentials\.([A-Za-z0-9_-]{1,60})\.totp\b/g)) {
      const cred = creds[m[1]];
      if (!cred) continue;
      if (!cred.totpSecret) fail('missing_totp_secret');
      changed ??= { ...creds };
      changed[m[1]] = { ...cred, totp: await totpCode(cred.totpSecret) };
    }
    return changed ? { ...ctx, credentials: changed } : ctx;
  };

  const runLeaf = async (s: InterpreterStep, ctx: Record<string, unknown>): Promise<Outcome> => {
    lastHeal = null;
    const selector = await heal(s, ctx, render(str(s.selector), ctx).trim());
    switch (s.type) {
      case 'goto': {
        const url = render(s.url, ctx).trim();
        if (!/^https?:\/\//i.test(url)) fail('invalid_url');
        const blocked = await opts.checkUrl(url);
        if (blocked) fail(blocked);
        pages += 1;
        if (pages > maxPages) fail('page_limit');
        await page.goto(url, { timeout: Math.max(timeout(), Math.min(30_000, remaining())), waitUntil: 'domcontentloaded' });
        return { detail: url };
      }
      case 'click': {
        const loc = await resolveTarget(selector, render(str(s.text), ctx).trim());
        await loc.click({ timeout: timeout() });
        return { detail: selector || str(s.text) };
      }
      case 'fill': {
        if (!selector) fail('missing_selector');
        await page.locator(selector).first().fill(render(s.value, ctx), { timeout: timeout() });
        return { detail: selector };
      }
      case 'select': {
        if (!selector) fail('missing_selector');
        await page.locator(selector).first().selectOption(render(s.value, ctx), { timeout: timeout() });
        return { detail: selector };
      }
      case 'press': {
        const key = str(s.key).trim();
        if (!/^[A-Za-z0-9+_ -]{1,40}$/.test(key)) fail('invalid_key');
        if (selector) await page.locator(selector).first().press(key, { timeout: timeout() });
        else await page.keyboard.press(key);
        return { detail: key };
      }
      case 'wait': {
        if (selector) {
          await page.locator(selector).first().waitFor({ state: 'attached', timeout: timeout() });
          return { detail: selector };
        }
        const ms = Math.min(Math.max(Number(s.ms) || 0, 0), 30_000);
        if (ms > remaining()) fail('timeout');
        await page.waitForTimeout(ms);
        return { detail: `${ms} ms` };
      }
      case 'extract': {
        if (!selector) fail('missing_selector');
        const name = str(s.name);
        const attr = str(s.attribute).trim();
        const loc = page.locator(selector);
        let value: unknown;
        if (s.mode === 'all') {
          value = attr
            ? await loc.evaluateAll(
                (els: Element[], a: string) => els.slice(0, 200).map((el) => el.getAttribute(a) ?? ''),
                attr,
              )
            : (await loc.allInnerTexts()).slice(0, 200).map((t) => clip(t.trim(), 2000));
        } else if (s.mode === 'attribute') {
          if (!attr) fail('missing_attribute');
          value = (await loc.first().getAttribute(attr, { timeout: timeout() })) ?? '';
        } else {
          value = clip((await loc.first().innerText({ timeout: timeout() })).trim());
        }
        vars[name] = value;
        return { detail: `${name} = ${clip(toText(value), 120)}` };
      }
      case 'extract_table': {
        if (!selector) fail('missing_selector');
        const name = str(s.name);
        const readTable = () =>
          page
          .locator(selector)
          .first()
          .evaluate(
            // Corre en el navegador: sin funciones con nombre adentro (los
            // bundlers les agregan helpers que no existen en la página).
            (el: Element) => {
              const table = el.tagName === 'TABLE' ? el : el.querySelector('table');
              if (!table) return [] as Array<Record<string, string> | string[]>;
              const matrix = Array.from(table.querySelectorAll('tr'))
                .slice(0, 501)
                .map((tr) => ({
                  th: tr.querySelectorAll('th').length,
                  td: tr.querySelectorAll('td').length,
                  cells: Array.from(tr.querySelectorAll('th,td')).map((c) =>
                    ((c as HTMLElement).innerText || c.textContent || '').trim().slice(0, 1000),
                  ),
                }));
              const hasHead = matrix.length > 0 && matrix[0].th > 0 && matrix[0].td === 0;
              if (!hasHead) return matrix.map((r) => r.cells).slice(0, 500);
              const head = matrix[0].cells.map((h, i) => h || `col${i + 1}`);
              return matrix.slice(1, 501).map((r) => {
                const row: Record<string, string> = {};
                r.cells.forEach((v, i) => {
                  row[head[i] ?? `col${i + 1}`] = v;
                });
                return row;
              });
            },
            undefined,
            { timeout: timeout() },
          );
        const { rows, pagesRead } = await paginate(s, ctx, selector, async () => {
          const r = await readTable();
          return Array.isArray(r) ? r : [];
        });
        vars[name] = rows;
        return { detail: `${name}: ${rows.length} rows${pagesRead > 1 ? ` · ${pagesRead} pages` : ''}` };
      }
      case 'extract_list': {
        if (!selector) fail('missing_selector');
        const name = str(s.name);
        const fields = (Array.isArray(s.fields) ? (s.fields as Array<Record<string, unknown>>) : [])
          .slice(0, 20)
          .map((f) => ({ name: str(f.name), selector: render(str(f.selector), ctx).trim(), attribute: str(f.attribute).trim() }))
          .filter((f) => f.name);
        if (!fields.length) fail('missing_fields');
        const max = Math.min(Math.max(Math.floor(Number(s.max) || 100), 1), 500);
        const arg = JSON.stringify({ fields, max });
        const readCards = async (): Promise<unknown[]> => {
          const rows = await page.locator(selector).evaluateAll(
            // Corre en el navegador: sin funciones con nombre adentro.
            (els: Element[], raw: string) => {
              const cfg = JSON.parse(raw) as { fields: Array<{ name: string; selector: string; attribute: string }>; max: number };
              return els.slice(0, cfg.max).map((card) => {
                const row: Record<string, string> = {};
                for (const f of cfg.fields) {
                  let el: Element | null = card;
                  if (f.selector) {
                    try {
                      el = card.querySelector(f.selector);
                    } catch {
                      el = null;
                    }
                  }
                  let v = '';
                  if (el && f.attribute) {
                    // href / src absolutos (la propiedad ya resuelve contra la página).
                    const prop = (el as unknown as Record<string, unknown>)[f.attribute];
                    v =
                      (f.attribute === 'href' || f.attribute === 'src') && typeof prop === 'string' && prop
                        ? prop
                        : (el.getAttribute(f.attribute) ?? '');
                  } else if (el) {
                    v = ((el as HTMLElement).innerText || el.textContent || '').trim();
                  }
                  row[f.name] = v.slice(0, 2000);
                }
                return row;
              });
            },
            arg,
          );
          return Array.isArray(rows) ? rows : [];
        };
        const { rows, pagesRead } = await paginate(s, ctx, selector, readCards);
        vars[name] = rows;
        return { detail: `${name}: ${rows.length} rows${pagesRead > 1 ? ` · ${pagesRead} pages` : ''}` };
      }
      case 'screenshot': {
        if (screenshots.length >= maxShots) return { detail: 'screenshot_limit' };
        const buf = await page.screenshot({ type: 'jpeg', quality: 60, timeout: timeout() });
        let b64 = '';
        if (B) b64 = B.from(buf).toString('base64');
        screenshots.push({ name: str(s.name) || `shot${screenshots.length + 1}`, data: b64, type: 'image/jpeg' });
        return { detail: str(s.name) };
      }
      case 'scroll': {
        if (selector) {
          await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: timeout() });
          return { detail: selector };
        }
        const y = Math.max(0, Number(s.y) || 0);
        await page.evaluate((dy: number) => {
          window.scrollBy(0, dy > 0 ? dy : document.body.scrollHeight);
          return true;
        }, y);
        return { detail: y ? `${y}px` : 'bottom' };
      }
      case 'if_exists': {
        const text = render(str(s.text), ctx).trim();
        if (!selector && !text) fail('missing_selector');
        if (await exists(selector, text)) return { detail: 'found' };
        const mode = str(s.onMissing) || 'skip';
        if (mode === 'fail') fail('element_not_found');
        if (mode === 'stop') return { stop: true, detail: 'missing → stop' };
        if (mode === 'goto') return { jump: Number(s.target) || 0, detail: `missing → step ${Number(s.target)}` };
        return { skip: Math.max(1, Number(s.count) || 1), detail: `missing → skip ${Math.max(1, Number(s.count) || 1)}` };
      }
      case 'download': {
        if (files.length >= maxFiles) fail('file_limit');
        if (!B || !page.waitForEvent) fail('unsupported');
        const name = str(s.name);
        const loc = await resolveTarget(selector, render(str(s.text), ctx).trim());
        const t = timeout();
        const [download] = await Promise.all([page.waitForEvent!('download', { timeout: t }), loc.click({ timeout: t })]);
        const stream = await download.createReadStream();
        if (!stream) fail('download_failed');
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of stream as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > maxFileBytes) fail('file_too_large');
          chunks.push(chunk);
        }
        const filename = (download.suggestedFilename() || name).replace(/[^\w.() -]/g, '_').slice(-120);
        const data = B!.concat(chunks).toString('base64');
        files.push({ name, filename, contentType: mimeFor(filename), size, data });
        vars[name] = { filename, size };
        return { detail: `${name}: ${filename} (${size} B)` };
      }
      case 'upload': {
        if (!selector) fail('missing_selector');
        if (!B) fail('unsupported');
        const url = render(s.url, ctx).trim();
        if (!/^https?:\/\//i.test(url)) fail('invalid_url');
        const blocked = await opts.checkUrl(url);
        if (blocked) fail(blocked);
        // Sin redirecciones: el destino ya se validó contra hosts privados.
        const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeout()) }).catch(() => null);
        if (!res || !res.ok) fail('upload_fetch_failed');
        const declared = Number(res!.headers.get('content-length') ?? 0);
        if (declared > maxFileBytes) fail('file_too_large');
        const buf = await res!.arrayBuffer();
        if (buf.byteLength > maxFileBytes) fail('file_too_large');
        let filename = render(str(s.filename), ctx).trim();
        if (!filename) {
          try {
            filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'file';
          } catch {
            filename = 'file';
          }
        }
        filename = filename.replace(/[^\w.() -]/g, '_').slice(-120);
        const mimeType = (res!.headers.get('content-type') || mimeFor(filename)).split(';')[0].trim();
        const input = page.locator(selector).first();
        if (!input.setInputFiles) fail('unsupported');
        await input.setInputFiles!({ name: filename, mimeType, buffer: B!.from(buf) }, { timeout: timeout() });
        return { detail: `${filename} (${buf.byteLength} B)` };
      }
      case 'pdf': {
        if (files.length >= maxFiles) fail('file_limit');
        if (!B || !page.pdf) fail('unsupported');
        const name = str(s.name);
        const buf = await page.pdf!({ format: 'A4', printBackground: true });
        if (buf.length > maxFileBytes) fail('file_too_large');
        files.push({ name, filename: `${name}.pdf`, contentType: 'application/pdf', size: buf.length, data: B!.from(buf).toString('base64') });
        vars[name] = { filename: `${name}.pdf`, size: buf.length };
        return { detail: `${name}.pdf (${buf.length} B)` };
      }
      case 'evaluate': {
        const name = str(s.name);
        const script = render(str(s.script), ctx);
        // Corre en la página (no en el servidor). Texto, no función: la CSP del sitio no lo bloquea.
        const expr = `(async () => {\n${script}\n})().then((v) => JSON.stringify(v === undefined ? null : v))`;
        const limit = timeout();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const json = await Promise.race([
          page.evaluate<string>(expr),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new RobotError('evaluate_timeout')), limit);
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
        if (typeof json !== 'string') fail('evaluate_not_json');
        if (json.length > 100_000) fail('result_too_large');
        vars[name] = JSON.parse(json) as unknown;
        return { detail: `${name} = ${clip(json, 120)}` };
      }
      case 'ai_extract': {
        // Lee el texto (y los links) de la página o del selector; la IA arma las
        // filas en el servidor al terminar la corrida (lib/robots-ai.ts).
        const name = str(s.name);
        const root = page.locator(selector || 'body').first();
        const text = clip(String(await root.innerText({ timeout: timeout() })).trim(), 30_000);
        const links = await root
          .evaluate(
            (el: Element) =>
              Array.from(el.querySelectorAll('a[href]'))
                .slice(0, 300)
                .map((a) => [((a as HTMLElement).innerText || '').trim().slice(0, 120), (a as HTMLAnchorElement).href]),
            undefined,
            { timeout: timeout() },
          )
          .catch(() => [] as string[][]);
        let url = '';
        try {
          url = String(page.url() || '').slice(0, 2000);
        } catch {
          url = '';
        }
        const fields = (Array.isArray(s.fields) ? (s.fields as Array<Record<string, unknown>>) : [])
          .slice(0, 20)
          .map((f) => ({ name: str(f.name), description: str(f.description) }))
          .filter((f) => f.name);
        vars[name] = { __aiExtract: 1, instruction: render(str(s.instruction), ctx).slice(0, 2000), fields, url, text, links };
        return { detail: `${name}: ${text.length} chars` };
      }
      default:
        return fail('unknown_step');
    }
  };

  /** Promesa con tope de tiempo: null si no llega (la captura nunca traba la corrida). */
  const within = async <R,>(p: Promise<R>, ms: number): Promise<R | null> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        p,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), ms);
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  /** Captura, URL y recorte del DOM al fallar un paso (best effort, unos segundos como mucho). */
  const captureFailure = async (label: string, type: string, code: string, selector: string): Promise<void> => {
    const f: RobotFailure = { step: label, type, error: code, url: '' };
    try {
      f.url = String(page.url() || '').slice(0, 2000);
    } catch {
      // sin URL
    }
    const buf = await within(page.screenshot({ type: 'jpeg', quality: 50, timeout: 4000 }), 5000);
    if (buf && B) f.screenshot = B.from(buf).toString('base64');
    // Texto, no función (igual que evaluate): corre en la página con su CSP.
    const expr =
      `(() => { const sel = ${JSON.stringify(selector)}; let el = null;` +
      ` try { el = sel ? document.querySelector(sel) : null; } catch (e) { el = null; }` +
      ` const root = el || document.body || document.documentElement; let html = '';` +
      ` if (root) { const c = root.cloneNode(true);` +
      ` if (c.querySelectorAll) c.querySelectorAll('script,style,noscript,svg,template,iframe').forEach((n) => n.remove());` +
      ` html = (c.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 4000); }` +
      ` return JSON.stringify({ matched: !!el, title: String(document.title || '').slice(0, 200), html }); })()`;
    const json = await within(page.evaluate<string>(expr), 3000);
    if (typeof json === 'string') {
      try {
        const d = JSON.parse(json) as { matched?: unknown; title?: unknown; html?: unknown };
        if (typeof d.html === 'string') f.dom = d.html.slice(0, 4000);
        if (typeof d.title === 'string' && d.title) f.title = d.title;
        if (selector) f.matched = d.matched === true;
      } catch {
        // DOM ilegible: queda la captura y la URL
      }
    }
    failure = f;
  };

  /** Errores que cortan la corrida aunque el paso tenga continueOnError. */
  const FATAL = /^(timeout|step_limit)$/;

  /** Errores que no se arreglan reintentando el paso. */
  const NO_RETRY = /^(timeout|page_limit|step_limit|invalid_url|private_host|https_required|unresolvable_host|missing_selector|missing_attribute|missing_fields|missing_totp_secret|invalid_key|unknown_step|file_limit|file_too_large|unsupported|result_too_large)$/;

  /** Ejecuta un paso con sus reintentos (retries + retryDelayMs). */
  const runWithRetries = async (s: InterpreterStep, ctx: Record<string, unknown>): Promise<Outcome & { attempts: number }> => {
    const retries = Math.min(Math.max(Math.floor(Number(s.retries) || 0), 0), 5);
    const delay = Math.min(Math.max(Math.floor(Number(s.retryDelayMs) || 0), 0), 30_000);
    for (let attempt = 0; ; attempt++) {
      try {
        // El código TOTP se calcula en cada intento (vence cada 30 s).
        const out = await runLeaf(s, await withTotp(s, ctx));
        return { ...out, attempts: attempt };
      } catch (err) {
        const retryable = !(err instanceof RobotError && NO_RETRY.test(err.message));
        if (!retryable || attempt >= retries || remaining() <= delay) throw err;
        if (delay > 0) await page.waitForTimeout(delay);
      }
    }
  };

  /**
   * Corre una lista de pasos. Devuelve true si un if_exists pidió terminar.
   * tolerant: el que llama atrapa el error (loop con continueOnItemError), así
   * que no hace falta la captura de la falla.
   */
  const runList = async (list: InterpreterStep[], ctx: Record<string, unknown>, prefix: string, tolerant = false): Promise<boolean> => {
    let i = 0;
    while (i < list.length) {
      const s = list[i];
      const label = `${prefix}${i + 1}`;
      executed += 1;
      if (executed > maxExecuted) fail('step_limit');
      if (remaining() <= 0) fail('timeout');
      const started = Date.now();
      if (s.type === 'loop_over') {
        const raw = renderRaw(s.list, ctx);
        let items: unknown[];
        if (Array.isArray(raw)) items = raw;
        else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            items = Array.isArray(parsed) ? parsed : [];
          } catch {
            items = [];
          }
        } else if (typeof raw === 'string' && raw.trim()) items = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        else items = [];
        const max = Math.min(Math.max(Number(s.max) || 10, 1), maxLoopItems);
        const capped = items.slice(0, max);
        logs.push({ step: label, type: 'loop_over', status: 'success', ms: 0, detail: `${capped.length}/${items.length} items` });
        const inner = Array.isArray(s.steps) ? (s.steps as InterpreterStep[]) : [];
        const perItem = s.continueOnItemError === true;
        for (let k = 0; k < capped.length; k++) {
          const itemStarted = Date.now();
          try {
            const stop = await runList(inner, { ...ctx, vars, loop: { item: capped[k], index: k } }, `${label}.${k + 1}.`, tolerant || perItem);
            if (stop) return true;
          } catch (err) {
            // "3.2.1: action_failed" → action_failed. timeout y step_limit cortan igual.
            const code = err instanceof Error ? err.message.replace(/^[\d.]+:\s*/, '') : 'action_failed';
            if (!perItem || FATAL.test(code)) throw err;
            warnings += 1;
            logs.push({ step: `${label}.${k + 1}`, type: 'loop_item', status: 'warning', ms: Date.now() - itemStarted, error: code, detail: clip(toText(capped[k]), 200) });
          }
        }
        i += 1;
        continue;
      }
      let out: Outcome & { attempts?: number };
      try {
        out = await runWithRetries(s, { ...ctx, vars });
        if (out.attempts) out.detail = `${out.detail ?? ''} · ${out.attempts} ${out.attempts === 1 ? 'retry' : 'retries'}`.trim();
      } catch (err) {
        const code =
          err instanceof RobotError
            ? err.message
            : err instanceof Error && /timeout/i.test(err.name + err.message)
              ? 'action_timeout'
              : 'action_failed';
        const msg = err instanceof Error && !(err instanceof RobotError) ? err.message.split('\n')[0].slice(0, 300) : undefined;
        if (s.continueOnError === true && !FATAL.test(code)) {
          warnings += 1;
          logs.push({ step: label, type: s.type, status: 'warning', ms: Date.now() - started, error: code, detail: msg });
          i += 1;
          continue;
        }
        logs.push({ step: label, type: s.type, status: 'failed', ms: Date.now() - started, error: code, detail: msg });
        if (!tolerant && !failure) await captureFailure(label, s.type, code, render(str(s.selector), { ...ctx, vars }).trim());
        throw new RobotError(`${label}: ${code}`);
      }
      if (lastHeal) {
        const h: { from: string; to: string } = lastHeal;
        healed.push({ step: label, from: h.from, to: h.to });
        out.detail = `${out.detail ?? ''} · healed: ${h.to}`.trim();
        lastHeal = null;
      }
      logs.push({ step: label, type: s.type, status: 'success', ms: Date.now() - started, detail: out.detail });
      if (out.stop) return true;
      if (out.skip) {
        for (let k = 1; k <= out.skip && i + k < list.length; k++) {
          logs.push({ step: `${prefix}${i + k + 1}`, type: list[i + k].type, status: 'skipped', ms: 0 });
        }
        i += out.skip + 1;
        continue;
      }
      if (out.jump && out.jump - 1 > i) {
        for (let k = i + 1; k < Math.min(out.jump - 1, list.length); k++) {
          logs.push({ step: `${prefix}${k + 1}`, type: list[k].type, status: 'skipped', ms: 0 });
        }
        i = out.jump - 1;
        continue;
      }
      i += 1;
    }
    return false;
  };

  let error: string | null = null;
  try {
    await runList(steps, { inputs, vars, robot: { name: opts.robotName ?? '' }, credentials: opts.credentials ?? {} }, '');
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : 'error';
  }
  // Los códigos 2FA nunca quedan en el log (p. ej. en la URL de un goto).
  if (otpCodes.size) {
    const scrub = (v: string | undefined): string | undefined => {
      if (!v) return v;
      let out = v;
      for (const code of otpCodes) out = out.split(code).join('[redacted]');
      return out;
    };
    for (const l of logs) {
      if (l.detail) l.detail = scrub(l.detail);
      if (l.error) l.error = scrub(l.error);
    }
    if (error) error = scrub(error) ?? error;
    if (failure) failure.url = scrub(failure.url) ?? '';
  }
  return {
    status: error ? 'failed' : 'success',
    error,
    vars,
    logs,
    screenshots,
    pages,
    files,
    warnings,
    ...(healed.length ? { healed } : {}),
    ...(error && failure ? { failure } : {}),
  };
}

/** IPv4/IPv6 privada, loopback, link-local, CGNAT o multicast. Autocontenida. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v.includes(':')) {
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('fec')) return true;
    // IPv4-mapped / NAT64 / IPv4-compatible, con puntos o en hex como lo
    // normaliza `new URL()` ([::ffff:169.254.169.254] → [::ffff:a9fe:a9fe]).
    // Igual que isPrivateIp de safe-fetch, pero autocontenida (va a la VM).
    const dotted = /^(?:::ffff:|64:ff9b::|::)(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = /^(?:::ffff:|64:ff9b::|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
    if (hex) {
      const h = parseInt(hex[1], 16);
      const l = parseInt(hex[2], 16);
      return isPrivateAddress(`${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`);
    }
    return false;
  }
  const parts = v.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

// ---------- Arnés (navegador real) ----------

export interface HarnessJob {
  steps: InterpreterStep[];
  inputs: Record<string, unknown>;
  robotName: string;
  /** Epoch ms de corte. */
  deadline: number;
  maxPages: number;
  maxScreenshots: number;
  maxExecuted: number;
  maxLoopItems: number;
  executablePath?: string;
  /** Flags de Chromium (p. ej. --no-sandbox dentro de la microVM). */
  args?: string[];
  credentials?: Record<string, Record<string, string>>;
  maxFiles?: number;
  maxFileBytes?: number;
  /** Sesión guardada (cookies + localStorage) para arrancar logueado. */
  storageState?: unknown;
  /** Devolver la sesión al terminar (para guardarla). */
  saveSession?: boolean;
  /** Proxy de salida (proveedor configurado por env, p. ej. residencial por país). */
  proxy?: { server: string; username?: string; password?: string };
  /** Idioma y zona horaria del país elegido. */
  locale?: string;
  timezoneId?: string;
}

/** Subconjunto de playwright-core que usa el arnés. */
export interface HarnessChromium {
  launch(opts: {
    headless: boolean;
    executablePath?: string;
    args?: string[];
    timeout?: number;
    proxy?: { server: string; username?: string; password?: string };
  }): Promise<{
    newContext(opts: Record<string, unknown>): Promise<{
      route(pattern: string, handler: (route: {
        request(): { url(): string; method(): string; headers(): Record<string, string> };
        abort(code?: string): Promise<void>;
        continue(): Promise<void>;
        fetch(opts?: { maxRedirects?: number; url?: string; method?: string }): Promise<{
          status(): number;
          headers(): Record<string, string>;
          body(): Promise<Buffer>;
        }>;
        fulfill(opts: { response?: unknown; status?: number; body?: string }): Promise<void>;
      }) => Promise<void>): Promise<void>;
      /** Playwright ≥ 1.48: los WebSocket no pasan por route(). */
      routeWebSocket?(
        pattern: RegExp,
        handler: (ws: { url(): string; close(opts?: { code?: number; reason?: string }): Promise<void>; connectToServer(): unknown }) => unknown,
      ): Promise<void>;
      on(event: 'page', cb: (p: { close(): Promise<void> }) => void): void;
      newPage(): Promise<unknown>;
      storageState(): Promise<unknown>;
    }>;
    close(): Promise<void>;
  }>;
}

/**
 * Abre Chromium (sin descargas, sin service workers), bloquea pedidos a
 * hosts privados y esquemas no http(s), limita las pestañas y corre el
 * intérprete. Autocontenida (se serializa al script del sandbox).
 */
export async function robotHarness(
  chromium: HarnessChromium,
  job: HarnessJob,
  interpret: typeof robotInterpreter,
  checkUrl: (url: string) => Promise<string | null>,
): Promise<InterpreterResult> {
  const started = Date.now();
  let browser: Awaited<ReturnType<HarnessChromium['launch']>> | null = null;
  let killer: ReturnType<typeof setTimeout> | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: job.executablePath || undefined,
      // WebRTC sin UDP directo: no abre conexiones a la red interna por fuera de route().
      // Topes de memoria y procesos: un sitio hostil no se come el runner.
      args: [
        ...(job.args ?? []),
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--js-flags=--max-old-space-size=512',
        '--renderer-process-limit=4',
        '--disable-gpu',
      ],
      timeout: 30_000,
      ...(job.proxy && job.proxy.server ? { proxy: job.proxy } : {}),
    });
    const b = browser;
    killer = setTimeout(() => {
      void b.close().catch(() => {});
    }, Math.max(1000, job.deadline - Date.now() + 5000));
    // Descargas: solo si el robot tiene un paso download (lo lee ese paso; van a
    // un temporal que se borra al cerrar). Sin ese paso, el sitio no puede bajar nada.
    const wantsDownloads = JSON.stringify(job.steps).includes('"download"');
    const context = await browser.newContext({
      acceptDownloads: wantsDownloads,
      ...(job.storageState ? { storageState: job.storageState } : {}),
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 800 },
      locale: job.locale || 'en-US',
      ...(job.timezoneId ? { timezoneId: job.timezoneId } : {}),
      ...(job.locale ? { extraHTTPHeaders: { 'accept-language': `${job.locale},${job.locale.split('-')[0]};q=0.9,en;q=0.5` } } : {}),
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 ZerosoftRobots/1',
    });
    // SSRF: cada pedido se valida por la IP a la que resuelve su host (sin
    // caché por origen: así un re-bind de DNS no reusa un veredicto viejo).
    // Las redirecciones (30x) NO las sigue Chromium: las resolvemos acá con
    // route.fetch({ maxRedirects: 0 }) y validamos cada Location antes de
    // seguirla, igual que una navegación nueva. Un redirector a la red interna
    // (location.href, window.open o un 30x del propio servidor) se corta.
    const MAX_HOPS = 8;
    await context.route('**/*', async (route) => {
      const raw = route.request().url();
      if (/^(data|blob|about):/i.test(raw)) return route.continue();
      if (await checkUrl(raw).catch(() => 'unresolvable_host')) return route.abort('blockedbyclient');
      // route.fetch no existe en Playwright viejos: ahí se continúa (el salto
      // inicial ya se validó; sin seguir redirects a mano no hay protección extra).
      if (typeof route.fetch !== 'function' || typeof route.fulfill !== 'function') return route.continue();
      try {
        let current = raw;
        let method = route.request().method();
        for (let hop = 0; ; hop++) {
          const res = await route.fetch(hop === 0 ? { maxRedirects: 0 } : { maxRedirects: 0, url: current, method });
          const status = res.status();
          const loc = res.headers()['location'];
          if (status < 300 || status >= 400 || !loc) return route.fulfill({ response: res });
          if (hop >= MAX_HOPS) return route.abort('blockedbyclient');
          let next: string;
          try {
            next = new URL(loc, current).toString();
          } catch {
            return route.abort('blockedbyclient');
          }
          if (!/^https?:\/\//i.test(next)) return route.abort('blockedbyclient');
          if (await checkUrl(next).catch(() => 'unresolvable_host')) return route.abort('blockedbyclient');
          // 301/302/303: el siguiente salto es GET sin cuerpo (307/308 conservan el método).
          if (status === 301 || status === 302 || status === 303) method = 'GET';
          current = next;
        }
      } catch {
        return route.abort('blockedbyclient').catch(() => {});
      }
    });
    // Los WebSocket (ws/wss) no pasan por route(): misma verificación de host.
    if (typeof context.routeWebSocket === 'function') {
      await context.routeWebSocket(/.*/, async (ws) => {
        let origin = '';
        try {
          const u = new URL(ws.url());
          if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return ws.close({ code: 1008, reason: 'blocked' });
          origin = `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`;
        } catch {
          return ws.close({ code: 1008, reason: 'blocked' });
        }
        if (await checkUrl(`${origin}/`).catch(() => 'unresolvable_host')) return ws.close({ code: 1008, reason: 'blocked' });
        ws.connectToServer();
      });
    }
    let opened = 0;
    context.on('page', (p) => {
      opened += 1;
      // La primera es la nuestra; los popups extra cuentan contra el límite.
      if (opened > job.maxPages) void p.close().catch(() => {});
    });
    const page = (await context.newPage()) as RobotPage;
    const result = await interpret(page, job.steps, job.inputs, {
      deadline: job.deadline,
      checkUrl,
      maxPages: job.maxPages,
      maxScreenshots: job.maxScreenshots,
      maxExecuted: job.maxExecuted,
      maxLoopItems: job.maxLoopItems,
      robotName: job.robotName,
      credentials: job.credentials,
      maxFiles: job.maxFiles,
      maxFileBytes: job.maxFileBytes,
    });
    if (job.saveSession) {
      try {
        result.storageState = await context.storageState();
      } catch {
        // sin sesión: se conserva la anterior
      }
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'browser_error';
    // El renderer se cayó (p. ej. una página pesada que se come la memoria): mensaje claro.
    const crashed = /Target crashed|Target closed|crashed|out of memory|Session closed/i.test(msg);
    return {
      status: 'failed',
      error:
        Date.now() - started > 5000 && job.deadline <= Date.now()
          ? 'timeout'
          : crashed
            ? 'page_crashed: the page used too much memory or closed the browser'
            : `browser_error: ${msg}`,
      vars: {},
      logs: [],
      screenshots: [],
      pages: 0,
    };
  } finally {
    if (killer) clearTimeout(killer);
    if (browser) await browser.close().catch(() => {});
  }
}
