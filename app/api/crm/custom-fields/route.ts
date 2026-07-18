import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createCustomField, listCustomFields } from '@/lib/crm';
import { customFieldCreateSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTITIES = ['contacts', 'companies', 'deals'] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const entity = req.nextUrl.searchParams.get('entity');
  if (entity && !(ENTITIES as readonly string[]).includes(entity)) {
    return crmError(400, 'invalid_input');
  }
  return NextResponse.json({ rows: listCustomFields(user.id, entity ?? undefined) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = customFieldCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const field = createCustomField(user.id, parsed.data);
  return NextResponse.json(field, { status: 201 });
}
