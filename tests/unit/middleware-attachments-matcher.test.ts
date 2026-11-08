import { readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

/**
 * Las subidas de adjuntos (lib/file-attachments.ts) no pasan por el
 * middleware: Next clona el cuerpo hasta 10 MB y corta el resto. El resto de
 * las APIs de las apps sí pasan (header del path para el acceso por app).
 */
const require = createRequire(import.meta.url);
const { getMiddlewareMatchers } = require('next/dist/build/analysis/get-page-static-info.js') as {
  getMiddlewareMatchers: (m: unknown, cfg: { i18n?: unknown }) => Array<{ regexp: string }>;
};

const src = readFileSync(path.join(process.cwd(), 'middleware.ts'), 'utf8');
const body = /matcher: \[([\s\S]*?)\],\n\};/.exec(src)![1].replace(/\/\/.*$/gm, '');
const list = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const regexps = getMiddlewareMatchers(list, {}).map((m) => new RegExp(m.regexp));
const runs = (p: string) => regexps.some((r) => r.test(p));

describe('middleware: matcher', () => {
  it('saltea las subidas de adjuntos', () => {
    expect(runs('/api/track/issues/0b7f0a8e-1111-4222-8333-444455556666/attachments/upload')).toBe(false);
    expect(runs('/api/crm/tasks/abc/attachments/upload')).toBe(false);
  });

  it('sigue corriendo en el resto de las APIs de las apps y en las páginas', () => {
    for (const p of [
      '/api/track',
      '/api/track/projects',
      '/api/track/issues/abc/attachments',
      '/api/track/issues/abc/attachments/finalize',
      '/api/track/issues/abc/attachments/0b7f0a8e-1111-4222-8333-444455556666',
      '/api/crm/contacts',
      '/en/app/track',
    ]) {
      expect(runs(p), p).toBe(true);
    }
    expect(runs('/api/auth/session')).toBe(false);
  });
});
