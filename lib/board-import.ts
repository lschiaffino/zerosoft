/**
 * Board: lectura de archivos .excalidraw (el formato del editor open source y
 * de Excalidraw+, "Guardar en…"). Puro: valida la forma y devuelve la escena
 * que se guarda; Excalidraw normaliza cada elemento al abrir la pizarra.
 */
import type { BoardScene } from './boards-types';

const MAX_ELEMENTS = 50_000;

/** Esquemas que no pueden ser un link de un elemento. */
const UNSAFE_SCHEME = /^(javascript|data|vbscript|file|blob):/i;

/**
 * ¿El link es peligroso? Se normaliza antes de mirar el esquema, como hace el
 * navegador: sin espacios ni caracteres de control (tab, salto de línea) en
 * ningún lado, y con las entidades &#…; y %xx más comunes resueltas.
 */
export function unsafeLink(link: string): boolean {
  let s = link;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* % suelto: se mira tal cual */
  }
  s = s.replace(/&#x?([0-9a-f]+);?/gi, (m, n: string) => {
    const code = /^&#x/i.test(m) ? parseInt(n, 16) : parseInt(n, 10);
    return Number.isFinite(code) ? String.fromCharCode(code) : '';
  });
  s = s.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  return UNSAFE_SCHEME.test(s);
}

/**
 * Limpia los elementos que llegan de afuera (API, en vivo, archivos, guardado):
 * - links peligrosos (javascript:, data:, …) → sin link. Excalidraw ya los
 *   neutraliza al abrir y al exportar a SVG, pero no hay que confiar en eso;
 * - el HTML generado por IA (customData.generationData de un frame de
 *   wireframe) no se guarda ni viaja: solo lo ve quien lo generó, en su
 *   pestaña (con dropGenerated: false se conserva, p. ej. para tests).
 * Devuelve el mismo array si no había nada que tocar.
 */
export function sanitizeElements<T extends Record<string, unknown>>(elements: T[], opts: { dropGenerated?: boolean } = {}): T[] {
  const dropGenerated = opts.dropGenerated !== false;
  let changed = false;
  const out = elements.map((el) => {
    let next = el;
    if (typeof el.link === 'string' && unsafeLink(el.link)) next = { ...next, link: null };
    const custom = el.customData as Record<string, unknown> | null | undefined;
    if (dropGenerated && custom && typeof custom === 'object' && 'generationData' in custom) {
      const { generationData: _g, ...rest } = custom;
      void _g;
      next = { ...next, customData: rest };
    }
    if (next !== el) changed = true;
    return next;
  });
  return changed ? out : elements;
}

export type ReadFileResult = { ok: true; scene: BoardScene } | { ok: false; error: 'invalid_file' | 'too_many_elements' };

/** Escena de un archivo .excalidraw (string u objeto ya parseado), o null si no lo es. */
export function parseExcalidrawFile(input: unknown): BoardScene | null {
  const r = readExcalidrawFile(input);
  return r.ok ? r.scene : null;
}

/** Como parseExcalidrawFile, con el motivo si no se puede abrir. */
export function readExcalidrawFile(input: unknown): ReadFileResult {
  const bad = { ok: false, error: 'invalid_file' } as const;
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      return bad;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return bad;
  const d = data as Record<string, unknown>;
  // Una biblioteca (.excalidrawlib) no es una escena.
  if (d.type !== undefined && d.type !== 'excalidraw') return bad;
  if (!Array.isArray(d.elements)) return bad;
  if (d.elements.length > MAX_ELEMENTS) return { ok: false, error: 'too_many_elements' };
  const elements: Array<Record<string, unknown>> = [];
  for (const e of d.elements) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return bad;
    const el = e as Record<string, unknown>;
    if (typeof el.id !== 'string' || el.id.length > 128 || typeof el.type !== 'string') return bad;
    if (el.isDeleted) continue;
    elements.push(el);
  }
  const appState = d.appState && typeof d.appState === 'object' && !Array.isArray(d.appState) ? (d.appState as Record<string, unknown>) : {};
  const rawFiles = d.files && typeof d.files === 'object' && !Array.isArray(d.files) ? (d.files as Record<string, unknown>) : {};
  // Solo imágenes en base64 que se pueden guardar en el storage (el navegador pasa los SVG a PNG
  // antes de importar); una URL ajena en el archivo no se guarda.
  const files: Record<string, unknown> = {};
  for (const [id, f] of Object.entries(rawFiles)) {
    const file = f as Record<string, unknown> | null;
    if (!file || typeof file.dataURL !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(file.dataURL)) continue;
    if (id.length > 128) continue;
    files[id] = { id, mimeType: file.mimeType, dataURL: file.dataURL, created: typeof file.created === 'number' ? file.created : Date.now() };
  }
  return {
    ok: true,
    scene: {
      elements: sanitizeElements(elements),
      appState: {
        viewBackgroundColor: typeof appState.viewBackgroundColor === 'string' ? appState.viewBackgroundColor.slice(0, 32) : '#ffffff',
        ...(typeof appState.gridSize === 'number' ? { gridSize: appState.gridSize } : {}),
      },
      files,
    },
  };
}

export const MAX_IMPORT_ELEMENTS = MAX_ELEMENTS;
