import { NextResponse } from 'next/server';
import { getBoardPerson } from '@/lib/board-session';
import { changelogInputSchema, createChangelogEntry, listChangelogRows, revalidateChangelog } from '@/lib/changelog';

export const dynamic = 'force-dynamic';

export async function GET() {
  const person = await getBoardPerson();
  if (!person?.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ entries: await listChangelogRows({ includeDrafts: true }) });
}

/** Publicar una entrada del changelog sin deploy. Solo ADMIN_EMAILS. */
export async function POST(req: Request) {
  const person = await getBoardPerson();
  if (!person?.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = changelogInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const entry = await createChangelogEntry(parsed.data, person.id);
  revalidateChangelog();
  return NextResponse.json({ entry }, { status: 201 });
}
