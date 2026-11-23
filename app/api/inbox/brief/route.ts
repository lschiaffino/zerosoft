import { iJson, withOwner } from '@/lib/inbox/http';
import { InboxError } from '@/lib/inbox/types';
import { briefKey, cleanDay, dismissBrief, inboxBriefPayload, restoreBrief } from '@/lib/daily-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El resumen del día de Inbox de la persona (solo sus chats; lib/daily-brief.ts). ?day=<AAAA-MM-DD>, su día local. */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const day = cleanDay(new URL(req.url).searchParams.get('day'));
    if (!day) throw new InboxError('invalid_input', 400);
    return iJson(await inboxBriefPayload(owner, day));
  });
}

/** { action: 'dismiss', day }: cerrar la tarjeta por hoy; { action: 'restore' }: deshacerlo. */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const b = (await req.json().catch(() => null)) as { action?: unknown; day?: unknown } | null;
    if (b?.action === 'restore') {
      await restoreBrief(owner, briefKey('inbox'));
      return iJson({ ok: true, dismissed: false });
    }
    const day = cleanDay(b?.day);
    if (b?.action !== 'dismiss' || !day) throw new InboxError('invalid_input', 400);
    await dismissBrief(owner, briefKey('inbox'), day);
    return iJson({ ok: true, day, dismissed: true });
  });
}
