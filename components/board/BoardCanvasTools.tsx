'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { STICKY_H, STICKY_W, elementBox, isSticky, stickyFill, stickySkeleton, type SceneEl } from '@/lib/board-stickies';
import {
  FILE_CARD,
  bulletEdit,
  elementAt,
  replayKeys,
  typedKey,
  type TypedKey,
  fileCardSkeleton,
  freeSpot,
  isStickyLike,
  nextStickyBox,
  parseSpreadsheetPaste,
  stickyAuthor,
  tableSkeletons,
  withAuthor,
  type Direction,
  type FileCardData,
} from '@/lib/board-canvas-tools';
import { ATTACHMENT_EXTENSIONS, BOARD_MAX_FILE_BYTES, attachmentExtension } from '@/lib/board-file-refs';
import { viewToScene } from '@/lib/board-view';
import type { CanvasApi } from './ExcalidrawCanvas';
import { authoredSkeleton, stickyColor, viewportCenter } from './BoardStickyTool';
import BoardMinimap from './BoardMinimap';
import NotesIcon from '@/components/notes/NotesIcon';

const MINIMAP_KEY = 'board.minimap';
/** Resaltador: trazo grueso, amarillo y translúcido (se vuelve al lápiz de antes al cambiar de herramienta). */
const HIGHLIGHTER = { currentItemStrokeColor: '#fab005', currentItemStrokeWidth: 10, currentItemOpacity: 35 };

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Sin localStorage: no se recuerda.
  }
}

/** ¿El foco está en algo donde se escribe (fuera del lienzo)? */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** ¿Tab o una flecha caen en un control de la app (botón, link) en vez del lienzo? */
function onControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === document.body || !el.tagName) return false;
  if (el.closest('.excalidraw-container') && el.tagName === 'CANVAS') return false;
  return el.tagName === 'BUTTON' || el.tagName === 'A' || typingIn(el) || el.getAttribute('role') === 'menuitem';
}

function selectedSticky(api: CanvasApi): SceneEl | null {
  const sel = (api.getAppState().selectedElementIds ?? {}) as Record<string, boolean>;
  const ids = Object.keys(sel).filter((k) => sel[k]);
  if (ids.length !== 1 && ids.length !== 2) return null;
  const els = api.getSceneElements() as SceneEl[];
  const byId = new Map(els.map((e) => [e.id, e]));
  const picked = ids.map((id) => byId.get(id)).map((e) => (e?.type === 'text' && e.containerId ? byId.get(e.containerId) : e));
  const unique = [...new Set(picked.filter(Boolean))] as SceneEl[];
  return unique.length === 1 && isSticky(unique[0]) ? unique[0] : null;
}

/** Lo que se ve del lienzo (escena), sin la franja de arriba de la barra de herramientas. */
function visibleArea(api: CanvasApi) {
  const s = api.getAppState();
  const zoom = Number((s.zoom as { value?: number })?.value) || 1;
  const top = 110 / zoom;
  return { x: -Number(s.scrollX) + 24 / zoom, y: -Number(s.scrollY) + top, width: (Number(s.width) - 48) / zoom, height: (Number(s.height) - 110 - 70) / zoom };
}

/** Editor de texto de Excalidraw abierto (el textarea del texto que se edita). */
function openEditor(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('textarea.excalidraw-wysiwyg');
}

/**
 * Pide a Excalidraw que edite el sticky elegido. Excalidraw 0.18 no tiene una API
 * pública para empezar a editar un texto: se usa su propio atajo (Enter con una
 * forma con texto elegida), mandado a su contenedor, que es donde escucha el teclado.
 */
function askToEdit() {
  document.querySelector('.excalidraw')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
}

/**
 * Herramientas del lienzo que Excalidraw no trae: sticky nuevo con N (en el
 * cursor), el siguiente con Tab / Alt+flecha (también mientras se escribe),
 * resaltador, tabla y minimapa (M). Solo para quien edita, salvo el minimapa.
 */
export default function BoardCanvasTools({
  api,
  me,
  canEdit,
  hostRef,
  attachUrl = null,
  onMessage,
  privateMode = false,
}: {
  api: CanvasApi | null;
  me: string | null;
  canEdit: boolean;
  hostRef: React.RefObject<HTMLDivElement | null>;
  /** Dónde se suben los archivos adjuntos (null: sin adjuntos, como el invitado). */
  attachUrl?: string | null;
  /** Aviso corto para la persona (errores al subir un archivo). */
  onMessage?: (text: string, tone?: 'error' | 'info') => void;
  /** Modo privado: lo que se crea queda como borrador hasta revelar. */
  privateMode?: boolean;
}) {
  const privateRef = useRef(privateMode);
  privateRef.current = privateMode;
  const t = useTranslations('board.tools');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [minimap, setMinimap] = useState(false);
  const [highlighter, setHighlighter] = useState(false);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const savedPenRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => setMinimap(readFlag(MINIMAP_KEY, window.innerWidth >= 900)), []);
  const toggleMinimap = useCallback(() => {
    setMinimap((v) => {
      writeFlag(MINIMAP_KEY, !v);
      return !v;
    });
  }, []);

  // Dónde está el cursor (en la escena), para que N ponga el sticky ahí.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onLeave = () => {
      pointerRef.current = null;
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [hostRef]);

  /**
   * Teclas que llegan entre que se pide un sticky y su editor tiene el foco
   * (crear el elemento y abrir el editor toma unos cuadros). Mientras no es
   * null, todas las teclas se guardan acá (no llegan a los atajos de
   * Excalidraw) y se repiten en el editor apenas abre.
   */
  const pendingRef = useRef<TypedKey[] | null>(null);
  /** Funciones de Excalidraw ya cargadas: crear el sticky no espera a nada. */
  const libRef = useRef<typeof import('./ExcalidrawCanvas') | null>(null);
  useEffect(() => {
    let alive = true;
    void import('./ExcalidrawCanvas').then(async (lib) => {
      await lib.ensureFonts();
      if (alive) libRef.current = lib;
    });
    return () => {
      alive = false;
    };
  }, []);

  // Se define más abajo (necesita nextSticky); el ref evita el ciclo entre callbacks.
  const continueRef = useRef<(stickyId: string, shift: boolean) => void>(() => {});

  /** Espera el editor del sticky `id` (pidiéndolo si hace falta) y le pasa las teclas guardadas. */
  const typeInto = useCallback(
    (id: string) => {
      if (!api) return;
      const started = performance.now();
      let asked = 0;
      const step = () => {
        const area = openEditor();
        const editing = api.getAppState().editingTextElement as SceneEl | null;
        if (area && editing?.containerId === id) {
          if (document.activeElement !== area) area.focus();
          const keys = pendingRef.current ?? [];
          // El sticky nuevo trae un espacio: lo primero que se escribe lo reemplaza.
          const blank = !area.value.trim();
          const r = replayKeys(area.value, blank ? 0 : area.selectionStart, blank ? area.value.length : area.selectionEnd, keys);
          area.value = r.value;
          area.setSelectionRange(r.caret, r.caret);
          if (keys.length) area.dispatchEvent(new Event('input', { bubbles: true }));
          if (r.stop === 'tab') {
            pendingRef.current = r.rest;
            continueRef.current(id, r.shift);
          } else if (r.stop === 'esc') {
            pendingRef.current = null;
            area.blur();
          } else {
            pendingRef.current = null;
            if (!r.value.trim()) area.select();
          }
          return;
        }
        const elapsed = performance.now() - started;
        if (elapsed > 3000) {
          // No abrió: lo escrito no se pierde en atajos, pero tampoco se puede ubicar.
          pendingRef.current = null;
          return;
        }
        const sel = (api.getAppState().selectedElementIds ?? {}) as Record<string, boolean>;
        if (sel[id] && !area && (asked === 0 || elapsed > asked * 400)) {
          asked += 1;
          askToEdit();
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [api],
  );

  /** Crea un sticky en `box` (escena), lo selecciona y abre su texto con las teclas guardadas. */
  const createSticky = useCallback(
    (box: { x: number; y: number; width?: number; height?: number }, fill: string) => {
      if (!api) return;
      const lib = libRef.current;
      if (!lib) {
        // Primer uso antes de que cargue Excalidraw: se reintenta en el próximo cuadro (las teclas siguen guardadas).
        requestAnimationFrame(() => createSticky(box, fill));
        return;
      }
      const sk = { ...stickySkeleton({ text: ' ', tags: [] }, box, fill), width: box.width ?? STICKY_W, height: box.height ?? STICKY_H };
      const created = lib.skeletonsToElements([authoredSkeleton(sk, me, privateRef.current)]) as SceneEl[];
      const sticky = created.find((e) => e.customData?.sticky);
      if (!sticky) {
        pendingRef.current = null;
        return;
      }
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...created],
        appState: { selectedElementIds: { [sticky.id]: true }, selectedGroupIds: {}, editingGroupId: null, activeTool: { type: 'selection', customType: null, locked: false, lastActiveTool: null } },
        captureUpdate: lib.UNDOABLE,
      });
      // Si quedó fuera de la vista, la vista lo sigue.
      const s = api.getAppState();
      const zoom = Number((s.zoom as { value?: number })?.value) || 1;
      const view = { x: -Number(s.scrollX), y: -Number(s.scrollY), w: Number(s.width) / zoom, h: Number(s.height) / zoom };
      const full = { x: box.x, y: box.y, width: box.width ?? STICKY_W, height: box.height ?? STICKY_H };
      if (full.x < view.x || full.y < view.y || full.x + full.width > view.x + view.w || full.y + full.height > view.y + view.h) {
        api.scrollToContent([sticky], { fitToContent: false, animate: false });
      }
      typeInto(sticky.id);
    },
    [api, me, typeInto],
  );

  /** Sticky nuevo con el color elegido: en el cursor, o en el centro de la vista. */
  const newSticky = useCallback(() => {
    if (!api) return;
    const s = api.getAppState();
    const view = { scrollX: Number(s.scrollX) || 0, scrollY: Number(s.scrollY) || 0, zoom: Number((s.zoom as { value?: number })?.value) || 1 };
    const at = pointerRef.current ? viewToScene(pointerRef.current, view) : viewportCenter(api);
    createSticky({ x: Math.round(at.x - STICKY_W / 2), y: Math.round(at.y - STICKY_H / 2) }, stickyFill(stickyColor()));
  }, [api, createSticky]);

  /** El sticky siguiente a `from`, del mismo color y tamaño. */
  const nextSticky = useCallback(
    (from: SceneEl, dir: Direction) => {
      if (!api) return;
      const occupied = (api.getSceneElements() as SceneEl[]).filter((e) => !e.isDeleted && !e.containerId && e.type !== 'frame' && e.type !== 'arrow').map(elementBox);
      const box = nextStickyBox(elementBox(from), dir, occupied);
      createSticky(box, from.backgroundColor ?? stickyFill(stickyColor()));
    },
    [api, createSticky],
  );

  /**
   * Tab (o Shift+Tab) en el editor de un sticky: se cierra (Excalidraw guarda el
   * texto al perder el foco) y se abre el siguiente. Las teclas que llegan en
   * el medio quedan guardadas.
   */
  const continueFrom = useCallback(
    (stickyId: string, shift: boolean) => {
      if (!api) return;
      pendingRef.current = pendingRef.current ?? [];
      openEditor()?.blur();
      const step = (tries: number) => {
        const editing = api.getAppState().editingTextElement;
        if (editing && tries < 30) return requestAnimationFrame(() => step(tries + 1));
        const fresh = (api.getSceneElements() as SceneEl[]).find((x) => x.id === stickyId);
        if (fresh) nextSticky(fresh, shift ? 'down' : 'right');
        else pendingRef.current = null;
      };
      requestAnimationFrame(() => step(0));
    },
    [api, nextSticky],
  );
  continueRef.current = continueFrom;

  // Atajos. En captura: llegan antes que Excalidraw (Tab en el texto no indenta en un sticky).
  useEffect(() => {
    if (!api || !canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // Abriendo un sticky: todo lo que se tipea se guarda para el editor (no dispara atajos).
      if (pendingRef.current) {
        const k = typedKey(e);
        if (k || !['Shift', 'Alt', 'Meta', 'Control', 'CapsLock'].includes(e.key)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        if (k) pendingRef.current.push(k);
        return;
      }
      if (e.defaultPrevented) return;
      const s = api.getAppState();
      if (s.openDialog || s.viewModeEnabled) return;
      const target = e.target as HTMLElement | null;
      // Escribiendo en un sticky: Tab lo cierra y abre el siguiente (Shift+Tab, abajo).
      if (target?.classList?.contains('excalidraw-wysiwyg')) {
        // Listas: "- " o "* " al empezar una línea pasa a "• ", y Enter sigue la lista.
        const area = target as HTMLTextAreaElement;
        const edit = bulletEdit(area.value, area.selectionStart, area.selectionEnd, e.key, e.shiftKey || e.altKey || e.metaKey || e.ctrlKey);
        if (edit) {
          e.preventDefault();
          e.stopPropagation();
          area.value = edit.value;
          area.setSelectionRange(edit.caret, edit.caret);
          area.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        if (e.key !== 'Tab' || e.altKey || e.metaKey || e.ctrlKey) return;
        const editing = s.editingTextElement as SceneEl | null;
        const container = editing?.containerId ? (api.getSceneElements() as SceneEl[]).find((x) => x.id === editing.containerId) : null;
        if (!container || !isSticky(container)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        pendingRef.current = [];
        continueFrom(container.id, e.shiftKey);
        return;
      }
      if (typingIn(target)) return;
      const plain = !e.altKey && !e.metaKey && !e.ctrlKey;
      if (plain && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pendingRef.current = [];
        newSticky();
        return;
      }
      if (plain && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        e.stopPropagation();
        toggleMinimap();
        return;
      }
      if (onControl(target)) return;
      const dir: Direction | null =
        e.key === 'Tab' && plain
          ? e.shiftKey
            ? 'down'
            : 'right'
          : e.altKey && !e.metaKey && !e.ctrlKey
            ? ({ ArrowRight: 'right', ArrowLeft: 'left', ArrowDown: 'down', ArrowUp: 'up' } as Record<string, Direction>)[e.key] ?? null
            : null;
      if (!dir) return;
      const from = selectedSticky(api);
      if (!from) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pendingRef.current = [];
      nextSticky(from, dir);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [api, canEdit, newSticky, nextSticky, toggleMinimap, continueFrom]);

  // Minimapa con M también para quien solo mira.
  useEffect(() => {
    if (canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (typingIn(e.target) || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (e.key === 'm' || e.key === 'M') toggleMinimap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, toggleMinimap]);

  // Resaltador: al cambiar de herramienta se vuelve al estilo de lápiz que había.
  useEffect(() => {
    if (!api || !highlighter) return;
    return api.onChange((_els, appState) => {
      const tool = (appState.activeTool as { type?: string } | undefined)?.type;
      if (tool === 'freedraw') return;
      const saved = savedPenRef.current;
      savedPenRef.current = null;
      setHighlighter(false);
      if (saved) setTimeout(() => api.updateScene({ appState: saved }), 0);
    });
  }, [api, highlighter]);

  function startHighlighter() {
    if (!api) return;
    if (highlighter) {
      api.setActiveTool({ type: 'selection' });
      return;
    }
    const s = api.getAppState();
    savedPenRef.current = {
      currentItemStrokeColor: s.currentItemStrokeColor,
      currentItemStrokeWidth: s.currentItemStrokeWidth,
      currentItemOpacity: s.currentItemOpacity,
    };
    api.updateScene({ appState: HIGHLIGHTER });
    api.setActiveTool({ type: 'freedraw' });
    setHighlighter(true);
  }

  /** Tabla en el centro de la vista: vacía (encabezados de ejemplo) o con lo pegado de una planilla. */
  const insertTable = useCallback(
    async (texts?: string[][]) => {
      if (!api) return;
      const { skeletonsToElements, UNDOABLE, ensureFonts } = await import('./ExcalidrawCanvas');
      await ensureFonts();
      const rows = texts ? texts.length : 4;
      const cols = texts ? Math.max(...texts.map((r) => r.length)) : 3;
      const center = viewportCenter(api);
      const group = Math.random().toString(36).slice(2, 12);
      const header = Array.from({ length: cols }, (_, j) => t('tableCol', { n: j + 1 }));
      const occupied = (api.getSceneElements() as SceneEl[]).filter((e) => !e.isDeleted && !e.containerId).map(elementBox);
      const origin = freeSpot({ width: cols * 180, height: rows * 56 }, center, occupied, 32, visibleArea(api));
      const cells = tableSkeletons(rows, cols, origin, group, texts ?? [header]);
      const created = skeletonsToElements(cells) as SceneEl[];
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...created],
        appState: { selectedElementIds: Object.fromEntries(created.map((e) => [e.id, true])), selectedGroupIds: { [group]: true } },
        captureUpdate: UNDOABLE,
      });
      api.scrollToContent(created.filter((e) => !e.containerId), { fitToContent: false, animate: true });
    },
    [api, t],
  );

  // Pegar celdas de una planilla (texto con tabs) arma una tabla en vez de un texto suelto.
  useEffect(() => {
    if (!api || !canEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      if (typingIn(e.target) || api.getAppState().editingTextElement) return;
      const rows = parseSpreadsheetPaste(e.clipboardData?.getData('text/plain') ?? '');
      if (!rows) return;
      e.preventDefault();
      e.stopPropagation();
      void insertTable(rows);
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, [api, canEdit, insertTable]);

  /** Sube archivos adjuntos y deja una tarjeta por archivo, desde `at` (escena) hacia la derecha. */
  const attachFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      if (!api || !attachUrl || !files.length) return;
      const { skeletonsToElements, UNDOABLE, ensureFonts } = await import('./ExcalidrawCanvas');
      await ensureFonts();
      const occupied = (api.getSceneElements() as SceneEl[]).filter((e) => !e.isDeleted && !e.containerId).map(elementBox);
      let origin = at ?? freeSpot({ width: FILE_CARD.width, height: files.length * (FILE_CARD.height + 16) }, viewportCenter(api), occupied, 32, visibleArea(api));
      for (const f of files) {
        if (!attachmentExtension(f.name)) {
          onMessage?.(t('fileType', { name: f.name }), 'error');
          continue;
        }
        if (f.size > BOARD_MAX_FILE_BYTES) {
          onMessage?.(t('fileTooBig', { name: f.name, mb: Math.round(BOARD_MAX_FILE_BYTES / 1024 / 1024) }), 'error');
          continue;
        }
        setUploading((n) => n + 1);
        try {
          const res = await fetch(attachUrl, { method: 'POST', headers: { 'x-file-name': encodeURIComponent(f.name), 'content-type': 'application/octet-stream' }, body: f });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as FileCardData;
          const created = skeletonsToElements([fileCardSkeleton(data, origin)]) as SceneEl[];
          api.updateScene({
            elements: [...api.getSceneElementsIncludingDeleted(), ...created],
            appState: { selectedElementIds: Object.fromEntries(created.filter((e) => !e.containerId).map((e) => [e.id, true])) },
            captureUpdate: UNDOABLE,
          });
          origin = { x: origin.x, y: origin.y + FILE_CARD.height + 16 };
        } catch {
          onMessage?.(t('fileError', { name: f.name }), 'error');
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [api, attachUrl, onMessage, t],
  );

  // Doble clic en una celda de tabla: se edita esa celda directo (sin el paso de entrar al grupo).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !api || !canEdit) return;
    const onDbl = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('canvas')) return;
      const s = api.getAppState();
      if (s.editingTextElement) return;
      const r = host.getBoundingClientRect();
      const view = { scrollX: Number(s.scrollX) || 0, scrollY: Number(s.scrollY) || 0, zoom: Number((s.zoom as { value?: number })?.value) || 1 };
      const p = viewToScene({ x: e.clientX - r.left, y: e.clientY - r.top }, view);
      const cell = elementAt(api.getSceneElements() as SceneEl[], p);
      const tableId = cell?.customData?.table;
      if (!cell || typeof tableId !== 'string') return;
      e.preventDefault();
      e.stopPropagation();
      api.updateScene({ appState: { editingGroupId: tableId, selectedGroupIds: {}, selectedElementIds: { [cell.id]: true } } });
      pendingRef.current = [];
      typeInto(cell.id);
    };
    host.addEventListener('dblclick', onDbl, true);
    return () => host.removeEventListener('dblclick', onDbl, true);
  }, [api, canEdit, hostRef, typeInto]);

  // Soltar archivos que no son imágenes sobre el lienzo: tarjeta en el punto donde caen.
  // Las imágenes siguen yendo a Excalidraw.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !api || !canEdit || !attachUrl) return;
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length || files.every((f) => f.type.startsWith('image/'))) return;
      e.preventDefault();
      e.stopPropagation();
      const r = host.getBoundingClientRect();
      const s = api.getAppState();
      const view = { scrollX: Number(s.scrollX) || 0, scrollY: Number(s.scrollY) || 0, zoom: Number((s.zoom as { value?: number })?.value) || 1 };
      const p = viewToScene({ x: e.clientX - r.left, y: e.clientY - r.top }, view);
      void attachFiles(files.filter((f) => !f.type.startsWith('image/')), { x: Math.round(p.x - FILE_CARD.width / 2), y: Math.round(p.y - FILE_CARD.height / 2) });
    };
    host.addEventListener('drop', onDrop, true);
    return () => host.removeEventListener('drop', onDrop, true);
  }, [api, canEdit, attachUrl, hostRef, attachFiles]);

  // Lo que dibuja o escribe esta persona y parece un sticky queda a su nombre: en modo
  // privado sigue viéndolo (y los demás no). Se marca al terminar de dibujar o escribir.
  const mineRef = useRef(new Set<string>());
  useEffect(() => {
    if (!api || !canEdit || !me) return;
    let pending = false;
    return api.onChange((els, s) => {
      const drawing = s.newElement as { id?: string } | null;
      const editing = s.editingTextElement as SceneEl | null;
      if (drawing?.id) mineRef.current.add(drawing.id);
      if (editing?.containerId) mineRef.current.add(editing.containerId);
      if (drawing || editing || pending || !mineRef.current.size) return;
      const todo = (els as SceneEl[]).filter((e) => mineRef.current.has(e.id) && !e.isDeleted && isStickyLike(e) && !stickyAuthor(e));
      if (!todo.length) return;
      pending = true;
      const ids = new Set(todo.map((e) => e.id));
      setTimeout(() => {
        pending = false;
        for (const id of ids) mineRef.current.delete(id);
        api.updateScene({
          elements: (api.getSceneElementsIncludingDeleted() as SceneEl[]).map((e) => (ids.has(e.id) && !stickyAuthor(e) ? withAuthor(e, me, undefined, privateRef.current) : e)),
        });
      }, 0);
    });
  }, [api, canEdit, me]);

  if (!api) return null;
  return (
    <>
      <div className="board-canvas-tools" role="toolbar" aria-label={t('label')}>
        {canEdit && (
          <>
            <button type="button" className="board-canvas-tool" onClick={() => {
                pendingRef.current = [];
                newSticky();
              }}
              title={t('stickyHint')} aria-label={t('sticky')} data-testid="board-tool-sticky">
              <NotesIcon name="sticky" size={16} />
              <kbd>N</kbd>
            </button>
            <button
              type="button"
              className={`board-canvas-tool${highlighter ? ' is-on' : ''}`}
              onClick={startHighlighter}
              aria-pressed={highlighter}
              title={t('highlighter')}
              aria-label={t('highlighter')}
              data-testid="board-tool-highlighter"
            >
              <NotesIcon name="highlighter" size={16} />
            </button>
            <button type="button" className="board-canvas-tool" onClick={() => void insertTable()} title={t('tableHint')} aria-label={t('table')} data-testid="board-tool-table">
              <NotesIcon name="table" size={16} />
            </button>
            {attachUrl && (
              <>
                <button
                  type="button"
                  className="board-canvas-tool"
                  onClick={() => fileRef.current?.click()}
                  title={t('fileHint')}
                  aria-label={t('file')}
                  aria-busy={uploading > 0}
                  data-testid="board-tool-file"
                >
                  <NotesIcon name="paperclip" size={16} />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  accept={ATTACHMENT_EXTENSIONS.map((x) => `.${x}`).join(',')}
                  data-testid="board-file-input"
                  onChange={(e) => {
                    const files = [...(e.currentTarget.files ?? [])];
                    e.currentTarget.value = '';
                    void attachFiles(files);
                  }}
                />
              </>
            )}
          </>
        )}
        <button
          type="button"
          className={`board-canvas-tool${minimap ? ' is-on' : ''}`}
          onClick={toggleMinimap}
          aria-pressed={minimap}
          title={t('minimapHint')}
          aria-label={t('minimap')}
          data-testid="board-tool-minimap"
        >
          <NotesIcon name="map" size={16} />
        </button>
      </div>
      {minimap && <BoardMinimap api={api} label={t('minimap')} />}
    </>
  );
}
