import { after, NextRequest, NextResponse } from 'next/server';
import { emitEvent } from '@/lib/events';
import { getCurrentUser } from '@/lib/session';
import { createDocPage, listDocPages } from '@/lib/docs';
import { docPageCreateSchema } from '@/lib/docs-schema';
import { unauthorized, invalidBody } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const rows = await listDocPages(user.id, { archived: false });
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docPageCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const page = await createDocPage(user.id, parsed.data);
  after(() => emitEvent(user.id, 'page.created', { page: { id: page.id, title: page.title, parentId: page.parent_id } }));
  return NextResponse.json(page, { status: 201 });
}
