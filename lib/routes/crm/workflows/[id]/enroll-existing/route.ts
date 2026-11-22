import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { enrollExistingRecords } from '@/lib/crm-workflows';
import { invalidBody, notFound, unauthorized, forbidden, limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Opcional: seguir una pasada que se cortó en un tope desde el último registro revisado. */
const bodySchema = z
  .object({
    after: z
      .object({
        entity: z.enum(['contact', 'company', 'deal']),
        createdAt: z.string().max(40),
        id: z.string().max(64),
      })
      .optional(),
  })
  .optional();

/**
 * Inscribe los registros que ya cumplen los criterios del workflow (W3). Solo
 * owner y admins; con tope de registros por pasada, por workspace y por hora.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const raw = await req.text().catch(() => '');
  let body: unknown = undefined;
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitAction(realUserId(user), 'workflow_enroll_existing', 10, 3600);
  if (limited) return limited;
  const result = await enrollExistingRecords(user.id, params.id, parsed.data?.after);
  if (!result) return notFound();
  return NextResponse.json(result);
}
