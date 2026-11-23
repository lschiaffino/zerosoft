import { iJson, withOwner } from '@/lib/inbox/http';
import { limitByIp } from '@/lib/rate-limit';
import { limitWrites } from '@/lib/write-limit';
import { InboxError } from '@/lib/inbox/types';
import { personCard, reactionDetails, sendMyPresence, setBlocked, sharedContent, type SharedKind } from '@/lib/inbox/wa-meta';
import { makeSummary, readSummary } from '@/lib/inbox/wa-summary';
import { MEMBER_ACTIONS } from '@/lib/wa-group-members';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const KINDS: SharedKind[] = ['media', 'docs', 'links', 'starred'];

/**
 * Panel de info de un chat de WhatsApp: ?part=shared&kind=media|docs|links|starred
 * (lo compartido en el chat), ?part=summary (el resumen guardado) o
 * ?part=person&phone=<dígitos> (la ficha de una persona del grupo) o
 * ?part=reactions&messages=<id>,<id> (quién reaccionó a esos mensajes) o
 * ?part=info&message=<id> (la Info de un mensaje propio: quién lo recibió y lo leyó) o
 * ?part=notes (las notas propias del chat, para su pestaña: sin armar la conversación) o
 * ?part=crm (el contacto, la empresa y los negocios del CRM de zerosoft vinculados, con la visibilidad del CRM).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    if (sp.get('part') === 'summary') return iJson({ summary: await readSummary(owner, id) });
    // El CRM de zerosoft del chat (lib/inbox/crm.ts): null si quien mira no usa el CRM del workspace activo.
    if (sp.get('part') === 'crm') {
      const [{ inboxCrm }, user] = await Promise.all([import('@/lib/inbox/crm'), getCurrentUser()]);
      if (!user) throw new InboxError('unauthorized', 401);
      return iJson({ crm: await inboxCrm(user, owner, id) });
    }
    // Las notas del chat (solo las ve la persona dueña de la bandeja): una fila, sin mensajes ni la info de WhatsApp.
    if (sp.get('part') === 'notes') {
      const { getThreadRow } = await import('@/lib/inbox/core');
      return iJson({ notes: (await getThreadRow(owner, id)).notes ?? '' });
    }
    // La ficha de una persona del grupo (foto o nombre de quien escribió).
    if (sp.get('part') === 'person') return iJson({ person: await personCard(owner, id, (sp.get('phone') ?? '').slice(0, 30)) });
    // Quién reaccionó a esos mensajes del chat (el cuadro de reacciones).
    if (sp.get('part') === 'reactions') {
      const ids = (sp.get('messages') ?? '').split(',').map((x) => x.trim().slice(0, 100)).filter(Boolean).slice(0, 30);
      return iJson({ reactions: await reactionDetails(owner, id, ids) });
    }
    // Info de un mensaje propio: quién lo recibió y lo leyó, con sus horas (lib/inbox/wa-receipts.ts).
    if (sp.get('part') === 'info') {
      const { inboxMessageInfo } = await import('@/lib/inbox/wa-receipts');
      return iJson({ info: await inboxMessageInfo(owner, id, (sp.get('message') ?? '').slice(0, 100)) });
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
 * { action: 'invite', revoke? } da el link y { action: 'inviteSend', phones, text } lo manda por 1:1,
 * { action: 'crm', crmContactId?, crmCompanyId? } vincula el chat al CRM de zerosoft (lib/inbox/crm.ts).
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
  // { action: 'groupInfo', name?, description? } cambia el nombre o la descripción del grupo en WhatsApp.
  // { action: 'leave' } sale del grupo en WhatsApp; el chat queda de solo lectura (lib/inbox/wa-group-members.ts).
  if (b?.action === 'members' || b?.action === 'invite' || b?.action === 'inviteSend' || b?.action === 'groupInfo' || b?.action === 'leave') {
    const limitedM = await limitByIp(req, 'inbox-group-members', 60, 60).catch(() => null);
    if (limitedM) return limitedM;
    const body = b as { op?: unknown; phones?: unknown; revoke?: unknown; text?: unknown; name?: unknown; description?: unknown };
    return withOwner(async (owner) => {
      const { updateGroupMembers, groupInviteLinkFor, sendGroupInvites, updateGroupInfo, leaveGroupThread } = await import('@/lib/inbox/wa-group-members');
      if (b.action === 'leave') return iJson(await leaveGroupThread(owner, id));
      if (b.action === 'groupInfo') return iJson(await updateGroupInfo(owner, id, { name: body.name, description: body.description }));
      if (b.action === 'invite') return iJson({ link: await groupInviteLinkFor(owner, id, body.revoke === true) });
      if (b.action === 'inviteSend') return iJson({ results: await sendGroupInvites(owner, id, body.phones, body.text) });
      const op = MEMBER_ACTIONS.find((a) => a === body.op);
      if (!op) throw new InboxError('invalid_input', 400);
      return iJson(await updateGroupMembers(owner, id, op, body.phones));
    });
  }
  // { action: 'crm', crmContactId?, crmCompanyId? }: vincula o desvincula (null) el contacto o la empresa del CRM.
  if (b?.action === 'crm') {
    const body = b as { crmContactId?: unknown; crmCompanyId?: unknown };
    const ref = (v: unknown) => (v === null ? null : typeof v === 'string' && v.length <= 100 ? v : undefined);
    return withOwner(async (owner) => {
      const limitedW = await limitWrites('inbox', owner);
      if (limitedW) return limitedW;
      const user = await getCurrentUser();
      if (!user) throw new InboxError('unauthorized', 401);
      const { linkInboxCrm } = await import('@/lib/inbox/crm');
      return iJson({ crm: await linkInboxCrm(user, owner, id, { crmContactId: ref(body.crmContactId), crmCompanyId: ref(body.crmCompanyId) }) });
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
