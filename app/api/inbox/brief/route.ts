import { iJson, withOwner } from '@/lib/inbox/http';
import { InboxError } from '@/lib/inbox/types';
import { briefDismissed, briefEmailOn, cleanDay, dismissBrief, inboxBrief } from '@/lib/daily-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El resumen del día de Inbox de la persona (solo sus chats; lib/daily-brief.ts). ?day=<AAAA-MM-DD>, su día local. */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const day = cleanDay(new URL(req.url).searchParams.get('day'));
    if (!day) throw new InboxError('invalid_input', 400);
    const [brief, dismissed, email] = await Promise.all([inboxBrief(owner), briefDismissed(owner, 'inbox', day), briefEmailOn(owner)]);
    return iJson({ day, dismissed, email, brief });
  });
}

/** { action: 'dismiss', day }: cerrar la tarjeta por hoy. */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const b = (await req.json().catch(() => null)) as { action?: unknown; day?: unknown } | null;
    const day = cleanDay(b?.day);
    if (b?.action !== 'dismiss' || !day) throw new InboxError('invalid_input', 400);
    await dismissBrief(owner, 'inbox', day);
    return iJson({ ok: true, day, dismissed: true });
  });
}
