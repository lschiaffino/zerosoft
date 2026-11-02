import { describe, expect, it } from 'vitest';
import {
  acceptedSeconds,
  firstClaim,
  isScriptedUserAgent,
  accessAllowed,
  cleanAccessList,
  completionPct,
  hashCode,
  hashToken,
  isForwarded,
  linkNeedsEmail,
  linkNeedsVerify,
  linkState,
  matchesAccessList,
  newCode,
  newToken,
  nextGate,
  normalizeEmail,
  scaleDeltas,
  safeBrandColor,
  safeHttpUrl,
  sniffKind,
  TOKEN_RE,
  videoBuckets,
  videoMime,
} from '@/lib/send/types';
import { assertOfficeSize, imageSize, kid, kids, parseXml, pptxToImages } from '@/lib/send/office';
import { buildZip } from '@/lib/zip-reader';
import { renderPdfPages } from '@/lib/send/render';
import { PDFDocument } from 'pdf-lib';
import { excludeReason, webOnlyWhere } from '@/lib/mcp/excludes.mjs';
import { scrubText } from '@/lib/mcp/scrub';

const open = { require_email: 0, verify_email: 0, passcode_hash: null, access_mode: 'none', access_list: '[]', watermark: 0, nda_template_id: null };
const fresh = { passcode_ok: 0, email: null, email_verified: 0, nda_signed_at: null };

describe('Send: tokens y códigos', () => {
  it('el token del link es largo, al azar y de 192 bits', () => {
    const a = newToken();
    expect(a).toMatch(TOKEN_RE);
    expect(a).toHaveLength(32);
    expect(newToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });

  it('el código es de 6 dígitos y su hash depende de la sesión', () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
    expect(hashCode('a', '123456')).not.toBe(hashCode('b', '123456'));
  });
});

describe('Send: emails y listas', () => {
  it('normaliza emails y rechaza lo que no es uno', () => {
    expect(normalizeEmail('  Ana@Acme.COM ')).toBe('ana@acme.com');
    for (const bad of ['', 'ana', 'ana@', '@acme.com', 'a b@acme.com', 'ana@acme', '<x>@acme.com', 12, null]) expect(normalizeEmail(bad)).toBeNull();
  });

  it('limpia la lista: emails, dominios, comas y entradas malas', () => {
    const { entries, invalid } = cleanAccessList(['ana@acme.com, ACME.com\n*.other.io;@third.org', 'not valid@', 'x']);
    expect(entries).toEqual(['ana@acme.com', 'acme.com', 'other.io', 'third.org']);
    expect(invalid).toEqual(['not', 'valid@', 'x']);
  });

  it('un dominio vale para sus subdominios pero no para un parecido', () => {
    expect(matchesAccessList(['acme.com'], 'ana@acme.com')).toBe(true);
    expect(matchesAccessList(['acme.com'], 'ana@eu.acme.com')).toBe(true);
    expect(matchesAccessList(['acme.com'], 'ana@notacme.com')).toBe(false);
    expect(matchesAccessList(['acme.com'], 'ana@acme.com.evil.io')).toBe(false);
    expect(matchesAccessList(['ana@acme.com'], 'bruno@acme.com')).toBe(false);
  });

  it('permitir y bloquear', () => {
    expect(accessAllowed('none', [], null)).toBe(true);
    expect(accessAllowed('allow', ['acme.com'], 'a@acme.com')).toBe(true);
    expect(accessAllowed('allow', ['acme.com'], 'a@x.com')).toBe(false);
    expect(accessAllowed('allow', ['acme.com'], null)).toBe(false);
    expect(accessAllowed('block', ['acme.com'], 'a@acme.com')).toBe(false);
    expect(accessAllowed('block', ['acme.com'], 'a@x.com')).toBe(true);
  });
});

describe('Send: pasos del link', () => {
  it('sin reglas no hay pasos', () => {
    expect(nextGate(open, null)).toBeNull();
    expect(linkNeedsEmail(open)).toBe(false);
  });

  it('el código de acceso va primero: sin él nadie prueba emails', () => {
    const l = { ...open, passcode_hash: 'x', require_email: 1 };
    expect(nextGate(l, null)).toBe('passcode');
    expect(nextGate(l, { ...fresh, passcode_ok: 1 })).toBe('email');
    expect(nextGate(l, { ...fresh, passcode_ok: 1, email: 'a@b.co' })).toBeNull();
  });

  it('watermark, acuerdo y listas piden email aunque el link no lo marque', () => {
    expect(linkNeedsEmail({ ...open, watermark: 1 })).toBe(true);
    expect(linkNeedsEmail({ ...open, nda_template_id: 't' })).toBe(true);
    expect(linkNeedsEmail({ ...open, access_mode: 'block' })).toBe(true);
    expect(nextGate({ ...open, watermark: 1 }, fresh)).toBe('email');
  });

  it('una lista de permitidos exige verificar: alcanzaría con escribir un email de la lista', () => {
    const l = { ...open, access_mode: 'allow', access_list: '["acme.com"]' };
    expect(linkNeedsVerify(l)).toBe(true);
    const typed = { ...fresh, email: 'a@acme.com' };
    expect(nextGate(l, typed)).toBe('verify');
    expect(nextGate(l, { ...typed, email_verified: 1 })).toBeNull();
    expect(nextGate(l, { ...fresh, email: 'a@x.com', email_verified: 1 })).toBe('denied');
  });

  it('una lista de bloqueados no obliga a verificar, y niega por email escrito', () => {
    const l = { ...open, access_mode: 'block', access_list: '["acme.com"]' };
    expect(linkNeedsVerify(l)).toBe(false);
    expect(nextGate(l, { ...fresh, email: 'a@acme.com' })).toBe('denied');
    expect(nextGate(l, { ...fresh, email: 'a@x.com' })).toBeNull();
  });

  it('el acuerdo va al final y solo pasa firmado', () => {
    const l = { ...open, nda_template_id: 't', verify_email: 1 };
    const v = { ...fresh, email: 'a@b.co', email_verified: 1 };
    expect(nextGate(l, { ...fresh, email: 'a@b.co' })).toBe('verify');
    expect(nextGate(l, v)).toBe('nda');
    expect(nextGate(l, { ...v, nda_signed_at: '2026-01-01' })).toBeNull();
  });

  it('un acuerdo exige un email verificado: nunca se firma a nombre de un email escrito', () => {
    const l = { ...open, nda_template_id: 't' };
    expect(linkNeedsVerify(l)).toBe(true);
    expect(nextGate(l, { ...fresh, email: 'ceo@bigco.com' })).toBe('verify');
    expect(nextGate(l, { ...fresh, email: 'ceo@bigco.com', email_verified: 1 })).toBe('nda');
  });

  it('con acceso por persona, el espacio está cerrado para quien no figura, y hace falta verificar', () => {
    const l = { ...open, space_emails: ['ana@acme.com'] };
    expect(linkNeedsEmail(l)).toBe(true);
    expect(linkNeedsVerify(l)).toBe(true);
    expect(nextGate(l, null)).toBe('email');
    expect(nextGate(l, { ...fresh, email: 'ana@acme.com' })).toBe('verify');
    expect(nextGate(l, { ...fresh, email: 'ana@acme.com', email_verified: 1 })).toBeNull();
    expect(nextGate(l, { ...fresh, email: 'otro@acme.com', email_verified: 1 })).toBe('denied');
    // Sin lista no cambia nada.
    expect(nextGate(open, null)).toBeNull();
  });

  it('deshabilitado y vencido cortan; deshabilitado manda', () => {
    const now = new Date('2026-11-02T12:00:00Z');
    expect(linkState({ disabled_at: null, expires_at: null }, now)).toBe('active');
    expect(linkState({ disabled_at: null, expires_at: '2026-11-02T12:00:00Z' }, now)).toBe('expired');
    expect(linkState({ disabled_at: null, expires_at: '2026-11-02T12:00:01Z' }, now)).toBe('active');
    expect(linkState({ disabled_at: '2026-11-01', expires_at: '2026-01-01' }, now)).toBe('disabled');
  });
});

describe('Send: tiempo', () => {
  it('no acepta más segundos que los que pasaron, y nada de negativos ni NaN', () => {
    const at = (elapsedSec: number, usedSec = 0, baseSec = 0) => ({ elapsedSec, usedSec, baseSec });
    expect(acceptedSeconds(5, at(5))).toBe(5);
    expect(acceptedSeconds(3600, at(5))).toBe(6.5);
    expect(acceptedSeconds(3600, at(100000))).toBe(120);
    expect(acceptedSeconds(-1, at(10))).toBe(0);
    expect(acceptedSeconds(Number.NaN, at(10))).toBe(0);
    expect(acceptedSeconds(9, at(-100))).toBe(1.5);
  });

  it('muchos avisos no suman tiempo: el margen es uno solo, no uno por aviso', () => {
    let used = 0;
    for (let i = 0; i < 40; i++) used += acceptedSeconds(3, { elapsedSec: 0.15, usedSec: used, baseSec: 2 });
    expect(used).toBeLessThanOrEqual(3.65);
  });

  it('el primer aviso no vale más que el tiempo desde que abrió la sesión', () => {
    expect(firstClaim(3.5, 3.6)).toBe(3.5);
    expect(firstClaim(100, 0)).toBe(1.5);
    expect(firstClaim(100, 1000)).toBe(15);
    expect(firstClaim(-1, 10)).toBe(0);
  });

  it('reparte sin pasarse y descarta páginas inválidas', () => {
    expect(scaleDeltas([{ page: 1, seconds: 2 }, { page: 2, seconds: 2 }], 10)).toEqual([{ page: 1, seconds: 2 }, { page: 2, seconds: 2 }]);
    expect(scaleDeltas([{ page: 1, seconds: 30 }, { page: 2, seconds: 10 }], 8)).toEqual([{ page: 1, seconds: 6 }, { page: 2, seconds: 2 }]);
    expect(scaleDeltas([{ page: 0, seconds: 5 }, { page: 1.5, seconds: 5 }, { page: 2, seconds: -1 }], 8)).toEqual([]);
  });

  it('completado y tramos de video', () => {
    expect(completionPct(1, 4)).toBe(25);
    expect(completionPct(9, 4)).toBe(100);
    expect(completionPct(0, 0)).toBe(0);
    expect(videoBuckets(95)).toEqual({ bucketSec: 10, pages: 10 });
    expect(videoBuckets(3600)).toEqual({ bucketSec: 30, pages: 120 });
    expect(videoBuckets(0.4).pages).toBe(1);
  });
});

describe('Send: reenvíos', () => {
  it('con destinatario, otro email es un posible reenvío', () => {
    expect(isForwarded('ana@acme.com', 'ana@acme.com')).toBe(false);
    expect(isForwarded('Ana@Acme.com', 'ana@acme.com')).toBe(false);
    expect(isForwarded('ana@acme.com', 'bruno@acme.com')).toBe(true);
    expect(isForwarded('ana@acme.com', null)).toBe(false);
  });
  it('sin destinatario nada es un reenvío: en una campaña, muchos emails es lo esperado', () => {
    expect(isForwarded(null, 'ana@acme.com')).toBe(false);
    expect(isForwarded(null, null)).toBe(false);
  });
});

describe('Send: archivos', () => {
  const bytes = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));

  it('el tipo sale de los bytes, no del nombre', () => {
    expect(sniffKind(bytes('%PDF-1.7 hello'), 'x.pdf', 'application/pdf')).toBe('pdf');
    expect(sniffKind(bytes('PK\x03\x04'), 'x.docx', '')).toBe('word');
    expect(sniffKind(bytes('PK\x03\x04'), 'x.pptx', '')).toBe('slides');
    expect(sniffKind(bytes('PK\x03\x04'), 'x.zip', '')).toBeNull();
    expect(sniffKind(bytes('<html><script>'), 'x.pdf', 'application/pdf')).toBeNull();
    expect(sniffKind(bytes('\0\0\0\x18ftypmp42'), 'v.mp4', 'video/mp4')).toBe('video');
    expect(sniffKind(bytes('\0\0\0\x18ftypmp42'), 'v.exe', 'application/x-msdownload')).toBeNull();
    expect(sniffKind(bytes('\x1aE\xdf\xa3'), 'v.webm', 'video/webm')).toBe('video');
  });

  it('el tipo del video se elige por sus bytes', () => {
    expect(videoMime(bytes('\x1aE\xdf\xa3aaaaaaaaaaaa'))).toBe('video/webm');
    expect(videoMime(bytes('\0\0\0\x18ftypqt  '))).toBe('video/quicktime');
    expect(videoMime(bytes('\0\0\0\x18ftypisom'))).toBe('video/mp4');
  });

  it('marca: colores y URLs seguros', () => {
    expect(safeBrandColor('#0B7285')).toBe('#0B7285');
    expect(safeBrandColor('red;background:url(x)')).toBe('');
    expect(safeHttpUrl('https://acme.com/a')).toBe('https://acme.com/a');
    expect(safeHttpUrl('javascript:alert(1)')).toBe('');
    expect(safeHttpUrl('data:text/html,x')).toBe('');
  });

  it('el XML de un Office se lee, con entidades y sin ejecutar nada', () => {
    const root = parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><a:p x="1 &amp; 2"><a:t>uno &lt;dos&gt; &#231;</a:t><a:t/></a:p>');
    const p = kid(root, 'a:p');
    expect(p?.attrs.x).toBe('1 & 2');
    expect(kids(p, 'a:t')[0].text).toBe('uno <dos> ç');
    expect(kids(p, 'a:t')).toHaveLength(2);
  });
});

describe('Send: clientes y archivos con trampa', () => {
  it('reconoce herramientas, no navegadores', () => {
    for (const ua of ['curl/8.4.0', 'python-requests/2.31', 'Go-http-client/2.0', 'axios/1.6', 'node-fetch/1.0', 'Wget/1.21', 'okhttp/4.12']) expect(isScriptedUserAgent(ua), ua).toBe(true);
    expect(isScriptedUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36')).toBe(false);
    expect(isScriptedUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });

  it('el tamaño de una imagen sale de su cabecera; otra cosa con nombre de imagen no', () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(8000, 16);
    png.writeUInt32BE(9000, 20);
    expect(imageSize(png)).toEqual({ width: 8000, height: 9000 });
    expect(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><image href="file:///etc/passwd"/></svg>'))).toBeNull();
  });

  const ns = 'xmlns:a="a" xmlns:r="r" xmlns:p="p"';
  const rel = (items: Array<[string, string, string]>) => `<Relationships>${items.map(([id, type, t]) => `<Relationship Id="${id}" Type="x/${type}" Target="${t}"/>`).join('')}</Relationships>`;
  const deck = (slides: string[], size = 'cx="12192000" cy="6858000"') =>
    buildZip([
      { name: 'ppt/presentation.xml', data: `<p:presentation ${ns}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz ${size}/></p:presentation>` },
      { name: 'ppt/_rels/presentation.xml.rels', data: rel(slides.map((_, i) => [`rId${i + 1}`, 'slide', `slides/slide${i + 1}.xml`])) },
      ...slides.map((d, i) => ({ name: `ppt/slides/slide${i + 1}.xml`, data: d })),
    ]);
  const slide = '<p:sld><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>';

  it('una diapositiva gigante se abre con tamaño acotado', async () => {
    const pages: Array<{ width: number; height: number }> = [];
    await pptxToImages(deck([slide], 'cx="914400" cy="13716000"'), { onPage: async (p) => void pages.push(p) });
    expect(pages[0].height).toBeLessThanOrEqual(2400);
    expect(pages[0].width).toBeLessThanOrEqual(1600);
  });

  it('un tamaño absurdo o negativo se rechaza sin dibujar', async () => {
    await expect(pptxToImages(deck([slide], 'cx="12192000" cy="-5"'))).rejects.toMatchObject({ code: 'office_invalid' });
    await expect(pptxToImages(deck([slide], 'cx="1" cy="2000000000"'))).rejects.toMatchObject({ code: 'office_invalid' });
  });

  it('una parte enorme que se comprime a casi nada no se abre', async () => {
    const start = Date.now();
    const bomb = buildZip([
      { name: 'ppt/presentation.xml', data: `<p:presentation ${ns}><p:sldIdLst><p:sldId id="1" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9" cy="9"/></p:presentation>` },
      { name: 'ppt/_rels/presentation.xml.rels', data: rel([['rId1', 'slide', 'slides/slide1.xml']]) },
      { name: 'ppt/slides/slide1.xml', data: ' '.repeat(40 * 1024 * 1024), deflate: true },
    ]);
    await expect(pptxToImages(bomb)).rejects.toMatchObject({ code: 'office_too_complex' });
    expect(Date.now() - start).toBeLessThan(5000);
    const word = buildZip([{ name: 'word/document.xml', data: ' '.repeat(40 * 1024 * 1024), deflate: true }]);
    await expect(assertOfficeSize(word)).rejects.toMatchObject({ code: 'office_too_complex' });
  });

  it('más de 500 diapositivas se rechaza antes de dibujar', async () => {
    let drawn = 0;
    await expect(pptxToImages(deck(Array.from({ length: 501 }, () => slide)), { onPage: async () => void drawn++ })).rejects.toMatchObject({ code: 'too_many_pages' });
    expect(drawn).toBe(0);
  });

  it('el tope de tiempo frena entre diapositivas y sigue donde quedó', async () => {
    const seen: number[] = [];
    const total = await pptxToImages(deck([slide, slide, slide]), { skip: 1, deadline: Date.now() + 60_000, onPage: async (p) => void seen.push(p.page) });
    expect(total).toBe(3);
    expect(seen).toEqual([2, 3]);
    const none: number[] = [];
    await pptxToImages(deck([slide, slide]), { deadline: Date.now() - 1, onPage: async (p) => void none.push(p.page) });
    expect(none).toEqual([]);
  });
});

describe('Send: render en un hilo aparte', () => {
  const heavy = () => {
    const ops = '0 g\n'.repeat(1_600_000);
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
      `<< /Length ${ops.length} >>\nstream\n${ops}endstream`,
    ];
    return Buffer.from(`%PDF-1.7\n${objs.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('')}trailer << /Root 1 0 R /Size 5 >>\n%%EOF`, 'latin1');
  };

  it('dibuja las páginas y sigue desde donde quedó', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 60, y: 700 });
    const bytes = Buffer.from(await doc.save());
    const seen: Array<{ page: number; width: number }> = [];
    let total = 0;
    await renderPdfPages(bytes, { from: 2, deadline: Date.now() + 60_000, onInfo: async (n) => void (total = n), onPage: async (p) => void seen.push({ page: p.page, width: p.width }) });
    expect(total).toBe(3);
    expect(seen).toEqual([{ page: 2, width: 1600 }, { page: 3, width: 1600 }]);
  }, 60_000);

  it('una página con demasiadas operaciones se corta con su motivo, sin tumbar el proceso', async () => {
    await expect(renderPdfPages(heavy(), { from: 1, deadline: Date.now() + 60_000, onInfo: async () => undefined, onPage: async () => undefined })).rejects.toMatchObject({ code: expect.stringMatching(/page_too_complex|render_stalled/) });
  }, 60_000);

  it('un archivo roto da su motivo', async () => {
    await expect(renderPdfPages(Buffer.from('%PDF-1.7 nada'), { from: 1, deadline: Date.now() + 30_000, onInfo: async () => undefined, onPage: async () => undefined })).rejects.toMatchObject({ code: 'pdf_invalid' });
  }, 30_000);
});

describe('Send: MCP', () => {
  it('las rutas públicas y las partes de subida quedan fuera del alcance de un token', () => {
    for (const path of ['/api/send/public/[token]', '/api/send/public/[token]/ping', '/api/send/public/[token]/code', '/api/send/public/[token]/nda', '/api/send/public/[token]/pages/[version]/[page]', '/api/send/public/[token]/video/[version]', '/api/send/public/[token]/download']) {
      expect(excludeReason(path, 'GET') ?? excludeReason(path, 'POST'), path).toBeTruthy();
    }
    expect(excludeReason('/api/send/versions/[id]/parts/[n]', 'PUT')).toBeTruthy();
    expect(excludeReason('/api/send/versions/[id]/complete', 'POST')).toBeTruthy();
    // El render pide el lienzo nativo, que no viaja con la función del MCP.
    expect(excludeReason('/api/send/versions/[id]/process', 'POST')).toBeTruthy();
  });

  it('crear un link o aflojarlo se hace desde la web: sobrevive a la conexión', () => {
    expect(webOnlyWhere('/api/send/documents/[id]/links', 'POST')).toBeTruthy();
    expect(webOnlyWhere('/api/send/spaces/[id]/links', 'POST')).toBeTruthy();
    expect(webOnlyWhere('/api/send/links/[id]', 'PATCH')).toBeTruthy();
    // Lo que cambia qué muestra un link vivo, o a quién.
    expect(webOnlyWhere('/api/send/spaces/[id]', 'PATCH')).toBeTruthy();
    expect(webOnlyWhere('/api/send/spaces/[id]/access', 'PUT')).toBeTruthy();
    expect(webOnlyWhere('/api/send/spaces/[id]/access', 'DELETE')).toBeTruthy();
    expect(webOnlyWhere('/api/send/documents/[id]/versions', 'POST')).toBeTruthy();
    expect(webOnlyWhere('/api/send/settings', 'PUT')).toBeTruthy();
    // Leer y borrar sí: borrar corta el acceso, no lo abre.
    expect(webOnlyWhere('/api/send/documents/[id]/links', 'GET')).toBeNull();
    expect(webOnlyWhere('/api/send/links/[id]', 'DELETE')).toBeNull();
  });

  it('la URL de un link no llega a un modelo', () => {
    const token = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL';
    expect(scrubText(`mirá /send/${token} y /en/send/${token}`)).not.toContain(token);
    expect(scrubText(`/api/send/public/${token}/ping`)).not.toContain(token);
  });
});
