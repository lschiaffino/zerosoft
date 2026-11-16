/**
 * La clave de un archivo de WhatsApp (lib/wa-media-wire.ts) guardada en la
 * base: `mediaKey` va cifrada (lib/secret-box.ts), el resto (ruta, hashes) no
 * es secreto. Lo guardado antes en claro se sigue leyendo. Server-only.
 */
import { isSealed, open, seal } from './secret-box';
import { parseMediaWire, type MediaWire } from './wa-media-wire';

/** Tope del JSON guardado (la columna media_ref de Inbox corta en 4000). */
const MAX_STORED = 3200;

/** La clave lista para guardar: mediaKey cifrada y, si no entra, sin la URL (con la ruta alcanza). */
export function sealWire(wire: MediaWire): Record<string, unknown> {
  const out: Record<string, unknown> = { ...wire, mediaKey: seal(wire.mediaKey) };
  if (JSON.stringify(out).length > MAX_STORED) delete out.url;
  return out;
}

/** Una clave guardada (cifrada o en claro) → MediaWire válido, o undefined. */
export function openWire(raw: unknown): MediaWire | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = raw as Record<string, unknown>;
  const key = typeof w.mediaKey === 'string' && isSealed(w.mediaKey) ? open(w.mediaKey) : w.mediaKey;
  return parseMediaWire({ ...w, mediaKey: key });
}
