import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { listCollections, listItems } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';

/** Preguntas, tableros y colecciones visibles (lista y sidebar). ?collection=<id>|root, ?q= */
export async function GET(req: NextRequest) {
  return withViewer(req, 'read', async (viewer) => {
    const sp = new URL(req.url).searchParams;
    const col = sp.get('collection');
    const items = await listItems(viewer, { collectionId: col === null ? undefined : col === 'root' ? null : col, q: sp.get('q') ?? undefined });
    return { items, collections: await listCollections(viewer) };
  });
}
