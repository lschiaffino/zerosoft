/**
 * Social: el tipo real de un archivo por sus primeros bytes (puro). La
 * subida lo compara con el tipo de la extensión: un archivo que dice ser una
 * foto o un video y no lo es no entra.
 */
export function sniffMediaType(bytes: Uint8Array): string | null {
  const b = bytes;
  const at = (i: number, sig: number[]) => sig.every((v, k) => b[i + k] === v);
  const ascii = (i: number, s: string) => at(i, [...s].map((c) => c.charCodeAt(0)));
  if (b.length < 12) return null;
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  // ISO base media: "ftyp" en el byte 4; QuickTime declara la marca "qt  ".
  if (ascii(4, 'ftyp')) return ascii(8, 'qt  ') ? 'video/quicktime' : 'video/mp4';
  // QuickTime viejo sin ftyp: el primer átomo es moov, mdat, wide o free.
  if (ascii(4, 'moov') || ascii(4, 'mdat') || ascii(4, 'wide') || ascii(4, 'free')) return 'video/quicktime';
  return null;
}
