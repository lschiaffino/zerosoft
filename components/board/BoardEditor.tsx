'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { BOARD_MAX_SCENE_BYTES, type BoardDetail, type BoardScene } from '@/lib/boards-types';
import type { CanvasApi } from './ExcalidrawCanvas';

const ExcalidrawCanvas = dynamic(() => import('./ExcalidrawCanvas'), {
  ssr: false,
  loading: () => <div className="board-loading" aria-busy="true" />,
});

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'too_large' | 'error';

const SAVE_DEBOUNCE_MS = 1200;
const THUMB_EVERY_MS = 10_000;

type El = { id: string; version?: number; isDeleted?: boolean; type?: string; fileId?: string | null };

/** Firma barata de la escena: cambia con cualquier edición (cada edición sube `version`). */
function signature(elements: readonly unknown[], bg: unknown, fileCount: number): string {
  let sum = 0;
  for (const e of elements as El[]) sum += e.version ?? 0;
  return `${elements.length}:${sum}:${String(bg)}:${fileCount}`;
}

/** Escena a guardar: sin elementos borrados y solo los archivos que usa alguna imagen. */
function buildScene(elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>): BoardScene {
  const live = (elements as El[]).filter((e) => !e.isDeleted);
  const used = new Set(live.filter((e) => e.type === 'image' && e.fileId).map((e) => e.fileId as string));
  const keptFiles: Record<string, unknown> = {};
  for (const id of used) if (files[id]) keptFiles[id] = files[id];
  return {
    elements: live,
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridSize: appState.gridSize,
      gridStep: appState.gridStep,
      gridModeEnabled: appState.gridModeEnabled,
    },
    files: keptFiles,
  };
}

export default function BoardEditor({ board, locale }: { board: BoardDetail; locale: string }) {
  const t = useTranslations('board');
  const [name, setName] = useState(board.name);
  const [state, setState] = useState<SaveState>('saved');
  const [conflictBy, setConflictBy] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(board.share_token);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const apiRef = useRef<CanvasApi | null>(null);
  const versionRef = useRef(board.version);
  /** Versión del servidor informada por un 409 (para "conservar la mía"). */
  const serverVersionRef = useRef(board.version);
  const sigRef = useRef(signature(board.scene.elements, board.scene.appState.viewBackgroundColor, Object.keys(board.scene.files).length));
  const pendingRef = useRef<BoardScene | null>(null);
  const lastSceneRef = useRef<BoardScene | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const blockedRef = useRef<SaveState | null>(null);
  const lastThumbRef = useRef(0);
  /** El primer onChange es el estado inicial normalizado por Excalidraw: solo fija la firma. */
  const baselineRef = useRef(true);
  const shareRef = useRef<HTMLDivElement>(null);

  const save = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (blockedRef.current === 'conflict') return;
    if (inFlightRef.current) {
      timerRef.current = setTimeout(() => void save(), 400);
      return;
    }
    const scene = pendingRef.current;
    if (!scene) return;
    pendingRef.current = null;
    lastSceneRef.current = scene;
    inFlightRef.current = true;
    setState('saving');
    let thumbnail: string | null | undefined;
    if (Date.now() - lastThumbRef.current > THUMB_EVERY_MS) {
      const { sceneThumbnail } = await import('./ExcalidrawCanvas');
      thumbnail = await sceneThumbnail(scene.elements, String(scene.appState.viewBackgroundColor ?? '#ffffff'));
      if (thumbnail) lastThumbRef.current = Date.now();
    }
    try {
      const body = JSON.stringify({ version: versionRef.current, scene, thumbnail });
      if (body.length > BOARD_MAX_SCENE_BYTES * 1.2) {
        blockedRef.current = 'too_large';
        setState('too_large');
        return;
      }
      const res = await fetch(`/api/boards/${board.id}/scene`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (res.ok) {
        const data = (await res.json()) as { version: number };
        versionRef.current = data.version;
        blockedRef.current = null;
        setState(pendingRef.current ? 'dirty' : 'saved');
      } else if (res.status === 409) {
        const data = (await res.json()) as { version: number; updated_by: string | null };
        blockedRef.current = 'conflict';
        setConflictBy(data.updated_by);
        serverVersionRef.current = data.version;
        setState('conflict');
      } else if (res.status === 413) {
        blockedRef.current = 'too_large';
        setState('too_large');
      } else {
        pendingRef.current = pendingRef.current ?? scene;
        setState('error');
      }
    } catch {
      pendingRef.current = pendingRef.current ?? scene;
      setState('error');
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current && !blockedRef.current) timerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    }
  }, [board.id]);

  const onChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      const sig = signature(elements, appState.viewBackgroundColor, Object.keys(files).length);
      if (baselineRef.current) {
        baselineRef.current = false;
        sigRef.current = sig;
        return;
      }
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      pendingRef.current = buildScene(elements, appState, files);
      if (blockedRef.current === 'conflict') return;
      // Si estaba trabado por tamaño, cada cambio (p. ej. borrar una imagen) reintenta.
      if (blockedRef.current === 'too_large') blockedRef.current = null;
      setState('dirty');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    },
    [save],
  );

  // Aviso al salir con cambios sin guardar.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (pendingRef.current || inFlightRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Navegación interna con cambios pendientes: último guardado sin esperar.
  useEffect(() => {
    const id = board.id;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const scene = pendingRef.current;
      if (!scene || blockedRef.current) return;
      const body = JSON.stringify({ version: versionRef.current, scene });
      void fetch(`/api/boards/${id}/scene`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: body.length < 60_000,
      }).catch(() => {});
    };
  }, [board.id]);

  useEffect(() => {
    if (!shareOpen) return;
    function onDoc(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [shareOpen]);

  /** "Recargar": trae la versión del servidor y descarta lo local. */
  async function reload() {
    const res = await fetch(`/api/boards/${board.id}`);
    if (!res.ok) return;
    const fresh = (await res.json()) as BoardDetail;
    const api = apiRef.current;
    if (api) {
      const files = Object.values(fresh.scene.files);
      if (files.length) api.addFiles(files);
      api.updateScene({ elements: fresh.scene.elements, appState: fresh.scene.appState });
      // Firma de lo que quedó en el lienzo (Excalidraw puede normalizar versiones al restaurar).
      sigRef.current = signature(
        api.getSceneElements(),
        api.getAppState().viewBackgroundColor,
        Object.keys(api.getFiles()).length,
      );
    }
    versionRef.current = fresh.version;
    pendingRef.current = null;
    blockedRef.current = null;
    setName(fresh.name);
    setConflictBy(null);
    setState('saved');
  }

  /** "Conservar la mía": guarda lo local encima de la versión del servidor. */
  function keepMine() {
    versionRef.current = serverVersionRef.current;
    pendingRef.current = pendingRef.current ?? lastSceneRef.current;
    blockedRef.current = null;
    setConflictBy(null);
    void save();
  }

  async function saveName(next: string) {
    const clean = next.trim();
    if (!clean || clean === board.name) return;
    await fetch(`/api/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: clean }),
    });
  }

  async function setShared(shared: boolean) {
    const res = await fetch(`/api/boards/${board.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shared }),
    });
    if (res.ok) setShareToken(((await res.json()) as { share_token: string | null }).share_token);
  }

  const shareUrl = shareToken && typeof window !== 'undefined' ? `${window.location.origin}/b/${shareToken}` : '';
  const statusText =
    state === 'saving'
      ? t('editor.saving')
      : state === 'dirty'
        ? t('editor.unsaved')
        : state === 'error'
          ? t('editor.saveError')
          : state === 'saved'
            ? t('editor.saved')
            : '';

  return (
    <div className="board-editor">
      <div className="board-bar">
        <Link href="/app/board" className="board-back">
          ‹ {t('editor.back')}
        </Link>
        <input
          className="board-name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => void saveName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label={t('editor.name')}
        />
        <span className={`board-status mono${state === 'error' ? ' bad' : ''}`} aria-live="polite">
          {statusText}
        </span>
        <div className="board-share-wrap" ref={shareRef}>
          <button
            type="button"
            className={`board-icon-btn${shareToken ? ' on' : ''}`}
            onClick={() => setShareOpen((v) => !v)}
            aria-expanded={shareOpen}
          >
            {t('share.button')}
          </button>
          {shareOpen && (
            <div className="board-pop" role="dialog" aria-label={t('share.title')}>
              <p className="board-pop-title">{t('share.title')}</p>
              <p className="board-pop-hint">{t('share.hint')}</p>
              {shareToken ? (
                <>
                  <div className="board-share-row">
                    <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        void navigator.clipboard.writeText(shareUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? t('share.copied') : t('share.copy')}
                    </button>
                  </div>
                  <button type="button" className="board-link-btn danger" onClick={() => void setShared(false)}>
                    {t('share.disable')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-small btn-solid" onClick={() => void setShared(true)}>
                  {t('share.enable')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {state === 'conflict' && (
        <div className="board-notice" role="alert">
          <span>{conflictBy ? t('editor.conflictBy', { name: conflictBy }) : t('editor.conflict')}</span>
          <button type="button" className="btn btn-small btn-solid" onClick={() => void reload()}>
            {t('editor.reload')}
          </button>
          <button type="button" className="btn btn-small" onClick={keepMine}>
            {t('editor.keepMine')}
          </button>
        </div>
      )}
      {state === 'too_large' && (
        <div className="board-notice" role="alert">
          <span>{t('editor.tooLarge', { mb: Math.round(BOARD_MAX_SCENE_BYTES / 1024 / 1024) })}</span>
        </div>
      )}

      <div className="board-canvas">
        <ExcalidrawCanvas
          scene={board.scene}
          locale={locale}
          onChange={onChange}
          onApi={(api) => {
            apiRef.current = api;
          }}
        />
      </div>
    </div>
  );
}
