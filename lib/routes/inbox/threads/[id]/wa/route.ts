import { iJson, withOwner } from '@/lib/inbox/http';
import { limitByIp } from '@/lib/rate-limit';
import { InboxError } from '@/lib/inbox/types';
import { personCard, reactionDetails, sendMyPresence, setBlocked, sharedContent, type SharedKind } from '@/lib/inbox/wa-meta';
import { makeSummary, readSummary } from '@/lib/inbox/wa-summary';
import { MEMBER_ACTIONS } from '@/lib/wa-group-members';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const KINDS: SharedKind[] = ['media', 'docs', 'links', 'starred'];

/**
 * Panel de info de un chat de WhatsApp: ?part=shared&kind=media|docs|links|starred
 * (lo compartido en el chat), ?part=summary (el resumen guardado) o
 * ?part=person&phone=<dígitos> (la ficha de una persona del grupo) o
 * ?part=reactions&messages=<id>,<id> (quién reaccionó a esos mensajes).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    if (sp.get('part') === 'summary') return iJson({ summary: await readSummary(owner, id) });
    // La ficha de una persona del grupo (foto o nombre de quien escribió).
    if (sp.get('part') === 'person') return iJson({ person: await personCard(owner, id, (sp.get('phone') ?? '').slice(0, 30)) });
    // Quién reaccionó a esos mensajes del chat (el cuadro de reacciones).
    if (sp.get('part') === 'reactions') {
      const ids = (sp.get('messages') ?? '').split(',').map((x) => x.trim().slice(0, 100)).filter(Boolean).slice(0, 30);
      return iJson({ reactions: await reactionDetails(owner, id, ids) });
    }
    const kind = sp.get('kind') as SharedKind;
    if (!KINDS.includes(kind)) throw new InboxError('invalid_input', 400);
    return iJson({ items: await sharedContent(owner, id, kind) });
  });
}

/**
 * { action: 'summary' } pide un resumen nuevo a la IA; { action: 'block' |
 * 'unblock' } bloquea en WhatsApp; { action: 'presence', state } manda
 * "escribiendo", "grabando" o se suscribe a la presencia del chat ("paused");
 * { action: 'fetchMissing' } "Traer mensajes que faltan" ({ action: 'fetchMissingStatus' } dice cómo va);
 * { action: 'fetchMissing', auto: true } le pide al teléfono el historial de un chat con huecos;
 * { action: 'loadOlder' } le pide los mensajes anteriores al más viejo guardado;
 * { action: 'members', op, phones } agrega, quita o cambia admins del grupo (resultado por persona),
 * { action: 'invite', revoke? } da el link y { action: 'inviteSend', phones, text } lo manda por 1:1.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { action?: unknown; state?: unknown } | null;
  if (b?.action === 'presence') {
    const limitedP = await limitByIp(req, 'inbox-presence', 120, 60).catch(() => null);
    if (limitedP) return limitedP;
    const state = b.state === 'composing' || b.state === 'recording' ? b.state : 'paused';
    return withOwner(async (owner) => {
      await sendMyPresence(owner, id, state);
      return iJson({ ok: true });
    });
  }
  if (b?.action === 'fetchMissing' && (b as { auto?: unknown }).auto !== true) {
    // "Traer mensajes que faltan" a mano: anclas exactas alrededor de los huecos y antes del último mensaje.
    const limitedR = await limitByIp(req, 'inbox-refresh-missing', 30, 60).catch(() => null);
    if (limitedR) return limitedR;
    return withOwner(async (owner) => {
      const { requestRefresh, refreshResponse } = await import('@/lib/wa-history-gaps');
      const out = await requestRefresh('inbox', owner, id);
      if (!out) throw new InboxError('not_found', 404);
      const r = refreshResponse(out);
      return iJson(r.body, r.status);
    });
  }
  if (b?.action === 'fetchMissingStatus') {
    return withOwner(async (owner) => {
      const { requestRefreshStatus } = await import('@/lib/wa-history-gaps');
      const st = await requestRefreshStatus('inbox', owner, id);
      if (!st) throw new InboxError('not_found', 404);
      return iJson(st);
    });
  }
  if (b?.action === 'fetchMissing') {
    // El historial del chat desde el teléfono (mensajes que WhatsApp no pudo entregar, lib/wa-history-gaps.ts).
    const auto = (b as { auto?: unknown }).auto === true;
    return withOwner(async (owner) => {
      const { requestChatHistory, historyResponse } = await import('@/lib/wa-history-gaps');
      const out = await requestChatHistory('inbox', owner, id, { auto });
      if (!out) throw new InboxError('not_found', 404);
      const r = historyResponse(out, auto);
      return iJson(r.body, r.status);
    });
  }
  if (b?.action === 'loadOlder') {
    // "Cargar mensajes anteriores": le pide al teléfono los anteriores al más viejo guardado (lib/wa-history-gaps.ts).
    const limitedO = await limitByIp(req, 'inbox-load-older', 60, 60).catch(() => null);
    if (limitedO) return limitedO;
    return withOwner(async (owner) => {
      const { requestOlderHistory, olderResponse } = await import('@/lib/wa-history-gaps');
      const out = await requestOlderHistory('inbox', owner, id);
      if (!out) throw new InboxError('not_found', 404);
      const r = olderResponse(out);
      return iJson(r.body, r.status);
    });
  }
  // Miembros del grupo: { action: 'members', op: add|remove|promote|demote, phones }, { action: 'invite', revoke? }
  // (el link) y { action: 'inviteSend', phones, text } (el link por 1:1 a quienes WhatsApp no dejó agregar).
  if (b?.action === 'members' || b?.action === 'invite' || b?.action === 'inviteSend') {
    const limitedM = await limitByIp(req, 'inbox-group-members', 60, 60).catch(() => null);
    if (limitedM) return limitedM;
    const body = b as { op?: unknown; phones?: unknown; revoke?: unknown; text?: unknown };
    return withOwner(async (owner) => {
      const { updateGroupMembers, groupInviteLinkFor, sendGroupInvites } = await import('@/lib/inbox/wa-group-members');
      if (b.action === 'invite') return iJson({ link: await groupInviteLinkFor(owner, id, body.revoke === true) });
      if (b.action === 'inviteSend') return iJson({ results: await sendGroupInvites(owner, id, body.phones, body.text) });
      const op = MEMBER_ACTIONS.find((a) => a === body.op);
      if (!op) throw new InboxError('invalid_input', 400);
      return iJson(await updateGroupMembers(owner, id, op, body.phones));
    });
  }
  const limited = await limitByIp(req, 'inbox-ai', 60, 60).catch(() => null);
  if (limited) return limited;
  return withOwner(async (owner) => {
    if (b?.action === 'summary') return iJson({ summary: await makeSummary(owner, id) });
    if (b?.action === 'block' || b?.action === 'unblock') {
      await setBlocked(owner, id, b.action === 'block');
      return iJson({ ok: true });
    }
    throw new InboxError('invalid_input', 400);
  });
}
