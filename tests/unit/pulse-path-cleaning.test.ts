import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { pathCleaner, pathPattern } from '@/lib/analytics/compute-more';
import { runPaths } from '@/lib/analytics/query';
import { pathsQuerySchema } from '@/lib/analytics/types';

describe('Pulse: patrones de camino', () => {
  it('sin * es igualdad; con * vale cualquier texto, barras incluidas', () => {
    expect(pathPattern('/pricing')('/pricing')).toBe(true);
    expect(pathPattern('/pricing')('/pricing/x')).toBe(false);
    expect(pathPattern('/blog/*')('/blog/a')).toBe(true);
    expect(pathPattern('/blog/*')('/blog/a/b')).toBe(true);
    expect(pathPattern('/blog/*')('/blog')).toBe(false);
    expect(pathPattern('/a/*/edit')('/a/12/edit')).toBe(true);
    // Los caracteres de regex se toman literales.
    expect(pathPattern('/a.b/*')('/aXb/c')).toBe(false);
    expect(pathPattern('/q?(x)*')('/q?(x)1')).toBe(true);
  });

  it('agrupa con el primer patrón que coincide y saca lo excluido', () => {
    const clean = pathCleaner({ groups: ['/blog/*', '/b*'], exclude: ['/admin/*', 'heartbeat'] });
    expect(clean('/blog/hello')).toBe('/blog/*');
    expect(clean('/billing')).toBe('/b*');
    expect(clean('/admin/users')).toBeNull();
    expect(clean('heartbeat')).toBeNull();
    expect(clean('/pricing')).toBe('/pricing');
    // Se puede excluir un grupo entero por su patrón.
    expect(pathCleaner({ groups: ['/blog/*'], exclude: ['/blog/*'] })('/blog/x')).toBeNull();
    expect(pathCleaner({})('/x')).toBe('/x');
  });

  it('el esquema acepta hasta 20 patrones y los recorta', () => {
    const q = pathsQuerySchema.parse({ kind: 'paths', exclude: [' /admin/* '], groups: ['/blog/*'] });
    expect(q.exclude).toEqual(['/admin/*']);
    expect(pathsQuerySchema.safeParse({ kind: 'paths', exclude: Array.from({ length: 21 }, (_, i) => `/p${i}`) }).success).toBe(false);
    expect(pathsQuerySchema.safeParse({ kind: 'paths', groups: [''] }).success).toBe(false);
  });
});

const created: string[] = [];
afterAll(async () => {
  for (const id of created) {
    await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
    await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
  }
});

/**
 * La hora se fija: '-1d' son los días enteros del proyecto (desde la medianoche
 * de hoy), así que visitas de hace una hora quedaban afuera entre las 00:00 y
 * las 01:00. Se consulta con '-24h' y se prueba justo en los cortes del día.
 */
const AT = ['23:59:30', '00:00:30', '00:59:00'];
afterEach(() => {
  vi.useRealTimers();
});

describe('Pulse: caminos con exclusiones y grupos', () => {
  it.each(AT)('el camino sigue sin el paso excluido y junta las páginas del grupo (%s UTC)', async (hhmmss) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`2026-03-10T${hhmmss}Z`));
    const user = await upsertUser({ email: `pulse-paths-${nanoid(8)}@test.dev` });
    const project = await createProject(user.id, user.id, 'P');
    created.push(project.id);
    const fresh = (await getProject(project.workspace_id, project.id)) as ProjectRow;
    const now = Date.now();
    const visits: Array<[string, string[]]> = [
      ['s1', ['/', '/admin/x', '/blog/a', '/pricing']],
      ['s2', ['/', '/blog/b', '/admin/y', '/pricing']],
    ];
    const batch = visits.flatMap(([session, pages]) =>
      pages.map((pathname, i) => ({
        event: '$pageview',
        distinct_id: `d-${session}`,
        timestamp: new Date(now - 3_600_000 + i * 1000).toISOString(),
        properties: { $session_id: session, $pathname: pathname, $current_url: `https://ex.com${pathname}` },
      })),
    );
    const parsed = parseIngestBody(JSON.stringify({ api_key: fresh.public_key, batch }));
    if (!parsed.ok) throw new Error(parsed.error);
    await storeEvents(fresh, parsed.events, null);

    const plain = await runPaths(fresh, pathsQuerySchema.parse({ kind: 'paths', dateRange: { from: '-24h' } }), now);
    expect(plain.topPaths.map((p) => p.path.join(' '))).toContain('/ /admin/x /blog/a /pricing');

    const cleaned = await runPaths(fresh, pathsQuerySchema.parse({ kind: 'paths', dateRange: { from: '-24h' }, exclude: ['/admin/*'], groups: ['/blog/*'] }), now);
    expect(cleaned.sessions).toBe(2);
    expect(cleaned.topPaths).toEqual([{ path: ['/', '/blog/*', '/pricing'], count: 2 }]);
    expect(cleaned.links.every((l) => !l.from.startsWith('/admin') && !l.to.startsWith('/admin'))).toBe(true);

    // El inicio se escribe como el grupo.
    const fromBlog = await runPaths(fresh, pathsQuerySchema.parse({ kind: 'paths', dateRange: { from: '-24h' }, groups: ['/blog/*'], exclude: ['/admin/*'], startPath: '/blog/*' }), now);
    expect(fromBlog.topPaths).toEqual([{ path: ['/blog/*', '/pricing'], count: 2 }]);
  });
});
