import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import { callForSession } from '@/lib/crm-voice-http';
import { callView, getCall, updateCallActivity } from '@/lib/crm-voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function fail(error: 'unauthorized' | 'not_found') {
  return error === 'unauthorized' ? unauthorized() : notFound();
}

/** Estado de la llamada (la UI lo consulta después de cortar para mostrar transcripción y resumen). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const res = await callForSession((await ctx.params).id);
  if ('error' in res) return fail(res.error);
  return NextResponse.json({ call: callView(res.call), activityId: res.call.activity_id });
}

const patchSchema = z.object({
  outcome: z.string().trim().max(60).optional(),
  note: z.string().max(5000).optional(),
});

/** Resultado y nota que elige la persona al cortar → la actividad de la llamada. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const res = await callForSession((await ctx.params).id);
  if ('error' in res) return fail(res.error);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  if (!(await updateCallActivity(res.user.id, res.call.id, parsed.data))) return crmError(409, 'call_not_finished');
  const call = await getCall(res.user.id, res.call.id);
  return NextResponse.json({ call: call ? callView(call) : null });
}
