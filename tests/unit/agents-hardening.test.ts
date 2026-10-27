import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pdfToText } from '@/lib/pdf-text';
import { parseSitemap } from '@/lib/agents-knowledge';
import { redactDeep, secretVariants } from '@/lib/agents-secrets';
import { businessContacts, redactJsonText, redactPii } from '@/lib/agents-privacy';
import { isPrivateIp } from '@/lib/safe-fetch';

describe('endurecimiento', () => {
  it('PDF bomba: 300 referencias al mismo stream no se inflan 300 veces', () => {
    const buf = readFileSync(path.join(__dirname, 'fixtures/pdf-bomb-300.pdf'));
    const t0 = Date.now();
    let code = '';
    try {
      pdfToText(buf);
    } catch (err) {
      code = (err as { code?: string }).code ?? '';
    }
    expect(['pdf_too_complex', 'pdf_no_text', '']).toContain(code);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('sitemap patológico de 5 MB se parsea en menos de 1 s', () => {
    const evil = '<urlset>' + '<loc'.repeat(1_250_000);
    const t0 = Date.now();
    parseSitemap(evil);
    parseSitemap('<url>' + '<url><loc>x'.repeat(400_000));
    parseSitemap('<urlset>' + '<loc>'.repeat(1_000_000));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(parseSitemap('<urlset><url><loc> https://a.test/x?a=1&amp;b=2 </loc></url><location>no</location></urlset>').urls).toEqual(['https://a.test/x?a=1&b=2']);
  });

  it('secretos: el valor, lo que sigue al esquema y el usuario/clave de Basic', () => {
    const basic = `Basic ${Buffer.from('apiuser:s3cretpass99').toString('base64')}`;
    const v = [...secretVariants('Bearer tok_ABCDEFGH123'), ...secretVariants(basic)];
    const out = redactDeep(
      { content: 'echo tok_ABCDEFGH123', structured: { auth: { header: 'Bearer tok_ABCDEFGH123' }, list: ['s3cretpass99', 42] }, user: 'apiuser:s3cretpass99' },
      v,
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('tok_ABCDEFGH123');
    expect(json).not.toContain('s3cretpass99');
    expect(out.structured.auth.header).toBe('[redacted]');
    expect(out.structured.list[1]).toBe(42);
  });

  it('PII: JSON válido, números que no son teléfonos y datos del negocio', () => {
    const raw = JSON.stringify({ email: 'ana@acme.com', ts: 1730000000123, lat: -34.603722, note: 'llamame al 11 5555-1234', id: 'ord_1730000000', amount: 1234567.89 });
    const out = JSON.parse(redactJsonText(raw) as string) as Record<string, unknown>;
    expect(out).toMatchObject({ email: '[email]', ts: 1730000000123, lat: -34.603722, note: 'llamame al [phone]', id: 'ord_1730000000', amount: 1234567.89 });
    expect(redactPii('pedido 1730000000 a las 14:30, coordenadas -34.603722, -58.381592')).toBe('pedido 1730000000 a las 14:30, coordenadas -34.603722, -58.381592');
    expect(redactPii('mi whatsapp 1155551234')).toBe('mi whatsapp [phone]');
    const keep = businessContacts(['Escribinos a soporte@acme.com o al +54 11 4000-1000']);
    expect(redactPii('Soporte: soporte@acme.com / +54 11 4000-1000. Mi mail: yo@x.com', keep)).toBe('Soporte: soporte@acme.com / +54 11 4000-1000. Mi mail: [email]');
  });

  it('SSRF: 6to4 y 198.18/15 cuentan como red privada', () => {
    expect(isPrivateIp('2002:7f00:1::1')).toBe(true);
    expect(isPrivateIp('198.18.0.1')).toBe(true);
    expect(isPrivateIp('198.19.255.1')).toBe(true);
    expect(isPrivateIp('198.20.0.1')).toBe(false);
  });
});
