import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canSeeActivity, sessionScope } from '@/lib/crm-visibility';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { invalidBody, limitAction, notFound, unauthorized } from '@/lib/crm-http';
import { generateFollowups, listFollowups } from '@/lib/crm-ai-followup';
import { aiErrorResponse, aiLocale } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ activityId: z.string().min(1).max(64), locale: z.string().max(5).optional() });

/** Propuestas de la IA de quien mira para una llamada o reunión (solo las suyas). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse({ activityId: req.nextUrl.searchParams.get('activityId'), locale: req.nextUrl.searchParams.get('locale') ?? undefined });
  if (!parsed.success) return invalidBody(parsed.error);
  const scope = await sessionScope(user);
  if (!(await canSeeActivity(user.id, parsed.data.activityId, scope))) return notFound();
  const res = await listFollowups({
    workspaceId: user.id,
    viewer: sessionFieldViewer(user),
    activityId: parsed.data.activityId,
    scope,
    locale: aiLocale(req, parsed.data.locale),
  });
  return NextResponse.json(res);
}

/** Pide (o vuelve a pedir) propuestas: propiedades, etapa, email de seguimiento y tareas. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitAction(realUserId(user), 'ai-call-followup', 120, 3600);
  if (limited) return limited;
  try {
    const items = await generateFollowups({
      workspaceId: user.id,
      viewer: sessionFieldViewer(user),
      activityId: parsed.data.activityId,
      scope: await sessionScope(user),
      locale: aiLocale(req, parsed.data.locale),
    });
    return NextResponse.json({ generatedAt: new Date().toISOString(), items });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
