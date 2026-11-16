import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { appCsp, newNonce, rootInlineScripts, rootScriptHashes, sha256Source } from '@/lib/csp';
import { cspReportLines } from '@/lib/csp-report';
import { THEME_INIT_SCRIPT } from '@/lib/color-theme';
import { LOOK_INIT_SCRIPT } from '@/lib/look';
import { SESSION_HINT_SCRIPT } from '@/lib/session-hint';
import { localeCookieScript } from '@/lib/locale-cookie';
import { TZ_COOKIE_SCRIPT } from '@/lib/tz-client';

describe('CSP de la app', () => {
  it('nonce nuevo en cada request, 128 bits', () => {
    const a = newNonce();
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });

  it('los hashes cubren los scripts en línea del layout raíz, tal cual', async () => {
    // Si cambia el layout raíz ([locale]/layout.tsx), esta lista tiene que cambiar con él.
    expect(rootInlineScripts()).toEqual([
      ...['en', 'es', 'pt'].map((l) => THEME_INIT_SCRIPT + LOOK_INIT_SCRIPT + SESSION_HINT_SCRIPT + localeCookieScript(l)),
      TZ_COOKIE_SCRIPT,
    ]);
    const expected = rootInlineScripts().map((s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`);
    expect(await rootScriptHashes()).toEqual(expected);
    expect(await sha256Source('alert(1)')).toBe(`'sha256-${createHash('sha256').update('alert(1)').digest('base64')}'`);
  });

  it('scripts solo con nonce, hash o strict-dynamic; sin eval en producción', () => {
    const p = appCsp('abc', ["'sha256-x'"]);
    const script = p.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).toContain("'sha256-x'");
    expect(script).not.toContain('unsafe-eval');
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'self'");
    expect(p).toContain("frame-ancestors 'self'");
    expect(p).toContain('report-uri /api/csp-report');
    expect(appCsp('abc', [], { dev: true })).toContain("'unsafe-eval'");
  });
});

describe('avisos de CSP al log', () => {
  it('report-uri: directiva, origen bloqueado y path, sin query ni código', () => {
    const body = JSON.stringify({
      'csp-report': {
        'document-uri': 'https://zerosoft.ai/en/app/crm?token=secret#x',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/x.js?c=1',
        'script-sample': 'steal(document.cookie)',
        disposition: 'report',
      },
    });
    const [line] = cspReportLines(body);
    expect(line).toBe('report script-src-elem https://evil.example /en/app/crm');
    expect(line).not.toContain('secret');
  });

  it('Reporting API: lista de avisos; lo que no es CSP se ignora', () => {
    const body = JSON.stringify([
      { type: 'csp-violation', body: { documentURL: 'https://zerosoft.ai/en/app', effectiveDirective: 'script-src-elem', blockedURL: 'inline', disposition: 'enforce' } },
      { type: 'deprecation', body: { id: 'x' } },
    ]);
    expect(cspReportLines(body)).toEqual(['enforce script-src-elem inline /en/app']);
    expect(cspReportLines('no json')).toEqual([]);
    expect(cspReportLines('{}')).toEqual([]);
  });
});
