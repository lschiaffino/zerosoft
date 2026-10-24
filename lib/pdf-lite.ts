/**
 * PDF mínimo sin dependencias (PDF 1.4): una página A4 con líneas de texto en
 * Helvetica (WinAnsi) y, opcional, una imagen JPEG. Alcanza para documentos
 * generados por el servidor como el certificado de firma de una cotización.
 */

export interface PdfLine {
  text: string;
  /** Tamaño en puntos (default 10). */
  size?: number;
  bold?: boolean;
  /** Espacio extra antes de la línea, en puntos. */
  gap?: number;
  /** Gris (0 negro … 1 blanco). */
  gray?: number;
}

export interface PdfImage {
  jpeg: Buffer;
  /** Ancho a dibujar en puntos (el alto respeta la proporción). */
  width: number;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;

/** Texto → bytes WinAnsi (latin1); lo que no entra se reemplaza por '?'. */
function winAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '—' || ch === '–') out += '-';
    else if (ch === '…') out += '...';
    else if (ch === '’' || ch === '‘') out += "'";
    else if (ch === '“' || ch === '”') out += '"';
    else if (ch === '·') out += '·';
    else out += code < 256 && code >= 32 ? ch : code === 9 ? ' ' : '?';
  }
  return out;
}

function pdfString(text: string): string {
  return `(${winAnsi(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

/** Corta una línea larga en varias por cantidad de caracteres (aprox. para Helvetica). */
export function wrapText(text: string, size: number, maxWidth = PAGE_W - MARGIN * 2): string[] {
  const perLine = Math.max(10, Math.floor(maxWidth / (size * 0.52)));
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    let rest = raw;
    while (rest.length > perLine) {
      let cut = rest.lastIndexOf(' ', perLine);
      if (cut < perLine * 0.5) cut = perLine;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out;
}

/** Ancho y alto de un JPEG (marcador SOF). null si no es un JPEG válido. */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Arma el PDF. Las líneas que no entran en la página se cortan (el certificado
 * entra siempre en una). La imagen va después de `imageAfter` líneas.
 */
export function buildPdf(input: { title: string; lines: PdfLine[]; image?: PdfImage | null; imageAfter?: number }): Buffer {
  const ops: string[] = [];
  let y = PAGE_H - MARGIN;
  const img = input.image ? jpegSize(input.image.jpeg) : null;
  const imageAfter = input.imageAfter ?? input.lines.length;
  let imageOp = '';
  const drawImage = () => {
    if (!img || !input.image) return;
    const w = Math.min(input.image.width, PAGE_W - MARGIN * 2);
    const h = (w * img.height) / img.width;
    y -= h + 8;
    if (y < MARGIN) return;
    imageOp = `q 0.6 G 0.5 w ${MARGIN - 4} ${(y - 4).toFixed(2)} ${(w + 8).toFixed(2)} ${(h + 8).toFixed(2)} re S Q q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${MARGIN} ${y.toFixed(2)} cm /Im1 Do Q`;
    y -= 6;
  };
  input.lines.forEach((line, idx) => {
    if (idx === imageAfter) drawImage();
    const size = line.size ?? 10;
    let gap = line.gap ?? 0;
    for (const part of wrapText(line.text, size)) {
      y -= gap + size * 1.45;
      gap = 0;
      if (y < MARGIN) return;
      ops.push(
        `BT /${line.bold ? 'F2' : 'F1'} ${size} Tf ${(line.gray ?? 0).toFixed(2)} g ${MARGIN} ${y.toFixed(2)} Td ${pdfString(part)} Tj ET`,
      );
    }
  });
  if (imageAfter >= input.lines.length) drawImage();
  if (imageOp) ops.push(imageOp);
  const content = ops.join('\n');

  const objects: Array<string | Buffer> = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${
      img ? ' /XObject << /Im1 7 0 R >>' : ''
    } >> /Contents 6 0 R >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const contentBytes = Buffer.from(content, 'latin1');
  objects.push(Buffer.concat([Buffer.from(`<< /Length ${contentBytes.length} >>\nstream\n`, 'latin1'), contentBytes, Buffer.from('\nendstream', 'latin1')]));
  if (img && input.image) {
    objects.push(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${input.image.jpeg.length} >>\nstream\n`,
          'latin1',
        ),
        input.image.jpeg,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }
  objects.push(`<< /Title ${pdfString(input.title)} /Producer (Zerosoft) >>`);
  const infoId = objects.length;

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(offset);
    const body = typeof obj === 'string' ? Buffer.from(obj, 'latin1') : obj;
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}
