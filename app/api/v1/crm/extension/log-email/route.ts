import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { apiScope } from '@/lib/crm-visibility';
import { logExtensionEmail } from '@/lib/crm-extension';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  messageId: z.string().trim().min(1).max(200),
  threadId: z.string().trim().max(200).optional(),
  subject: z.string().max(1000).optional(),
  body: z.string().max(200_000).optional(),
  from: z.string().trim().min(3).max(500),
  to: z.string().max(2000).optional(),
  cc: z.string().max(2000).optional(),
  sentAt: z.string().max(64).nullish(),
});

/** Registra en el CRM el email abierto en Gmail (timeline de los contactos que participan). */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'The request body is not valid.');
  const res = await logExtensionEmail(
    { workspaceId: auth.user.id, personId: auth.personId, scope: await apiScope(auth) },
    parsed.data,
  );
  if (!res.ok) return apiError(404, res.error, 'None of the participants is a contact you can see.');
  return NextResponse.json(res, { status: res.duplicate ? 200 : 201 });
}
