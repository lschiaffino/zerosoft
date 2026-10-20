import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getFlowSettings, updateFlowSettings } from '@/lib/flow';
import { flowSettingsSchema } from '@/lib/flow-schema';
import { canEditFlows, flowError, forbidden, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ajustes de Flow del workspace: retención del historial e idioma de los avisos. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ settings: await getFlowSettings(user.id) });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = flowSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  return NextResponse.json({ settings: await updateFlowSettings(user.id, parsed.data) });
}
