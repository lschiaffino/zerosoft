/**
 * Forma de las URLs de archivos (lib/files/store.ts). Puro: lo usan el
 * servidor y los componentes.
 */

/** /api/files/<id de 22>/<nombre seguro>: lo que devuelve saveUpload. */
export const FILE_URL_RE = /^\/api\/files\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9._-]{1,80}$/;

export function isFileUrlPath(url: unknown): url is string {
  return typeof url === 'string' && FILE_URL_RE.test(url);
}

/**
 * URL para el navegador de un archivo de antes en el Blob público de la
 * suite: /api/files/legacy/<pathname>, que chequea sesión y permiso. Las
 * demás URLs vuelven igual.
 */
export function viaFilesProxy(url: string): string {
  const m = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/([A-Za-z0-9._/-]+)$/i.exec(url);
  if (!m || m[1].includes('..') || m[1].startsWith('uploads/')) return url;
  return `/api/files/legacy/${m[1]}`;
}
