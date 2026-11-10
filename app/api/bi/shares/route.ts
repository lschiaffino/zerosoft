import type { NextRequest } from 'next/server';
import { withViewer, str } from '@/lib/bi/http';
import { BiStoreError, createShare, listShares } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';

function kindOf(v: unknown): 'question' | 'dashboard' {
  if (v === 'question' || v === 'dashboard') return v;
  throw new BiStoreError('invalid_kind');
}

/** Links públicos activos de una pregunta o tablero. ?kind=&target= */
export async function GET(req: NextRequest) {
  return withViewer(req, 'read', async (viewer) => {
    const sp = new URL(req.url).searchParams;
    return { shares: await listShares(viewer, kindOf(sp.get('kind')), sp.get('target') ?? '') };
  });
}

/** Crea un link público (solo admins). El token se ve una sola vez. */
export async function POST(req: NextRequest) {
  return withViewer(req, 'write', async (viewer, body) => ({ share: await createShare(viewer, kindOf(body.kind), str(body.targetId) ?? '') }), 201);
}
