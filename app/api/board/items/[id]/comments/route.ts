import { NextResponse } from 'next/server';
import { z } from 'zod';
import { limitByIp } from '@/lib/rate-limit';
import { COMMENT_MAX, addComment, getPublicItem, listComments } from '@/lib/board';
import { getBoardPerson, localeFromRequest } from '@/lib/board-session';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!(await getPublicItem(id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ comments: await listComments(id) });
}

const commentSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_MAX),
  official: z.boolean().optional(),
  locale: z.string().optional(),
  // Honeypot
  website: z.string().optional(),
});

/** Comentar: requiere sesión. Solo un admin puede marcarlo como respuesta oficial. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const limited = await limitByIp(req, 'board-comment', 20, 600);
  if (limited) return limited;
  const person = await getBoardPerson();
  if (!person) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = commentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (parsed.data.website && parsed.data.website.trim() !== '') return NextResponse.json({ ok: true });
  const res = await addComment({
    itemId: id,
    userId: person.id,
    body: parsed.data.body,
    official: parsed.data.official,
    isAdmin: person.isAdmin,
    locale: localeFromRequest(req, parsed.data.locale),
  });
  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : res.error === 'forbidden' ? 403 : 400;
    return NextResponse.json({ error: res.error }, { status });
  }
  const comments = await listComments(id);
  return NextResponse.json({ comment: comments.find((c) => c.id === res.comment.id) ?? res.comment }, { status: 201 });
}
