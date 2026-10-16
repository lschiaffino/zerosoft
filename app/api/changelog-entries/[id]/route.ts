import { NextResponse } from 'next/server';
import { getBoardPerson } from '@/lib/board-session';
import { changelogInputSchema, deleteChangelogEntry, revalidateChangelog, updateChangelogEntry } from '@/lib/changelog';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const person = await getBoardPerson();
  if (!person?.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = changelogInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const entry = await updateChangelogEntry(id, parsed.data, person.id);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  revalidateChangelog();
  return NextResponse.json({ entry });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const person = await getBoardPerson();
  if (!person?.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await deleteChangelogEntry(id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  revalidateChangelog();
  return NextResponse.json({ ok: true });
}
