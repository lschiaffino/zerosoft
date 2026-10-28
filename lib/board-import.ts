/**
 * Board: lectura de archivos .excalidraw (el formato del editor open source y
 * de Excalidraw+, "Guardar en…"). Puro: valida la forma y devuelve la escena
 * que se guarda; Excalidraw normaliza cada elemento al abrir la pizarra.
 */
import type { BoardScene } from './boards-types';

const MAX_ELEMENTS = 50_000;

const UNSAFE_LINK = /^[\s\u0000-\u001f]*(javascript|data|vbscript|file):/i;

/**
 * Saca links peligrosos de los elementos (javascript:, data:, …). Excalidraw
 * ya los neutraliza al abrir y al exportar a SVG, pero lo que llega por la API
 * o en vivo de otra pestaña no tiene por qué confiar en eso. Devuelve el mismo
 * array si no había nada que tocar.
 */
export function sanitizeElements<T extends Record<string, unknown>>(elements: T[]): T[] {
  let changed = false;
  const out = elements.map((el) => {
    if (typeof el.link === 'string' && UNSAFE_LINK.test(el.link)) {
      changed = true;
      return { ...el, link: null };
    }
    return el;
  });
  return changed ? out : elements;
}

/** Escena de un archivo .excalidraw (string u objeto ya parseado), o null si no lo es. */
export function parseExcalidrawFile(input: unknown): BoardScene | null {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  // Una biblioteca (.excalidrawlib) no es una escena.
  if (d.type !== undefined && d.type !== 'excalidraw') return null;
  if (!Array.isArray(d.elements) || d.elements.length > MAX_ELEMENTS) return null;
  const elements: Array<Record<string, unknown>> = [];
  for (const e of d.elements) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const el = e as Record<string, unknown>;
    if (typeof el.id !== 'string' || el.id.length > 128 || typeof el.type !== 'string') return null;
    if (el.isDeleted) continue;
    elements.push(el);
  }
  const appState = d.appState && typeof d.appState === 'object' && !Array.isArray(d.appState) ? (d.appState as Record<string, unknown>) : {};
  const rawFiles = d.files && typeof d.files === 'object' && !Array.isArray(d.files) ? (d.files as Record<string, unknown>) : {};
  // Solo las imágenes en base64 (data:image/...); una URL ajena en el archivo no se guarda.
  const files: Record<string, unknown> = {};
  for (const [id, f] of Object.entries(rawFiles)) {
    const file = f as Record<string, unknown> | null;
    if (!file || typeof file.dataURL !== 'string' || !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(file.dataURL)) continue;
    if (id.length > 128) continue;
    files[id] = { id, mimeType: file.mimeType, dataURL: file.dataURL, created: typeof file.created === 'number' ? file.created : Date.now() };
  }
  return {
    elements: sanitizeElements(elements),
    appState: {
      viewBackgroundColor: typeof appState.viewBackgroundColor === 'string' ? appState.viewBackgroundColor.slice(0, 32) : '#ffffff',
      ...(typeof appState.gridSize === 'number' ? { gridSize: appState.gridSize } : {}),
    },
    files,
  };
}
