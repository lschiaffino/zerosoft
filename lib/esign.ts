/**
 * Firma electrónica compartida (cotizaciones del CRM y Sign). Server-only.
 *
 * Lo que es común a toda firma con registro de auditoría: el hash del
 * contenido firmado, la imagen de la firma (data URL JPEG validada por sus
 * bytes y acotada) y las fechas en UTC para los certificados.
 *
 * Es una firma electrónica simple con registro de auditoría (estilo
 * ESIGN/UETA). No es una firma electrónica avanzada ni calificada (eIDAS AES
 * o QES), ni "firma digital" de la Ley 25.506 (AR), que pide un certificador
 * licenciado. El texto legal de los certificados lo dice (ESIGN_LEGAL_NOTE).
 */
import { createHash } from 'crypto';
import { jpegSize } from './pdf-lite';

/** Máximo de la firma dibujada (data URL JPEG). */
export const MAX_SIGNATURE_BYTES = 200 * 1024;

const JPEG_PREFIX = 'data:image/jpeg;base64,';

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  const h = createHash('sha256');
  if (typeof data === 'string') h.update(data, 'utf8');
  else h.update(data);
  return h.digest('hex');
}

/** Valida la firma: data URL JPEG, tamaño acotado. Devuelve el data URL o '' si no sirve. */
export function cleanSignatureImage(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith(JPEG_PREFIX)) return '';
  if (raw.length > MAX_SIGNATURE_BYTES * 1.4) return '';
  const buf = Buffer.from(raw.slice(JPEG_PREFIX.length), 'base64');
  const size = jpegSize(buf);
  if (!size || size.width < 20 || size.height < 10 || size.width > 2000 || size.height > 1000) return '';
  return raw;
}

/** Bytes de una firma ya validada con cleanSignatureImage. */
export function signatureBytes(dataUrl: string): Buffer | null {
  return dataUrl.startsWith(JPEG_PREFIX) ? Buffer.from(dataUrl.slice(JPEG_PREFIX.length), 'base64') : null;
}

/** "2026-10-30 14:05:09 UTC" a partir de un ISO o de un datetime de SQLite. */
export function utcStamp(d: string | null | undefined): string {
  if (!d) return '-';
  const iso = d.includes('T') ? d : `${d.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? d : `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/** Qué es (y qué no es) esta firma, para el pie de los certificados. */
export const ESIGN_LEGAL_NOTE =
  'Electronic signature with an audit trail (simple electronic signature, in the style of the US ESIGN Act and UETA). ' +
  'It is not an advanced or qualified electronic signature under eIDAS, nor a "firma digital" under Argentine Law 25.506, which requires a licensed certifier.';
