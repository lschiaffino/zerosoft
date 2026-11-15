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
  // Nada de credenciales en la URL (https://user:pass@…).
  if (url.username || url.password) return false;
  if (!/^[a-z0-9]+\.(public|private)\.blob\.vercel-storage\.com$/i.test(url.hostname)) return false;
  return decodeURIComponent(url.pathname).startsWith(`/${voiceBlobPrefix(personId)}`);
}

/**
 * Store privado de archivos de la suite (FILES_BLOB_READ_WRITE_TOKEN o
 * BLOB_PRIVATE_READ_WRITE_TOKEN): con él, la grabación nunca queda en una URL
 * pública mientras espera que se transcriba.
 */
export function voicePrivateToken(): string | null {
  return process.env.FILES_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim() || null;
}

/** ¿Está la subida directa a Blob? (sin token, la grabación va por la ruta en un multipart). */
export function voiceBlobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim() || voicePrivateToken());
}

/**
 * Acceso de las grabaciones subidas a Blob: privado con el store privado de
 * archivos (o VOICE_BLOB_ACCESS=private si el store de siempre es privado);
 * public si no.
 */
export function voiceBlobAccess(): 'public' | 'private' {
  if (voicePrivateToken()) return 'private';
  return process.env.VOICE_BLOB_ACCESS?.trim().toLowerCase() === 'private' ? 'private' : 'public';
}

/** Token con el que se firma, lee y borra (el del store privado si hay; si no, el de siempre). */
export function voiceBlobToken(): { token?: string } {
  const t = voicePrivateToken();
  return t ? { token: t } : {};
}

/** Tope de una grabación importada según el proveedor (OpenAI acepta 25 MB por archivo). */
export function voiceImportMaxBytes(provider: string, blob: boolean): number {
  const big = provider === 'deepgram' || provider === 'assemblyai' || provider === 'fake';
  if (!blob) return 25 * 1024 * 1024;
  return big ? 200 * 1024 * 1024 : 25 * 1024 * 1024;
}
