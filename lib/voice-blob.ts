/**
 * Voice: subida directa de grabaciones a Vercel Blob (puro). El cliente sube
 * a voice/<persona>/<nombre> con un token de /api/voice/upload; la ruta que
 * transcribe solo acepta URLs de Blob con ese prefijo, así no se puede usar
 * para leer otra URL ni el archivo de otra persona.
 */

export function voiceBlobPrefix(personId: string): string {
  return `voice/${personId.replace(/[^A-Za-z0-9_-]/g, '_')}/`;
}

export function isVoiceBlobUrl(raw: string, personId: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (!/^[a-z0-9]+\.(public|private)\.blob\.vercel-storage\.com$/i.test(url.hostname)) return false;
  return decodeURIComponent(url.pathname).startsWith(`/${voiceBlobPrefix(personId)}`);
}

/** ¿Está la subida directa a Blob? (sin token, la grabación va por la ruta en un multipart). */
export function voiceBlobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}
