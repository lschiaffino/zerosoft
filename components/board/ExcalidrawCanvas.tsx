'use client';

/**
 * Wrapper de Excalidraw. Se carga SOLO en el cliente (next/dynamic con
 * ssr:false desde BoardEditor / BoardViewer): Excalidraw toca window al
 * importarse. Su CSS se importa acá, así viaja en el mismo chunk.
 */
import { Excalidraw, exportToSvg } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { BoardScene } from '@/lib/boards-types';
import { useResolvedTheme } from '@/components/theme/ThemeProvider';

// Tipos laxos: los .d.ts de Excalidraw arrastran paquetes internos.
export interface CanvasApi {
  updateScene: (scene: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) => void;
  addFiles: (files: unknown[]) => void;
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
}

export type CanvasChange = (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;

const LANG: Record<string, string> = { en: 'en', es: 'es-ES', pt: 'pt-BR' };

export default function ExcalidrawCanvas({
  scene,
  locale,
  viewMode = false,
  onChange,
  onApi,
}: {
  scene: BoardScene;
  locale: string;
  viewMode?: boolean;
  onChange?: CanvasChange;
  onApi?: (api: CanvasApi) => void;
}) {
  // El lienzo sigue el modo de color del sitio (selector sistema/claro/oscuro).
  const theme = useResolvedTheme();
  return (
    <Excalidraw
      theme={theme}
      initialData={{
        elements: scene.elements as never,
        appState: { ...scene.appState, collaborators: undefined } as never,
        files: scene.files as never,
        scrollToContent: true,
      }}
      langCode={LANG[locale] ?? 'en'}
      viewModeEnabled={viewMode}
      excalidrawAPI={onApi ? (api) => onApi(api as unknown as CanvasApi) : undefined}
      onChange={onChange ? (els, appState, files) => onChange(els, appState as unknown as Record<string, unknown>, files as unknown as Record<string, unknown>) : undefined}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          toggleTheme: false,
          export: viewMode ? false : { saveFileToDisk: true },
        },
      }}
    />
  );
}

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
