/**
 * Dispatcher de rutas API consolidadas.
 *
 * Vercel limita a 2048 las rutas del deploy (`.vercel/output/config.json`) y
 * cada route handler con segmentos dinámicos suma entradas propias. Para no
 * pasarnos, las rutas dinámicas de una familia (p. ej. `app/api/crm/**`) se
 * mueven tal cual a `lib/routes/<familia>/**` y un único catch-all
 * (`app/api/<familia>/[...zsPath]/route.ts`, generado por
 * `scripts/consolidate-routes.mjs`) las despacha.
 *
 * Mantiene la semántica de Next para route handlers:
 * - precedencia: segmento estático > dinámico > catch-all > catch-all opcional,
 *   comparando segmento a segmento (igual que el orden de `getSortedRoutes`);
 * - `params` con los mismos nombres y valores (ya decodificados por Next);
 * - método no exportado: 405; HEAD usa GET; OPTIONS automático con `Allow`.
 * Las rutas estáticas de la familia y las que tienen config propia
 * (`maxDuration`, `force-static`, etc.) siguen como archivos en `app/api`, y
 * Next las elige antes que el catch-all.
 */
import type { NextRequest } from 'next/server';

export type RouteParams = Record<string, string | string[]>;
export type RouteContext = { params: Promise<RouteParams> };

// Bivariante a propósito: cada handler declara sus params concretos
// (`{ params: Promise<{ id: string }> }`) y el dispatcher les pasa exactamente
// esos nombres. Puede devolver undefined como en Next (que lo trata como error).
type HandlerResult = Response | undefined | void;
type Handler = {
  bivarianceHack(req: NextRequest, ctx: RouteContext): HandlerResult | Promise<HandlerResult>;
}['bivarianceHack'];

export const ROUTE_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];
export type RouteModule = { [M in RouteMethod]?: Handler };
export type RouteEntry = { pattern: string; mod: RouteModule };

type Segment =
  | { kind: 0; value: string } // estático
  | { kind: 1; name: string } // [id]
  | { kind: 2; name: string } // [...rest]
  | { kind: 3; name: string }; // [[...rest]]

type Compiled = { pattern: string; segments: Segment[]; rank: number[]; mod: RouteModule };

function parseSegment(raw: string): Segment {
  let m = /^\[\[\.\.\.([^\]]+)\]\]$/.exec(raw);
  if (m) return { kind: 3, name: m[1] };
  m = /^\[\.\.\.([^\]]+)\]$/.exec(raw);
  if (m) return { kind: 2, name: m[1] };
  m = /^\[([^\]]+)\]$/.exec(raw);
  if (m) return { kind: 1, name: m[1] };
  return { kind: 0, value: raw };
}

export function compileRoutes(entries: RouteEntry[]): Compiled[] {
  const seen = new Set<string>();
  return entries.map(({ pattern, mod }) => {
    const segments = pattern.split('/').filter(Boolean).map(parseSegment);
    const shape = segments.map((s) => (s.kind === 0 ? s.value : `[${s.kind}]`)).join('/');
    if (seen.has(shape)) throw new Error(`consolidated routes: patrón duplicado ${pattern}`);
    seen.add(shape);
    segments.forEach((s, i) => {
      if (s.kind >= 2 && i !== segments.length - 1) {
        throw new Error(`consolidated routes: catch-all que no es el último segmento en ${pattern}`);
      }
    });
    return { pattern, segments, rank: segments.map((s) => s.kind), mod };
  });
}

function matchOne(route: Compiled, path: string[]): RouteParams | null {
  const params: RouteParams = {};
  const { segments } = route;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === 2 || seg.kind === 3) {
      const rest = path.slice(i);
      if (seg.kind === 2 && rest.length === 0) return null;
      if (rest.length > 0) params[seg.name] = rest;
      return params;
    }
    if (i >= path.length) return null;
    if (seg.kind === 0) {
      if (seg.value !== path[i]) return null;
    } else {
      params[seg.name] = path[i];
    }
  }
  return path.length === segments.length ? params : null;
}

function compareRank(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Ruta que Next elegiría para `path` (segmentos relativos a la base del catch-all). */
export function matchRoute(routes: Compiled[], path: string[]) {
  let best: { route: Compiled; params: RouteParams } | null = null;
  for (const route of routes) {
    const params = matchOne(route, path);
    if (params && (!best || compareRank(route.rank, best.route.rank) < 0)) best = { route, params };
  }
  return best;
}

const notFound = () => new Response(null, { status: 404 });
const methodNotAllowed = () => new Response(null, { status: 405 });

/** Igual que `autoImplementMethods` de Next: HEAD cae en GET y OPTIONS responde 204 con `Allow`. */
function handlerFor(mod: RouteModule, method: RouteMethod): Handler | null {
  const own = mod[method];
  if (own) return own;
  if (method === 'HEAD' && mod.GET) return mod.GET;
  if (method === 'OPTIONS') {
    const implemented = new Set<string>(ROUTE_METHODS.filter((m) => mod[m]));
    if (mod.GET) implemented.add('HEAD');
    implemented.add('OPTIONS');
    const allow = [...implemented].sort().join(', ');
    return () => new Response(null, { status: 204, headers: { Allow: allow } });
  }
  return null;
}

/**
 * Arma los handlers del catch-all. `param` es el nombre del catch-all
 * (`zsPath`); los params de segmentos padre (si la base es dinámica) pasan tal cual.
 */
export function createDispatcher(param: string, entries: RouteEntry[]) {
  const routes = compileRoutes(entries);
  const make =
    (method: RouteMethod) =>
    async (req: NextRequest, ctx: RouteContext): Promise<Response> => {
      const { [param]: rest, ...parent } = await ctx.params;
      const path = rest === undefined ? [] : Array.isArray(rest) ? rest : [rest];
      const hit = matchRoute(routes, path);
      if (!hit) return notFound();
      const handler = handlerFor(hit.route.mod, method);
      if (!handler) return methodNotAllowed();
      // Si el handler no devuelve nada, Next responde el mismo error que antes.
      return (await handler(req, { params: Promise.resolve({ ...parent, ...hit.params }) })) as Response;
    };
  return {
    GET: make('GET'),
    HEAD: make('HEAD'),
    OPTIONS: make('OPTIONS'),
    POST: make('POST'),
    PUT: make('PUT'),
    DELETE: make('DELETE'),
    PATCH: make('PATCH'),
  };
}
