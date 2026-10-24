import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { apiScope } from '@/lib/crm-visibility';
import { trackExtensionEmail } from '@/lib/crm-extension';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  to: z.string().trim().min(3).max(2000),
  cc: z.string().max(2000).optional(),
  subject: z.string().max(1000).optional(),
  body: z.string().max(200_000).optional(),
  threadId: z.string().trim().max(200).optional(),
});

/**
 * Antes de enviar desde Gmail con "Registrar y trackear": guarda el email
 * saliente y devuelve la URL del pixel de aperturas que la extensión inserta.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'The request body is not valid.');
  const res = await trackExtensionEmail(
    { workspaceId: auth.user.id, personId: auth.personId, scope: await apiScope(auth) },
    parsed.data,
  );
  if (!res.ok) return apiError(400, res.error, 'Add at least one recipient.');
  return NextResponse.json(res, { status: 201 });
}
