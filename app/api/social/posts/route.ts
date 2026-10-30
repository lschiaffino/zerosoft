import { NextRequest, NextResponse } from 'next/server';
import { readBody, withSocial } from '@/lib/social-http';
import { createPost, listPosts, type ListPostsOptions } from '@/lib/social';
import { postSchema } from '@/lib/social-schemas';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['draft', 'pending_approval', 'rejected', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'scheduled_any', 'needs_approval'];

/** Publicaciones que ve la persona. ?from=&to= (ISO) para el calendario, ?status=, ?account=, ?q=. */
export async function GET(req: NextRequest) {
  return withSocial(async ({ actor }) => {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const opts: ListPostsOptions = {
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      status: status && STATUSES.includes(status) ? (status as ListPostsOptions['status']) : undefined,
      accountId: sp.get('account') ?? undefined,
      q: sp.get('q')?.slice(0, 200) ?? undefined,
      limit: Number(sp.get('limit')) || undefined,
    };
    return NextResponse.json({ posts: await listPosts(actor, opts) });
  });
}

export async function POST(req: NextRequest) {
  return withSocial(
    async ({ actor }) => {
      const body = await readBody(req, postSchema);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json(await createPost(actor, body), { status: 201 });
    },
    { write: 'posts', limit: 120 },
  );
}
