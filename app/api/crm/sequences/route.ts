import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createSequence, getSequence, listSequences } from '@/lib/crm-sequences';
import { sequenceCreateSchema } from '@/lib/crm-email-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ sequences: await listSequences(user.id) });
}

/** Cualquier miembro crea secuencias; editarlas: admins o quien la creó. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = sequenceCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const seq = await createSequence(user.id, realUserId(user), parsed.data);
  return NextResponse.json(await getSequence(user.id, seq.id), { status: 201 });
}
