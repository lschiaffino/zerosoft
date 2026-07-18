import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { mergeContacts } from '@/lib/crm';
import { contactMergeSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = contactMergeSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { keepId, dropId } = parsed.data;
  if (keepId === dropId) return crmError(400, 'invalid_input');

  const merged = await mergeContacts(user.id, keepId, dropId);
  if (!merged) return notFound();
  return NextResponse.json(merged);
}
