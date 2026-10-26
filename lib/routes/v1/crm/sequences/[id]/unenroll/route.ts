import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { getSequence, unenrollContact } from '@/lib/crm-sequences';
import { unenrollSchema } from '@/lib/crm-email-schema';
import { zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const body: unknown = await req.json().catch(() => null);
  const parsed = unenrollSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  if (!(await getSequence(auth.user.id, id))) return apiError(404, 'not_found', 'Sequence not found.');
  const exited = await unenrollContact(auth.user.id, id, parsed.data.contactId);
  return NextResponse.json({ exited });
}
