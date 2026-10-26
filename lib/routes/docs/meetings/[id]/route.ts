import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { clearMeeting, getMeeting, MEETING_TRANSCRIPT_MAX, updateMeeting } from '@/lib/docs-meetings';
import { meetingFor } from '@/lib/docs-meetings-http';
import { invalidBody } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Params) {
  const { id } = await props.params;
  const ctx = await meetingFor(id, false);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ meeting: await getMeeting(id) });
}

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  /** Transcripción pegada o corregida a mano. */
  transcript: z.string().max(MEETING_TRANSCRIPT_MAX).optional(),
  status: z.enum(['idle', 'recording', 'ready']).optional(),
});

export async function PATCH(req: NextRequest, props: Params) {
  const { id } = await props.params;
  const ctx = await meetingFor(id, true);
  if ('res' in ctx) return ctx.res;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json({ meeting: await updateMeeting(id, parsed.data) });
}

/** Borra la transcripción y las notas generadas (el bloque queda vacío). */
export async function DELETE(_req: NextRequest, props: Params) {
  const { id } = await props.params;
  const ctx = await meetingFor(id, true);
  if ('res' in ctx) return ctx.res;
  return NextResponse.json({ meeting: await clearMeeting(id) });
}
