import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, isValidSlug } from '@/lib/reserved';

/** middleware.ts no se puede importar en node (next-intl/middleware); se lee el Set del fuente. */
function middlewareReserved(): string[] {
  const src = readFileSync(path.join(process.cwd(), 'middleware.ts'), 'utf8');
  const m = /const RESERVED = new Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!m) throw new Error('RESERVED not found in middleware.ts');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

describe('slugs reservados', () => {
  it('middleware.ts y lib/reserved.ts están sincronizados', () => {
    expect(middlewareReserved()).toEqual([...RESERVED_SLUGS].sort());
  });

  it('reserva las rutas públicas de Notes (/n) y Board (/b)', () => {
    expect(RESERVED_SLUGS.has('n')).toBe(true);
    expect(RESERVED_SLUGS.has('b')).toBe(true);
    expect(isValidSlug('notes')).toBe(true);
  });

  it('reserva la página pública de quotes del CRM (/q)', () => {
    expect(RESERVED_SLUGS.has('q')).toBe(true);
    expect(middlewareReserved()).toContain('q');
    expect(isValidSlug('quote')).toBe(true);
  });
});
