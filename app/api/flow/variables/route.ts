import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { createVariable, listVariables } from '@/lib/flow-variables';
import { canEditFlows, flowError, forbidden, realUserId, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Variables de quien pide (las que leen los flows que corren con su acceso). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ variables: await listVariables(user.id, realUserId(user)) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = z.object({ key: z.string().max(100), value: z.string().max(20_000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  const res = await createVariable(user.id, realUserId(user), parsed.data.key, parsed.data.value);
  if (!res.ok) return flowError(res.error === 'duplicate_key' ? 409 : 400, res.error);
  return NextResponse.json({ variable: res.variable }, { status: 201 });
}
