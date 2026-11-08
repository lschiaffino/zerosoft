import { expect, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Chequeos de "se usa en el teléfono" para cualquier página u overlay abierto:
 *
 * - hscroll:  la página no scrollea de costado.
 * - offscreen: nada visible queda fuera de la pantalla, salvo dentro de un
 *              contenedor que scrollea o recorta (una tabla con su propio scroll).
 * - tap:      un campo mide ≥ 40px de alto; lo demás ≥ 40×40 o con aire alrededor (un
 *              cuadrado de 40px centrado no pisa otro objetivo). Un checkbox cuenta por su
 *              label; los links dentro de un párrafo no cuentan.
 * - zoom:     inputs, selects y textareas con letra ≥ 16px (si no, iOS hace zoom al enfocar).
 * - sheet:    un diálogo modal abierto ocupa el ancho de la pantalla (hoja de abajo o pantalla completa).
 * - popover:  menús, listas y diálogos no modales quedan enteros dentro de la pantalla.
 * - hover:    nada que se toca queda invisible esperando un hover que el dedo no hace.
 *
 * Lo usan los responsive-*.spec.ts. Con RESPONSIVE_CRAWL=<carpeta> no falla:
 * junta todo en <carpeta>/report.jsonl y guarda una captura por vista.
 */

export interface Issue {
  kind: 'hscroll' | 'offscreen' | 'tap' | 'zoom' | 'sheet' | 'popover' | 'hover';
  what: string;
  detail?: string;
}

export const PHONE = { width: 390, height: 844 };
export const SMALL_PHONE = { width: 360, height: 740 };
export const TABLET = { width: 768, height: 1024 };

export const CRAWL_DIR = process.env.RESPONSIVE_CRAWL || '';

/** Theme por cookie (zs_theme), igual que el selector de la app. */
export async function setTheme(context: BrowserContext, baseURL: string, theme: 'light' | 'dark') {
  await context.addCookies([{ name: 'zs_theme', value: theme, url: baseURL }]);
}

/** Corre los chequeos en la vista actual (página u overlay abierto). */
export async function auditView(page: Page, opts: { tap?: boolean } = {}): Promise<Issue[]> {
  return page.evaluate(({ checkTap }) => {
    const issues: Array<{ kind: string; what: string; detail?: string }> = [];
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const coarse = matchMedia('(pointer: coarse)').matches;

    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
      const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${id}${cls}${label ? ` "${label}"` : ''}`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      if ('checkVisibility' in el && !(el as HTMLElement).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      return true;
    };
    // Visualmente oculto a propósito (sr-only, clip) o decorativo.
    const srOnly = (el: Element) => {
      const s = getComputedStyle(el);
      return (s.clip !== 'auto' && s.clip !== '') || s.clipPath === 'inset(50%)' || el.closest('[aria-hidden="true"]') !== null;
    };
    /** El ancestro más cercano que recorta o scrollea en horizontal (antes de llegar al body). */
    const clipper = (el: Element): Element | null => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== 'visible' || s.contain.includes('paint')) return p;
        if (s.position === 'fixed') return null;
      }
      return null;
    };
    // Dentro de un overlay abierto, solo se mira ese overlay (lo de atrás queda inerte).
    const modal = [...document.querySelectorAll('dialog[open]')].find((d) => (d as HTMLDialogElement).matches(':modal'));
    // Un drawer o panel modal abierto (el sidebar en el teléfono, el switcher) tapa la página: se mira solo eso.
    const sheet = [...document.querySelectorAll('.side.open, .band-menu-panel, [aria-modal="true"]')].find((el) => visible(el));
    const scope: Element = modal ?? sheet ?? document.body;

    // 1. Scroll horizontal de la página.
    const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (sw > vw + 1) issues.push({ kind: 'hscroll', what: 'page', detail: `scrollWidth ${sw} > ${vw}` });

    // 2. Fuera de pantalla: solo el elemento más externo de cada rama.
    const off = new Set<Element>();
    for (const el of scope.querySelectorAll('*')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      if (!visible(el) || srOnly(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 && r.left >= -1) continue;
      // Algo que está entero fuera (un carrusel corrido, un drawer cerrado) no se ve: no es un corte.
      if (r.left >= vw || r.right <= 0) continue;
      const c = clipper(el);
      if (c) {
        const cr = c.getBoundingClientRect();
        // Recortado por un contenedor que sí entra en la pantalla: se ve por scroll o se corta adrede.
        if (cr.right <= vw + 1 && cr.left >= -1) continue;
      }
      if (el.parentElement && off.has(el.parentElement)) { off.add(el); continue; }
      off.add(el);
      issues.push({ kind: 'offscreen', what: describe(el), detail: `left ${Math.round(r.left)} right ${Math.round(r.right)} (vw ${vw})` });
    }

    // 3. Lo que se toca. Un campo de texto mide ≥ 40px de alto. El resto, ≥ 40×40, o tiene
    //    aire alrededor: un cuadrado de 40px centrado en él no pisa otro objetivo (la excepción
    //    de espaciado de WCAG 2.5.8 con 40 en vez de 24). Así un link suelto pasa y una fila de
    //    íconos de 24px pegados no.
    if (checkTap) {
      const sel = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="switch"], [role="checkbox"], input:not([type="hidden"]), select, textarea, summary';
      const targets: Array<{ el: Element; t: Element; r: DOMRect; field: boolean }> = [];
      const seen = new Set<Element>();
      for (const el of scope.querySelectorAll(sel)) {
        if (!visible(el) || srOnly(el)) continue;
        if ((el as HTMLButtonElement).disabled) continue;
        if (getComputedStyle(el).pointerEvents === 'none') continue;
        if (el.closest('[contenteditable="true"], .cm-editor, .ProseMirror, canvas, [data-responsive-skip]')) continue;
        let target: Element = el;
        const type = (el as HTMLInputElement).type;
        const isInput = el.tagName === 'INPUT';
        if (isInput && type === 'file') continue;
        if (isInput && (type === 'checkbox' || type === 'radio')) target = el.closest('label') ?? el;
        // Un label o un ítem que lo envuelve hace de área táctil.
        const wrap = el.parentElement?.closest('label, [role="menuitem"], [role="option"], li[role], .tap-wrap');
        if (wrap && wrap !== el) {
          const wr = wrap.getBoundingClientRect();
          if (wr.height >= 39.5 && wr.width >= 39.5) continue;
        }
        if (seen.has(target)) continue;
        seen.add(target);
        // Links dentro de texto corrido: el tamaño lo da la línea, como en cualquier lectura.
        if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') {
          const p = el.parentElement;
          if (p && [...p.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0)) continue;
        }
        const r = target.getBoundingClientRect();
        if (r.right < 0 || r.left > vw) continue;
        // Un telón que cierra el panel (botón invisible a pantalla completa) no compite con nadie.
        if (r.width >= vw * 0.9 && r.height >= vh * 0.5 && !(el.textContent ?? '').trim()) continue;
        // Escondido arriba hasta recibir foco (el "saltar al contenido"; a veces el foco cae ahí al cerrar un overlay).
        if ((r.bottom <= 0 && window.scrollY === 0) || el.classList.contains('skip-link')) continue;
        const field = el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (isInput && !['checkbox', 'radio', 'range', 'color', 'submit', 'button', 'reset', 'image'].includes(type));
        targets.push({ el, t: target, r, field });
      }
      const near = (a: DOMRect, b: DOMRect) => {
        const cx = a.left + a.width / 2;
        const cy = a.top + a.height / 2;
        const box = { l: Math.min(a.left, cx - 20), r: Math.max(a.right, cx + 20), t: Math.min(a.top, cy - 20), b: Math.max(a.bottom, cy + 20) };
        return b.left < box.r - 0.5 && b.right > box.l + 0.5 && b.top < box.b - 0.5 && b.bottom > box.t + 0.5;
      };
      for (const x of targets) {
        const { r } = x;
        if (x.field) {
          if (r.height < 39.5) issues.push({ kind: 'tap', what: describe(x.el), detail: `${Math.round(r.width)}x${Math.round(r.height)} (campo)` });
          continue;
        }
        if (r.height >= 39.5 && r.width >= 39.5) continue;
        const crowd = targets.find((o) => o !== x && !o.t.contains(x.t) && !x.t.contains(o.t) && near(r, o.r));
        if (crowd) issues.push({ kind: 'tap', what: describe(x.el), detail: `${Math.round(r.width)}x${Math.round(r.height)} junto a ${describe(crowd.el).slice(0, 40)}` });
      }
    }

    // 4. Letra de los campos (zoom de iOS).
    if (coarse) {
      for (const el of scope.querySelectorAll('input, select, textarea')) {
        const type = (el as HTMLInputElement).type;
        if (['checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
        if (!visible(el) || srOnly(el) || (el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) issues.push({ kind: 'zoom', what: describe(el), detail: `${fs}px` });
      }
    }

    // 5. Acciones que solo aparecen al pasar el puntero: con el dedo no hay hover.
    if (!matchMedia('(hover: hover)').matches) {
      for (const el of scope.querySelectorAll('button, a[href], [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || srOnly(el)) continue;
        // Sin eventos (pointer-events: none) no es un objetivo: se abre de otro modo (toque largo, barra táctil).
        if (getComputedStyle(el).pointerEvents === 'none') continue;
        if (!('checkVisibility' in el) || !(el as HTMLElement).checkVisibility({ checkVisibilityCSS: true })) continue;
        let o = 1;
        for (let p: Element | null = el; p && o > 0.05; p = p.parentElement) o *= parseFloat(getComputedStyle(p).opacity);
        if (o <= 0.05 && r.right > 0 && r.left < vw) issues.push({ kind: 'hover', what: describe(el), detail: 'opacity 0 sin hover' });
      }
    }

    // 6. Overlays abiertos.
    for (const d of document.querySelectorAll('dialog[open]')) {
      if (!visible(d)) continue;
      const r = d.getBoundingClientRect();
      if ((d as HTMLDialogElement).matches(':modal') && vw <= 640 && r.width < vw - 2) {
        issues.push({ kind: 'sheet', what: describe(d), detail: `width ${Math.round(r.width)} of ${vw}` });
      }
    }
    for (const el of document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], dialog[open], [popover]:popover-open')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const pos = getComputedStyle(el).position;
      // Una lista en el flujo de la página (role="listbox" de una vista) scrollea con ella: no es un popover.
      if (pos !== 'fixed' && pos !== 'absolute' && el.tagName !== 'DIALOG') continue;
      const below = pos !== 'absolute' && r.bottom > vh + 1 && getComputedStyle(el).overflowY === 'visible';
      if (r.left < -1 || r.right > vw + 1 || (pos !== 'absolute' && r.top < -1) || below) {
        issues.push({ kind: 'popover', what: describe(el), detail: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} in ${vw}x${vh}` });
      }
    }
    return issues;
  }, { checkTap: opts.tap !== false }) as Promise<Issue[]>;
}

let shotN = 0;
/** Revisa la vista; en modo crawl junta en el reporte y saca captura, si no, falla con la lista. */
export async function check(page: Page, label: string, opts: { tap?: boolean; ignore?: RegExp } = {}) {
  // Que terminen las animaciones de apertura (hojas, menús): a mitad de camino todo está corrido o transparente.
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity), null, { timeout: 2_000 })
    .catch(() => {});
  let issues = await auditView(page, opts);
  if (opts.ignore) issues = issues.filter((i) => !opts.ignore!.test(`${i.kind} ${i.what}`));
  if (CRAWL_DIR) {
    fs.mkdirSync(CRAWL_DIR, { recursive: true });
    const file = `${String(++shotN).padStart(4, '0')}-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.png`;
    await page.screenshot({ path: path.join(CRAWL_DIR, file) }).catch(() => {});
    fs.appendFileSync(path.join(CRAWL_DIR, 'report.jsonl'), JSON.stringify({ label, url: page.url(), shot: file, issues }) + '\n');
    return;
  }
  expect.soft(issues, `${label} (${page.url()})`).toEqual([]);
}

/** Espera a que la vista se asiente sin colgarse en páginas con polling. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(150);
}

/**
 * Abre los overlays de la página uno por uno (botones con menú o desplegable,
 * más los que se nombran) y revisa cada uno. Esc cierra; si no cierra, vuelve a la URL.
 */
export async function auditOverlays(page: Page, label: string, opts: { max?: number; extra?: RegExp; root?: string } = {}) {
  const url = page.url();
  const max = opts.max ?? 6;
  const mark = () => page.evaluate(([extraSrc, root]) => {
    const extra = extraSrc ? new RegExp(extraSrc, 'i') : null;
    const out: string[] = [];
    const main = document.querySelector(root) ?? document.body;
    const cands = [...main.querySelectorAll<HTMLElement>('button[aria-haspopup], button[aria-expanded="false"], [role="button"][aria-haspopup]')];
    if (extra) for (const b of main.querySelectorAll<HTMLElement>('button')) if (extra.test((b.getAttribute('aria-label') || b.innerText || '').trim())) cands.push(b);
    for (const b of new Set(cands)) {
      const r = b.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || (b as HTMLButtonElement).disabled) continue;
      // Marca estable para volver a encontrarlo después de cerrar el overlay anterior.
      const key = `ov${out.length}`;
      b.setAttribute('data-ov', key);
      out.push(key);
    }
    return [...new Set(out)];
  }, [opts.extra?.source ?? '', opts.root ?? 'main'] as const);
  const triggers = await mark();
  const reload = async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await mark();
  };
  for (const key of triggers.slice(0, max)) {
    const btn = page.locator(`[data-ov="${key}"]`);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const name = ((await btn.getAttribute('aria-label')) || (await btn.innerText().catch(() => '')) || key).trim().slice(0, 30);
    const before = page.url();
    await btn.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(250);
    if (page.url() !== before) {
      await reload();
      continue;
    }
    await check(page, `${label} · ${name}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    if (await page.locator('dialog[open]').count()) await reload();
  }
}
