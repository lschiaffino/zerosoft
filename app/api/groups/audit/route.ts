import { NextResponse } from 'next/server';
import { listAudit } from '@/lib/groups-audit';
import { canSeeChat, maskPhoneText, scopeChatCrmRefs, visibleChatIds } from '@/lib/groups-access';
import { groupsError, groupsSession, sessionViewer } from '@/lib/groups-http';

export const runtime = 'nodejs';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
export const dynamic = 'force-dynamic';

/**
 * Log de auditoría. ?chat=<id> el de un chat (quien ve el chat); sin chat, el
 * del workspace (solo admins). Filtros: action, actor.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const chatId = p.get('chat') || undefined;
  const viewer = await sessionViewer(s);
  if (chatId) {
    if (!(await canSeeChat(viewer, chatId))) return groupsError(404, 'not_found');
  } else if (!s.isAdmin) return groupsError(403, 'forbidden');
  const entries = await listAudit(s.ws, {
    chatId,
    action: p.get('action') || undefined,
    actorId: p.get('actor') || undefined,
    chatIds: chatId ? null : await visibleChatIds(viewer),
    limit: Number(p.get('limit')) || 100,
  });
  // Un cambio de vínculo al CRM: solo los ids del contacto y la empresa que quien mira ve en el CRM.
  const links = await scopeChatCrmRefs(
    viewer,
    entries.map((e) => (e.action === 'crm_link' ? { crmContactId: str(e.detail.contactId), crmCompanyId: str(e.detail.companyId) } : { crmContactId: null, crmCompanyId: null })),
  );
  const scoped = entries.map((e, i) => (e.action === 'crm_link' ? { ...e, detail: { ...e.detail, contactId: links[i].crmContactId, companyId: links[i].crmCompanyId } } : e));
  // Con teléfonos ocultos: también en el detalle (un nombre o un título que era el teléfono); los ids quedan.
  const maskDetail = (d: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(d).map(([k, v]) => [
        k,
        /id$/i.test(k) ? v : typeof v === 'string' ? maskPhoneText(v) : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? maskPhoneText(x) : x)) : v,
      ]),
    );
  return NextResponse.json({ entries: viewer.mask ? scoped.map((e) => ({ ...e, chatName: maskPhoneText(e.chatName), detail: maskDetail(e.detail) })) : scoped });
}
