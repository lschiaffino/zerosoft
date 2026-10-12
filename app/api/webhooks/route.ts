import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { createWebhook, listWebhooks, WEBHOOK_EVENTS } from '@/lib/webhooks';
import { UnsafeUrlError } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  url: z.string().trim().url().max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ rows: await listWebhooks(user.id) });
}

/** Crea un webhook; la respuesta incluye el secret una sola vez. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const created = await createWebhook(user.id, { ...parsed.data, createdBy: realUserId(user) });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
