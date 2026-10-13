import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { createTag, listTags } from '@/lib/crm-tags';
import { tagCreateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listTags(user.id, undefined, await sessionScope(user)) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = tagCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await createTag(user.id, parsed.data);
  if (!res.ok) return crmError(409, res.error);
  return NextResponse.json(res.tag, { status: 201 });
}
