import { NextResponse } from 'next/server';
import { getPublicItem, setSubscription } from '@/lib/board';
import { getBoardPerson, localeFromRequest } from '@/lib/board-session';

export const dynamic = 'force-dynamic';

/** Seguir / dejar de seguir un ítem. Body { subscribed: boolean }. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const person = await getBoardPerson();
  if (!person) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await getPublicItem(id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { subscribed?: unknown; locale?: unknown } | null;
  if (typeof body?.subscribed !== 'boolean') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  await setSubscription(id, person.id, body.subscribed, localeFromRequest(req, body.locale));
  return NextResponse.json({ subscribed: body.subscribed });
}
