import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { createPost, listPosts, SocialError, type PostDto, type SocialActor } from '@/lib/social';
import { postSchema } from '@/lib/social-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** La key actúa como la persona que la creó: sus cuentas, su rol (con aprobación si es drafter). */
function postV1(p: PostDto) {
  return {
    id: p.id,
    text: p.text,
    status: p.status,
    scheduled_at: p.scheduledAt,
    published_at: p.publishedAt,
    targets: p.targets.map((t) => ({ account_id: t.accountId, network: t.account?.network ?? null, status: t.status, url: t.externalUrl, error: t.errorCode })),
    created_at: p.createdAt,
  };
}

/** GET /api/v1/social/posts?status=&from=&to= */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'social:read');
  if ('res' in auth) return auth.res;
  const actor: SocialActor = { workspaceId: auth.user.id, personId: auth.personId, role: auth.role };
  const sp = new URL(req.url).searchParams;
  const status = sp.get('status') ?? undefined;
  const rows = await listPosts(actor, { status: status as never, from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, limit: 100 });
  return NextResponse.json({ data: rows.map(postV1) });
}

/** POST /api/v1/social/posts { text, accountIds, overrides?, action: draft|schedule|now|queue, scheduledAt? } */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'social:write');
  if ('res' in auth) return auth.res;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Expected { text, accountIds, action }.');
  const actor: SocialActor = { workspaceId: auth.user.id, personId: auth.personId, role: auth.role };
  try {
    return NextResponse.json({ data: postV1(await createPost(actor, parsed.data)) }, { status: 201 });
  } catch (err) {
    if (err instanceof SocialError) return NextResponse.json({ error: { code: err.code, message: err.code, details: err.details ?? null } }, { status: err.status });
    throw err;
  }
}
