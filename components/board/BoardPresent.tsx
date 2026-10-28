'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { nextSlide, orderFrames, slideKey, type FrameLike } from '@/lib/board-present';
import type { CanvasApi } from './ExcalidrawCanvas';
import NotesIcon from '@/components/notes/NotesIcon';

/**
 * Presentar los frames como slides: pantalla completa, un frame por vez
 * ajustado a la pantalla, flechas, espacio, PageUp/PageDown, Inicio/Fin y Esc
 * para salir. Con "que me sigan", todos los que tienen la pizarra abierta
 * siguen la presentación (traer a todos + su vista sigue a la de quien
 * presenta).
 */
export default function BoardPresent({
  api,
  hostRef,
  canSummon,
  onSummon,
  onExit,
  onExportPdf,
}: {
  api: CanvasApi;
  /** Elemento que pasa a pantalla completa (el editor). */
  hostRef: React.RefObject<HTMLElement | null>;
  canSummon: boolean;
  onSummon: () => Promise<boolean>;
  onExit: () => void;
  onExportPdf: () => void;
}) {
  const t = useTranslations('board.present');
  const [frames] = useState<FrameLike[]>(() => orderFrames<FrameLike>(api.getSceneElements()));
  const [index, setIndex] = useState(0);
  const [shared, setShared] = useState(false);
  const exitedRef = useRef(false);
  const prevState = useRef<Record<string, unknown> | null>(null);

  const exit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (prevState.current) api.updateScene({ appState: prevState.current });
    onExit();
  }, [api, onExit]);

  // Al entrar: sin bordes ni nombres de frame, solo lo de adentro; pantalla completa si se puede.
  useEffect(() => {
    const s = api.getAppState();
    prevState.current = { frameRendering: s.frameRendering, viewModeEnabled: s.viewModeEnabled, zenModeEnabled: s.zenModeEnabled };
    api.updateScene({
      appState: { frameRendering: { enabled: true, clip: true, name: false, outline: false }, viewModeEnabled: true, zenModeEnabled: true, selectedElementIds: {} },
    });
    const host = hostRef.current;
    if (host?.requestFullscreen && !document.fullscreenElement) void host.requestFullscreen().catch(() => undefined);
    const fsEntered = { current: false };
    const onFs = () => {
      // Salir de pantalla completa (Esc del navegador) termina la presentación.
      if (!document.fullscreenElement && fsEntered.current) exit();
      if (document.fullscreenElement) fsEntered.current = true;
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [api, hostRef, exit]);

  // Cada slide: el frame entero en la pantalla.
  useEffect(() => {
    const frame = frames[index];
    if (!frame) return;
    // Releer el frame actual (pudo moverse mientras se presenta).
    const live = (api.getSceneElements() as FrameLike[]).find((e) => e.id === frame.id) ?? frame;
    api.scrollToContent(live, { fitToContent: true, animate: true });
  }, [api, frames, index]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = slideKey(e.key);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === 'exit') return exit();
      setIndex((i) => nextSlide(i, frames.length, action));
    }
    // Captura: el lienzo no recibe las teclas mientras se presenta.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [frames.length, exit]);

  async function share() {
    if (await onSummon()) setShared(true);
  }

  const frame = frames[index];
  return (
    <div className="board-present" role="region" aria-label={t('title')}>
      {frames.length === 0 ? (
        <div className="board-present-empty" role="status">
          <p>{t('empty')}</p>
          <button type="button" className="btn btn-sm" onClick={exit} autoFocus>
            {t('exit')}
          </button>
        </div>
      ) : (
        <div className="board-present-bar">
          <button type="button" className="btn btn-sm" onClick={() => setIndex((i) => nextSlide(i, frames.length, 'prev'))} disabled={index === 0} aria-label={t('prev')}>
            <span aria-hidden="true">‹</span>
          </button>
          <span className="board-present-count mono" aria-live="polite">
            {t('count', { n: index + 1, total: frames.length })}
            {frame?.name ? <span className="board-present-name"> · {frame.name}</span> : null}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setIndex((i) => nextSlide(i, frames.length, 'next'))}
            disabled={index >= frames.length - 1}
            aria-label={t('next')}
            autoFocus
          >
            <span aria-hidden="true">›</span>
          </button>
          {canSummon && (
            <button type="button" className={`btn btn-sm board-bar-wide${shared ? ' is-on' : ''}`} onClick={() => void share()} aria-pressed={shared}>
              <NotesIcon name="users" size={14} />
              <span className="board-bar-label">{shared ? t('sharing') : t('share')}</span>
            </button>
          )}
          <button type="button" className="btn btn-sm board-bar-wide" onClick={onExportPdf}>
            {t('pdf')}
          </button>
          <button type="button" className="btn btn-sm" onClick={exit}>
            {t('exit')}
          </button>
        </div>
      )}
    </div>
  );
}
