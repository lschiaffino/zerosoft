/**
 * Board — importar un archivo .excalidraw (o .json con la misma forma) como
 * pizarra nueva. Se valida en el servidor: el cliente solo lee el archivo.
 */
import { BOARD_MAX_SCENE_BYTES, type BoardScene } from './boards-types';

export const BOARD_IMPORT_MAX_ELEMENTS = 50_000;

/** Escena lista para guardar, o null si el contenido no es un dibujo de Excalidraw. */
export function parseExcalidrawScene(input: unknown): BoardScene | null {
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const raw = data as { type?: unknown; elements?: unknown; appState?: unknown; files?: unknown };
  if (raw.type !== undefined && raw.type !== 'excalidraw') return null;
  if (!Array.isArray(raw.elements) || raw.elements.length > BOARD_IMPORT_MAX_ELEMENTS) return null;
  const elements = raw.elements.filter(
    (e): e is Record<string, unknown> =>
      !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' && typeof (e as { type?: unknown }).type === 'string' && !(e as { isDeleted?: unknown }).isDeleted,
  );
  const appState = raw.appState && typeof raw.appState === 'object' ? (raw.appState as Record<string, unknown>) : {};
  const allFiles = raw.files && typeof raw.files === 'object' ? (raw.files as Record<string, unknown>) : {};
  const files: Record<string, unknown> = {};
  for (const e of elements) {
    const id = e.type === 'image' ? e.fileId : null;
    if (typeof id === 'string' && id in allFiles) files[id] = allFiles[id];
  }
  const scene: BoardScene = { elements, appState, files };
  if (Buffer.byteLength(JSON.stringify(scene)) > BOARD_MAX_SCENE_BYTES) return null;
  return scene;
}

/** Nombre de la pizarra a partir del archivo: sin extensión y recortado. */
export function importedBoardName(filename: string): string {
  return filename.replace(/\.(excalidraw|json)$/i, '').trim().slice(0, 120);
}
