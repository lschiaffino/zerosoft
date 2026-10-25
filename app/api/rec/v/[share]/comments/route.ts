import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addComment, listComments } from '@/lib/rec';
import { publicVideoFor, recFail, resolveViewer, withViewerCookie } from '@/lib/rec-http';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ share: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { share } = await ctx.params;
  const r = await publicVideoFor(req, share);
  if ('res' in r) return r.res;
  const { viewer, newKey } = await resolveViewer(req, r.v);
  return withViewerCookie(NextResponse.json({ comments: await listComments(r.v.id, viewer.key), me: { name: viewer.name, signedIn: !!viewer.userId } }), newKey);
}

const schema = z.object({
  kind: z.enum(['comment', 'reaction']),
  body: z.string().max(4000).optional(),
  emoji: z.string().max(16).optional(),
  atSec: z.number().min(0).max(86_400).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().max(80).optional(),
});

/** Comentario o reacción con el segundo del video. Sin login, con el nombre que escribe quien mira. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const limited = await limitByIp(req, 'rec:comment', 60, 600);
  if (limited) return limited;
  const { share } = await ctx.params;
  const r = await publicVideoFor(req, share);
  if ('res' in r) return r.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { viewer, newKey } = await resolveViewer(req, r.v, parsed.data.name);
  try {
    const comment = await addComment(r.v, viewer, parsed.data);
    return withViewerCookie(NextResponse.json({ comment }, { status: 201 }), newKey);
  } catch (err) {
    return recFail(err);
  }
}
