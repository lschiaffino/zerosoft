import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUserIsAdmin } from '@/lib/roadmap-admin';
import { mergeRoadmapItems } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

const mergeSchema = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) });

/** Fusiona dos ítems (el origen desaparece). Solo ADMIN_EMAILS. */
export async function POST(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = mergeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.sourceId === parsed.data.targetId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const item = await mergeRoadmapItems(parsed.data.sourceId, parsed.data.targetId);
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ item });
}
