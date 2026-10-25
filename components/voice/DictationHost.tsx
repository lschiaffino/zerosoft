'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { parseShortcut, DEFAULT_VOICE_SETTINGS, type VoiceSettings } from '@/lib/voice-types';
import { useDictation } from './useDictation';
import { contextFor, copyText, editableTarget, insertIntoField } from './insert';
import { LevelBars, MicIcon, voiceErrorKey } from './voice-icons';

/** Mantener la tecla más que esto = dictar mientras está apretada; menos = manos libres. */
const HOLD_MS = 350;

/**
 * Dictado en toda la app (como Wispr Flow): mantener el atajo (Alt+Space por
 * defecto) graba; al soltar, transcribe, limpia y escribe en el campo que
 * tenía el foco. Un toque corto entra en manos libres hasta volver a tocar.
 * Sin campo enfocado, el texto se copia. Esc cancela. Alt+Shift+V pega el
 * último dictado. Con un campo enfocado aparece el botón de dictar abajo al
 * centro (se apaga en Voice › Ajustes).
 */
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
  const downAtRef = useRef(0);
  const holdingRef = useRef(false);
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

    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (d.state === 'recording' || d.state === 'starting')) {
        e.preventDefault();
        e.stopPropagation();
        holdingRef.current = false;
        handsFreeRef.current = false;
        setHandsFree(false);
        d.cancel();
        showToast(t('cancelled'));
        return;
      }
      if (e.code === 'KeyV' && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const target = editableTarget(document.activeElement);
        if (lastTextRef.current && target) {
          e.preventDefault();
          insertIntoField(target, lastTextRef.current);
        }
        return;
      }
      if (!matches(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (handsFreeRef.current && d.state === 'recording') {
        void finish();
        return;
      }
      if (d.state !== 'idle') return;
      downAtRef.current = Date.now();
      holdingRef.current = true;
      void begin({ handsFree: false });
    };

    const onUp = (e: KeyboardEvent) => {
      if (!holdingRef.current) return;
      const releasedMain = e.code === sc.code;
      const releasedMod = (sc.alt && e.key === 'Alt') || (sc.ctrl && e.key === 'Control') || (sc.meta && e.key === 'Meta') || (sc.shift && e.key === 'Shift');
      if (!releasedMain && !releasedMod) return;
      e.preventDefault();
      holdingRef.current = false;
      if (Date.now() - downAtRef.current < HOLD_MS) {
        // Toque corto: manos libres hasta volver a tocar el atajo.
        handsFreeRef.current = true;
        setHandsFree(true);
        return;
      }
      void finish();
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
  const showBar = !busy && !onDictationPage && !!focused && (settings?.showBar ?? false);

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
          type="button"
          className="vc-bar"
          aria-label={t('barLabel', { shortcut })}
          title={t('barLabel', { shortcut })}
          // Que el campo no pierda el foco: ahí va el texto.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void begin({ handsFree: true })}
        >
          <MicIcon />
          <span className="vc-bar-text">{t('barText', { shortcut })}</span>
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
