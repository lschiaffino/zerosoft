/**
 * PDF mínimo con una imagen JPEG por página (sin dependencias). Lo usa Board
 * para exportar sus frames como un PDF de slides: cada frame se rinde a JPEG
 * en el navegador y acá se arma el archivo. Puro (sirve en cliente y tests).
 */

export interface PdfImagePage {
  /** Bytes de un JPEG (baseline o progresivo). */
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/** Lado largo de cada página, en puntos (A4 apaisado ≈ 842). */
const LONG_SIDE_PT = 842;

function pageSize(w: number, h: number): { w: number; h: number } {
  const scale = LONG_SIDE_PT / Math.max(w, h, 1);
  return { w: Math.max(1, Math.round(w * scale * 100) / 100), h: Math.max(1, Math.round(h * scale * 100) / 100) };
}

/** Arma el PDF: una página por imagen, del tamaño (proporcional) de la imagen. */
export function buildImagePdf(pages: PdfImagePage[], title = 'Board'): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%âãÏÓ\n');
  const n = pages.length;
  // 1 catálogo, 2 páginas, 3 info; después por página: página, contenido, imagen.
  const pageObj = (i: number) => 4 + i * 3;
  const safeTitle = title.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`));
  obj(3, () => push(`<< /Title (${safeTitle}) /Producer (zerosoft Board) >>`));
  pages.forEach((p, i) => {
    const size = pageSize(p.width, p.height);
    const page = pageObj(i);
    const content = page + 1;
    const image = page + 2;
    obj(page, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.w} ${size.h}] /Resources << /XObject << /Im${i} ${image} 0 R >> >> /Contents ${content} 0 R >>`),
    );
    const stream = `q ${size.w} 0 0 ${size.h} 0 0 cm /Im${i} Do Q`;
    obj(content, () => push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    obj(image, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(p.width)} /Height ${Math.round(p.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      );
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const total = 4 + n * 3;
  const xref = length;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Ancho y alto de un JPEG leyendo su marcador SOF (null si no es JPEG). */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}
