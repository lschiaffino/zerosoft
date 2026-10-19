import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRoadmapItem } from '@/lib/roadmap';

const { POST } = await import('@/app/api/roadmap/ingest/route');

const TOKEN = 'test-ingest-token-0123456789abcdef';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.ROADMAP_INGEST_TOKEN;
  process.env.ROADMAP_INGEST_TOKEN = TOKEN;
});
afterEach(() => {
  if (saved === undefined) delete process.env.ROADMAP_INGEST_TOKEN;
  else process.env.ROADMAP_INGEST_TOKEN = saved;
});

function post(body: unknown, token: string | null = TOKEN) {
  return POST(
    new Request('http://localhost/api/roadmap/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/roadmap/ingest', () => {
  it('sin token, con token incorrecto o sin token configurado responde 404', async () => {
    const body = { items: [{ title: 'Algo nuevo para probar', product: 'docs' }] };
    expect((await post(body, null)).status).toBe(404);
    expect((await post(body, 'otro-token-que-no-es-el-correcto')).status).toBe(404);
    delete process.env.ROADMAP_INGEST_TOKEN;
    expect((await post(body)).status).toBe(404);
  });

  it('crea ideas públicas y saltea títulos repetidos sin importar acentos ni mayúsculas', async () => {
    const title = `Exportar páginas a Markdown ${Date.now()}`;
    const res = await post({ items: [{ title, description: 'Gap vs Notion', product: 'docs' }] });
    expect(res.status).toBe(201);
    const { created } = (await res.json()) as { created: Array<{ id: string }> };
    expect(created).toHaveLength(1);
    const item = await getRoadmapItem(created[0].id);
    expect(item).toMatchObject({ status: 'idea', is_public: 1, product: 'docs', kind: 'idea' });

    const again = await post({ items: [{ title: `  EXPORTAR PAGINAS A MARKDOWN ${title.split(' ').pop()} ` }] });
    expect(again.status).toBe(200);
    const out = (await again.json()) as { created: unknown[]; skipped: Array<{ id: string }> };
    expect(out.created).toHaveLength(0);
    expect(out.skipped[0].id).toBe(created[0].id);
  });

  it('rechaza un cuerpo inválido', async () => {
    expect((await post({ items: [] })).status).toBe(400);
    expect((await post({ items: [{ title: 'x', product: 'nada' }] })).status).toBe(400);
  });
});

describe('importResearchIdeas', () => {
  it('una idea borrada desde el admin no vuelve a crearse', async () => {
    const { importResearchIdeas } = await import('@/lib/roadmap');
    const { getDb } = await import('@/lib/db');
    const title = `Track: Triage inbox ${Date.now()}`;
    const first = await importResearchIdeas([{ title, description: '', product: 'track', kind: 'idea' }]);
    expect(first.created).toHaveLength(1);
    await getDb().prepare('DELETE FROM roadmap_items WHERE id = ?').run(first.created[0].id);
    const again = await importResearchIdeas([{ title, description: '', product: 'track', kind: 'idea' }]);
    expect(again.created).toHaveLength(0);
    expect(await getRoadmapItem(first.created[0].id)).toBeUndefined();
  });
});

describe('research/ideas.json', () => {
  it('cada idea es válida y los títulos no se repiten', async () => {
    const { researchIdeaSchema, roadmapTitleKey } = await import('@/lib/roadmap');
    const ideas = (await import('@/research/ideas.json')).default as unknown[];
    const keys = new Set<string>();
    for (const idea of ideas) {
      const parsed = researchIdeaSchema.safeParse(idea);
      expect(parsed.success, JSON.stringify(idea)).toBe(true);
      if (!parsed.success) continue;
      const key = roadmapTitleKey(parsed.data.title);
      expect(keys.has(key), `título repetido: ${parsed.data.title}`).toBe(false);
      keys.add(key);
    }
  });
});

describe('importResearchIdeas: avance de estado', () => {
  it('pasa una idea a done con su changelog y nunca la hace retroceder', async () => {
    const { importResearchIdeas, updateRoadmapItem } = await import('@/lib/roadmap');
    const title = `Link: Forward query params ${Date.now()}`;
    const base = { title, description: '', product: 'link' as const, kind: 'idea' as const };
    const first = await importResearchIdeas([base]);
    const id = first.created[0].id;
    expect((await getRoadmapItem(id))?.status).toBe('idea');

    await importResearchIdeas([{ ...base, status: 'done', changelog: '2026-10-19-link' }]);
    expect(await getRoadmapItem(id)).toMatchObject({ status: 'done', shipped_changelog_id: '2026-10-19-link' });

    await importResearchIdeas([{ ...base, status: 'planned' }]);
    expect((await getRoadmapItem(id))?.status).toBe('done');
  });

  it('no toca una idea rechazada desde el admin', async () => {
    const { importResearchIdeas, updateRoadmapItem } = await import('@/lib/roadmap');
    const title = `Cal: Seats ${Date.now()}`;
    const base = { title, description: '', product: 'cal' as const, kind: 'idea' as const };
    const id = (await importResearchIdeas([base])).created[0].id;
    await updateRoadmapItem(id, { status: 'declined' });
    await importResearchIdeas([{ ...base, status: 'done' }]);
    expect((await getRoadmapItem(id))?.status).toBe('declined');
  });
});
