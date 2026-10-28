'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { BOARD_MAX_SCENE_BYTES, type BoardDetail, type BoardScene } from '@/lib/boards-types';
import { isDataUrl, swapUploadedFiles } from '@/lib/board-file-refs';
import type { BoardSnapshotSummary } from '@/lib/board-history';
import type { CanvasApi, CanvasMenuItem } from './ExcalidrawCanvas';
import BoardPresence from './BoardPresence';
import BoardPresent from './BoardPresent';
import { useBoardCollab } from './useBoardCollab';
import { clusterStickies, exportFramesPdf, textToDiagram, wireframeToCode } from './boardActions';
import { sceneSignature } from '@/lib/board-signature';
import CanvasComments from './CanvasComments';
import BoardAccessPanel from './BoardAccessPanel';
import BoardOverlays from './BoardOverlays';
import BoardStickyTool from './BoardStickyTool';
import BoardTrackTool from './BoardTrackTool';
import BoardWorkshop, { TimerChip } from './BoardWorkshop';
import { usePoll, useTrackCards, useWorkshop } from './useBoardLive';
import {
  ambiguousToServer,
  baseFrom,
  clearDraft,
  draftDiffers,
  flushOnLeave,
  mergeBoardScenes,
  readDraft,
  remoteAction,
  REMOTE_POLL_MS,
  writeDraft,
  type BaseVersions,
  type BoardDraft,
  type MergeResult,
} from '@/lib/board-sync';
import NotesIcon from '@/components/notes/NotesIcon';
import { usePopover } from '@/components/notes/usePopover';
import RowMenu from '@/components/notes/RowMenu';
import { notifyBoardsChanged } from './BoardBranch';
import { parseDbUtc } from '@/lib/utils';

const ExcalidrawCanvas = dynamic(() => import('./ExcalidrawCanvas'), {
  ssr: false,
  loading: () => <BoardLoading />,
});

/** Mientras baja Excalidraw: el lienzo vacío con un aviso para lectores de pantalla. */
export function BoardLoading() {
  const t = useTranslations('board');
  return (
    <div className="board-loading" role="status" aria-busy="true">
      <span className="sr-only">{t('editor.loading')}</span>
    </div>
  );
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'too_large' | 'error';

const SAVE_DEBOUNCE_MS = 1200;
const THUMB_EVERY_MS = 10_000;
/**
 * Si un guardado salió sin miniatura (por el tope de arriba), se regenera sola
 * un rato después de la última edición: la grilla nunca queda con una vieja.
 */
const THUMB_TRAILING_MS = 2500;
/** Merges seguidos antes de rendirse y mostrar el aviso (alguien guardando sin parar). */
const MAX_MERGES = 3;
/** Cuánto queda en el estado "Actualizada con cambios de X". */
const REMOTE_STATUS_MS = 6000;

type El = { id: string; version?: number; isDeleted?: boolean; type?: string; fileId?: string | null };

/** Firma barata de la escena: cambia con cualquier edición (cada edición sube `version`). */
const signature = sceneSignature;

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

/** Imágenes ya subidas al storage (fileId → URL propia), a partir de la escena guardada. */
function uploadedFrom(files: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, f] of Object.entries(files)) {
    const url = (f as { dataURL?: unknown })?.dataURL;
    if (typeof url === 'string' && !isDataUrl(url)) out.set(id, url);
  }
  return out;
}

/** localStorage si existe y se puede usar (modo privado, iframes, SSR). */
function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export default function BoardEditor({
  board,
  locale,
  commentId = null,
  guestToken = null,
}: {
  board: BoardDetail;
  locale: string;
  /** ?comment=<hilo>: abre ese hilo (link de una notificación). */
  commentId?: string | null;
  /**
   * Link de invitado con edición (/b/e/<token>): sin sesión, guarda por la
   * ruta del token y no hay comentarios, historial, compartir ni taller.
   */
  guestToken?: string | null;
}) {
  const t = useTranslations('board');
  const format = useFormatter();
  const router = useRouter();
  const guest = Boolean(guestToken);
  /** Invitado con rol "ver": el lienzo queda en modo lectura y no se guarda nada. */
  const readOnly = board.my_access === 'view';
  const apiBase = guest ? `/api/boards/guest/${encodeURIComponent(guestToken ?? '')}` : `/api/boards/${board.id}`;
  const workshop = useWorkshop(board.id, !guest);
  const track = useTrackCards(board.id, !guest);
  const [name, setName] = useState(board.name);
  /** Último nombre que confirmó el servidor. */
  const savedNameRef = useRef(board.name);
  const nameSeqRef = useRef(0);
  const [nameError, setNameError] = useState(false);
  const [state, setStateRaw] = useState<SaveState>('saved');
  /** Estado actual fuera del render: onChange no vuelve a pedir 'dirty' en cada trazo. */
  const stateRef = useRef<SaveState>('saved');
  const setState = useCallback((next: SaveState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);
  const [conflictBy, setConflictBy] = useState<string | null>(null);
  /** El aviso es por borrado contra edición (lo único que no se combina solo). */
  const [conflictDeleted, setConflictDeleted] = useState(false);
  const [draft, setDraft] = useState<BoardDraft | null>(null);
  /** Cambios de otro aplicados solos (sin nada local pendiente): se avisa en el estado. */
  const [remoteApplied, setRemoteApplied] = useState<{ by: string | null } | null>(null);
  /** Cambios de otro que no se pueden aplicar solos (lo local está trabado): aviso con acciones. */
  const [remoteNotice, setRemoteNotice] = useState<{ by: string | null } | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(board.share_token);
  const [accessMode, setAccessMode] = useState<'workspace' | 'restricted'>(board.access ?? 'workspace');
  const share = usePopover();
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [copied, setCopied] = useState(false);
  const apiRef = useRef<CanvasApi | null>(null);
  const [canvasApi, setCanvasApi] = useState<CanvasApi | null>(null);
  const history = usePopover();
  const [snapshots, setSnapshots] = useState<BoardSnapshotSummary[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(Boolean(commentId));
  const [placing, setPlacing] = useState(false);
  const [openThreads, setOpenThreads] = useState(0);
  /** Menú "Más opciones" (barra angosta) y qué herramienta pidió abrir. */
  const [moreOpen, setMoreOpen] = useState(false);
  const [openTool, setOpenTool] = useState<{ tool: 'track' | 'workshop'; n: number } | null>(null);
  /** Presentando los frames como slides. */
  const [presenting, setPresenting] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Pestaña en el tiempo real: el guardado la manda para no recibir su propio aviso. */
  const socketIdRef = useRef('');
  /** Aviso corto abajo (PDF exportado, agrupado con IA, errores). */
  const [toast, setToast] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  /** Se perdió el acceso en vivo (la sacaron, la borraron o se apagó el link). */
  const [revoked, setRevoked] = useState(false);
  /** Imágenes ya subidas: la escena las manda como URL y el base64 viaja una sola vez. */
  const uploadedRef = useRef<Map<string, string>>(uploadedFrom(board.scene.files));
  const versionRef = useRef(board.version);
  /** Versión del servidor informada por un 409 (para "conservar la mía" sin merge). */
  const serverVersionRef = useRef(board.version);
  /** Versiones de la última escena que sabemos que tiene el servidor (base del merge). */
  const baseRef = useRef<BaseVersions>(baseFrom(board.scene.elements));
  const baseBgRef = useRef<unknown>(board.scene.appState.viewBackgroundColor);
  /** Merge con algo ambiguo esperando que la persona elija. */
  const mergeRef = useRef<{ merged: MergeResult; fresh: BoardDetail } | null>(null);
  const mergesRef = useRef(0);
  const sigRef = useRef(signature(board.scene.elements, board.scene.appState.viewBackgroundColor, Object.keys(board.scene.files).length));
  const pendingRef = useRef<BoardScene | null>(null);
  const lastSceneRef = useRef<BoardScene | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  /** Promesa del guardado en vuelo: el guardado al salir la espera. */
  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const unmountedRef = useRef(false);
  /** Se llama al terminar un guardado con 409 (definido más abajo). */
  const onConflictRef = useRef<(by: string | null) => void>(() => {});
  const blockedRef = useRef<SaveState | null>(null);
  const lastThumbRef = useRef(0);
  const thumbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** El primer onChange es el estado inicial normalizado por Excalidraw: solo fija la firma. */
  const baselineRef = useRef(true);

  /** Lo que hay en el lienzo ahora, listo para guardar. */
  const canvasScene = useCallback((): BoardScene | null => {
    const api = apiRef.current;
    if (!api) return null;
    return buildScene(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles());
  }, []);

  /** Miniatura de `scene` directo a la pizarra (sin tocar la escena ni su versión). */
  const pushThumbnail = useCallback(
    async (scene: BoardScene | null) => {
      if (guest || !scene) return;
      const { sceneThumbnail } = await import('./ExcalidrawCanvas');
      const thumbnail = await sceneThumbnail(scene.elements, String(scene.appState.viewBackgroundColor ?? '#ffffff'));
      if (!thumbnail) return;
      lastThumbRef.current = Date.now();
      await fetch(`/api/boards/${board.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thumbnail }),
        keepalive: thumbnail.length < 60_000,
      }).catch(() => null);
    },
    [guest, board.id],
  );

  /** Programa la miniatura que faltó; si antes llega otro guardado, ese decide. */
  const scheduleThumbnail = useCallback(() => {
    if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current = setTimeout(() => {
      thumbTimerRef.current = null;
      // Con un guardado pendiente o en vuelo, el próximo vuelve a programarla.
      if (pendingRef.current || inFlightRef.current || unmountedRef.current) return;
      void pushThumbnail(canvasScene());
    }, THUMB_TRAILING_MS);
  }, [pushThumbnail, canvasScene]);

  /**
   * Sube las imágenes pegadas que todavía van en base64 y las reemplaza por su
   * URL. Si una subida falla, esa imagen va en línea y el servidor reintenta.
   */
  const withUploadedFiles = useCallback(
    async (scene: BoardScene): Promise<BoardScene> => {
      for (const [id, f] of Object.entries(scene.files)) {
        const dataURL = (f as { dataURL?: unknown })?.dataURL;
        if (!isDataUrl(dataURL) || uploadedRef.current.has(id)) continue;
        try {
          const res = await fetch(`${apiBase}/files`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, dataURL }),
          });
          if (res.ok) uploadedRef.current.set(id, ((await res.json()) as { url: string }).url);
        } catch {
          // Sin red: queda en línea.
        }
      }
      return { ...scene, files: swapUploadedFiles(scene.files, uploadedRef.current) };
    },
    [apiBase],
  );

  const save = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (blockedRef.current === 'conflict' || unmountedRef.current) return;
    if (inFlightRef.current) {
      timerRef.current = setTimeout(() => void save(), 400);
      return;
    }
    const scene = pendingRef.current;
    if (!scene) return;
    pendingRef.current = null;
    lastSceneRef.current = scene;
    inFlightRef.current = true;
    let settle: () => void = () => {};
    inFlightPromiseRef.current = new Promise<void>((resolve) => {
      settle = resolve;
    });
    setState('saving');
    let conflictBy: string | null | undefined;
    try {
      let thumbnail: string | null | undefined;
      if (Date.now() - lastThumbRef.current > THUMB_EVERY_MS) {
        const { sceneThumbnail } = await import('./ExcalidrawCanvas');
        thumbnail = await sceneThumbnail(scene.elements, String(scene.appState.viewBackgroundColor ?? '#ffffff'));
        if (thumbnail) lastThumbRef.current = Date.now();
      }
      const body = JSON.stringify({ version: versionRef.current, scene: await withUploadedFiles(scene), thumbnail });
      if (body.length > BOARD_MAX_SCENE_BYTES * 1.2) {
        blockedRef.current = 'too_large';
        setState('too_large');
        return;
      }
      const res = await fetch(`${apiBase}/scene`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-board-socket': socketIdRef.current },
        body,
      });
      if (res.ok) {
        const data = (await res.json()) as { version: number };
        versionRef.current = data.version;
        baseRef.current = baseFrom(scene.elements);
        baseBgRef.current = scene.appState.viewBackgroundColor;
        mergesRef.current = 0;
        blockedRef.current = null;
        if (!pendingRef.current) clearDraft(storage(), board.id);
        setState(pendingRef.current ? 'dirty' : 'saved');
        if (thumbnail) {
          if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
          thumbTimerRef.current = null;
        } else {
          scheduleThumbnail();
        }
      } else if (res.status === 409) {
        const data = (await res.json()) as { version: number; updated_by: string | null };
        conflictBy = data.updated_by;
        blockedRef.current = 'conflict';
        serverVersionRef.current = data.version;
        // Lo que no entró sigue pendiente (o lo más nuevo del lienzo si hubo cambios después).
        pendingRef.current = pendingRef.current ?? scene;
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
      inFlightPromiseRef.current = null;
      settle();
      if (pendingRef.current && !blockedRef.current && !unmountedRef.current) {
        timerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
      }
    }
    if (conflictBy !== undefined && !unmountedRef.current) onConflictRef.current(conflictBy);
  }, [board.id, apiBase, withUploadedFiles, scheduleThumbnail, setState]);

  /** Suma las imágenes que ya tiene el servidor (escena de otra pestaña o persona). */
  function rememberUploaded(files: Record<string, unknown>) {
    for (const [id, url] of uploadedFrom(files)) uploadedRef.current.set(id, url);
  }

  /** Muestra el aviso de conflicto (merge ambiguo, o sin poder combinar). */
  function showConflict(by: string | null, deleted: boolean) {
    blockedRef.current = 'conflict';
    setConflictBy(by);
    setConflictDeleted(deleted);
    setState('conflict');
  }

  /** Aplica el merge al lienzo y lo guarda sobre la versión del servidor. */
  function applyMerged(merged: MergeResult, fresh: BoardDetail) {
    const api = apiRef.current;
    if (!api) return;
    api.updateScene({ elements: merged.elements, appState: { viewBackgroundColor: merged.appState.viewBackgroundColor } });
    sigRef.current = signature(api.getSceneElements(), api.getAppState().viewBackgroundColor, Object.keys(api.getFiles()).length);
    versionRef.current = fresh.version;
    baseRef.current = baseFrom(fresh.scene.elements);
    baseBgRef.current = fresh.scene.appState.viewBackgroundColor;
    pendingRef.current = canvasScene();
    mergeRef.current = null;
    blockedRef.current = null;
    setConflictBy(null);
    setConflictDeleted(false);
    setState('dirty');
    void save();
  }

  /**
   * 409: otra persona (u otra pestaña) guardó antes. Se trae su escena y se
   * combina elemento por elemento con la local; solo se pregunta si alguien
   * editó algo que el otro borró.
   */
  async function resolveConflict(by: string | null) {
    mergesRef.current += 1;
    if (mergesRef.current > MAX_MERGES) return showConflict(by, false);
    setState('saving');
    try {
      const res = await fetch(apiBase);
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as BoardDetail;
      const { reconcile } = await import('./ExcalidrawCanvas');
      const api = apiRef.current;
      if (!api || unmountedRef.current) return;
      const files = Object.values(fresh.scene.files);
      if (files.length) api.addFiles(files);
      rememberUploaded(fresh.scene.files);
      // Lectura síncrona del lienzo justo antes de aplicar: entra todo lo que se dibujó mientras.
      const merged = mergeBoardScenes({
        local: api.getSceneElementsIncludingDeleted(),
        localAppState: api.getAppState(),
        localFiles: api.getFiles(),
        server: fresh.scene,
        base: baseRef.current,
        baseBackground: baseBgRef.current,
        reconcile,
      });
      if (merged.ambiguous.length) {
        mergeRef.current = { merged, fresh };
        serverVersionRef.current = fresh.version;
        return showConflict(fresh.updated_by ?? by, true);
      }
      applyMerged(merged, fresh);
    } catch {
      showConflict(by, false);
    }
  }
  onConflictRef.current = (by) => void resolveConflict(by);

  /**
   * Trae la escena que guardó otro y la aplica al lienzo. Solo corre sin nada
   * local pendiente; igual pasa por el merge con la base, así lo que otro borró
   * desaparece y lo que se está editando acá (texto abierto) no se pisa.
   */
  async function pullRemote(by: string | null) {
    const busy = () => pendingRef.current !== null || inFlightRef.current || blockedRef.current !== null || unmountedRef.current;
    const res = await fetch(apiBase).catch(() => null);
    if (!res?.ok || busy()) return;
    const fresh = (await res.json()) as BoardDetail;
    const { reconcile } = await import('./ExcalidrawCanvas');
    const api = apiRef.current;
    // Si mientras bajaba la escena se editó acá, lo resuelve el guardado (409 → merge).
    if (!api || busy() || fresh.version <= versionRef.current) return;
    const files = Object.values(fresh.scene.files);
    if (files.length) api.addFiles(files);
    rememberUploaded(fresh.scene.files);
    const merged = mergeBoardScenes({
      local: api.getSceneElementsIncludingDeleted(),
      localAppState: api.getAppState(),
      localFiles: api.getFiles(),
      server: fresh.scene,
      base: baseRef.current,
      baseBackground: baseBgRef.current,
      reconcile,
    });
    // Sin nada local pendiente, lo dudoso lo decide el servidor (lo que otro borró se va).
    api.updateScene({
      elements: ambiguousToServer(merged, fresh.scene.elements),
      appState: { viewBackgroundColor: merged.appState.viewBackgroundColor },
    });
    // Misma firma que calcula onChange (con los borrados): aplicar no cuenta como edición
    // y no se vuelve a guardar (si no, dos pestañas abiertas se rebotarían versiones).
    sigRef.current = signature(
      api.getSceneElementsIncludingDeleted(),
      api.getAppState().viewBackgroundColor,
      Object.keys(api.getFiles()).length,
    );
    versionRef.current = fresh.version;
    serverVersionRef.current = fresh.version;
    baseRef.current = baseFrom(fresh.scene.elements);
    baseBgRef.current = fresh.scene.appState.viewBackgroundColor;
    // El nombre viaja con la escena; si alguien lo está editando acá, no se pisa.
    const editingName = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('board-name');
    if (fresh.name !== savedNameRef.current && !editingName) {
      savedNameRef.current = fresh.name;
      setName(fresh.name);
    }
    setRemoteApplied({ by });
  }

  /** Otro guardó la versión `remoteVersion`: se trae (si no hay nada local pendiente) o se avisa. */
  async function onRemoteVersion(remoteVersion: number, by: string | null) {
    if (!apiRef.current || unmountedRef.current) return;
    const action = remoteAction({
      remoteVersion,
      localVersion: versionRef.current,
      pending: pendingRef.current !== null,
      inFlight: inFlightRef.current,
      blocked: blockedRef.current,
    });
    setRemoteNotice(action === 'notify' ? { by } : null);
    if (action === 'apply') await pullRemote(by);
  }

  async function checkVersion() {
    if (!apiRef.current || unmountedRef.current) return;
    const res = await fetch(`${apiBase}/version`).catch(() => null);
    if (!res?.ok) return;
    const remote = (await res.json()) as { version: number; updated_by: string | null };
    await onRemoteVersion(remote.version, remote.updated_by);
  }

  // Tiempo real: cursores, cambios en vivo, seguir y traer a todos. El guardado de
  // otro llega como evento y se trae la versión guardada.
  const collab = useBoardCollab({
    boardId: board.id,
    guestToken,
    api: canvasApi,
    canEdit: !readOnly,
    guestLabel: t('live.guest'),
    onRemoteApplied: () => {
      const api = apiRef.current;
      if (!api) return;
      // Lo que llegó de otro no es una edición de acá: no dispara un guardado.
      sigRef.current = signature(api.getSceneElementsIncludingDeleted(), api.getAppState().viewBackgroundColor, Object.keys(api.getFiles()).length);
    },
    onSaved: (version, by) => void onRemoteVersion(version, by),
    onResync: () => void checkVersion(),
    onRevoked: () => setRevoked(true),
  });
  socketIdRef.current = collab.socketId;

  // Siguiendo a alguien, Esc deja de seguir (como dice el aviso).
  const following = collab.following;
  const stopFollowing = collab.stopFollowing;
  useEffect(() => {
    if (!following) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopFollowing();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [following, stopFollowing]);

  // Red de seguridad: si el tiempo real no está conectado, se pregunta la versión cada tanto.
  usePoll(checkVersion, collab.status === 'live' ? 60_000 : REMOTE_POLL_MS, true);

  useEffect(() => {
    if (!remoteApplied) return;
    const h = setTimeout(() => setRemoteApplied(null), REMOTE_STATUS_MS);
    return () => clearTimeout(h);
  }, [remoteApplied]);

  /** "Combinar sus cambios" (aviso con lo local trabado): el mismo merge que un 409. */
  function mergeRemote() {
    const by = remoteNotice?.by ?? null;
    setRemoteNotice(null);
    blockedRef.current = null;
    mergesRef.current = 0;
    void resolveConflict(by);
  }

  const collabChangeRef = useRef(collab.onCanvasChange);
  collabChangeRef.current = collab.onCanvasChange;
  const onChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      // Selección y elementos editados viajan en vivo (también con rol de lectura, solo la selección).
      collabChangeRef.current(appState);
      // Cuántos elementos vivos hay (sin re-render): lo leen los e2e del tiempo real.
      if (canvasRef.current) canvasRef.current.dataset.elements = String((elements as Array<{ isDeleted?: boolean }>).filter((e) => !e.isDeleted).length);
      if (readOnly) return;
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
      // Mientras se dibuja, onChange llega en cada movimiento: solo el primero
      // cambia el estado (y re-renderiza la barra); el resto reprograma el guardado.
      if (stateRef.current !== 'dirty') setState('dirty');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    },
    [save, readOnly, setState],
  );

  // Identidad estable: ExcalidrawCanvas está memoizado y no se re-renderiza con el editor.
  const onCanvasApi = useCallback((api: CanvasApi) => {
    apiRef.current = api;
    setCanvasApi(api);
  }, []);

  // Borrador de una visita anterior que no llegó al servidor: se ofrece recuperarlo.
  useEffect(() => {
    const d = readDraft(storage(), board.id);
    if (d && draftDiffers(d, board.scene)) setDraft(d);
    else if (d) clearDraft(storage(), board.id);
  }, [board.id, board.scene]);

  // Aviso al salir con cambios sin guardar; queda un borrador local por si el último PUT no llega.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (pendingRef.current || inFlightRef.current) {
        const scene = canvasScene() ?? pendingRef.current;
        if (scene) writeDraft(storage(), board.id, { baseVersion: versionRef.current, scene, savedAt: Date.now() });
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [board.id, canvasScene]);

  // Navegación interna con cambios pendientes: último guardado, después del que esté en vuelo.
  useEffect(() => {
    const id = board.id;
    const base = apiBase;
    // El mapa es el mismo objeto toda la vida del editor (solo se le suman entradas).
    const uploaded = uploadedRef.current;
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      // Miniatura atrasada (o cambios sin guardar): se manda con lo último del lienzo.
      const thumbStale = thumbTimerRef.current !== null || pendingRef.current !== null || inFlightRef.current;
      if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
      thumbTimerRef.current = null;
      const leaving = thumbStale ? canvasScene() : null;
      void flushOnLeave({
        inFlight: inFlightPromiseRef.current,
        getPending: () => pendingRef.current,
        isBlocked: () => blockedRef.current !== null,
        getVersion: () => versionRef.current,
        put: async (scene, version) => {
          // Al salir no hay tiempo de subir: lo ya subido va como URL y lo nuevo en línea.
          const body = JSON.stringify({ version, scene: { ...scene, files: swapUploadedFiles(scene.files, uploaded) } });
          const res = await fetch(`${base}/scene`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', 'x-board-socket': socketIdRef.current },
            body,
            keepalive: body.length < 60_000,
          });
          if (!res.ok) return { ok: false, status: res.status };
          return { ok: true, version: ((await res.json()) as { version: number }).version };
        },
        saveDraft: (scene, baseVersion) => writeDraft(storage(), id, { baseVersion, scene, savedAt: Date.now() }),
        dropDraft: () => clearDraft(storage(), id),
      }).then(() => pushThumbnail(leaving));
    };
  }, [board.id, apiBase, canvasScene, pushThumbnail]);

  /** "Recuperar": suma el borrador al lienzo (combinado si algo cambió desde entonces). */
  async function restoreDraft() {
    const d = draft;
    const api = apiRef.current;
    if (!d || !api) return;
    const { reconcile } = await import('./ExcalidrawCanvas');
    const files = Object.values(d.scene.files);
    if (files.length) api.addFiles(files);
    const untouched = d.baseVersion === versionRef.current && !pendingRef.current;
    const merged = untouched
      ? { elements: d.scene.elements, appState: d.scene.appState }
      : mergeBoardScenes({
          local: d.scene.elements,
          localAppState: { ...api.getAppState(), viewBackgroundColor: d.scene.appState.viewBackgroundColor },
          localFiles: d.scene.files,
          server: canvasScene() ?? board.scene,
          base: null,
          reconcile,
        });
    api.updateScene({ elements: merged.elements, appState: { viewBackgroundColor: merged.appState.viewBackgroundColor } });
    sigRef.current = signature(api.getSceneElements(), api.getAppState().viewBackgroundColor, Object.keys(api.getFiles()).length);
    pendingRef.current = canvasScene();
    setDraft(null);
    setState('dirty');
    void save();
  }

  // Pizarra creada desde una plantilla (o restaurada sin miniatura): la grilla
  // muestra la miniatura sin esperar a la primera edición.
  useEffect(() => {
    if (!canvasApi || guest || readOnly || board.thumbnail || board.scene.elements.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { sceneThumbnail } = await import('./ExcalidrawCanvas');
      const thumbnail = await sceneThumbnail(board.scene.elements, String(board.scene.appState.viewBackgroundColor ?? '#ffffff'));
      if (!thumbnail || cancelled) return;
      await fetch(`/api/boards/${board.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thumbnail }),
      }).catch(() => null);
    })();
    return () => {
      cancelled = true;
    };
  }, [canvasApi, guest, readOnly, board.id, board.thumbnail, board.scene]);

  async function toggleHistory() {
    history.toggle();
    if (history.open) return;
    setHistoryError(false);
    try {
      const res = await fetch(`/api/boards/${board.id}/history`);
      if (!res.ok) throw new Error(String(res.status));
      setSnapshots(((await res.json()) as { snapshots: BoardSnapshotSummary[] }).snapshots);
    } catch {
      setHistoryError(true);
    }
  }

  /** Restaurar = pizarra nueva con esa versión; la actual no cambia. */
  async function restoreSnapshot(snap: BoardSnapshotSummary) {
    setRestoring(snap.id);
    setHistoryError(false);
    try {
      const when = format.dateTime(parseDbUtc(snap.content_at), { dateStyle: 'medium', timeStyle: 'short' });
      const res = await fetch(`/api/boards/${board.id}/history/${snap.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: t('history.copyName', { name: name.trim() || board.name, when }).slice(0, 120) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const copy = (await res.json()) as BoardDetail;
      history.close();
      router.push(`/app/board/${copy.id}`);
    } catch {
      setHistoryError(true);
      setRestoring(null);
    }
  }

  function discardDraft() {
    clearDraft(storage(), board.id);
    setDraft(null);
  }

  /** "Recargar": trae la versión del servidor y descarta lo local. */
  async function reload() {
    const res = await fetch(apiBase);
    if (!res.ok) return;
    const fresh = (await res.json()) as BoardDetail;
    const api = apiRef.current;
    if (api) {
      const files = Object.values(fresh.scene.files);
      if (files.length) api.addFiles(files);
      rememberUploaded(fresh.scene.files);
      api.updateScene({ elements: fresh.scene.elements, appState: fresh.scene.appState });
      // Firma de lo que quedó en el lienzo (Excalidraw puede normalizar versiones al restaurar).
      sigRef.current = signature(
        api.getSceneElements(),
        api.getAppState().viewBackgroundColor,
        Object.keys(api.getFiles()).length,
      );
    }
    versionRef.current = fresh.version;
    baseRef.current = baseFrom(fresh.scene.elements);
    baseBgRef.current = fresh.scene.appState.viewBackgroundColor;
    mergeRef.current = null;
    mergesRef.current = 0;
    pendingRef.current = null;
    blockedRef.current = null;
    clearDraft(storage(), board.id);
    setName(fresh.name);
    setConflictBy(null);
    setConflictDeleted(false);
    setRemoteNotice(null);
    setState('saved');
  }

  /**
   * "Conservar la mía": si hubo merge, aplica el combinado con lo local en lo
   * ambiguo (lo nuevo del otro lado se mantiene). Si no se pudo combinar,
   * guarda lo local encima de la versión del servidor.
   */
  function keepMine() {
    const pendingMerge = mergeRef.current;
    mergesRef.current = 0;
    if (pendingMerge) return applyMerged(pendingMerge.merged, pendingMerge.fresh);
    versionRef.current = serverVersionRef.current;
    pendingRef.current = pendingRef.current ?? lastSceneRef.current;
    blockedRef.current = null;
    setConflictBy(null);
    setConflictDeleted(false);
    void save();
  }

  async function saveName(next: string) {
    const clean = next.trim();
    // Se compara contra el último nombre guardado (no el inicial): A → B → A guarda las dos veces.
    if (!clean) {
      setName(savedNameRef.current);
      return;
    }
    if (clean === savedNameRef.current && !nameError) return;
    const seq = ++nameSeqRef.current;
    try {
      const res = await fetch(`/api/boards/${board.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: clean }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json().catch(() => null)) as { name?: string } | null;
      // Solo cuenta la respuesta del último rename (dos blurs seguidos no se pisan).
      if (seq !== nameSeqRef.current || unmountedRef.current) return;
      savedNameRef.current = data?.name ?? clean;
      setNameError(false);
      notifyBoardsChanged();
    } catch {
      // El input conserva lo escrito: el próximo blur o Enter reintenta.
      if (seq === nameSeqRef.current && !unmountedRef.current) setNameError(true);
    }
  }

  async function setShared(shared: boolean) {
    setShareBusy(true);
    setShareError(false);
    try {
      const res = await fetch(`/api/boards/${board.id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shared }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setShareToken(((await res.json()) as { share_token: string | null }).share_token);
    } catch {
      setShareError(true);
    } finally {
      setShareBusy(false);
    }
  }

  const showToast = useCallback((text: string, tone: 'error' | 'info' = 'info') => setToast({ text, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(h);
  }, [toast]);

  /** Mensaje para la persona según el código de error de la IA. */
  const aiMessage = useCallback(
    (code: string) =>
      code === 'ai_disabled'
        ? t('ai.disabled')
        : code === 'quota_exceeded'
          ? t('ai.quota')
          : code === 'rate_limited'
            ? t('ai.rate')
            : code === 'ai_bad_output'
              ? t('ai.badOutput')
              : code === 'no_notes'
                ? t('ai.noNotes')
                : code === 'too_many_notes'
                  ? t('ai.tooManyNotes')
                  : t('ai.failed'),
    [t],
  );

  const exportPdf = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    const res = await exportFramesPdf(api, name.trim() || board.name);
    if (res.ok) showToast(t('present.pdfDone', { count: res.count ?? 0 }));
    else showToast(res.error === 'no_frames' ? t('present.noFrames') : t('present.pdfError'), 'error');
  }, [name, board.name, showToast, t]);

  const cluster = useCallback(async () => {
    const api = apiRef.current;
    if (!api || aiBusy) return;
    setAiBusy(true);
    showToast(t('ai.clustering'));
    const res = await clusterStickies(api, board.id, { other: t('ai.other'), summary: t('ai.summary') });
    setAiBusy(false);
    if (res.ok) showToast(t('ai.clustered', { count: res.count ?? 0 }));
    else showToast(aiMessage(res.error), 'error');
  }, [aiBusy, board.id, showToast, t, aiMessage]);

  const startPresenting = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    setPresenting(true);
  }, []);

  // Texto a diagrama y wireframe a código (con sesión y permiso de edición).
  const onTextToDiagram = useCallback(
    async (prompt: string) => {
      const res = await textToDiagram(board.id, prompt);
      if (!res.ok) throw new Error(aiMessage(res.error));
      return res.mermaid;
    },
    [board.id, aiMessage],
  );
  const onWireframeToCode = useCallback(
    async (frame: unknown, children: readonly unknown[]) => {
      const api = apiRef.current;
      if (!api) throw new Error(t('ai.failed'));
      const res = await wireframeToCode(api, board.id, frame, children);
      if (!res.ok) throw new Error(aiMessage(res.error));
      return res.html;
    },
    [board.id, aiMessage, t],
  );

  // Ítems del menú del lienzo: estables (el lienzo está memoizado).
  const actionsRef = useRef({ startPresenting, exportPdf, cluster });
  actionsRef.current = { startPresenting, exportPdf, cluster };
  const menuItems = useMemo<CanvasMenuItem[]>(
    () => [
      { key: 'present', label: t('present.button'), onSelect: () => actionsRef.current.startPresenting() },
      { key: 'pdf', label: t('present.pdf'), onSelect: () => void actionsRef.current.exportPdf() },
      ...(!guest && !readOnly ? [{ key: 'cluster', label: t('ai.cluster'), onSelect: () => void actionsRef.current.cluster() }] : []),
    ],
    [t, guest, readOnly],
  );

  const shareUrl = shareToken && typeof window !== 'undefined' ? `${window.location.origin}/b/${shareToken}` : '';
  const statusText = nameError
    ? t('editor.renameError')
    : state === 'saving'
      ? t('editor.saving')
      : state === 'dirty'
        ? t('editor.unsaved')
        : state === 'error'
          ? t('editor.saveError')
          : state === 'saved'
            ? remoteApplied
              ? remoteApplied.by
                ? t('editor.remoteApplied', { name: remoteApplied.by })
                : t('editor.remoteAppliedAnon')
              : t('editor.saved')
            : '';

  return (
    <div className={`board-editor${presenting ? ' is-presenting' : ''}`} ref={editorRef}>
      <div className="board-bar">
        {guest ? (
          <span className="board-guest-tag mono">{t('guest.badge')}</span>
        ) : (
          <Link href="/app/board" className="board-back" aria-label={t('editor.back')}>
            <NotesIcon name="back" size={14} />
            <span className="board-back-label">{t('editor.back')}</span>
          </Link>
        )}
        {guest || readOnly ? (
          <span className="board-name is-static">{name}</span>
        ) : (
          <input
            className="board-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => void saveName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
            aria-label={t('editor.name')}
            // El ancho sigue al nombre: el estado de guardado queda pegado a él.
            style={{ width: `${Math.max(name.length, 6) + 2}ch` }}
          />
        )}
        <span
          className={`board-status${state === 'error' || nameError ? ' is-error' : ''}${state === 'dirty' || state === 'error' || nameError ? '' : ' is-quiet'}`}
          aria-live="polite"
        >
          {readOnly ? t('access.viewOnly') : statusText}
        </span>
        {!guest && <TimerChip timer={workshop.timer} skew={workshop.skew} />}
        <span className="board-bar-first" aria-hidden="true" />
        <BoardPresence
          people={collab.people}
          status={collab.status}
          canSummon={!readOnly}
          following={collab.following}
          onFollow={collab.follow}
          onStopFollowing={collab.stopFollowing}
          onSummon={() => collab.summonAll(false)}
        />
        <button type="button" className="btn btn-sm board-bar-extra" onClick={startPresenting} title={t('present.button')} data-testid="board-present">
          <NotesIcon name="play" size={14} />
          <span className="board-bar-label">{t('present.button')}</span>
        </button>
        {!readOnly && <BoardStickyTool api={canvasApi} />}
        {!guest && !readOnly && (
          <BoardTrackTool
            className="board-bar-extra"
            boardId={board.id}
            api={canvasApi}
            cards={track.cards}
            onCards={track.setCards}
            openSignal={openTool?.tool === 'track' ? openTool.n : 0}
          />
        )}
        {!guest && (
          <BoardWorkshop
            api={canvasApi}
            timer={workshop.timer}
            voting={workshop.voting}
            skew={workshop.skew}
            canRun={!readOnly}
            error={workshop.error}
            send={workshop.send}
            className="board-bar-extra"
            openSignal={openTool?.tool === 'workshop' ? openTool.n : 0}
          />
        )}
        {!guest && (
          <>
            <button
              type="button"
              className={`btn btn-sm board-bar-wide${commentsOpen ? ' is-on' : ''}`}
              onClick={() => {
                setCommentsOpen((v) => !v);
                setPlacing(false);
              }}
              aria-pressed={commentsOpen}
              title={t('comments.button')}
            >
              <NotesIcon name="ask" size={14} />
              <span className="board-bar-label">{t('comments.button')}</span>
              {openThreads > 0 && <span className="board-bar-count">{openThreads}</span>}
            </button>
            <button
              type="button"
              className={`btn btn-sm board-bar-extra${placing ? ' is-on' : ''}`}
              onClick={() => setPlacing((v) => !v)}
              aria-pressed={placing}
              title={t('comments.add')}
            >
              <NotesIcon name="plus" size={14} />
              <span className="board-bar-label">{t('comments.add')}</span>
            </button>
          </>
        )}
        {!guest && !readOnly && (
          <div className="board-share-wrap board-history-wrap board-bar-extra" ref={history.wrapRef}>
            <button
              ref={history.buttonRef}
              type="button"
              className="btn btn-sm"
              onClick={() => void toggleHistory()}
              aria-expanded={history.open}
              aria-haspopup="dialog"
            >
              <NotesIcon name="history" size={14} />
              <span className="board-bar-label">{t('history.button')}</span>
            </button>
            {history.open && (
              <div className="board-pop board-history" role="dialog" aria-label={t('history.title')}>
                <p className="board-pop-title">{t('history.title')}</p>
                <p className="board-pop-hint">{t('history.hint')}</p>
                {snapshots === null && !historyError ? (
                  <p className="board-pop-hint" role="status">{t('history.loading')}</p>
                ) : snapshots && snapshots.length === 0 ? (
                  <p className="board-pop-hint">{t('history.empty')}</p>
                ) : (
                  <ul className="board-history-list">
                    {(snapshots ?? []).map((snap) => (
                      <li key={snap.id} className="board-history-item">
                        <div className="board-history-thumb" aria-hidden="true">
                          {snap.thumbnail ? (
                            // Miniatura SVG filtrada en el servidor; como <img> no ejecuta nada.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(snap.thumbnail)}`} alt="" />
                          ) : null}
                        </div>
                        <div className="board-history-body">
                          <span className="board-history-when">
                            {format.dateTime(parseDbUtc(snap.content_at), { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                          <span className="board-history-meta">
                            {t('history.elements', { count: snap.element_count })}
                            {snap.edited_by ? ` · ${snap.edited_by}` : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm"
                          aria-busy={restoring === snap.id}
                          disabled={restoring !== null}
                          onClick={() => void restoreSnapshot(snap)}
                        >
                          {t('history.restore')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {historyError && (
                  <p className="ui-error" role="alert">
                    {t('list.actionError')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {!guest && (
          // Barra angosta: Track, Taller, Comentar e Historial pasan a este menú
          // (CSS por ancho del editor); el título y el estado no se achican.
          <RowMenu
            className="board-bar-more"
            open={moreOpen}
            label={t('editor.more')}
            onToggle={setMoreOpen}
            items={[
              { label: t('present.button'), onSelect: () => { setMoreOpen(false); startPresenting(); } },
              ...(!readOnly
                ? [{ label: t('track.button'), onSelect: () => { setMoreOpen(false); setOpenTool((o) => ({ tool: 'track', n: (o?.n ?? 0) + 1 })); } }]
                : []),
              { label: t('workshop.button'), onSelect: () => { setMoreOpen(false); setOpenTool((o) => ({ tool: 'workshop', n: (o?.n ?? 0) + 1 })); } },
              // En el teléfono también Comentarios (con los hilos abiertos) pasa al menú.
              {
                label: openThreads > 0 ? `${t('comments.button')} (${openThreads})` : t('comments.button'),
                className: 'board-more-narrow',
                onSelect: () => { setMoreOpen(false); setCommentsOpen(true); setPlacing(false); },
              },
              { label: t('comments.add'), onSelect: () => { setMoreOpen(false); setPlacing(true); } },
              ...(!readOnly
                ? [{ label: t('history.button'), onSelect: () => { setMoreOpen(false); if (!history.open) void toggleHistory(); } }]
                : []),
            ]}
          />
        )}
        {!guest && (
          <div className="board-share-wrap" ref={share.wrapRef}>
            <button
              ref={share.buttonRef}
              type="button"
              className={`btn btn-sm${shareToken || accessMode === 'restricted' ? ' is-on' : ''}`}
              onClick={share.toggle}
              aria-expanded={share.open}
              aria-haspopup="dialog"
              title={shareToken ? t('share.on') : t('share.button')}
            >
              <NotesIcon name={accessMode === 'restricted' ? 'lock' : 'share'} size={14} />
              <span className="board-bar-label board-share-label">{shareToken ? t('share.on') : t('share.button')}</span>
            </button>
            {share.open && (
              <div className="board-pop" role="dialog" aria-label={t('share.title')}>
                {!readOnly && (
                  <>
                    <p className="board-pop-title">{t('share.title')}</p>
                    <p className="board-pop-hint">{t('share.hint')}</p>
                    {shareToken ? (
                      <>
                        <div className="board-share-row">
                          <input className="input data" readOnly value={shareUrl} aria-label={t('share.title')} onFocus={(e) => e.currentTarget.select()} />
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              void navigator.clipboard?.writeText(shareUrl).catch(() => {});
                              setCopied(true);
                              setTimeout(() => setCopied(false), 1500);
                            }}
                          >
                            {copied ? t('share.copied') : t('share.copy')}
                          </button>
                        </div>
                        <button type="button" className="btn btn-sm btn-ghost btn-danger board-share-off" aria-busy={shareBusy} onClick={() => void setShared(false)}>
                          {t('share.disable')}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-sm btn-primary board-share-on" aria-busy={shareBusy} onClick={() => void setShared(true)}>
                        {t('share.enable')}
                      </button>
                    )}
                    {shareError && (
                      <p className="ui-error" role="alert">
                        {t('list.actionError')}
                      </p>
                    )}
                  </>
                )}
                <BoardAccessPanel boardId={board.id} onModeChange={setAccessMode} />
              </div>
            )}
          </div>
        )}
      </div>

      {revoked && (
        <div className="board-notice" role="alert">
          <span>{t('live.revoked')}</span>
          <div className="board-notice-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
              {t('editor.reload')}
            </button>
          </div>
        </div>
      )}
      {collab.following && !presenting && (
        <div className="board-notice board-follow-notice" role="status">
          <span>
            {collab.summon?.presenting && collab.summon.socketId === collab.following.socketId
              ? t('live.presenting', { name: collab.following.name })
              : t('live.following', { name: collab.following.name })}
          </span>
          <div className="board-notice-actions">
            <button type="button" className="btn btn-sm" onClick={collab.stopFollowing}>
              {t('live.unfollow')}
            </button>
          </div>
        </div>
      )}
      {state === 'conflict' && (
        <div className="board-notice" role="alert">
          <span>
            {conflictDeleted
              ? conflictBy
                ? t('editor.conflictDeletedBy', { name: conflictBy })
                : t('editor.conflictDeleted')
              : conflictBy
                ? t('editor.conflictBy', { name: conflictBy })
                : t('editor.conflict')}
          </span>
          <div className="board-notice-actions">
            <button type="button" className="btn btn-sm" onClick={keepMine}>
              {t('editor.keepMine')}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void reload()}>
              {t('editor.reload')}
            </button>
          </div>
        </div>
      )}
      {remoteNotice && state !== 'conflict' && (
        <div className="board-notice" role="status">
          <span>
            {remoteNotice.by ? t('editor.remoteChanged', { name: remoteNotice.by }) : t('editor.remoteChangedAnon')}
          </span>
          <div className="board-notice-actions">
            <button type="button" className="btn btn-sm" onClick={() => void reload()}>
              {t('editor.reload')}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={mergeRemote}>
              {t('editor.remoteMerge')}
            </button>
          </div>
        </div>
      )}
      {draft && state !== 'conflict' && (
        <div className="board-notice" role="status">
          <span>{t('editor.draftFound')}</span>
          <div className="board-notice-actions">
            <button type="button" className="btn btn-sm" onClick={discardDraft}>
              {t('editor.draftDiscard')}
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void restoreDraft()}>
              {t('editor.draftRestore')}
            </button>
          </div>
        </div>
      )}
      {state === 'too_large' && (
        <div className="board-notice" role="alert">
          <span>{t('editor.tooLarge', { mb: Math.round(BOARD_MAX_SCENE_BYTES / 1024 / 1024) })}</span>
        </div>
      )}

      <div className="board-canvas" ref={canvasRef}>
        <ExcalidrawCanvas
          scene={board.scene}
          locale={locale}
          viewMode={readOnly}
          library={!guest}
          onChange={onChange}
          onApi={onCanvasApi}
          onPointerUpdate={collab.onPointer}
          collaborating
          menuItems={menuItems}
          onTextToDiagram={guest || readOnly ? undefined : onTextToDiagram}
          onWireframeToCode={guest || readOnly ? undefined : onWireframeToCode}
          canOpenFile={!readOnly}
        />
        {presenting && canvasApi && (
          <BoardPresent
            api={canvasApi}
            hostRef={editorRef}
            canSummon={!readOnly && collab.people.length > 0}
            onSummon={() => collab.summonAll(true)}
            onExit={() => setPresenting(false)}
            onExportPdf={() => void exportPdf()}
          />
        )}
        {!guest && (
          <BoardOverlays
            api={canvasApi}
            cards={track.cards}
            voting={workshop.voting}
            canVote
            onVote={(elementId, delta) => void workshop.send({ vote: { action: 'vote', elementId, delta } })}
          />
        )}
        {!guest && (
          <CanvasComments
            boardId={board.id}
            api={canvasApi}
            panelOpen={commentsOpen}
            onClosePanel={() => setCommentsOpen(false)}
            placing={placing}
            onPlaced={() => setPlacing(false)}
            initialThreadId={commentId}
            onCountChange={setOpenThreads}
          />
        )}
      </div>
      <div className="ui-toasts" role="status" aria-live="polite">
        {toast && (
          <div className="ui-toast" data-tone={toast.tone}>
            {toast.text}
            <button type="button" className="ui-toast-action" onClick={() => setToast(null)}>
              {t('editor.dismiss')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
