import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getTaskDigest, setTaskDigest } from '@/lib/crm-task-digest';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ enabled: z.boolean() });

/** El email diario con las tareas del día de la persona que mira (en el workspace activo). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ enabled: await getTaskDigest(user.id, user.actingUser?.id ?? user.id) });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  await setTaskDigest(user.id, user.actingUser?.id ?? user.id, parsed.data.enabled);
  return NextResponse.json({ enabled: parsed.data.enabled });
}
