import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { deleteInviteeData, previewInviteeData } from '@/lib/calendar-privacy';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().min(3).max(320).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'invalid_email' }),
  /** false = solo contar (vista previa); true = borrar. */
  confirm: z.boolean().optional(),
});

/** Borrado de datos de un invitado (solo admins): primero la vista previa, después el borrado. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  if (!parsed.data.confirm) return NextResponse.json({ preview: await previewInviteeData(user.id, parsed.data.email) });
  const deleted = await deleteInviteeData(user.id, parsed.data.email, realUserId(user));
  return NextResponse.json({ deleted });
}
