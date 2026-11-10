import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { createCollection } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';

/** Crea una colección (carpeta). */
export async function POST(req: NextRequest) {
  return withViewer(req, 'write', (viewer, body) => createCollection(viewer, { name: body.name, parentId: body.parentId }), 201);
}
