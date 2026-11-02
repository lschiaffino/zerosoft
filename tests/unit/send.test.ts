import { describe, expect, it } from 'vitest';
import {
  acceptedSeconds,
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
import { kid, kids, parseXml } from '@/lib/send/office';
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
    expect(acceptedSeconds(5, 5)).toBe(5);
    expect(acceptedSeconds(3600, 5)).toBe(8);
    expect(acceptedSeconds(3600, 100000)).toBe(120);
    expect(acceptedSeconds(-1, 10)).toBe(0);
    expect(acceptedSeconds(Number.NaN, 10)).toBe(0);
    expect(acceptedSeconds(1, -100)).toBe(1);
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
    expect(isForwarded('ana@acme.com', null, 'ana@acme.com')).toBe(false);
    expect(isForwarded('Ana@Acme.com', null, 'ana@acme.com')).toBe(false);
    expect(isForwarded('ana@acme.com', null, 'bruno@acme.com')).toBe(true);
  });
  it('sin destinatario, compara con el primero que lo abrió', () => {
    expect(isForwarded(null, null, 'ana@acme.com')).toBe(false);
    expect(isForwarded(null, 'ana@acme.com', 'ana@acme.com')).toBe(false);
    expect(isForwarded(null, 'ana@acme.com', 'bruno@acme.com')).toBe(true);
    expect(isForwarded(null, 'ana@acme.com', null)).toBe(false);
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

describe('Send: MCP', () => {
  it('las rutas públicas y las partes de subida quedan fuera del alcance de un token', () => {
    for (const path of ['/api/send/public/[token]', '/api/send/public/[token]/ping', '/api/send/public/[token]/code', '/api/send/public/[token]/nda', '/api/send/public/[token]/pages/[version]/[page]', '/api/send/public/[token]/video/[version]', '/api/send/public/[token]/download']) {
      expect(excludeReason(path, 'GET') ?? excludeReason(path, 'POST'), path).toBeTruthy();
    }
    expect(excludeReason('/api/send/versions/[id]/parts/[n]', 'PUT')).toBeTruthy();
  });

  it('crear un link o aflojarlo se hace desde la web: sobrevive a la conexión', () => {
    expect(webOnlyWhere('/api/send/documents/[id]/links', 'POST')).toBeTruthy();
    expect(webOnlyWhere('/api/send/spaces/[id]/links', 'POST')).toBeTruthy();
    expect(webOnlyWhere('/api/send/links/[id]', 'PATCH')).toBeTruthy();
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
