/**
 * Pegar con el portapapeles (puro, con dependencias inyectadas para probarlo
 * sin Electron):
 *
 * 1. Se guarda todo lo que había (texto, HTML, imágenes, archivos).
 * 2. Se escribe el texto y se simula Cmd/Ctrl+V.
 * 3. Después de un rato (la app de destino lee el portapapeles al procesar
 *    la tecla) se devuelve lo guardado, solo si el portapapeles sigue
 *    teniendo nuestro texto: si la persona copió otra cosa en el medio, no
 *    se pisa.
 *
 * Sin permiso para simular la tecla, el texto queda copiado ('copied') para
 * pegarlo a mano y no se devuelve nada.
 */

export interface ClipboardPort<S> {
  snapshot(): Promise<S>;
  isEmpty(s: S): boolean;
  writeText(text: string): Promise<void> | void;
  readText(): Promise<string> | string;
  restore(s: S): Promise<void> | void;
  clear(): void;
}

export interface PasteDeps<S> {
  clipboard: ClipboardPort<S>;
  /** Simula Cmd/Ctrl+V. null = no hay permiso (Accesibilidad) o hook. */
  tapPaste: (() => void) | null;
  sleep: (ms: number) => Promise<void>;
  /** Devolver lo que había (ajuste "restaurar portapapeles"). */
  restore: boolean;
  /** Espera antes de devolver el portapapeles. */
  settleMs?: number;
}

export interface PasteResult {
  how: 'pasted' | 'copied';
  /** Termina cuando se devolvió (o no) el portapapeles: true si se devolvió. */
  restored: Promise<boolean>;
}

export const PASTE_SETTLE_MS = 450;

export async function pasteViaClipboard<S>(text: string, deps: PasteDeps<S>): Promise<PasteResult> {
  const cb = deps.clipboard;
  if (!deps.tapPaste) {
    await cb.writeText(text);
    return { how: 'copied', restored: Promise.resolve(false) };
  }
  const saved = deps.restore ? await cb.snapshot().catch(() => null) : null;
  await cb.writeText(text);
  deps.tapPaste();
  const restored = (async () => {
    if (!deps.restore || saved === null) return false;
    await deps.sleep(deps.settleMs ?? PASTE_SETTLE_MS);
    let current = '';
    try {
      current = await cb.readText();
    } catch {
      return false;
    }
    if (current !== text) return false;
    try {
      if (cb.isEmpty(saved)) cb.clear();
      else await cb.restore(saved);
      return true;
    } catch {
      return false;
    }
  })();
  return { how: 'pasted', restored };
}
