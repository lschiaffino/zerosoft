import { NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { toggleVote } from '@/lib/board';
import { getBoardPerson, localeFromRequest } from '@/lib/board-session';

export const dynamic = 'force-dynamic';

/**
 * Votar / quitar el voto. Requiere sesión (401 → el cliente manda al login y
 * vuelve). Body opcional { voted: boolean } para fijar el estado en vez de alternar.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const limited = await limitByIp(req, 'board-vote', 60, 600);
  if (limited) return limited;
  const person = await getBoardPerson();
  if (!person) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { voted?: unknown; locale?: unknown } | null;
  const force = body?.voted === true ? 'on' : body?.voted === false ? 'off' : undefined;
  const res = await toggleVote(id, person.id, { force, locale: localeFromRequest(req, body?.locale) });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.error === 'closed' ? 409 : 404 });
  return NextResponse.json({ voted: res.voted, votes: res.votes });
}
