/**
 * Responder un archivo que ya está en memoria respetando `Range` (206): sin
 * eso Safari no reproduce audio ni video, y no se puede adelantar. Un solo
 * rango ("bytes=a-b", "bytes=a-", "bytes=-n"); cualquier otra cosa, el archivo
 * entero.
 */

export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/** El rango pedido sobre un archivo de `size` bytes; null si no hay (o no se entiende) y va entero. */
export function parseRange(header: string | null, size: number): ByteRange {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  if (size <= 0) return 'unsatisfiable';
  if (!m[1]) {
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/** La respuesta (200, 206 o 416) de `data` para el `Range` del pedido, con las cabeceras dadas. */
export function rangedResponse(req: Request, data: Uint8Array, headers: Record<string, string>): Response {
  const range = parseRange(req.headers.get('range'), data.byteLength);
  const base = { ...headers, 'accept-ranges': 'bytes' };
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${data.byteLength}` } });
  if (!range) return new Response(new Uint8Array(data), { headers: { ...base, 'content-length': String(data.byteLength) } });
  const part = data.subarray(range.start, range.end + 1);
  return new Response(new Uint8Array(part), {
    status: 206,
    headers: { ...base, 'content-length': String(part.byteLength), 'content-range': `bytes ${range.start}-${range.end}/${data.byteLength}` },
  });
}
