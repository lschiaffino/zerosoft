import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCLUDED, getOperation, OPERATIONS } from '@/lib/mcp/catalog';
import { ROUTE_TABLE } from '@/lib/mcp/route-table.generated';
import { DIRECT_TOOLS } from '@/lib/mcp/server';
import { excludeReason, NO_SESSION_OK } from '@/lib/mcp/excludes.mjs';
import { PRODUCT_KEYS } from '@/lib/products';

const ROOT = process.cwd();
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'route.ts' || e.name === 'route.tsx') out.push(p);
  }
  return out;
}

function urlOf(file: string): string {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel.startsWith('app/api/')) return rel.replace(/^app/, '').replace(/\/route\.tsx?$/, '');
  return rel.replace(/^lib\/routes/, '/api').replace(/\/route\.tsx?$/, '');
}

/** Métodos exportados, leídos del texto: no depende del generador que se está probando. */
function exportedMethods(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) found.add(m[1]);
  // export { GET, POST } from …, y export const { GET, POST } = fabrica(…).
  for (const m of text.matchAll(/export\s*(?:const\s*)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && METHODS.includes(name)) found.add(name);
    }
  }
  return [...found];
}

const routes = [...walk(path.join(ROOT, 'app/api')), ...walk(path.join(ROOT, 'lib/routes'))].flatMap((file) => {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('Generado por scripts/consolidate-routes.mjs')) return [];
  return exportedMethods(text).map((method) => ({ path: urlOf(file), method }));
});

const inCatalog = new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`));
const inExcluded = new Set(EXCLUDED.map((e) => `${e.method} ${e.path}`));

describe('cobertura del catálogo', () => {
  it('enumera las rutas de verdad', () => {
    expect(routes.length).toBeGreaterThan(1500);
  });

  it('toda ruta está en el catálogo o excluida con razón', () => {
    const missing = routes.map((r) => `${r.method} ${r.path}`).filter((k) => !inCatalog.has(k) && !inExcluded.has(k));
    expect(missing, `Regenerá con node scripts/mcp-catalog.mjs: ${missing.slice(0, 20).join(', ')}`).toEqual([]);
  });

  it('nada del catálogo apunta a una ruta que ya no existe', () => {
    const real = new Set(routes.map((r) => `${r.method} ${r.path}`));
    expect(OPERATIONS.filter((o) => !real.has(`${o.method} ${o.path}`)).map((o) => o.id)).toEqual([]);
  });

  it('cada exclusión tiene una razón, y las reglas se siguen cumpliendo', () => {
    for (const e of EXCLUDED) {
      expect(e.reason.length, e.path).toBeGreaterThan(10);
      expect(excludeReason(e.path, e.method), e.path).toBeTruthy();
    }
    for (const o of OPERATIONS) expect(excludeReason(o.path, o.method), o.path).toBeNull();
  });

  it('las 24 apps tienen operaciones', () => {
    const apps = new Set(OPERATIONS.map((o) => o.app));
    for (const k of PRODUCT_KEYS) expect(apps.has(k), k).toBe(true);
  });

  it('los ids son únicos y cada operación tiene su handler en la tabla', () => {
    expect(new Set(OPERATIONS.map((o) => o.id)).size).toBe(OPERATIONS.length);
    for (const o of OPERATIONS) expect(ROUTE_TABLE[o.path], o.path).toBeTypeOf('function');
  });

  it('una operación sin sesión detectada está revisada a mano', () => {
    const unknown = OPERATIONS.filter((o) => !o.session && !NO_SESSION_OK.has(`${o.method} ${o.path}`)).map((o) => `${o.method} ${o.path}`);
    expect(unknown).toEqual([]);
  });

  it('los atajos apuntan a operaciones que existen', () => {
    for (const t of DIRECT_TOOLS) expect(getOperation(t.op), t.name).not.toBeNull();
  });
});

describe('lo que nunca entra', () => {
  const forbidden = [
    /^\/api\/auth/, /^\/api\/keys/, /^\/api\/oauth/, /^\/api\/cron/, /^\/api\/ingest/, /^\/api\/mcp/, /^\/api\/v1\/[^/]+\/mcp$/,
    /\/(books|shop)\/webhooks\//, /stripe-webhook/, /^\/api\/groups\/webhook\//, /^\/api\/roadmap\/ingest$/, /^\/api\/desktop\/(login|token)$/, /\/public\//, /\/transfer$/, /^\/api\/teams\/switch$/,
    /^\/api\/gate$/,
  ];
  it.each(forbidden.map((r) => [r.source, r] as const))('%s', (_name, re) => {
    expect(OPERATIONS.filter((o) => re.test(o.path)).map((o) => o.path)).toEqual([]);
  });

  it('crear un workspace, no: la propiedad queda en la app', () => {
    expect(inCatalog.has('POST /api/teams')).toBe(false);
  });
});

describe('clase de cada operación', () => {
  it('todo DELETE es destructivo', () => {
    expect(OPERATIONS.filter((o) => o.method === 'DELETE' && o.access !== 'destructive').map((o) => o.id)).toEqual([]);
  });

  it('solo lee lo que es GET o está en la lista revisada', () => {
    const reads = OPERATIONS.filter((o) => o.access === 'read' && o.method !== 'GET').map((o) => `${o.method} ${o.path}`);
    expect(reads.sort()).toEqual(['POST /api/analytics/query', 'POST /api/crm/email-templates/preview']);
  });

  it('lo sensible del equipo está marcado destructivo', () => {
    for (const k of ['POST /api/teams/invites', 'PATCH /api/teams/members/[userId]', 'PATCH /api/teams/workspace', 'POST /api/webhooks']) {
      const op = OPERATIONS.find((o) => `${o.method} ${o.path}` === k);
      expect(op?.access, k).toBe('destructive');
    }
  });
});
