import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { crmError, invalidBody, unauthorized } from '@/lib/crm-http';
import { applyFieldFollowup, FollowupError, markFollowup } from '@/lib/crm-ai-followup';
import { aiLocale } from '@/lib/crm-ai-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  /** Propiedad: la aplica el server (con el valor editado, si vino). */
  z.object({ action: z.literal('apply'), value: z.union([z.string().max(5000), z.number(), z.boolean()]).optional() }),
  /** Etapa, email o tarea: la UI ya hizo el cambio con la ruta de siempre. */
  z.object({ action: z.literal('applied') }),
  z.object({ action: z.literal('discard') }),
]);

/** Aprueba o descarta una propuesta propia de la IA tras una llamada. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const viewer = sessionFieldViewer(user);
  try {
    if (parsed.data.action === 'apply') {
      const res = await applyFieldFollowup({
        workspaceId: user.id,
        viewer,
        scope: await sessionScope(user),
        id,
        value: parsed.data.value,
        actorEmail: user.actingUser?.email ?? user.email,
        locale: aiLocale(req),
      });
      return NextResponse.json({ ok: true, value: res.value });
    }
    await markFollowup(user.id, viewer.personId, id, parsed.data.action === 'applied' ? 'applied' : 'discarded');
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof FollowupError) return crmError(err.status, err.code);
    console.error('[crm-ai-followup] apply failed', err instanceof Error ? err.message : err);
    return crmError(500, 'generic');
  }
}
