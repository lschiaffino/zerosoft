import type { NextRequest } from 'next/server';
import { withViewer } from '@/lib/bi/http';
import { createQuestion } from '@/lib/bi/store';

export const dynamic = 'force-dynamic';

/** Guarda una pregunta. */
export async function POST(req: NextRequest) {
  return withViewer(req, 'write', async (viewer, body) => ({ question: await createQuestion(viewer, body) }), 201);
}
