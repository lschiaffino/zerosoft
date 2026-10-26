import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { compileRoutes, createDispatcher, matchRoute, type RouteModule } from '@/lib/routes/dispatch';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const req = (method = 'GET') => new Request('http://x.test/api/demo', { method }) as unknown as NextRequest;
const ctx = (path: string[], parent: Record<string, string> = {}) => ({
  params: Promise.resolve({ ...parent, zsPath: path }),
});

function echo(name: string): RouteModule {
  const reply = async (_req: NextRequest, { params }: { params: Promise<Record<string, unknown>> }) =>
    Response.json({ name, params: await params });
  return { GET: reply, POST: reply };
}

describe('dispatcher de rutas consolidadas', () => {
  const routes = compileRoutes([
    { pattern: 'items/[id]', mod: echo('item') },
    { pattern: 'items/new', mod: echo('new') },
    { pattern: 'items/[id]/comments/[cid]', mod: echo('comment') },
    { pattern: '[kind]/stats', mod: echo('kind-stats') },
    { pattern: 'items/[id]/[[...rest]]', mod: echo('optional') },
    { pattern: 'files/[...path]', mod: echo('files') },
  ]);

  it('elige como Next: estático antes que dinámico, dinámico antes que catch-all', () => {
    expect(matchRoute(routes, ['items', 'new'])?.route.pattern).toBe('items/new');
    expect(matchRoute(routes, ['items', 'abc'])?.route.pattern).toBe('items/[id]');
    expect(matchRoute(routes, ['items', 'stats'])?.route.pattern).toBe('items/[id]');
    expect(matchRoute(routes, ['other', 'stats'])?.route.pattern).toBe('[kind]/stats');
    expect(matchRoute(routes, ['items', 'a', 'x', 'y'])?.route.pattern).toBe('items/[id]/[[...rest]]');
    expect(matchRoute(routes, ['items', 'a', 'comments', 'c1'])?.route.pattern).toBe('items/[id]/comments/[cid]');
    expect(matchRoute(routes, ['files'])).toBeNull();
    expect(matchRoute(routes, ['files', 'a', 'b'])?.params).toEqual({ path: ['a', 'b'] });
    expect(matchRoute(routes, ['nope'])).toBeNull();
  });

  it('rechaza patrones duplicados', () => {
    expect(() => compileRoutes([{ pattern: 'a/[id]', mod: {} }, { pattern: 'a/[x]', mod: {} }])).toThrow();
  });

  it('pasa los params con sus nombres y suma los del segmento padre', async () => {
    const d = createDispatcher('zsPath', [{ pattern: 'comments/[cid]', mod: echo('c') }]);
    const res = await d.GET(req(), ctx(['comments', 'c 1'], { id: 'p1' }));
    expect(await res.json()).toEqual({ name: 'c', params: { id: 'p1', cid: 'c 1' } });
  });

  it('404 si no hay ruta, 405 si el método no está, HEAD usa GET y OPTIONS arma Allow', async () => {
    const d = createDispatcher('zsPath', [
      { pattern: 'only-post', mod: { POST: async () => new Response('ok') } },
      { pattern: 'items/[id]', mod: echo('item') },
    ]);
    expect((await d.GET(req(), ctx(['missing']))).status).toBe(404);
    expect((await d.GET(req(), ctx(['only-post']))).status).toBe(405);
    expect((await d.POST(req('POST'), ctx(['only-post']))).status).toBe(200);
    expect((await d.HEAD(req('HEAD'), ctx(['items', '1']))).status).toBe(200);
    expect((await d.HEAD(req('HEAD'), ctx(['only-post']))).status).toBe(405);
    const opts = await d.OPTIONS(req('OPTIONS'), ctx(['items', '1']));
    expect(opts.status).toBe(204);
    expect(opts.headers.get('Allow')).toBe('GET, HEAD, OPTIONS, POST');
    expect((await d.OPTIONS(req('OPTIONS'), ctx(['only-post']))).headers.get('Allow')).toBe('OPTIONS, POST');
  });
});

describe('catch-alls generados', () => {
  const catchAlls = walk(join(ROOT, 'app/api')).filter((f) => f.endsWith('/[...zsPath]/route.ts'));

  it('cada catch-all lista exactamente los handlers movidos a lib/routes', () => {
    expect(catchAlls.length).toBeGreaterThan(0);
    for (const file of catchAlls) {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('// Generado por scripts/consolidate-routes.mjs');
      const base = relative(join(ROOT, 'app/api'), join(file, '../..'));
      const listed = [...src.matchAll(/pattern: '([^']+)', mod: \w+ \}, \/\/ (\S+)/g)].map((m) => {
        expect(m[2]).toBe(`lib/routes/${base}/${m[1]}`);
        return m[2];
      });
      const onDisk = walk(join(ROOT, 'lib/routes', base))
        .filter((f) => /\/route\.tsx?$/.test(f))
        .map((f) => relative(ROOT, f).replace(/\/route\.tsx?$/, ''))
        // Las de un catch-all más profundo (otra base) no son de este.
        .filter((f) => !catchAlls.some((c) => c !== file && f.startsWith(`lib/routes/${relative(join(ROOT, 'app/api'), join(c, '../..'))}/`)));
      expect(new Set(listed)).toEqual(new Set(onDisk));
    }
  });
});

/**
 * Presupuesto de rutas de Vercel (máximo 2048 en .vercel/output/config.json).
 * Con Next 15 + middleware, @vercel/next escribe 3 rutas por cada ruta dinámica
 * (la normal, la `.rsc` y la de `/_next/data/<build>/….json`) más ~95 fijas
 * (redirects, headers y las de sistema). Ver docs/routes-budget.md.
 */
describe('presupuesto de rutas de Vercel', () => {
  it('queda margen debajo del límite de 2048', () => {
    const dynamic = walk(join(ROOT, 'app')).filter((f) => {
      const r = relative(ROOT, f);
      return (
        r.includes('[') &&
        (/\/(page\.tsx|route\.tsx?)$/.test(r) || /\/(opengraph-image|twitter-image|icon|apple-icon|sitemap)[^/]*\.(tsx?|js)$/.test(r))
      );
    });
    const estimate = 95 + 3 * dynamic.length;
    // Si esto falla: `node scripts/consolidate-routes.mjs app/api/<familia>` (docs/routes-budget.md).
    expect(estimate, `rutas estimadas en Vercel: ${estimate} (${dynamic.length} dinámicas)`).toBeLessThanOrEqual(1700);
  });
});
