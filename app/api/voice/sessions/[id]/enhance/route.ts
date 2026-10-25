import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth, readBody } from '@/lib/voice-route';
import { meetingLabels, voiceErrorResponse, voiceMessages } from '@/lib/voice-http';
import { enhance } from '@/lib/voice-service';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Nota mejorada con IA (tus notas + la transcripción, con la plantilla). Body: { locale?, templateKey? }. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'ai', limit: 20 });
  if (auth.res) return auth.res;
  const body = await readBody(req);
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  const templateKey = typeof body.templateKey === 'string' && body.templateKey.length <= 64 ? body.templateKey : undefined;
  try {
    const res = await enhance({
      owner: auth.owner,
      scope: await sessionScope(auth.user),
      sessionId: id,
      locale,
      labels: meetingLabels(locale),
      builtinNames: voiceMessages(locale).templates.builtin,
      templateKey,
    });
    return NextResponse.json(res);
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
