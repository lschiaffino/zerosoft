import { NextResponse } from 'next/server';
import { currentUserIsAdmin } from '@/lib/roadmap-admin';
import { roadmapPatchSchema, updateRoadmapItem } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

// Solo ADMIN_EMAILS; para el resto la ruta no existe.
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = roadmapPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const item = await updateRoadmapItem(id, parsed.data);
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ item });
}
