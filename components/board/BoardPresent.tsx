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
  // Los frames se releen del lienzo: si alguien suma, mueve o borra uno mientras se presenta, entra.
  const [frames, setFrames] = useState<FrameLike[]>(() => orderFrames<FrameLike>(api.getSceneElements()));
  const [index, setIndex] = useState(0);
  /** Rectángulo del frame actual en la pantalla: lo de afuera se tapa (la slide es solo el frame). */
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const currentId = frames[index]?.id ?? null;
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

  // Frames vivos: se recalculan con cada cambio del lienzo (barato: solo filtra y ordena).
  useEffect(() => {
    const off = api.onChange(() => {
      const next = orderFrames<FrameLike>(api.getSceneElements());
      const prev = framesRef.current;
      const same = next.length === prev.length && next.every((f, i) => f.id === prev[i].id && f.x === prev[i].x && f.y === prev[i].y && f.width === prev[i].width && f.height === prev[i].height && f.name === prev[i].name);
      if (!same) setFrames(next);
    });
    return off;
  }, [api]);
  useEffect(() => {
    if (index > 0 && index >= frames.length) setIndex(Math.max(0, frames.length - 1));
  }, [frames.length, index]);

  // Cada slide: el frame entero en la pantalla, y lo de afuera tapado.
  const measure = useCallback(() => {
    const frame = framesRef.current.find((f) => f.id === currentId);
    if (!frame) return setRect(null);
    const s = api.getAppState() as { scrollX: number; scrollY: number; zoom: { value: number } };
    const z = s.zoom?.value ?? 1;
    setRect({ left: (frame.x + s.scrollX) * z, top: (frame.y + s.scrollY) * z, width: frame.width * z, height: frame.height * z });
  }, [api, currentId]);
  useEffect(() => {
    const frame = frames.find((f) => f.id === currentId);
    if (!frame) return;
    // El frame llena la pantalla (agranda también los chicos), con un poco de aire. Al cambiar el
    // tamaño (pantalla completa, rotar el teléfono) Excalidraw remide su lienzo y se vuelve a ajustar.
    const fit = () => {
      (api as CanvasApi & { refresh?: () => void }).refresh?.();
      const live = (api.getSceneElements() as FrameLike[]).find((e) => e.id === frame.id) ?? frame;
      api.scrollToContent(live, { fitToViewport: true, viewportZoomFactor: 0.9, animate: false });
      measure();
    };
    fit();
    const late = setTimeout(fit, 300);
    const off = api.onScrollChange(() => measure());
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fit);
    return () => {
      off();
      clearTimeout(late);
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', fit);
    };
  }, [api, frames, currentId, measure]);

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
      {rect && (
        <div
          className="board-present-mask"
          aria-hidden="true"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      )}
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
