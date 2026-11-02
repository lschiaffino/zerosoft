/**
 * Send: los archivos subidos y las páginas renderizadas son privados. Mismo
 * almacenamiento que Sign y los CVs de Hiring (lib/private-files.ts):
 * SEND_BLOB_READ_WRITE_TOKEN (Blob privado) o cifrado con AES-256-GCM con
 * SEND_FILES_KEY (o una clave derivada con la etiqueta "send-files"). Nunca hay
 * una URL directa: se leen solo por las rutas de Send, con permisos o con la
 * sesión de un link activo.
 *
 * Un archivo se guarda en partes de PART_BYTES: cada subida entra en una función
 * y un video se sirve leyendo solo la parte que el reproductor pide.
 */
import { privateFileStore } from '../private-files';
import { SendError } from './types';

const files = privateFileStore({
  folder: 'send',
  envPrefix: 'SEND',
  hkdfLabel: 'send-files',
  magic: 'ZSD1',
  unavailable: () => new SendError('storage_unavailable', 503),
});

export const storeSendFile = files.store;
export const readSendFile = files.read;
export const deleteSendFiles = files.remove;
export const sealSendValue = (plain: string) => files.seal(Buffer.from(plain, 'utf8')).toString('base64');
export function openSendValue(sealed: string): string | null {
  try {
    return files.open(Buffer.from(sealed, 'base64'))?.toString('utf8') ?? null;
  } catch {
    return null;
  }
}
