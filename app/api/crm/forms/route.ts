import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createForm, FormError, listForms } from '@/lib/crm-forms';
import { formCreateSchema } from '@/lib/crm-forms-schema';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ forms: await listForms(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = formCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  try {
    const form = await createForm(user.id, { ...parsed.data, createdBy: realUserId(user) });
    return NextResponse.json(form, { status: 201 });
  } catch (e) {
    if (e instanceof FormError) return crmError(400, e.code);
    throw e;
  }
}
