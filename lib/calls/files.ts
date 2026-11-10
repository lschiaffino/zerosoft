/**
 * Calls: las grabaciones son privadas. Mismo almacenamiento que Send, Sign y
 * los CVs de Hiring (lib/private-files.ts): CALLS_BLOB_READ_WRITE_TOKEN (Blob
 * privado) o cifrado con AES-256-GCM con CALLS_FILES_KEY (o una clave derivada
 * con la etiqueta "calls-files"). Nunca hay una URL directa: se leen solo por
 * las rutas de Calls, con permisos o con el link compartido activo.
 *
 * Cada parte (4 MB de video o un segmento de audio) es un archivo: cada subida
 * entra en una función y el video se sirve leyendo solo la parte pedida.
 */
import { privateFileStore } from '../private-files';
import { CallsError } from './types';

const files = privateFileStore({
  folder: 'calls',
  envPrefix: 'CALLS',
  hkdfLabel: 'calls-files',
  magic: 'ZSC1',
  unavailable: () => new CallsError('storage_unavailable', 503),
});

/** ¿Hay dónde guardar? En Vercel el disco es efímero: hace falta un store de Blob. */
export function callsStorageConfigured(): boolean {
  return !process.env.VERCEL || Boolean(process.env.CALLS_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_READ_WRITE_TOKEN);
}

export const storeCallFile = files.store;
export const readCallFile = files.read;
export const deleteCallFiles = files.remove;
