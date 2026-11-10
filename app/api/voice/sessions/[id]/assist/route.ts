import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { meetingLabels, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { getSessionRow } from '@/lib/voice';
import { briefForSession, followupForSession, saveFollowup, sendFollowup } from '@/lib/voice-prep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const postSchema = z.object({ kind: z.enum(['brief', 'followup']), locale: z.string().max(5).optional() });
const email = z.string().trim().toLowerCase().email().max(254);
const sendSchema = z.object({
  kind: z.literal('send'),
  followup: z.object({ to: z.array(email).min(1).max(50), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10_000) }),
});

/**
 * IA alrededor de la reunión. kind=brief: lo hablado antes con sus
 * asistentes (queda en la reunión). kind=followup: borrador del email de
 * seguimiento (queda en la reunión y se puede editar). kind=send: lo manda
 * desde el buzón conectado de la persona.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const raw = (await req.json().catch(() => ({}))) as { kind?: unknown };
  // kind=send: manda el seguimiento desde el Gmail u Outlook conectado de la persona.
  if (raw?.kind === 'send') {
    const auth = await voiceAuth({ bucket: 'send', limit: 20 });
    if (auth.res) return auth.res;
    const send = sendSchema.safeParse(raw);
    if (!send.success) return voiceJsonError(400, 'invalid_input');
    try {
      return NextResponse.json(await sendFollowup(auth.owner, id, send.data.followup));
    } catch (err) {
      return voiceErrorResponse(err);
    }
  }
  const auth = await voiceAuth({ bucket: 'ai', limit: 20 });
  if (auth.res) return auth.res;
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  const locale = parsed.data.locale ?? 'en';
  try {
    if (parsed.data.kind === 'brief') return NextResponse.json({ brief: await briefForSession(auth.owner, id, locale, meetingLabels(locale)) });
    const sender = auth.user.actingUser?.name || auth.user.name || '';
    return NextResponse.json({ followup: await followupForSession({ owner: auth.owner, sessionId: id, locale, labels: meetingLabels(locale), senderName: sender }) });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}

const patchSchema = z.object({
  followup: z.object({ to: z.array(email).max(50), subject: z.string().max(200), body: z.string().max(10_000) }),
});

/** Guarda lo que la persona editó del borrador. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  const row = await getSessionRow(auth.owner, id);
  if (!row || row.kind !== 'meeting') return voiceJsonError(404, 'not_found');
  const followup = { ...parsed.data.followup, at: new Date().toISOString() };
  await saveFollowup(id, followup);
  return NextResponse.json({ followup });
}

