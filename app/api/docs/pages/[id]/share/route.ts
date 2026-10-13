import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createDocShare } from '@/lib/docs';
import { docShareCreateSchema } from '@/lib/docs-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = docShareCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const share = await createDocShare(user.id, params.id, parsed.data.kind, parsed.data.target_id);
  if (!share) return notFound();
  return NextResponse.json(share, { status: 201 });
}
