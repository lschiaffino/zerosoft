/**
 * Send: el PDF de una descarga con watermark. Se dibuja en el servidor sobre cada
 * página: lo que baja la persona ya lleva su email. Server-only.
 */
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readSendFile } from './files';
import { pagesOf, pageRef, readParts, type VersionRow } from './core';
import { imageToJpeg } from './render';
import { SendError } from './types';

/** Lo que Helvetica no puede escribir se reemplaza: el dato queda legible y la descarga no falla. */
function winAnsi(text: string): string {
  return text.replace(/[^\x20-\x7e -ÿ]/g, '?');
}

async function basePdf(v: VersionRow): Promise<PDFDocument> {
  if (v.kind === 'pdf' || v.kind === 'docs') {
    try {
      return await PDFDocument.load(await readParts(v.id), { updateMetadata: false });
    } catch {
      // Cifrado o con una estructura que pdf-lib no lee: se arma con las páginas, como un Word.
    }
  }
  // Word y PowerPoint: se arma con las páginas ya renderizadas.
  const doc = await PDFDocument.create();
  for (const p of await pagesOf(v.id)) {
    const ref = await pageRef(v.id, p.page);
    const bytes = ref ? await readSendFile(ref.ref) : null;
    if (!bytes) throw new SendError('file_unavailable', 404);
    const img = await doc.embedJpg(new Uint8Array(await imageToJpeg(bytes)));
    const w = 720;
    const h = (p.height / p.width) * w;
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return doc;
}

export async function stampPdf(v: VersionRow, text: string): Promise<Buffer> {
  const doc = await basePdf(v);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const label = winAnsi(text);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(9, width / 42);
    const tw = font.widthOfTextAtSize(label, size);
    const stepX = tw + size * 3;
    const stepY = size * 7;
    const diagonal = Math.hypot(width, height);
    // Dentro del sistema de la página: girado 30 grados, repetido en toda la hoja.
    const a = Math.PI / 6;
    let row = 0;
    for (let v2 = -diagonal; v2 < diagonal; v2 += stepY, row++) {
      const shift = row % 2 ? stepX / 2 : 0;
      for (let u = -diagonal - shift; u < diagonal; u += stepX) {
        const x = width / 2 + u * Math.cos(a) - v2 * Math.sin(a);
        const y = height / 2 + u * Math.sin(a) + v2 * Math.cos(a);
        if (x < -tw || x > width + tw || y < -tw || y > height + tw) continue;
        page.drawText(label, { x, y, size, font, color: rgb(0.16, 0.16, 0.16), opacity: 0.2, rotate: degrees(30) });
      }
    }
  }
  return Buffer.from(await doc.save());
}
