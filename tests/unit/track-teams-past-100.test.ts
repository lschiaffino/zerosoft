import { describe, expect, it, vi } from 'vitest';
import { createProject, listProjectMetas, listProjects } from '@/lib/track-data';
import { fetchAllTrackTeams } from '@/components/track/fetchAllTeams';
import { makeUser } from './helpers';

/**
 * Con más de 100 teams, los que venían después en el orden por nombre no
 * aparecían en el sidebar de Track (ni como destino de arrastre), en "Mover a
 * team" ni en el selector de team de "Nuevo issue": todo pedía una sola página
 * de 100.
 */

type Row = { id: string; name: string; status: string };

function pagedFetcher(rows: Row[]) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    calls.push(url);
    const sp = new URL(url, 'http://x').searchParams;
    const size = Number(sp.get('pageSize'));
    const page = Number(sp.get('page'));
    const slice = rows.slice((page - 1) * size, page * size);
    return new Response(JSON.stringify({ rows: slice, total: rows.length, page, pageSize: size }), { status: 200 });
  });
  return { fetcher, calls };
}

const teams = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `Team ${String(i).padStart(3, '0')}`, status: 'active' }));

describe('fetchAllTrackTeams', () => {
  it('junta todas las páginas cuando hay más de 100 teams', async () => {
    const { fetcher, calls } = pagedFetcher(teams(230));
    const rows = await fetchAllTrackTeams<Row>(fetcher);
    expect(rows).toHaveLength(230);
    expect(rows?.at(-1)?.id).toBe('t229');
    expect(calls).toHaveLength(3);
  });

  it('con 100 o menos hace un solo pedido', async () => {
    const { fetcher, calls } = pagedFetcher(teams(40));
    expect(await fetchAllTrackTeams<Row>(fetcher)).toHaveLength(40);
    expect(calls).toHaveLength(1);
  });

  it('exactamente 100: no pide una página vacía de más', async () => {
    const { fetcher, calls } = pagedFetcher(teams(100));
    expect(await fetchAllTrackTeams<Row>(fetcher)).toHaveLength(100);
    expect(calls).toHaveLength(1);
  });

  it('null si falla el primer pedido; lo juntado si falla uno posterior', async () => {
    expect(await fetchAllTrackTeams<Row>(async () => new Response('no', { status: 500 }))).toBeNull();
    expect(await fetchAllTrackTeams<Row>(async () => Promise.reject(new Error('offline')))).toBeNull();

    const all = teams(150);
    let n = 0;
    const flaky = async (url: string) => {
      n += 1;
      if (n === 2) return new Response('no', { status: 500 });
      return pagedFetcher(all).fetcher(url);
    };
    expect(await fetchAllTrackTeams<Row>(flaky)).toHaveLength(100);
  });
});

describe('teams de Track más allá de 100', () => {
  it('listProjects pagina y listProjectMetas devuelve todos los activos', async () => {
    const owner = await makeUser('many-teams');
    for (let i = 0; i < 104; i++) await createProject(owner.id, null, { name: `Aa ${String(i).padStart(3, '0')}` });
    const last = await createProject(owner.id, null, { name: 'Zz último' });

    const first = await listProjects(null, owner.id, { page: 1, pageSize: 100 });
    expect(first.total).toBe(105);
    expect(first.rows.some((r) => r.id === last.id)).toBe(false);
    const second = await listProjects(null, owner.id, { page: 2, pageSize: 100 });
    expect(second.rows.map((r) => r.id)).toContain(last.id);

    const metas = await listProjectMetas(null, owner.id);
    expect(metas).toHaveLength(105);
    expect(metas.at(-1)?.id).toBe(last.id);
  }, 60_000);
});
