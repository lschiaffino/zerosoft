'use client';

/**
 * Wrapper de Excalidraw. Se carga SOLO en el cliente (next/dynamic con
 * ssr:false desde BoardEditor / BoardViewer): Excalidraw toca window al
 * importarse. Su CSS se importa acá, así viaja en el mismo chunk.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, exportToSvg, reconcileElements, useHandleLibrary } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { isAllowedLibraryUrl, type BoardScene } from '@/lib/boards-types';
import { excalidrawLang } from '@/lib/board-view';
import { useResolvedTheme } from '@/components/theme/ThemeProvider';

// Tipos laxos: los .d.ts de Excalidraw arrastran paquetes internos.
export interface CanvasApi {
  updateScene: (scene: { elements?: readonly unknown[]; appState?: Record<string, unknown>; captureUpdate?: unknown }) => void;
  onChange: (cb: (elements: readonly unknown[], appState: Record<string, unknown>) => void) => () => void;
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
  addFiles: (files: unknown[]) => void;
  getSceneElements: () => readonly unknown[];
  getSceneElementsIncludingDeleted: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  onScrollChange: (cb: (scrollX: number, scrollY: number, zoom: { value: number }) => void) => () => void;
}

/**
 * Biblioteca de formas del workspace (GET/PUT /api/boards/library). Excalidraw
 * la carga al abrir, la guarda en cada cambio y, al volver del catálogo de
 * libraries.excalidraw.com con #addLibrary=<url>, instala la biblioteca elegida.
 */
const libraryAdapter = {
  async load() {
    const res = await fetch('/api/boards/library');
    if (!res.ok) return null;
    return (await res.json()) as { libraryItems: never[] };
  },
  async save({ libraryItems }: { libraryItems: readonly unknown[] }) {
    const res = await fetch('/api/boards/library', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ libraryItems }),
    });
    // El adapter tiene que fallar para que Excalidraw avise y no dé por guardado.
    if (!res.ok) throw new Error(`library_save_${res.status}`);
  },
};

export type CanvasChange = (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;


/** Aire entre el panel de propiedades y la barra de zoom. */
const PANEL_GAP = 12;

/**
 * Excalidraw limita el panel de propiedades con la altura de la ventana, pero
 * acá el lienzo arranca debajo de la barra de la app: sin este tope el panel
 * baja hasta tapar la barra de zoom. Se mide cuando aparece o cambia de tamaño.
 */
function usePanelLimit(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const root = host.querySelector<HTMLElement>('.excalidraw');
      const panel = host.querySelector<HTMLElement>('.App-menu__left');
      const zoom = host.querySelector<HTMLElement>('.App-menu_bottom');
      if (!root) return;
      if (!panel || !zoom) return root.style.removeProperty('--board-panel-max');
      const max = Math.max(120, zoom.getBoundingClientRect().top - panel.getBoundingClientRect().top - PANEL_GAP);
      root.style.setProperty('--board-panel-max', `${Math.floor(max)}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(host, { childList: true, subtree: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(host.parentElement ?? host);
    schedule();
    return () => {
      mo.disconnect();
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}

export default function ExcalidrawCanvas({
  scene,
  locale,
  viewMode = false,
  library = true,
  onChange,
  onApi,
}: {
  scene: BoardScene;
  locale: string;
  viewMode?: boolean;
  /** Biblioteca de formas del workspace (sin sesión, como el invitado, no hay). */
  library?: boolean;
  onChange?: CanvasChange;
  onApi?: (api: CanvasApi) => void;
}) {
  // El lienzo sigue el modo de color del sitio (selector sistema/claro/oscuro).
  const theme = useResolvedTheme();
  const [api, setApi] = useState<unknown>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  usePanelLimit(hostRef);
  // La biblioteca solo en el editor con sesión (la vista pública y el invitado no la tienen).
  const withLibrary = library && !viewMode;
  useHandleLibrary({
    excalidrawAPI: (withLibrary ? api : null) as never,
    adapter: libraryAdapter as never,
    validateLibraryUrl: isAllowedLibraryUrl,
  });
  const [returnUrl, setReturnUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    // Al instalar desde el catálogo se vuelve a esta misma pizarra.
    setReturnUrl(`${window.location.origin}${window.location.pathname}`);
  }, []);
  const uiOptions = useMemo(
    () => ({
      canvasActions: {
        loadScene: false,
        saveToActiveFile: false,
        toggleTheme: false,
        export: viewMode ? (false as const) : { saveFileToDisk: true },
      },
    }),
    [viewMode],
  );
  return (
    // display: contents: no cambia el layout; solo sirve para medir el panel.
    <div ref={hostRef} className="board-excalidraw" data-lang={excalidrawLang(locale)}>
    <Excalidraw
      theme={theme}
      initialData={{
        elements: scene.elements as never,
        appState: { ...scene.appState, collaborators: undefined } as never,
        files: scene.files as never,
        scrollToContent: true,
      }}
      langCode={excalidrawLang(locale)}
      viewModeEnabled={viewMode}
      excalidrawAPI={(instance) => {
        setApi(instance);
        onApi?.(instance as unknown as CanvasApi);
      }}
      libraryReturnUrl={withLibrary ? returnUrl : undefined}
      onChange={onChange ? (els, appState, files) => onChange(els, appState as unknown as Record<string, unknown>, files as unknown as Record<string, unknown>) : undefined}
      UIOptions={uiOptions}
    />
    </div>
  );
}

/** Merge por elemento de Excalidraw (versión mayor gana; empate por versionNonce). */
export function reconcile(local: readonly unknown[], remote: readonly unknown[], appState: Record<string, unknown>): unknown[] {
  return reconcileElements(local as never, remote as never, appState as never) as unknown[];
}

/** Elementos de Excalidraw a partir de esqueletos (stickies con su texto ligado). */
export function skeletonsToElements(skeletons: Array<Record<string, unknown>>): unknown[] {
  return convertToExcalidrawElements(skeletons as never) as unknown[];
}

/** Opción de updateScene para que el cambio entre al deshacer/rehacer. */
export const UNDOABLE = CaptureUpdateAction.IMMEDIATELY;

/** Miniatura SVG de la escena (sin imágenes, para que sea chica). */
export async function sceneThumbnail(elements: readonly unknown[], viewBackgroundColor: string): Promise<string | null> {
  const live = (elements as Array<{ isDeleted?: boolean; type?: string }>).filter((e) => !e.isDeleted && e.type !== 'image');
  if (!live.length) return null;
  try {
    const svg = await exportToSvg({
      elements: live as never,
      appState: { exportBackground: false, viewBackgroundColor, exportEmbedScene: false } as never,
      files: null,
      exportPadding: 16,
      skipInliningFonts: true,
    });
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    return svg.outerHTML;
  } catch {
    return null;
  }
}
