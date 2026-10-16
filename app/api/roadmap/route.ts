import { NextResponse } from 'next/server';
import { getBoardPerson } from '@/lib/board-session';
import { createRoadmapItem, roadmapCreateSchema } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

/** Crear un ítem desde el admin. Solo ADMIN_EMAILS; para el resto la ruta no existe. */
export async function POST(req: Request) {
  const person = await getBoardPerson();
  if (!person?.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = roadmapCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const item = await createRoadmapItem(parsed.data, person.id);
  return NextResponse.json({ item }, { status: 201 });
}
