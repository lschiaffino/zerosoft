import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { reorderStages } from '@/lib/crm';
import { crmError, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reorderSchema = z.object({
  stageIds: z.array(z.string().min(1).max(64)).min(1).max(100),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');

  if (!(await reorderStages(user.id, params.id, parsed.data.stageIds))) return notFound();
  return NextResponse.json({ ok: true });
}
