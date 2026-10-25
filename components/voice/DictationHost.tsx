'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { parseShortcut, DEFAULT_VOICE_SETTINGS, type VoiceSettings } from '@/lib/voice-types';
import { useDictation } from './useDictation';
import { contextFor, copyText, editableTarget, insertIntoField } from './insert';
import { LevelBars, MicIcon, voiceErrorKey } from './voice-icons';

/** Mantener el atajo al menos esto empieza a dictar; un toque más corto deja pasar la tecla. */
const HOLD_MS = 300;
/** Dos toques dentro de este tiempo = manos libres. */
const DOUBLE_TAP_MS = 400;

/** Pegar el último dictado: Ctrl+Cmd+V en Mac (como Wispr Flow), Ctrl+Alt+Shift+V en el resto. */
function isPasteLast(e: KeyboardEvent): boolean {
  if (e.code !== 'KeyV') return false;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return mac ? e.metaKey && e.ctrlKey && !e.altKey && !e.shiftKey : e.ctrlKey && e.altKey && e.shiftKey && !e.metaKey;
}

/**
 * Dictado en toda la app (como Wispr Flow): mantener el atajo (Alt+Space por
 * defecto) 300 ms o más graba; al soltar, transcribe, limpia y escribe en el
 * campo que tenía el foco. Un toque corto deja pasar el carácter original
 * (Option+Space escribe su espacio duro); dos toques seguidos entran en manos
 * libres hasta el próximo toque. Sin campo enfocado, el texto se copia. Esc
 * cancela. Ctrl+Cmd+V (Mac) o Ctrl+Alt+Shift+V pega el último dictado. Con un
 * campo enfocado aparece un botón chico de dictar (se apaga en Voice › Ajustes).
 */
interface PendingTap {
  char: string;
  target: HTMLElement | null;
  /** Inputs y textareas: dónde estaba el cursor al tocar. */
  pos?: number;
  /** Contenteditable: el rango del cursor al tocar. */
  range?: Range;
}

function captureTap(char: string, target: HTMLElement | null): PendingTap {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return { char, target, pos: target.selectionStart ?? target.value.length };
  const sel = window.getSelection();
  return { char, target, range: sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : undefined };
}

/** Escribe el carácter del toque corto en su posición original, sin mover el cursor de quien sigue escribiendo. */
function insertTapChar(tap: PendingTap) {
  const el = tap.target;
  if (!tap.char || !el?.isConnected) return;
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && tap.pos !== undefined) {
    const pos = Math.min(tap.pos, el.value.length);
    const caret = el.selectionStart ?? el.value.length;
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, el.value.slice(0, pos) + tap.char + el.value.slice(pos));
    const next = caret >= pos ? caret + 1 : caret;
    if (document.activeElement === el) el.setSelectionRange(next, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (tap.range) {
    try {
      tap.range.insertNode(document.createTextNode(tap.char));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: tap.char }));
    } catch {
      /* el nodo ya no existe */
    }
  }
}

const BAR = 24;
const GAP = 8;
const INTERACTIVE = 'button, a[href], input, textarea, select, [role="button"], [role="tab"], [contenteditable="true"], [contenteditable=""]';

/**
 * Dónde va el botón de dictar: un ícono chico pegado a una esquina del campo,
 * por fuera (arriba a la derecha, abajo a la derecha, arriba a la izquierda o
 * abajo a la izquierda). Se descarta la esquina que pisa otro control (enviar,
 * guardar, adjuntar…) o queda fuera de la pantalla; si todas chocan, no se
 * muestra (el atajo sigue andando).
 */
function useBarPosition(field: HTMLElement | null, barRef: RefObject<HTMLButtonElement | null>): { top: number; left: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!field) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = field.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const candidates = [
        { top: r.top - BAR - GAP, left: r.right - BAR },
        { top: r.bottom + GAP, left: r.right - BAR },
        { top: r.top - BAR - GAP, left: r.left },
        { top: r.bottom + GAP, left: r.left },
      ];
      const free = (c: { top: number; left: number }) => {
        if (c.top < 4 || c.left < 4 || c.top + BAR > vh - 4 || c.left + BAR > vw - 4) return false;
        // Con un margen alrededor: tampoco se apoya sobre el borde de otro campo o botón.
        const m = 4;
        const points = [
          [c.left - m, c.top - m],
          [c.left + BAR + m, c.top - m],
          [c.left - m, c.top + BAR + m],
          [c.left + BAR + m, c.top + BAR + m],
          [c.left + BAR / 2, c.top - m],
          [c.left + BAR / 2, c.top + BAR + m],
          [c.left - m, c.top + BAR / 2],
          [c.left + BAR + m, c.top + BAR / 2],
          [c.left + BAR / 2, c.top + BAR / 2],
        ];
        for (const [x, y] of points) {
          for (const el of document.elementsFromPoint(x, y)) {
            if (el === barRef.current || barRef.current?.contains(el)) continue;
            if (el === field || field.contains(el)) return false;
            if (el.closest(INTERACTIVE)) return false;
          }
        }
        return true;
      };
      setPos(candidates.find(free) ?? null);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(field);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [field, barRef]);
  return pos;
}

export default function DictationHost() {
  const t = useTranslations('voice.host');
  const tErr = useTranslations('voice.errors');
  const pathname = usePathname();
  const d = useDictation();
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [focused, setFocused] = useState<HTMLElement | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const holdingRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Primer toque corto pendiente: el carácter que hay que dejar pasar si no llega un segundo toque. */
  const pendingTapRef = useRef<PendingTap | null>(null);
  const startedHoldRef = useRef(false);
  const barRef = useRef<HTMLButtonElement>(null);
  const lastKeyRef = useRef<PendingTap | null>(null);
  const handsFreeRef = useRef(false);
  const lastTextRef = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Ajustes de la persona (atajo, botón). Sin sesión o sin Voice, valores por defecto.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/voice/settings')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { settings?: VoiceSettings } | null) => {
          if (alive) setSettings(data?.settings ?? DEFAULT_VOICE_SETTINGS);
        })
        .catch(() => alive && setSettings(DEFAULT_VOICE_SETTINGS));
    void load();
    const onChange = () => void load();
    window.addEventListener('zs:voice-settings', onChange);
    return () => {
      alive = false;
      window.removeEventListener('zs:voice-settings', onChange);
    };
  }, []);

  const finish = useCallback(async () => {
    holdingRef.current = false;
    handsFreeRef.current = false;
    setHandsFree(false);
    const target = targetRef.current;
    const res = await d.stop({ context: contextFor(target), sourceApp: window.location.pathname });
    if (!res) return;
    lastTextRef.current = res.text;
    window.dispatchEvent(new CustomEvent('zs:voice-dictated', { detail: res }));
    if (target && insertIntoField(target, res.text)) {
      if (res.aiError) showToast(t('insertedRules'));
      return;
    }
    showToast((await copyText(res.text)) ? t('copied') : t('copyFailed'));
  }, [d, showToast, t]);

  const begin = useCallback(
    async (opts: { handsFree: boolean }) => {
      targetRef.current = editableTarget(document.activeElement);
      handsFreeRef.current = opts.handsFree;
      setHandsFree(opts.handsFree);
      await d.start();
    },
    [d],
  );

  d.autoStopRef.current = () => void finish();

  useEffect(() => {
    if (d.error) {
      showToast(tErr(voiceErrorKey(d.error)));
      d.setError(null);
    }
  }, [d, d.error, showToast, tErr]);

  useEffect(() => {
    const sc = parseShortcut(settings?.shortcut ?? DEFAULT_VOICE_SETTINGS.shortcut);
    const matches = (e: KeyboardEvent) =>
      e.code === sc.code && e.altKey === sc.alt && e.ctrlKey === sc.ctrl && e.shiftKey === sc.shift && e.metaKey === sc.meta;

    const clearHold = () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (d.state === 'recording' || d.state === 'starting')) {
        e.preventDefault();
        e.stopPropagation();
        holdingRef.current = false;
        handsFreeRef.current = false;
        clearHold();
        setHandsFree(false);
        d.cancel();
        showToast(t('cancelled'));
        return;
      }
      if (isPasteLast(e)) {
        const target = editableTarget(document.activeElement);
        if (!target) return;
        e.preventDefault();
        // El último dictado sale del historial del servidor (también los de la app de escritorio).
        void fetch('/api/voice/sessions?kind=dictation&limit=1')
          .then((r) => (r.ok ? (r.json() as Promise<{ sessions: Array<{ text: string }> }>) : null))
          .then((data) => {
            const text = data?.sessions[0]?.text || lastTextRef.current;
            if (text) insertIntoField(target, text);
          })
          .catch(() => lastTextRef.current && insertIntoField(target, lastTextRef.current));
        return;
      }
      if (!matches(e)) return;
      // Se retiene la tecla: si resulta ser un toque corto, el carácter se escribe después.
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (handsFreeRef.current && d.state === 'recording') {
        void finish();
        return;
      }
      if (d.state !== 'idle') return;
      holdingRef.current = true;
      startedHoldRef.current = false;
      const char = e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : '';
      const target = editableTarget(document.activeElement);
      const tapInfo = captureTap(char, target);
      clearHold();
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        if (!holdingRef.current) return;
        startedHoldRef.current = true;
        pendingTapRef.current = null;
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
        void begin({ handsFree: false });
      }, HOLD_MS);
      // Para el keyup: el carácter de este toque.
      lastKeyRef.current = tapInfo;
    };

    const onUp = (e: KeyboardEvent) => {
      if (!holdingRef.current) return;
      const releasedMain = e.code === sc.code;
      const releasedMod = (sc.alt && e.key === 'Alt') || (sc.ctrl && e.key === 'Control') || (sc.meta && e.key === 'Meta') || (sc.shift && e.key === 'Shift');
      if (!releasedMain && !releasedMod) return;
      holdingRef.current = false;
      if (startedHoldRef.current) {
        e.preventDefault();
        startedHoldRef.current = false;
        void finish();
        return;
      }
      // Toque corto.
      clearHold();
      const tap = lastKeyRef.current ?? { char: '', target: null };
      if (pendingTapRef.current) {
        // Segundo toque: manos libres (el primero no escribe nada).
        pendingTapRef.current = null;
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
        void begin({ handsFree: true });
        return;
      }
      pendingTapRef.current = tap;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => {
        const pending = pendingTapRef.current;
        pendingTapRef.current = null;
        // No hubo segundo toque: se escribe el carácter original (p. ej. el espacio duro de
        // Option+Space) donde estaba el cursor al tocar, aunque se haya seguido escribiendo.
        if (pending) insertTapChar(pending);
      }, DOUBLE_TAP_MS);
    };

    const onFocus = () => setFocused(editableTarget(document.activeElement));
    const onToggle = () => {
      if (d.state === 'recording') void finish();
      else if (d.state === 'idle') void begin({ handsFree: true });
    };

    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocus);
    window.addEventListener('zs:voice-dictate', onToggle);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocus);
      window.removeEventListener('zs:voice-dictate', onToggle);
    };
  }, [settings, d, begin, finish, showToast, t]);

  const shortcut = settings?.shortcut ?? DEFAULT_VOICE_SETTINGS.shortcut;
  const busy = d.state !== 'idle';
  const onDictationPage = pathname.startsWith('/app/voice/dictation');
  const barWanted = !busy && !onDictationPage && !!focused && (settings?.showBar ?? false);
  const barPos = useBarPosition(barWanted ? focused : null, barRef);
  const showBar = barWanted && !!barPos;

  return (
    <>
      {busy && (
        <div className="vc-host" role="status" aria-live="polite">
          <MicIcon />
          {d.state === 'recording' ? <LevelBars level={d.level} /> : <span className="vc-spinner" aria-hidden="true" />}
          <span className="vc-host-label">
            {d.state === 'transcribing'
              ? t('transcribing')
              : d.state === 'starting'
                ? t('starting')
                : handsFree
                  ? t('listeningHandsFree', { shortcut })
                  : t('listeningHold')}
          </span>
          {d.state === 'recording' && (
            <>
              <button type="button" className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => void finish()}>
                {t('done')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  handsFreeRef.current = false;
                  setHandsFree(false);
                  d.cancel();
                }}
              >
                {t('cancel')}
              </button>
            </>
          )}
        </div>
      )}
      {showBar && (
        <button
          ref={barRef}
          type="button"
          className="vc-bar"
          style={{ top: barPos!.top, left: barPos!.left }}
          aria-label={t('barLabel', { shortcut })}
          title={t('barLabel', { shortcut })}
          // Que el campo no pierda el foco: ahí va el texto.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void begin({ handsFree: true })}
        >
          <MicIcon size={14} />
        </button>
      )}
      {toast && (
        <div className="vc-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
