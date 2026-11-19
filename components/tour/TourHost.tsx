'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { atTourStart, stepsFor, TOUR_START_EVENT, TOURS, type TourAudience, type TourBoot, type TourStatus, type TourStep } from '@/lib/tours';

/** Ancho desde el que la tarjeta flota junto al elemento; más angosto, va pegada abajo (o arriba). */
const DOCK_MAX = 640;
const GAP = 12;
const EDGE = 12;
const PAD = 6;
/** Al abrirse, cuánto se espera a que la página termine de pintar antes de dar un paso por ausente. */
const SETTLE_MS = 1200;
/** Después de un paso que se cumple con un clic (abrir un chat), cuánto se espera al elemento siguiente. */
const AFTER_CLICK_MS = 8000;
/** Mínimo que se espera a un elemento antes de darlo por ausente (una lista que se está refrescando). */
const GRACE_MS = 300;
/** Tope de espera mientras algo de la pantalla está cargando. */
const BUSY_MAX_MS = 8000;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function post(body: Record<string, unknown>) {
  void fetch('/api/tours', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
}

/** A la vista: pintado, con tamaño y dentro del ancho de la ventana (un drawer cerrado no cuenta). */
function onScreen(el: HTMLElement): boolean {
  if (el.closest('[inert]')) return false;
  const check = (el as HTMLElement & { checkVisibility?: (o?: Record<string, boolean>) => boolean }).checkVisibility;
  if (typeof check === 'function' && !check.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return r.right > 0 && r.left < window.innerWidth;
}

function findTarget(step: TourStep | undefined): HTMLElement | null {
  for (const name of step?.targets ?? []) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))) {
      if (onScreen(el)) return el;
    }
  }
  return null;
}

/** Algo de la pantalla está cargando (listas y paneles marcan aria-busy mientras traen datos). */
function loading(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-busy="true"]')).some(onScreen);
}

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  // Recortado a la ventana: una lista más alta que la pantalla no saca el resaltado afuera.
  const top = Math.max(r.top - PAD, 4);
  const left = Math.max(r.left - PAD, 4);
  const bottom = Math.min(r.bottom + PAD, window.innerHeight - 4);
  const right = Math.min(r.right + PAD, window.innerWidth - 4);
  return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
}

const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * Motor de los tours guiados (lib/tours). Resalta el elemento del paso con un
 * recorte sobre la pantalla atenuada y una tarjeta al lado (en el teléfono,
 * pegada abajo, o arriba si el elemento está abajo). Nada bloquea la app: el
 * resalte no toma clics y un paso "usá esto" avanza cuando la persona lo usa.
 *
 * - Se abre solo en la ruta de arranque si `boot.auto` (primera vez, después
 *   del onboarding), y retoma el paso donde quedó.
 * - El menú de la cuenta lo reabre con requestTour() (evento TOUR_START_EVENT).
 * - Un paso cuyo elemento no está a la vista se saltea (o va centrado).
 * - Esc sale; el foco va al botón principal de cada paso y vuelve a donde
 *   estaba al cerrar.
 *
 * El progreso, "No mostrar más tours" y la respuesta equipo/sola se guardan
 * en /api/tours.
 */
export default function TourHost({ boot }: { boot: TourBoot }) {
  const def = TOURS[boot.tour];
  const t = useTranslations('common.tour');
  const pathname = usePathname();
  const router = useRouter();
  const ids = useId();

  const [audience, setAudience] = useState<TourAudience | null>(boot.audience);
  const steps = useMemo(() => stepsFor(def, { audience, admin: boot.admin }), [def, audience, boot.admin]);
  const [running, setRunning] = useState(false);
  /** Índice del paso que se busca o se muestra. */
  const [idx, setIdx] = useState(0);
  /** Pasos mostrados, en orden (Atrás vuelve por acá). */
  const [history, setHistoryState] = useState<number[]>([]);
  const historyRef = useRef<number[]>([]);
  const setHistory = useCallback((next: number[] | ((h: number[]) => number[])) => {
    historyRef.current = typeof next === 'function' ? next(historyRef.current) : next;
    setHistoryState(historyRef.current);
  }, []);
  const [dir, setDir] = useState<1 | -1>(1);
  const [target, setTarget] = useState<{ idx: number; el: HTMLElement | null } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [nonce, setNonce] = useState(0);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [accent, setAccent] = useState('');
  const pop = useRef<HTMLDivElement>(null);
  const settleAt = useRef(0);
  const afterClick = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pendingStart = useRef<string | null | false>(false);
  const autoTried = useRef(false);
  const lastSaved = useRef('');
  const moving = useRef(false);

  const start = useCallback(
    (from: string | null) => {
      const at = from ? steps.findIndex((s) => s.id === from) : -1;
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // El color de la app (lo pone .app-frame) para el resaltado: la capa va en un portal fuera del marco.
      const frame = document.querySelector('.app-frame');
      setAccent(frame ? getComputedStyle(frame).getPropertyValue('--accent-ink').trim() : '');
      settleAt.current = Date.now() + SETTLE_MS;
      afterClick.current = false;
      moving.current = false;
      lastSaved.current = '';
      setHistory([]);
      setDir(1);
      setTarget(null);
      setIdx(Math.max(at, 0));
      setRunning(true);
    },
    [steps, setHistory],
  );

  const close = useCallback(
    (status: Exclude<TourStatus, 'active'>, current?: string) => {
      setRunning(false);
      setTarget(null);
      setBox(null);
      post({ kind: 'progress', tour: def.key, status, ...(current ? { step: current } : {}) });
      const back = returnFocus.current;
      returnFocus.current = null;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    },
    [def.key],
  );

  // Primera vez: se abre solo en la ruta de arranque (no encima de "Nuevo chat").
  useEffect(() => {
    if (autoTried.current || !boot.auto || !atTourStart(def, pathname)) return;
    autoTried.current = true;
    if (new URLSearchParams(window.location.search).has('new')) return;
    start(boot.resume);
  }, [boot.auto, boot.resume, def, pathname, start]);

  // Reabrir desde el menú: si la ruta no es la de arranque, primero se va ahí.
  useEffect(() => {
    const onStart = (e: Event) => {
      const tour = (e as CustomEvent<{ tour?: string }>).detail?.tour;
      if (tour !== def.key) return;
      if (atTourStart(def, window.location.pathname)) start(null);
      else {
        pendingStart.current = null;
        router.push(def.startPath);
      }
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [def, router, start]);
  useEffect(() => {
    if (pendingStart.current === false || !atTourStart(def, pathname)) return;
    const from = pendingStart.current;
    pendingStart.current = false;
    start(from);
  }, [def, pathname, start]);

  const step = running ? steps[idx] : undefined;
  const shown = running && target?.idx === idx ? target : null;

  // Buscar el elemento del paso: espera a que la página pinte; si no aparece, se saltea (o va centrado).
  useEffect(() => {
    if (!running) return;
    const s = steps[idx];
    if (!s) {
      close('done', steps[steps.length - 1]?.id);
      return;
    }
    if (!s.targets?.length) {
      setTarget({ idx, el: null });
      return;
    }
    const wait = afterClick.current ? AFTER_CLICK_MS : Math.max(settleAt.current - Date.now(), GRACE_MS);
    const deadline = Date.now() + wait;
    const hardDeadline = Date.now() + Math.max(wait, BUSY_MAX_MS);
    let timer = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const el = findTarget(s);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setTarget({ idx, el });
        return;
      }
      // Mientras la página dice que está cargando (aria-busy), el elemento todavía puede aparecer.
      if (Date.now() < deadline || (Date.now() < hardDeadline && loading())) {
        timer = window.setTimeout(tick, 120);
        return;
      }
      if (s.ifMissing === 'center') {
        setTarget({ idx, el: null });
        return;
      }
      // Ausente: el siguiente en la misma dirección. Volviendo, el de antes en la historia.
      if (dir === -1) {
        const rest = historyRef.current.slice(0, -1);
        const prev = rest[rest.length - 1];
        setHistory(rest);
        if (prev === undefined) setDir(1);
        setIdx(prev ?? 0);
      } else setIdx((i) => i + 1);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [running, idx, steps, dir, nonce, close, setHistory]);

  // Un paso mostrado entra a la historia y queda guardado como progreso.
  useEffect(() => {
    if (!shown) return;
    afterClick.current = false;
    moving.current = false;
    setHistory((h) => (h[h.length - 1] === shown.idx ? h : [...h.filter((i) => i < shown.idx), shown.idx]));
    const id = steps[shown.idx]?.id;
    if (id && lastSaved.current !== id) {
      lastSaved.current = id;
      post({ kind: 'progress', tour: def.key, status: 'active', step: id });
    }
  }, [shown, steps, def.key, setHistory]);

  // Seguir al elemento (scroll, cambios de tamaño). Si desaparece, se vuelve a buscar.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let vp = { w: 0, h: 0 };
    // undefined: todavía no se midió en este paso (un paso centrado borra el resalte del anterior).
    let last: Box | null | undefined;
    const loop = () => {
      if (vp.w !== window.innerWidth || vp.h !== window.innerHeight) {
        vp = { w: window.innerWidth, h: window.innerHeight };
        setViewport(vp);
      }
      const el = shown?.el;
      const b = el && el.isConnected && onScreen(el) ? boxOf(el) : null;
      if (el && !b) {
        // El elemento se fue (cambió la vista): se busca de nuevo.
        setTarget(null);
        setBox(null);
        setNonce((n) => n + 1);
        return;
      }
      if (last === undefined || !sameBox(last, b)) {
        last = b;
        setBox(b);
      }
      raf = window.requestAnimationFrame(loop);
    };
    loop();
    return () => window.cancelAnimationFrame(raf);
  }, [running, shown]);

  const next = useCallback(
    (byClick = false) => {
      // Un solo paso por vez: un doble disparo (Enter y clic, dos clics seguidos) no saltea el siguiente.
      if (moving.current) return;
      moving.current = true;
      afterClick.current = byClick;
      setDir(1);
      setIdx((i) => i + 1);
    },
    [],
  );
  const back = useCallback(() => {
    const prev = history[history.length - 2];
    if (prev === undefined || moving.current) return;
    moving.current = true;
    setDir(-1);
    setHistory((h) => h.slice(0, -1));
    setIdx(prev);
  }, [history, setHistory]);

  // Un paso "usá esto": el clic en el elemento (o en uno igual, como otra fila) lo cumple.
  useEffect(() => {
    if (!shown?.el || steps[shown.idx]?.advanceOn !== 'click') return;
    const names = steps[shown.idx].targets ?? [];
    const onClick = (e: MouseEvent) => {
      const hit = e.target instanceof Element && names.some((n) => (e.target as Element).closest(`[data-tour="${n}"]`));
      if (hit) window.setTimeout(() => next(true), 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [shown, steps, next]);

  // Teclado: Esc sale; con el foco en la tarjeta, las flechas van y vuelven.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Un menú o un diálogo de la app abierto encima se cierra primero (salvo con el foco en la tarjeta).
        const inPop = pop.current?.contains(document.activeElement);
        if (!inPop && Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="menu"], .zs-msel-list')).some(onScreen)) return;
        e.preventDefault();
        e.stopPropagation();
        close('exited', steps[idx]?.id);
        return;
      }
      if (!pop.current?.contains(document.activeElement)) return;
      if (e.key === 'ArrowRight' && steps[idx] && !steps[idx].advanceOn && !steps[idx].askAudience) {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [running, idx, steps, close, next, back]);

  // El total de pasos depende de lo que hay en pantalla (una lista que termina de cargar): se recalcula.
  const [, setRecount] = useState(0);
  useEffect(() => {
    if (!shown) return;
    const id = window.setInterval(() => setRecount((n) => n + 1), 700);
    return () => window.clearInterval(id);
  }, [shown]);

  // El foco va al botón principal de cada paso.
  useEffect(() => {
    if (!shown) return;
    pop.current?.querySelector<HTMLElement>('[data-tour-primary]')?.focus({ preventScroll: true });
  }, [shown]);

  const docked = viewport.w > 0 && viewport.w <= DOCK_MAX;
  const dockTop = docked && !!box && box.top + box.height / 2 > viewport.h / 2;

  // Ubicar la tarjeta junto al elemento: abajo, arriba, a la derecha o a la izquierda (lo primero que entra).
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el || !shown) return;
    if (docked || !box) {
      el.style.removeProperty('top');
      el.style.removeProperty('left');
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.min(Math.max(x, EDGE), vw - w - EDGE);
    const clampY = (y: number) => Math.min(Math.max(y, EDGE), vh - h - EDGE);
    const options: Array<[boolean, number, number]> = [
      [box.top + box.height + GAP + h <= vh - EDGE, box.top + box.height + GAP, clampX(box.left)],
      [box.top - GAP - h >= EDGE, box.top - GAP - h, clampX(box.left)],
      [box.left + box.width + GAP + w <= vw - EDGE, clampY(box.top), box.left + box.width + GAP],
      [box.left - GAP - w >= EDGE, clampY(box.top), box.left - GAP - w],
    ];
    const fit = options.find(([ok]) => ok);
    // Nada entra (un elemento que ocupa casi toda la pantalla): abajo a la derecha, encima.
    const [, top, left] = fit ?? [false, vh - h - EDGE, vw - w - EDGE];
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  });

  if (!running || !step || typeof document === 'undefined') return null;
  const current = shown ? steps[shown.idx] : null;
  const ask = !!current?.askAudience && !audience;
  const last = shown ? shown.idx === steps.length - 1 : false;
  // Cuántos faltan: los que no buscan nada, los que ya están a la vista y los que aparecen después de un clic.
  const remaining = shown
    ? steps.slice(shown.idx + 1).reduce(
        (acc, s) => {
          const counts = acc.unlocked || !s.targets?.length || s.ifMissing === 'center' || !!findTarget(s);
          return { n: acc.n + (counts ? 1 : 0), unlocked: acc.unlocked || s.advanceOn === 'click' };
        },
        { n: 0, unlocked: !!current?.advanceOn },
      ).n
    : 0;
  const position = history.length || 1;
  const total = position + remaining;

  const answer = (a: TourAudience) => {
    setAudience(a);
    post({ kind: 'audience', audience: a });
    // Con la respuesta cambian los pasos: el siguiente es el que sigue a este en la lista nueva.
    const nextSteps = stepsFor(def, { audience: a, admin: boot.admin });
    const at = nextSteps.findIndex((s) => s.id === current?.id);
    setHistory((h) => h.map((i) => nextSteps.findIndex((s) => s.id === steps[i]?.id)).filter((i) => i >= 0));
    setDir(1);
    setIdx(at + 1);
  };

  const style = accent ? ({ '--tour-accent': accent } as CSSProperties) : undefined;
  return createPortal(
    <div className="zs-tour-layer" style={style} data-testid="tour-layer">
      {shown && (box ? <div className="zs-tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} aria-hidden="true" /> : <div className="zs-tour-dim" aria-hidden="true" />)}
      {shown && current && (
        <div
          ref={pop}
          className={`zs-tour${docked ? (dockTop ? ' is-docked is-top' : ' is-docked') : ''}${box ? '' : ' is-center'}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${ids}-title`}
          aria-describedby={`${ids}-body`}
          data-testid="tour"
          data-tour-step={current.id}
        >
          <div className="zs-tour-head">
            <p className="zs-tour-count" data-testid="tour-count">
              {t('count', { n: position, total })}
            </p>
            <button type="button" className="btn btn-ghost btn-icon btn-sm zs-tour-close" onClick={() => close('exited', current.id)} aria-label={t('exit')} title={t('exit')} data-testid="tour-exit">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" />
              </svg>
            </button>
          </div>
          <h2 className="zs-tour-title" id={`${ids}-title`}>
            {t(`${def.key}.${current.id}.title`)}
          </h2>
          <p className="zs-tour-body" id={`${ids}-body`}>
            {t(`${def.key}.${current.id}.body`)}
          </p>
          {ask && (
            <div className="zs-tour-ask" role="group" aria-labelledby={`${ids}-ask`}>
              <p className="zs-tour-ask-q" id={`${ids}-ask`}>
                {t('ask')}
              </p>
              <div className="zs-tour-ask-options">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => answer('solo')} data-testid="tour-solo" data-tour-primary>
                  {t('solo')}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => answer('team')} data-testid="tour-team">
                  {t('team')}
                </button>
              </div>
            </div>
          )}
          <div className="zs-tour-foot">
            <button type="button" className="zs-tour-off" onClick={() => {
              post({ kind: 'off', off: true });
              close('exited', current.id);
            }} data-testid="tour-off">
              {t('off')}
            </button>
            <div className="zs-tour-nav">
              {history.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={back} data-testid="tour-back">
                  {t('back')}
                </button>
              )}
              {ask || current.advanceOn ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => next()} data-testid="tour-skip" {...(ask ? {} : { 'data-tour-primary': true })}>
                  {t('skipStep')}
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => (last ? close('done', current.id) : next())} data-testid="tour-next" data-tour-primary>
                  {last ? t('finish') : t('next')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
