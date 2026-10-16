import { NextResponse } from 'next/server';
import { getBoardPerson } from '@/lib/board-session';
import { roadmapPatchSchema, updateRoadmapItem } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

// Solo ADMIN_EMAILS; para el resto la ruta no existe.
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const person = await getBoardPerson();
  if (!person?.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = roadmapPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  // Cambiar el estado registra el evento (timeline) y avisa a los suscriptos.
  const item = await updateRoadmapItem(id, parsed.data, { actorId: person.id });
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ item });
}
