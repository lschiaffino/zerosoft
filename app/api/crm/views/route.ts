import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createSavedView, listSavedViews } from '@/lib/crm';
import { savedViewCreateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTITIES = ['contacts', 'companies', 'deals', 'tasks'] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const entity = req.nextUrl.searchParams.get('entity');
  if (!entity || !(ENTITIES as readonly string[]).includes(entity)) {
    return crmError(400, 'invalid_input');
  }
  return NextResponse.json({ rows: await listSavedViews(user.id, entity) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = savedViewCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const view = await createSavedView(user.id, parsed.data);
  return NextResponse.json(view, { status: 201 });
}
