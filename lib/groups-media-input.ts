/**
 * Groups: adjunto que llega en el cuerpo de una ruta ({ url, mimetype,
 * filename }). Solo archivos subidos a zerosoft (/uploads/) o URLs https; un
 * /uploads/ relativo se completa con el origen porque el proveedor baja la
 * media de una URL pública.
 */
export function mediaFromBody(raw: unknown, req: Request): { url: string; mimetype: string; filename: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const url = typeof m.url === 'string' ? m.url.slice(0, 2000) : '';
  if (!/^(\/uploads\/|https:\/\/)/.test(url)) return null;
  const base = (process.env.NEXTAUTH_URL || new URL(req.url).origin).replace(/\/$/, '');
  return {
    url: url.startsWith('/') ? `${base}${url}` : url,
    mimetype: (typeof m.mimetype === 'string' && m.mimetype.slice(0, 100)) || 'application/octet-stream',
    filename: (typeof m.filename === 'string' && m.filename.slice(0, 200)) || 'file',
  };
}
