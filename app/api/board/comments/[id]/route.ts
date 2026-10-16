import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteComment, moderateComment } from '@/lib/board';
import { getBoardPerson } from '@/lib/board-session';

export const dynamic = 'force-dynamic';

/** Borrar un comentario: el propio, o cualquiera si sos admin. */
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const person = await getBoardPerson();
  if (!person) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const res = await deleteComment(id, person.id, person.isAdmin);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.error === 'forbidden' ? 403 : 404 });
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({ pinned: z.boolean().optional(), official: z.boolean().optional() });

/** Fijar o marcar como respuesta oficial "Equipo zerosoft": solo ADMIN_EMAILS. */
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const person = await getBoardPerson();
  if (!person) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const res = await moderateComment(id, parsed.data, person.isAdmin);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.error === 'forbidden' ? 403 : 404 });
  return NextResponse.json({ comment: res.comment });
}
