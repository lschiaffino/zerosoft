/**
 * Sign: los PDFs (original limpio, firmado final y los de las plantillas) son
 * privados. Mismo almacenamiento que los CVs de Hiring (lib/private-files.ts):
 * SIGN_BLOB_READ_WRITE_TOKEN (Blob privado) o cifrado con AES-256-GCM con
 * SIGN_FILES_KEY (o una clave derivada con la etiqueta "sign-files") y el id
 * de la clave en cada archivo; SIGN_FILES_KEY_OLD lee lo anterior a una
 * rotación. Se leen solo por las rutas de Sign con chequeo de permisos o con
 * el link del destinatario.
 */
import { privateFileStore } from '../private-files';
import { SignError } from './types';

const files = privateFileStore({
  folder: 'sign',
  envPrefix: 'SIGN',
  hkdfLabel: 'sign-files',
  magic: 'ZSS1',
  unavailable: () => new SignError('storage_unavailable', 503),
});

export const storeSignFile = files.store;
export const readSignFile = files.read;
export const deleteSignFiles = files.remove;
export const sealSignFile = files.seal;
export const openSignFile = files.open;
