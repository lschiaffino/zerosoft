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
}

export interface RobotPage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' }): Promise<unknown>;
  url(): string;
  locator(selector: string): RobotLocator;
  getByText(text: string, opts?: { exact?: boolean }): RobotLocator;
  keyboard: { press(key: string): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts?: { type?: 'jpeg' | 'png'; quality?: number; timeout?: number }): Promise<Uint8Array>;
  evaluate<R>(fn: (arg: number) => R, arg: number): Promise<R>;
}

export interface RobotLogEntry {
  /** Número de paso (1-based); en loops, "3.2" = paso 2 del loop del paso 3. */
  step: string;
  type: string;
  status: 'success' | 'failed' | 'skipped';
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

export interface InterpreterResult {
  status: 'success' | 'failed';
  error: string | null;
  vars: Record<string, unknown>;
  logs: RobotLogEntry[];
  screenshots: RobotScreenshot[];
  pages: number;
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
  const vars: Record<string, unknown> = {};
  const logs: RobotLogEntry[] = [];
  const screenshots: RobotScreenshot[] = [];
  let pages = 0;
  let executed = 0;

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

  type Outcome = { jump?: number; skip?: number; stop?: boolean; detail?: string };

  const runLeaf = async (s: InterpreterStep, ctx: Record<string, unknown>): Promise<Outcome> => {
    const selector = render(str(s.selector), ctx).trim();
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
        const rows = await page
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
        vars[name] = rows;
        return { detail: `${name}: ${Array.isArray(rows) ? rows.length : 0} rows` };
      }
      case 'screenshot': {
        if (screenshots.length >= maxShots) return { detail: 'screenshot_limit' };
        const buf = await page.screenshot({ type: 'jpeg', quality: 60, timeout: timeout() });
        let b64 = '';
        // Buffer en Node; Uint8Array genérico en tests.
        const B = (globalThis as unknown as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
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
      default:
        return fail('unknown_step');
    }
  };

  /** Corre una lista de pasos. Devuelve true si un if_exists pidió terminar. */
  const runList = async (list: InterpreterStep[], ctx: Record<string, unknown>, prefix: string): Promise<boolean> => {
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
        for (let k = 0; k < capped.length; k++) {
          const stop = await runList(inner, { ...ctx, vars, loop: { item: capped[k], index: k } }, `${label}.${k + 1}.`);
          if (stop) return true;
        }
        i += 1;
        continue;
      }
      let out: Outcome;
      try {
        out = await runLeaf(s, { ...ctx, vars });
      } catch (err) {
        const code =
          err instanceof RobotError
            ? err.message
            : err instanceof Error && /timeout/i.test(err.name + err.message)
              ? 'action_timeout'
              : 'action_failed';
        const msg = err instanceof Error && !(err instanceof RobotError) ? err.message.split('\n')[0].slice(0, 300) : undefined;
        logs.push({ step: label, type: s.type, status: 'failed', ms: Date.now() - started, error: code, detail: msg });
        throw new RobotError(`${label}: ${code}`);
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
    await runList(steps, { inputs, vars, robot: { name: opts.robotName ?? '' } }, '');
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : 'error';
  }
  return { status: error ? 'failed' : 'success', error, vars, logs, screenshots, pages };
}

/** IPv4/IPv6 privada, loopback, link-local, CGNAT o multicast. Autocontenida. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v.includes(':')) {
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]) : false;
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
}

/** Subconjunto de playwright-core que usa el arnés. */
export interface HarnessChromium {
  launch(opts: { headless: boolean; executablePath?: string; args?: string[]; timeout?: number }): Promise<{
    newContext(opts: Record<string, unknown>): Promise<{
      route(pattern: string, handler: (route: {
        request(): { url(): string };
        abort(code?: string): Promise<void>;
        continue(): Promise<void>;
      }) => Promise<void>): Promise<void>;
      on(event: 'page', cb: (p: { close(): Promise<void> }) => void): void;
      newPage(): Promise<unknown>;
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
      args: job.args ?? [],
      timeout: 30_000,
    });
    const b = browser;
    killer = setTimeout(() => {
      void b.close().catch(() => {});
    }, Math.max(1000, job.deadline - Date.now() + 5000));
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 ZerosoftRobots/1',
    });
    const verdicts = new Map<string, Promise<string | null>>();
    await context.route('**/*', async (route) => {
      const raw = route.request().url();
      if (/^(data|blob|about):/i.test(raw)) return route.continue();
      let origin = '';
      try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.abort('blockedbyclient');
        origin = `${u.protocol}//${u.host}`;
      } catch {
        return route.abort('blockedbyclient');
      }
      let verdict = verdicts.get(origin);
      if (!verdict) {
        verdict = checkUrl(`${origin}/`).catch(() => 'unresolvable_host');
        verdicts.set(origin, verdict);
      }
      if (await verdict) return route.abort('blockedbyclient');
      return route.continue();
    });
    let opened = 0;
    context.on('page', (p) => {
      opened += 1;
      // La primera es la nuestra; los popups extra cuentan contra el límite.
      if (opened > job.maxPages) void p.close().catch(() => {});
    });
    const page = (await context.newPage()) as RobotPage;
    return await interpret(page, job.steps, job.inputs, {
      deadline: job.deadline,
      checkUrl,
      maxPages: job.maxPages,
      maxScreenshots: job.maxScreenshots,
      maxExecuted: job.maxExecuted,
      maxLoopItems: job.maxLoopItems,
      robotName: job.robotName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'browser_error';
    return {
      status: 'failed',
      error: Date.now() - started > 5000 && job.deadline <= Date.now() ? 'timeout' : `browser_error: ${msg}`,
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
