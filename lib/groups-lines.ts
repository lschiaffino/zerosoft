/**
 * Groups, varias líneas y equipo (como Periskope): varias líneas de WhatsApp
 * en una bandeja, con estado y salud por línea, acceso por línea (personas o
 * equipos), el mismo chat en dos líneas mostrado una vez y "Responder
 * desde" para elegir la línea que contesta, la vista de equipo (roles,
 * líneas, disponibilidad) y el historial de asignación. Server-only.
 *
 * Modelo: cada línea (groups_numbers) tiene sus chats (groups_chats, único
 * por número + id del proveedor). El mismo grupo en dos líneas son dos
 * filas con el mismo provider_chat_id; el mismo contacto, dos filas 1:1 con
 * el mismo teléfono. `lineKeySql` es esa clave.
 */
import { getDb } from './db';
import { GroupsError, getChatRow, getNumberRow, listNumbers, listPeople, upsertChat, type ChatRow, type NumberDto, type NumberRow } from './groups';
import { canSeeChat, chatAccessSql, personLineIds, personTeamIds, type GroupsViewer } from './groups-access';
import { recordAudit } from './groups-audit';
import { lineColor, type Availability, type ReplyLine } from './groups-lines-shared';
import { phoneDigits } from './groups-provider';

/** Clave que une el mismo chat en distintas líneas: el grupo por su id, el 1:1 por teléfono. */
export function lineKeySql(alias = 'c'): string {
  return `(${alias}.kind || '|' || CASE WHEN ${alias}.kind = 'dm' AND ${alias}.phone != '' THEN ${alias}.phone ELSE ${alias}.provider_chat_id END)`;
}

// ======================================================================
// Líneas: estado, salud y acceso
// ======================================================================

export interface LineAccess {
  personIds: string[];
  teamIds: string[];
}

export interface LineDto extends NumberDto {
  /** Color efectivo (el elegido o el automático). */
  displayColor: string;
  /** Último mensaje (entrante o saliente) en un chat de la línea. */
  lastMessageAt: string | null;
  /** Chats abiertos de la línea. */
  openChats: number;
  /** Quién la ve con el acceso por línea prendido (solo admins lo reciben). */
  access?: LineAccess;
  /** Importación del historial en curso o terminada. */
  import: { status: string; chatsDone: number; chatsTotal: number; messages: number; error: string; finishedAt: string | null } | null;
}

export async function listLineAccess(ws: string): Promise<Record<string, LineAccess>> {
  const rows = (await getDb().prepare('SELECT number_id, subject_kind, subject_id FROM groups_line_access WHERE user_id = ?').all(ws)) as Array<{
    number_id: string;
    subject_kind: 'person' | 'team';
    subject_id: string;
  }>;
  const out: Record<string, LineAccess> = {};
  for (const r of rows) {
    const a = (out[r.number_id] ??= { personIds: [], teamIds: [] });
    (r.subject_kind === 'team' ? a.teamIds : a.personIds).push(r.subject_id);
  }
  return out;
}

/** Reemplaza quién ve una línea (personas del workspace y equipos de Groups). */
export async function setLineAccess(ws: string, actor: string | null, numberId: string, input: { personIds?: unknown; teamIds?: unknown }): Promise<LineAccess> {
  const db = getDb();
  const number = await getNumberRow(ws, numberId);
  if (!number) throw new GroupsError('not_found', 404);
  const people = new Set((await listPeople(ws)).map((p) => p.id));
  const teams = new Set(((await db.prepare('SELECT id FROM groups_teams WHERE user_id = ?').all(ws)) as Array<{ id: string }>).map((t) => t.id));
  const clean = (v: unknown, ok: Set<string>) => [...new Set(Array.isArray(v) ? v.map(String) : [])].filter((id) => ok.has(id)).slice(0, 500);
  const prev = (await listLineAccess(ws))[numberId] ?? { personIds: [], teamIds: [] };
  const next: LineAccess = {
    personIds: input.personIds !== undefined ? clean(input.personIds, people) : prev.personIds,
    teamIds: input.teamIds !== undefined ? clean(input.teamIds, teams) : prev.teamIds,
  };
  await db.prepare('DELETE FROM groups_line_access WHERE user_id = ? AND number_id = ?').run(ws, numberId);
  for (const id of next.personIds) {
    await db.prepare("INSERT OR IGNORE INTO groups_line_access (user_id, number_id, subject_kind, subject_id) VALUES (?, ?, 'person', ?)").run(ws, numberId, id);
  }
  for (const id of next.teamIds) {
    await db.prepare("INSERT OR IGNORE INTO groups_line_access (user_id, number_id, subject_kind, subject_id) VALUES (?, ?, 'team', ?)").run(ws, numberId, id);
  }
  await recordAudit(ws, { chatId: null, chatName: number.name, actorId: actor, action: 'line_access', detail: { numberId, ...next } });
  await releaseLostLines(ws, [numberId]);
  return next;
}

/**
 * Con el acceso por línea prendido, quien perdió una línea deja de tener
 * asignados sus chats abiertos (vuelven a las reglas). Lo llaman el cambio
 * de acceso de una línea y el prender el ajuste.
 */
export async function releaseLostLines(ws: string, numberIds?: string[]): Promise<number> {
  const db = getDb();
  const ids = numberIds ?? ((await db.prepare('SELECT id FROM groups_numbers WHERE user_id = ?').all(ws)) as Array<{ id: string }>).map((r) => r.id);
  const { releaseChat } = await import('./groups-inbox');
  let n = 0;
  for (const numberId of ids) {
    const allowed = await peopleWithLine(ws, numberId);
    if (!allowed) return 0;
    const rows = (await db
      .prepare("SELECT * FROM groups_chats WHERE user_id = ? AND number_id = ? AND status = 'open' AND assigned_to IS NOT NULL LIMIT 1000")
      .all(ws, numberId)) as ChatRow[];
    for (const chat of rows) if (chat.assigned_to && !allowed.has(chat.assigned_to) && (await releaseChat(ws, chat, chat.assigned_to, 'no_access'))) n++;
  }
  return n;
}

/** Líneas que la persona ve, con su salud. Admins reciben además quién tiene acceso. */
export async function listLines(ws: string, viewer: GroupsViewer | null, opts: { withAccess?: boolean } = {}): Promise<LineDto[]> {
  const db = getDb();
  const numbers = (await listNumbers(ws)).filter((n) => !viewer?.lineIds || viewer.lineIds.includes(n.id));
  if (numbers.length === 0) return [];
  const stats = (await db
    .prepare(
      `SELECT number_id, MAX(last_message_at) AS last_at, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_chats
       FROM groups_chats WHERE user_id = ? GROUP BY number_id`,
    )
    .all(ws)) as Array<{ number_id: string; last_at: string | null; open_chats: number }>;
  const imports = (await db
    .prepare('SELECT number_id, status, chats_done, chats_total, messages, error, finished_at FROM groups_imports WHERE user_id = ?')
    .all(ws)) as Array<{ number_id: string; status: string; chats_done: number; chats_total: number; messages: number; error: string; finished_at: string | null }>;
  const access = opts.withAccess ? await listLineAccess(ws) : null;
  return numbers.map((n) => {
    const st = stats.find((s) => s.number_id === n.id);
    const im = imports.find((i) => i.number_id === n.id);
    return {
      ...n,
      displayColor: lineColor(n),
      lastMessageAt: st?.last_at ?? null,
      openChats: Number(st?.open_chats ?? 0),
      ...(access ? { access: access[n.id] ?? { personIds: [], teamIds: [] } } : {}),
      import: im
        ? { status: im.status, chatsDone: Number(im.chats_done), chatsTotal: Number(im.chats_total), messages: Number(im.messages), error: im.error, finishedAt: im.finished_at }
        : null,
    };
  });
}

/** El estado de una línea cambió (webhook, conectar, desconectar): auditoría y aviso a los admins si se cayó. */
export async function lineStatusChanged(row: NumberRow, status: string): Promise<void> {
  if (row.provider === 'sample') return;
  await recordAudit(row.user_id, { chatId: null, chatName: row.name, actorId: null, actorKind: 'system', action: 'line_status', detail: { numberId: row.id, from: row.status, to: status } });
  const fell = row.status === 'connected' && (status === 'disconnected' || status === 'error');
  if (!fell) return;
  const { createNotification } = await import('./notifications');
  const { localized } = await import('./notification-copy');
  for (const id of await adminIds(row.user_id)) {
    await createNotification({
      userId: id,
      type: 'groups_line',
      title: localized('groupsLineDown', { line: `${row.name}${row.phone ? ` (+${row.phone})` : ''}` }),
      body: localized('groupsLineDownBody'),
      href: '/app/groups/settings?tab=numbers',
      sourceType: 'groups_number',
      sourceId: row.id,
      meta: { line: row.name },
    }).catch(() => null);
  }
}

async function adminIds(ws: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT DISTINCT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.role IN ('owner', 'admin')`,
    )
    .all(ws)) as Array<{ user_id: string }>;
  return [...new Set([ws, ...rows.map((r) => r.user_id)])];
}

// ======================================================================
// El mismo chat en varias líneas
// ======================================================================

/**
 * Filas del mismo chat en otras líneas. Por defecto solo las que la persona
 * puede ver con sus reglas de acceso (línea, etiqueta, equipo); el chat
 * abierto siempre va (quien llama ya comprobó que lo ve). `all` trae todas,
 * solo para decisiones internas (nunca para mostrar ni para escribir).
 */
export async function siblingChats(ws: string, viewer: GroupsViewer | null, chatId: string, opts: { all?: boolean } = {}): Promise<ChatRow[]> {
  const db = getDb();
  const access = opts.all ? null : chatAccessSql(viewer, 'c');
  const rows = (await db
    .prepare(
      `SELECT c.* FROM groups_chats c JOIN groups_chats me ON me.id = ? AND me.user_id = c.user_id
       WHERE c.user_id = ? AND ${lineKeySql('c')} = ${lineKeySql('me')}${access ? ` AND (c.id = me.id OR ${access.sql})` : ''}
       ORDER BY c.id = me.id DESC, COALESCE(c.last_message_at, c.created_at) DESC`,
    )
    .all(chatId, ws, ...(access?.args ?? []))) as ChatRow[];
  return rows;
}

/**
 * Líneas por las que se puede responder este chat ("Responder desde"):
 * las que ya tienen el chat y la persona lo ve ahí, y en un 1:1 también las
 * demás líneas conectadas que ve y donde todavía no hay chat (empieza la
 * conversación desde esa línea). Una línea donde el chat existe pero la
 * persona no lo ve no se ofrece.
 */
export async function chatLines(ws: string, viewer: GroupsViewer | null, chatId: string): Promise<ReplyLine[]> {
  const chat = await getChatRow(ws, chatId);
  if (!chat) return [];
  const all = await siblingChats(ws, viewer, chatId, { all: true });
  const visible = new Set((await siblingChats(ws, viewer, chatId)).map((c) => c.id));
  const numbers = (await listNumbers(ws)).filter((n) => !viewer?.lineIds || viewer.lineIds.includes(n.id));
  const out: ReplyLine[] = [];
  for (const n of numbers) {
    const row = all.find((s) => s.number_id === n.id);
    if (row && !visible.has(row.id)) continue;
    // Un grupo solo se responde por las líneas que están en el grupo; un 1:1, por cualquier línea con teléfono real.
    if (!row && (chat.kind === 'group' || !chat.phone || n.provider === 'sample')) continue;
    out.push({
      chatId: row?.id ?? '',
      numberId: n.id,
      name: n.name,
      phone: n.phone,
      color: lineColor(n),
      status: n.status,
      canSend: n.status === 'connected' && !row?.left_at,
      isDefault: n.id === chat.number_id,
    });
  }
  return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Id del chat en otra línea para un 1:1, con el formato de ese proveedor. */
function dmProviderChatId(provider: NumberRow['provider'], phone: string): string {
  if (provider === 'cloud') return phone;
  return provider === 'waha' || provider === 'fake' ? `${phone}@c.us` : `${phone}@s.whatsapp.net`;
}

/**
 * El chat por el que sale una respuesta "desde" una línea. Sin línea o la
 * misma: el chat abierto. Otra línea que ya tiene el chat: esa fila, solo
 * si la persona la ve. Un 1:1 en una línea que nunca le habló: se crea el
 * chat en esa línea con la misma asignación, equipo y etiquetas que el
 * abierto (así queda visible para las mismas personas).
 */
export async function resolveReplyChat(ws: string, viewer: GroupsViewer | null, chatId: string, numberId: string | null | undefined): Promise<string> {
  const chat = await getChatRow(ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  if (!numberId || numberId === chat.number_id) return chat.id;
  if (viewer?.lineIds && !viewer.lineIds.includes(numberId)) throw new GroupsError('line_forbidden', 403);
  const number = await getNumberRow(ws, numberId);
  if (!number) throw new GroupsError('not_found', 404);
  if (number.status !== 'connected') throw new GroupsError('line_disconnected', 409);
  const sibling = (await siblingChats(ws, viewer, chatId, { all: true })).find((s) => s.number_id === numberId);
  if (sibling) {
    if (viewer && !(await canSeeChat(viewer, sibling.id))) throw new GroupsError('line_forbidden', 403);
    return sibling.id;
  }
  if (chat.kind === 'group' || !chat.phone || number.provider === 'sample') throw new GroupsError('line_not_in_chat');
  const phone = phoneDigits(chat.phone);
  const db = getDb();
  // Quién lo atiende en la línea nueva: el mismo, solo si ve esa línea (si no, queda para las reglas).
  const lineOk = await peopleWithLine(ws, numberId);
  const keepAssignee = chat.assigned_to && (!lineOk || lineOk.has(chat.assigned_to)) ? chat.assigned_to : null;
  // Antes de crear nada: ¿la persona va a ver el chat nuevo? (mismas etiquetas y equipo; asignado solo si se conserva)
  if (viewer?.scoped) {
    const viaMe = keepAssignee === viewer.me;
    const viaTeam = Boolean(chat.assigned_team_id && (viewer.teamIds ?? []).includes(chat.assigned_team_id));
    const viaLabel =
      Boolean(viewer.labels) &&
      Boolean(
        await db
          .prepare('SELECT 1 AS x FROM groups_chat_labels zl JOIN groups_label_access za ON za.label_id = zl.label_id WHERE zl.chat_id = ? AND za.person_id = ?')
          .get(chat.id, viewer.me),
      );
    if (!viaMe && !viaTeam && !viaLabel) throw new GroupsError('line_forbidden', 403);
  }
  const row = await upsertChat(number, { providerChatId: dmProviderChatId(number.provider, phone), kind: 'dm', name: chat.name, phone });
  // Recién creado: hereda equipo, etiquetas y (si ve la línea) quién lo atiende. Compare-and-set: no pisa una fila con datos.
  await db
    .prepare('UPDATE groups_chats SET assigned_to = ?, assigned_team_id = ? WHERE id = ? AND assigned_to IS NULL AND assigned_team_id IS NULL')
    .run(keepAssignee, chat.assigned_team_id ?? null, row.id);
  await db
    .prepare('INSERT OR IGNORE INTO groups_chat_labels (chat_id, label_id) SELECT ?, label_id FROM groups_chat_labels WHERE chat_id = ?')
    .run(row.id, chat.id);
  if (viewer && !(await canSeeChat(viewer, row.id))) {
    // No debería pasar (se comprobó antes); si pasa, no queda una fila vacía.
    await db.prepare("DELETE FROM groups_chats WHERE id = ? AND last_message_at IS NULL AND NOT EXISTS (SELECT 1 FROM groups_messages m WHERE m.chat_id = groups_chats.id)").run(row.id);
    throw new GroupsError('line_forbidden', 403);
  }
  if (!keepAssignee && chat.assigned_to) {
    const { autoAssignChat } = await import('./groups-inbox');
    await autoAssignChat(ws, row.id).catch(() => null);
  }
  return row.id;
}

// ======================================================================
// Equipo: personas, roles, líneas y disponibilidad
// ======================================================================

export interface TeamPersonDto {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  teamIds: string[];
  /** Líneas que ve: 'all' (admin, dueño o sin acceso por línea) o la lista. */
  lineIds: string[] | 'all';
  /** Líneas dadas a la persona directamente (sin contar las de su equipo). */
  directLineIds: string[];
  availability: Availability;
  availabilityAt: string | null;
  openChats: number;
}

export async function teamOverview(ws: string): Promise<TeamPersonDto[]> {
  const db = getDb();
  const { getPlatformSettings } = await import('./groups-access');
  const settings = await getPlatformSettings(ws);
  const people = await listPeople(ws);
  const roles = (await db
    .prepare(`SELECT m.user_id, m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.role != 'guest'`)
    .all(ws)) as Array<{ user_id: string; role: string }>;
  const avail = (await db.prepare('SELECT person_id, status, available, updated_at FROM groups_availability WHERE user_id = ?').all(ws)) as Array<{
    person_id: string;
    status: string | null;
    available: number;
    updated_at: string;
  }>;
  const open = (await db
    .prepare("SELECT assigned_to, COUNT(*) AS n FROM groups_chats WHERE user_id = ? AND status = 'open' AND assigned_to IS NOT NULL GROUP BY assigned_to")
    .all(ws)) as Array<{ assigned_to: string; n: number }>;
  const access = await listLineAccess(ws);
  const out: TeamPersonDto[] = [];
  for (const p of people) {
    const raw = p.id === ws ? 'owner' : (roles.find((r) => r.user_id === p.id)?.role ?? 'member');
    const role: TeamPersonDto['role'] = raw === 'owner' || raw === 'admin' ? raw : 'member';
    const teamIds = await personTeamIds(ws, p.id);
    const a = avail.find((x) => x.person_id === p.id);
    out.push({
      id: p.id,
      name: p.name,
      email: p.email,
      role,
      teamIds,
      lineIds: role !== 'member' || !settings.lineAccess ? 'all' : await personLineIds(ws, p.id, teamIds),
      directLineIds: Object.entries(access)
        .filter(([, v]) => v.personIds.includes(p.id))
        .map(([k]) => k),
      availability: (a?.status as Availability) || (a && a.available === 0 ? 'offline' : 'online'),
      availabilityAt: a?.updated_at ?? null,
      openChats: Number(open.find((o) => o.assigned_to === p.id)?.n ?? 0),
    });
  }
  return out;
}

// ======================================================================
// Historial de asignación
// ======================================================================

export interface AssignmentEvent {
  id: string;
  chatId: string;
  event: 'assigned' | 'unassigned' | 'auto_assigned' | 'reassigned' | 'team';
  to: string | null;
  by: string | null;
  rule: string | null;
  teamName: string | null;
  at: string;
}

/** Asignaciones del chat (y del mismo chat en sus otras líneas), de la más nueva a la más vieja. */
export async function assignmentHistory(ws: string, viewer: GroupsViewer | null, chatId: string, limit = 100): Promise<AssignmentEvent[]> {
  const ids = (await siblingChats(ws, viewer, chatId)).map((c) => c.id);
  if (ids.length === 0) return [];
  const rows = (await getDb()
    .prepare(
      `SELECT id, chat_id, meta, author_id, created_at FROM groups_messages
       WHERE user_id = ? AND chat_id IN (${ids.map(() => '?').join(',')}) AND direction = 'system' AND author_kind = 'event'
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(ws, ...ids, Math.min(Math.max(1, limit), 500))) as Array<{ id: string; chat_id: string; meta: string; author_id: string | null; created_at: string }>;
  const out: AssignmentEvent[] = [];
  for (const r of rows) {
    let m: Record<string, unknown> = {};
    try {
      m = JSON.parse(r.meta || '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    const ev = String(m.event ?? '');
    if (!['assigned', 'unassigned', 'auto_assigned', 'reassigned', 'team'].includes(ev)) continue;
    out.push({
      id: r.id,
      chatId: r.chat_id,
      event: ev as AssignmentEvent['event'],
      to: typeof m.to === 'string' ? m.to : null,
      by: typeof m.by === 'string' ? m.by : (r.author_id ?? null),
      rule: typeof m.rule === 'string' ? m.rule : null,
      teamName: typeof m.teamName === 'string' ? m.teamName : null,
      at: r.created_at,
    });
  }
  return out;
}

/**
 * Quiénes pueden ver una línea con el acceso por línea prendido: el dueño,
 * los admins y los miembros con la línea (directa o por equipo). null = sin
 * acceso por línea (todos). Lo usan la asignación manual y la automática:
 * nunca se le asigna a alguien un chat de una línea que no ve.
 */
export async function peopleWithLine(ws: string, numberId: string): Promise<Set<string> | null> {
  const { getPlatformSettings } = await import('./groups-access');
  if (!(await getPlatformSettings(ws)).lineAccess) return null;
  const db = getDb();
  const out = new Set(await adminIds(ws));
  const rows = (await db
    .prepare(
      `SELECT a.subject_id AS id FROM groups_line_access a WHERE a.user_id = ? AND a.number_id = ? AND a.subject_kind = 'person'
       UNION SELECT m.person_id AS id FROM groups_line_access a JOIN groups_team_members m ON m.team_id = a.subject_id
       WHERE a.user_id = ? AND a.number_id = ? AND a.subject_kind = 'team'`,
    )
    .all(ws, numberId, ws, numberId)) as Array<{ id: string }>;
  for (const r of rows) out.add(r.id);
  return out;
}

/** Lo que un miembro ve del equipo: nombre, rol, equipos y estado. Emails, líneas y chats abiertos son de los admins. */
export function teamForViewer(people: TeamPersonDto[], isAdmin: boolean): TeamPersonDto[] {
  if (isAdmin) return people;
  return people.map((p) => ({
    id: p.id,
    name: p.name || p.email.split('@')[0],
    email: '',
    role: p.role,
    teamIds: p.teamIds,
    lineIds: [],
    directLineIds: [],
    availability: p.availability,
    availabilityAt: p.availabilityAt,
    openChats: 0,
  }));
}
