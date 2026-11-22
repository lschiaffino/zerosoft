/**
 * Inbox: agregar, quitar y cambiar admins de un grupo de WhatsApp de la
 * persona, con su cuenta vinculada (el mismo proveedor que Lines). Es su
 * WhatsApp: decide WhatsApp. Si la cuenta está en el grupo y no es admin, se
 * corta antes con not_group_admin (403). El resultado vuelve por persona
 * (lib/wa-group-members.ts) y los participantes se vuelven a leer de WhatsApp.
 */
import { phoneDigits, isValidPhone, splitPhones, ProviderError, type MemberRole } from '../groups-provider';
import { getDb } from '../db';
import { listAccounts, nowIso, type AccountRow, type ThreadRow } from './core';
import { InboxError, type ParticipantDto } from './types';
import { waProviderFor } from './whatsapp';
import { applyChatInfo, groupParticipants, parseThreadInfo, refreshChatInfo } from './wa-meta';
import { MAX_MEMBER_TARGETS, participantError, type MemberAction, type MemberTargetResult } from '../wa-group-members';
import { GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX } from '../wa-group-limits';

async function groupThread(owner: string, threadId: string): Promise<{ thread: ThreadRow; account: AccountRow }> {
  const thread = (await getDb().prepare('SELECT * FROM inbox_threads WHERE id = ? AND owner_id = ? AND removed_at IS NULL').get(threadId, owner)) as ThreadRow | undefined;
  if (!thread || thread.channel !== 'whatsapp') throw new InboxError('not_found', 404);
  if (thread.kind !== 'group') throw new InboxError('not_a_group', 400);
  const account = (await listAccounts(owner)).find((a) => a.id === thread.account_id);
  if (!account || account.status !== 'connected') throw new InboxError('not_connected', 409);
  return { thread, account };
}

/** El rol de la cuenta en el grupo según los participantes guardados; null si no se sabe. */
export function selfRoleIn(thread: Pick<ThreadRow, 'info'>, myPhone: string): MemberRole | null {
  const me = phoneDigits(myPhone);
  if (!me) return null;
  return parseThreadInfo(thread.info).participants.find((p) => phoneDigits(p.phone) === me)?.role ?? null;
}

/** Los participantes después del cambio: los de WhatsApp si los da; si no, lo guardado con el cambio aplicado. */
async function reconcile(owner: string, thread: ThreadRow, account: AccountRow, action: MemberAction, done: string[]): Promise<ParticipantDto[]> {
  const fresh = await refreshChatInfo(account, thread).catch(() => false);
  if (!fresh && done.length) {
    const info = parseThreadInfo(thread.info);
    let list = info.participants.map((p) => ({ ...p, phone: phoneDigits(p.phone) }));
    if (action === 'add') list = [...list, ...done.filter((p) => !list.some((x) => x.phone === p)).map((phone) => ({ phone, role: 'member' as const }))];
    else if (action === 'remove') list = list.filter((p) => !done.includes(p.phone));
    else list = list.map((p) => (done.includes(p.phone) && p.role !== 'superadmin' ? { ...p, role: action === 'promote' ? ('admin' as const) : ('member' as const) } : p));
    await applyChatInfo(thread, { name: '', about: info.about, pictureUrl: thread.avatar_url ?? '', participants: list, size: Math.max(list.length, info.size + (action === 'add' ? done.length : action === 'remove' ? -done.length : 0)), createdAt: info.createdAt ?? undefined, isBusiness: info.isBusiness });
  }
  const row = (await getDb().prepare('SELECT * FROM inbox_threads WHERE id = ?').get(thread.id)) as ThreadRow;
  return groupParticipants(owner, row, phoneDigits(account.address));
}

/**
 * Agrega, quita, hace admin o deja de hacer admin a esos teléfonos. Errores
 * del pedido entero: not_found (404), not_a_group, not_connected (409),
 * not_group_admin (403), invalid_input (sin teléfonos) y send_failed (502).
 */
export async function updateGroupMembers(
  owner: string,
  threadId: string,
  action: MemberAction,
  rawPhones: unknown,
): Promise<{ results: MemberTargetResult[]; participants: ParticipantDto[]; size: number }> {
  const { thread, account } = await groupThread(owner, threadId);
  const myPhone = phoneDigits(account.address);
  if (selfRoleIn(thread, myPhone) === 'member') throw new InboxError('not_group_admin', 403);
  const raw = splitPhones(Array.isArray(rawPhones) ? rawPhones.filter((p): p is string => typeof p === 'string') : []).slice(0, MAX_MEMBER_TARGETS);
  const results: MemberTargetResult[] = [];
  const go: Array<{ key: string; phone: string }> = [];
  for (const key of raw) {
    const phone = phoneDigits(key);
    if (!isValidPhone(phone)) results.push({ key, phone: key, ok: false, error: 'invalid_phone' });
    else if (myPhone && phone === myPhone) results.push({ key, phone, ok: false, error: 'own_number' });
    else if (!go.some((g) => g.phone === phone)) go.push({ key, phone });
  }
  if (go.length === 0 && results.length === 0) throw new InboxError('invalid_input', 400);
  let done: string[] = [];
  if (go.length) {
    let res;
    try {
      res = await waProviderFor(account).updateParticipants(thread.external_id, action, go.map((g) => g.phone));
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'not_group_admin') throw new InboxError('not_group_admin', 403);
      if (err instanceof ProviderError && err.code === 'not_connected') throw new InboxError('not_connected', 409);
      throw new InboxError('send_failed', 502);
    }
    for (const g of go) {
      const r = res.find((x) => phoneDigits(x.phone) === g.phone);
      results.push(r?.ok ? { key: g.key, phone: g.phone, ok: true } : { key: g.key, phone: g.phone, ok: false, error: participantError(r?.error) });
    }
    done = results.filter((r) => r.ok).map((r) => r.phone);
  }
  const participants = await reconcile(owner, thread, account, action, done);
  const size = parseThreadInfo(((await getDb().prepare('SELECT info FROM inbox_threads WHERE id = ?').get(thread.id)) as { info: string } | undefined)?.info).size;
  return { results, participants, size: size || participants.length };
}

/**
 * Lo que se pide cambiar del grupo, limpio: nombre sin espacios de más (no
 * vacío) y descripción (puede quedar vacía, como en WhatsApp). invalid_name si
 * el nombre queda vacío; invalid_input si no viene ninguno de los dos.
 */
export function cleanGroupInfoPatch(raw: { name?: unknown; description?: unknown }): { name?: string; description?: string } {
  const out: { name?: string; description?: string } = {};
  if (typeof raw.name === 'string') {
    const name = raw.name.replace(/\s+/g, ' ').trim().slice(0, GROUP_NAME_MAX);
    if (!name) throw new InboxError('invalid_name', 400);
    out.name = name;
  }
  if (typeof raw.description === 'string') out.description = raw.description.trim().slice(0, GROUP_DESCRIPTION_MAX);
  if (out.name === undefined && out.description === undefined) throw new InboxError('invalid_input', 400);
  return out;
}

/**
 * Cambia el nombre o la descripción del grupo en WhatsApp, como el lápiz de
 * la info del grupo en WhatsApp Web, y deja el aviso "Cambiaste…" en el chat
 * (WhatsApp no avisa a los dispositivos vinculados lo que hace uno). Si el
 * grupo solo deja editar a los admins, lo decide WhatsApp: not_group_admin.
 */
export async function updateGroupInfo(owner: string, threadId: string, raw: { name?: unknown; description?: unknown }): Promise<{ title: string; about: string }> {
  const { thread, account } = await groupThread(owner, threadId);
  const patch = cleanGroupInfoPatch(raw);
  const info = parseThreadInfo(thread.info);
  if (patch.name === thread.title) delete patch.name;
  if (patch.description === info.about) delete patch.description;
  if (patch.name === undefined && patch.description === undefined) return { title: thread.title, about: info.about };
  try {
    await waProviderFor(account).updateGroup(thread.external_id, patch);
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'not_group_admin') throw new InboxError('not_group_admin', 403);
    if (err instanceof ProviderError && err.code === 'not_connected') throw new InboxError('not_connected', 409);
    throw new InboxError('send_failed', 502);
  }
  const title = patch.name ?? thread.title;
  const about = patch.description ?? info.about;
  let stored: Record<string, unknown> = {};
  try {
    stored = thread.info ? (JSON.parse(thread.info) as Record<string, unknown>) : {};
  } catch {
    stored = {};
  }
  await getDb()
    .prepare('UPDATE inbox_threads SET title = ?, info = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(title, JSON.stringify({ ...stored, about }), nowIso(), thread.id, owner);
  const { addInboxGroupEvent } = await import('../wa-group-system');
  if (patch.name !== undefined) await addInboxGroupEvent(thread, { t: 'subject', by: { p: 'me' }, subject: title }, nowIso()).catch(() => false);
  if (patch.description !== undefined) await addInboxGroupEvent(thread, { t: 'description', by: { p: 'me' } }, nowIso()).catch(() => false);
  return { title, about };
}

/** El link de invitación del grupo (con `revoke`, uno nuevo y el anterior deja de andar). */
export async function groupInviteLinkFor(owner: string, threadId: string, revoke = false): Promise<string> {
  const { thread, account } = await groupThread(owner, threadId);
  if (selfRoleIn(thread, phoneDigits(account.address)) === 'member') throw new InboxError('not_group_admin', 403);
  try {
    return await waProviderFor(account).inviteLink(thread.external_id, revoke);
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'not_group_admin') throw new InboxError('not_group_admin', 403);
    throw new InboxError('send_failed', 502);
  }
}

/**
 * "Salir del grupo", como en WhatsApp: la cuenta sale en WhatsApp, el chat
 * queda como historial de solo lectura (left_at) con el aviso "Saliste" y se
 * puede seguir leyendo, buscando y borrando. Ya fuera: group_left (409).
 */
export async function leaveGroupThread(owner: string, threadId: string): Promise<{ leftAt: string }> {
  const { thread, account } = await groupThread(owner, threadId);
  if (thread.left_at) throw new InboxError('group_left', 409);
  try {
    await waProviderFor(account).leaveGroup(thread.external_id);
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'not_connected') throw new InboxError('not_connected', 409);
    throw new InboxError('send_failed', 502);
  }
  const at = nowIso();
  const { addInboxGroupEvent, applyInboxMembership } = await import('../wa-group-system');
  const e = { t: 'leave' as const, by: { p: 'me' } };
  await addInboxGroupEvent(thread, e, at).catch(() => false);
  await applyInboxMembership(thread.id, e, at);
  await getDb().prepare('UPDATE inbox_threads SET updated_at = ? WHERE id = ? AND owner_id = ?').run(at, thread.id, owner);
  return { leftAt: at };
}

/** "Mandar el link" a quienes WhatsApp no dejó agregar: un mensaje 1:1 con el texto de la pantalla y el link. */
export async function sendGroupInvites(owner: string, threadId: string, rawPhones: unknown, text: unknown): Promise<MemberTargetResult[]> {
  const link = await groupInviteLinkFor(owner, threadId);
  const body = `${typeof text === 'string' && text.trim() ? `${text.trim().slice(0, 500)}\n` : ''}${link}`;
  const { startWhatsappChat } = await import('./whatsapp');
  const { sendWaMessage } = await import('./wa-actions');
  const out: MemberTargetResult[] = [];
  for (const key of splitPhones(Array.isArray(rawPhones) ? rawPhones.filter((p): p is string => typeof p === 'string') : []).slice(0, 20)) {
    const phone = phoneDigits(key);
    try {
      const dm = await startWhatsappChat(owner, phone);
      await sendWaMessage(owner, dm.id, body);
      out.push({ key, phone, ok: true });
    } catch {
      out.push({ key, phone, ok: false, error: 'failed' });
    }
  }
  return out;
}
