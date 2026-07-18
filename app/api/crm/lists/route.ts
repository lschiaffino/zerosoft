import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createList, listLists } from '@/lib/crm';
import { listCreateSchema } from '@/lib/crm-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listLists(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = listCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const list = await createList(user.id, parsed.data);
  return NextResponse.json(list, { status: 201 });
}
