/**
 * Lo mínimo de un archivo de WhatsApp para volver a bajarlo sin que el
 * gateway lo tenga guardado: la clave del archivo (mediaKey), dónde está en
 * los servidores de WhatsApp (directPath) y sus hashes.
 *
 * Por qué: Evolution baja un archivo recibido buscando el mensaje en su base
 * (getBase64FromMediaMessage con la key). Los mensajes que llegan por la
 * sincronización del historial (al volver a vincular la línea) no se guardan
 * en esa base (DATABASE_SAVE_DATA_HISTORIC apagado) y la respuesta es
 * "Message not found". Con estos datos se le pasa el mensaje entero y Baileys
 * lo baja directo de WhatsApp; si el enlace venció, le pide al teléfono que lo
 * vuelva a subir (reuploadRequest → updateMediaMessage).
 *
 * El archivo solo se pide a los servidores de WhatsApp: la URL se guarda solo
 * si es de mmg.whatsapp.net y el directPath es una ruta; nada de otro host.
 * No se manda nunca al navegador.
 */

export const WIRE_TYPES = ['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage', 'documentMessage', 'stickerMessage'] as const;
export type WireType = (typeof WIRE_TYPES)[number];

export interface MediaWire {
  type: WireType;
  mediaKey: string;
  directPath: string;
  url?: string;
  mimetype?: string;
  fileEncSha256?: string;
  fileSha256?: string;
  fileLength?: number;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes en cualquiera de las formas en que llegan por JSON (base64, Buffer serializado, objeto {0:..} o lista) → base64. */
export function bytesToBase64(v: unknown): string {
  if (typeof v === 'string') {
    const s = v.replace(/^data:[^,]*,/, '').trim();
    return s.length > 0 && s.length <= 200 && B64.test(s) ? s : '';
  }
  if (!v || typeof v !== 'object') return '';
  const o = v as Record<string, unknown>;
  const list = Array.isArray(v) ? v : o.type === 'Buffer' && Array.isArray(o.data) ? (o.data as unknown[]) : Object.keys(o).every((k) => /^\d+$/.test(k)) ? Object.keys(o).sort((a, b) => Number(a) - Number(b)).map((k) => o[k]) : null;
  if (!list || list.length === 0 || list.length > 128) return '';
  if (!list.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255)) return '';
  return Buffer.from(list as number[]).toString('base64');
}

const DIRECT_PATH = /^\/[A-Za-z0-9\-._~/?=&%]{1,1000}$/;

/** Los datos para volver a bajar el archivo de un mensaje de Baileys (`m` es imageMessage, videoMessage…); undefined si falta algo. */
export function mediaWireOf(type: string, m: Record<string, unknown>): MediaWire | undefined {
  if (!(WIRE_TYPES as readonly string[]).includes(type)) return undefined;
  const mediaKey = bytesToBase64(m.mediaKey);
  const directPath = typeof m.directPath === 'string' && DIRECT_PATH.test(m.directPath) ? m.directPath : '';
  if (!mediaKey || !directPath) return undefined;
  const url = typeof m.url === 'string' && m.url.startsWith('https://mmg.whatsapp.net/') && m.url.length < 2000 ? m.url : '';
  const len = Number(typeof m.fileLength === 'object' && m.fileLength ? (m.fileLength as { low?: number }).low : m.fileLength);
  const fileEncSha256 = bytesToBase64(m.fileEncSha256);
  const fileSha256 = bytesToBase64(m.fileSha256);
  const mimetype = typeof m.mimetype === 'string' ? m.mimetype.slice(0, 100) : '';
  return {
    type: type as WireType,
    mediaKey,
    directPath,
    ...(url ? { url } : {}),
    ...(mimetype ? { mimetype } : {}),
    ...(fileEncSha256 ? { fileEncSha256 } : {}),
    ...(fileSha256 ? { fileSha256 } : {}),
    ...(Number.isFinite(len) && len > 0 ? { fileLength: len } : {}),
  };
}

/** Un MediaWire guardado (JSON de la base) que todavía es válido; si no, undefined. */
export function parseMediaWire(raw: unknown): MediaWire | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = raw as Record<string, unknown>;
  return mediaWireOf(String(w.type ?? ''), w);
}

/** El `message` de Baileys que se le pasa a Evolution para bajar el archivo sin buscarlo en su base. */
export function wireMessage(wire: MediaWire): Record<string, unknown> {
  const { type, ...fields } = wire;
  return { [type]: fields };
}

/**
 * Qué tipo de falla fue al bajar un archivo (para el log y para la pantalla): nunca ids, números ni contenido.
 * - gone: WhatsApp ya no lo tiene (o el gateway no tiene el mensaje y no hay clave para pedirlo directo).
 * - offline: la línea no está conectada; al volver a vincularla se puede pedir de nuevo.
 * - el resto: pasajeras, se reintenta.
 */
export type MediaErrorKind = 'gone' | 'offline' | 'too_big' | 'unreachable' | 'auth' | 'rate_limited' | 'provider_error';

/**
 * Lo que dijo el gateway al fallar, reducido a una etiqueta (el texto no se guarda ni se loguea):
 * no tiene el mensaje, la sesión está cerrada, WhatsApp/el teléfono ya no tienen el archivo, o tardó de más.
 */
export type GatewayReason = 'message_not_found' | 'offline' | 'media_gone' | 'timeout';

export function gatewayReason(text: string): GatewayReason | undefined {
  const t = String(text ?? '').slice(0, 2000).toLowerCase();
  if (!t) return undefined;
  if (/connection closed|connection lost|not connected|is not open|closed session|logged out|precondition required|instance.{0,60}(not exist|not found)/.test(t)) return 'offline';
  if (/timed? ?out|timeout/.test(t)) return 'timeout';
  if (/re-?upload|media.{0,40}(expired|gone|not found|unavailable)|status code 4(04|10)|\b4(04|10)\b.{0,20}media/.test(t)) return 'media_gone';
  if (/message not found|not found/.test(t)) return 'message_not_found';
  return undefined;
}

export function mediaErrorKind(err: unknown, withWire = false): MediaErrorKind {
  const e = err as { code?: string; httpStatus?: number; reason?: GatewayReason } | null;
  if (e?.httpStatus === 413) return 'too_big';
  if (e?.reason === 'offline' || e?.code === 'not_connected') return 'offline';
  if (e?.reason === 'timeout' || e?.code === 'unreachable') return 'unreachable';
  if (e?.reason === 'media_gone') return 'gone';
  if (e?.code === 'auth_failed') return 'auth';
  if (e?.code === 'rate_limited') return 'rate_limited';
  if (e?.code === 'not_found' || e?.httpStatus === 404 || e?.httpStatus === 410 || e?.reason === 'message_not_found') return 'gone';
  // Un 400 sin motivo reconocible: sin clave no queda nada que probar; con clave (se le pidió al teléfono) puede ser pasajero.
  if (e?.httpStatus === 400) return withWire ? 'provider_error' : 'gone';
  return 'provider_error';
}

/** Una línea de log con el tipo de falla y si había clave para el reintento directo. */
export function logMediaFailure(app: 'inbox' | 'lines', err: unknown, withWire: boolean, connected = true): MediaErrorKind {
  let kind = mediaErrorKind(err, withWire);
  // Con la línea desvinculada el gateway no puede pedirle nada al teléfono: no es "ya no está", es "sin conexión".
  if (!connected && kind !== 'too_big') kind = 'offline';
  // eslint-disable-next-line no-console
  console.warn('[wa-media] download failed', JSON.stringify({ app, kind, wire: withWire }));
  return kind;
}

/** Lo que ve la pantalla de una media que no se pudo bajar. */
export type MediaFetchState = 'gone' | 'offline' | 'pending';

export function fetchStateOf(kind: MediaErrorKind): MediaFetchState {
  return kind === 'gone' || kind === 'too_big' ? 'gone' : kind === 'offline' ? 'offline' : 'pending';
}
