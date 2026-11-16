import { describe, expect, it } from 'vitest';
import { DOC_THUMB_MAX, isPdf, validDocThumb, validPages } from '@/lib/wa-doc-thumb';

/** Vista previa de un PDF que guarda el navegador: solo un JPEG chico de verdad, solo en PDFs. */

/** Un JPEG mínimo con cabecera válida (SOI + SOF0 con las medidas) y relleno. */
function jpeg(width: number, height: number, pad = 200): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(pad, 0x20), Buffer.from([0xff, 0xd9])]);
}
const url = (b: Buffer, type = 'image/jpeg') => `data:${type};base64,${b.toString('base64')}`;

describe('validDocThumb', () => {
  it('acepta un JPEG chico con medidas razonables', () => {
    const ok = url(jpeg(480, 240));
    expect(validDocThumb(ok)).toBe(ok);
  });

  it('rechaza lo que no es un JPEG de verdad, lo enorme y lo que pasa el tope', () => {
    expect(validDocThumb(url(Buffer.from('<svg onload="x"></svg>'.padEnd(300)), 'image/jpeg'))).toBeNull();
    expect(validDocThumb(url(jpeg(480, 240), 'image/svg+xml'))).toBeNull();
    expect(validDocThumb(url(jpeg(5000, 240)))).toBeNull();
    expect(validDocThumb(url(jpeg(8, 8)))).toBeNull();
    expect(validDocThumb(url(jpeg(480, 240, DOC_THUMB_MAX)))).toBeNull();
    expect(validDocThumb('https://evil.example/x.jpg')).toBeNull();
    expect(validDocThumb(undefined)).toBeNull();
  });
});

describe('isPdf y validPages', () => {
  it('por tipo o por nombre', () => {
    expect(isPdf('application/pdf', '')).toBe(true);
    expect(isPdf('application/pdf; charset=binary', 'x')).toBe(true);
    expect(isPdf('', 'Presupuesto.PDF')).toBe(true);
    expect(isPdf('text/html', 'propuesta.html')).toBe(false);
  });

  it('páginas: entero positivo', () => {
    expect(validPages(12)).toBe(12);
    expect(validPages('3')).toBe(3);
    expect(validPages(-1)).toBe(0);
    expect(validPages(1.5)).toBe(0);
  });
});
