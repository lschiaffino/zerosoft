/**
 * Hiring: archivos privados de candidatos (CVs y documentos). Nunca tienen
 * una URL pública; se leen solo por la ruta con chequeo de permisos.
 *
 * El almacenamiento es el de lib/private-files.ts (lo comparte con Sign):
 * HIRING_BLOB_READ_WRITE_TOKEN (Blob privado), o cifrado con AES-256-GCM con
 * HIRING_FILES_KEY (o una clave derivada con la etiqueta "hiring-files") y el
 * id de la clave en cada archivo; HIRING_FILES_KEY_OLD lee lo anterior a una
 * rotación.
 */
import { privateFileStore } from '../private-files';
import { HiringError } from './types';

const files = privateFileStore({
  folder: 'hiring',
  envPrefix: 'HIRING',
  hkdfLabel: 'hiring-files',
  magic: 'ZSH1',
  unavailable: () => new HiringError('storage_unavailable', 503),
});

/** "ZSH1" + id de la clave (8) + iv (12) + tag (16) + datos. */
export const sealFile = files.seal;
export const openFile = files.open;
export const storeHiringFile = files.store;
export const readHiringFile = files.read;
export const deleteHiringFiles = files.remove;
