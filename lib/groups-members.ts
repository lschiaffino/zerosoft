/**
 * Lines: agregar, quitar y cambiar admins de un grupo desde el panel del chat.
 *
 * - Quién puede: cualquiera que ve el chat (la regla de siempre de la ruta de
 *   miembros: sesión + chatGuard). Los members ven solo las líneas que les
 *   dejan ver; un invitado o un rol con los teléfonos ocultos puede actuar con
 *   referencias (`member:` de la lista, `contact:` de la libreta, `chat:` de
 *   un chat 1:1 de la línea) sin ver ningún número.
 * - WhatsApp decide si la línea puede: si el número de la línea está en el
 *   grupo y no es admin, se corta antes con not_group_admin (403).
 * - El resultado vuelve por persona, con el motivo que la pantalla explica
 *   (lib/wa-group-members.ts). A quien su privacidad no deja agregar se le
 *   puede mandar el link (`sendInviteLinks`).
 */
import { getDb } from './db';
import { canSeeChat, maskPhone, type GroupsViewer } from './groups-access';
import { getChatRow, GroupsError, groupInviteLink, selfGroupRole, sendMessage, updateMembers } from './groups';
import { isValidPhone, phoneDigits, splitPhones } from './groups-provider';
import { MAX_MEMBER_TARGETS, memberRef, participantError, type MemberAction, type MemberTargetResult } from './wa-group-members';

interface Target {
  key: string;
  phone: string;
}

/** Teléfonos escritos y referencias → teléfonos. Lo que no se resuelve vuelve como error de esa persona. */
export async function resolveLinesTargets(
  viewer: GroupsViewer,
  chat: { id: string; number_id: string },
  input: { phones?: unknown; refs?: unknown },
): Promise<{ targets: Target[]; failed: MemberTargetResult[] }> {
  const db = getDb();
  const targets: Target[] = [];
  const failed: MemberTargetResult[] = [];
  const phones = splitPhones(Array.isArray(input.phones) ? input.phones.filter((p): p is string => typeof p === 'string') : []).slice(0, MAX_MEMBER_TARGETS);
  const refs = Array.isArray(input.refs) ? input.refs.filter((r): r is string => typeof r === 'string').slice(0, MAX_MEMBER_TARGETS) : [];
  for (const raw of phones) {
    const phone = phoneDigits(raw);
    if (!isValidPhone(phone)) failed.push({ key: raw.slice(0, 40), phone: raw.slice(0, 40), ok: false, error: 'invalid_phone' });
    else targets.push({ key: raw.slice(0, 40), phone });
  }
  let members: string[] | null = null;
  for (const ref of refs) {
    const key = ref.slice(0, 120);
    let phone = '';
    if (key.startsWith('member:')) {
      members ??= ((await db.prepare('SELECT phone FROM groups_members WHERE chat_id = ?').all(chat.id)) as Array<{ phone: string }>).map((m) => m.phone);
      phone = members.find((p) => memberRef(chat.id, p) === key) ?? '';
    } else if (key.startsWith('contact:') && !viewer.restricted) {
      // La libreta no se le muestra a quien solo ve sus chats: tampoco se resuelve por id.
      const row = (await db
        .prepare("SELECT phone FROM wa_contacts WHERE id = ? AND app = 'lines' AND account_id = ? AND user_id = ?")
        .get(key.slice(8), chat.number_id, viewer.ws)) as { phone: string } | undefined;
      phone = row?.phone ?? '';
    } else if (key.startsWith('chat:')) {
      const id = key.slice(5);
      const row = (await db
        .prepare("SELECT phone FROM groups_chats WHERE id = ? AND user_id = ? AND number_id = ? AND kind = 'dm'")
        .get(id, viewer.ws, chat.number_id)) as { phone: string } | undefined;
      phone = row && (await canSeeChat(viewer, id)) ? row.phone : '';
    }
    phone = phoneDigits(phone);
    if (!isValidPhone(phone)) failed.push({ key, phone: '', ok: false, error: 'not_found' });
    else targets.push({ key, phone });
  }
  return { targets: targets.slice(0, MAX_MEMBER_TARGETS), failed };
}

const shown = (viewer: GroupsViewer, phone: string) => (viewer.mask && phone ? maskPhone(phone).replace(/^\+/, '') : phone);

/**
 * Hace la acción con WhatsApp y devuelve el resultado por persona. Errores
 * del pedido entero: not_found (404), not_a_group, not_group_admin (403),
 * no_targets (400) y el del proveedor (502).
 */
export async function manageLinesMembers(
  viewer: GroupsViewer,
  chatId: string,
  action: MemberAction,
  input: { phones?: unknown; refs?: unknown },
): Promise<MemberTargetResult[]> {
  const chat = await getChatRow(viewer.ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  if (chat.kind !== 'group') throw new GroupsError('not_a_group');
  if ((await selfGroupRole(viewer.ws, chatId)) === 'member') throw new GroupsError('not_group_admin', 403);
  const { targets, failed } = await resolveLinesTargets(viewer, chat, input);
  const own = phoneDigits(((await getDb().prepare('SELECT phone FROM groups_numbers WHERE id = ?').get(chat.number_id)) as { phone: string } | undefined)?.phone ?? '');
  const out: MemberTargetResult[] = [...failed.map((f) => ({ ...f, phone: shown(viewer, f.phone) }))];
  const go: Target[] = [];
  for (const t of targets) {
    // La línea misma: quitarse es "salir del grupo" (otro botón) y su rol no se cambia desde acá.
    if (own && t.phone === own) out.push({ key: t.key, phone: shown(viewer, t.phone), ok: false, error: 'own_number' });
    else if (!go.some((g) => g.phone === t.phone)) go.push(t);
  }
  if (go.length === 0) {
    if (out.length) return out;
    throw new GroupsError('no_targets');
  }
  const [result] = await updateMembers(viewer.ws, [chatId], action, go.map((t) => t.phone));
  if (!result.ok) {
    const code = result.error ?? 'provider_error';
    throw new GroupsError(code, code === 'not_group_admin' ? 403 : 502);
  }
  for (const t of go) {
    const r = result.results.find((x) => phoneDigits(x.phone) === t.phone);
    out.push(r?.ok ? { key: t.key, phone: shown(viewer, t.phone), ok: true } : { key: t.key, phone: shown(viewer, t.phone), ok: false, error: participantError(r?.error) });
  }
  return out;
}

/**
 * "Mandar el link": a quienes WhatsApp no dejó agregar, un mensaje 1:1 desde
 * la línea con el texto de la pantalla y el link de invitación del grupo.
 */
export async function sendInviteLinks(
  viewer: GroupsViewer,
  chatId: string,
  input: { phones?: unknown; refs?: unknown; text?: unknown },
): Promise<MemberTargetResult[]> {
  const chat = await getChatRow(viewer.ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  if (chat.kind !== 'group') throw new GroupsError('not_a_group');
  const { targets, failed } = await resolveLinesTargets(viewer, chat, input);
  if (targets.length === 0 && failed.length === 0) throw new GroupsError('no_targets');
  const link = chat.invite_link && !chat.invite_link.startsWith('sample:') ? chat.invite_link : await groupInviteLink(viewer.ws, chatId, false);
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 500) : '';
  const body = text ? `${text}\n${link}` : link;
  const { startChat } = await import('./groups-new-chat');
  const out: MemberTargetResult[] = failed.map((f) => ({ ...f, phone: shown(viewer, f.phone) }));
  for (const t of targets.slice(0, 20)) {
    try {
      const dm = await startChat(viewer, { numberId: chat.number_id, phone: t.phone });
      await sendMessage(viewer.ws, viewer.me, dm.id, { body, authorKind: 'person' });
      out.push({ key: t.key, phone: shown(viewer, t.phone), ok: true });
    } catch (err) {
      const code = err instanceof GroupsError ? err.code : 'failed';
      out.push({ key: t.key, phone: shown(viewer, t.phone), ok: false, error: participantError(code === 'not_on_whatsapp' ? code : 'failed') });
    }
  }
  return out;
}
