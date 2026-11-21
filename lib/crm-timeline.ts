/**
 * CRM: el timeline de la ficha (contacto, empresa, deal), como el de HubSpot. Server-only.
 *
 * - Actividades del registro y, en empresas y deals, las de sus registros asociados ("rollup"): una
 *   empresa ve las de sus contactos y deals; un deal, las de sus contactos y su empresa. Cada fila dice si
 *   es propia (`rollup` 0) o viene de un asociado (1); la ficha deja esconder las asociadas.
 * - Paginado sin tope (`offset`): la ficha trae 100 y "Ver más" pide las siguientes.
 * - Emails (threads de Gmail/Outlook/CRM) y, en contactos y empresas, los chats de Lines vinculados.
 *
 * Privacidad: todo pasa por la visibilidad por owner (activityScopeSql: cada registro vinculado a la
 * actividad tiene que verse), por la regla de tareas de chats de Lines (#593: sin el texto para quien no
 * ve el chat) y por la visibilidad de Lines (líneas, etiquetas, app apagada, teléfonos ocultos). Los
 * emails de una empresa o un deal salen solo de contactos que la persona ve.
 */
import { getDb } from './db';
import { activityScopeSql, canSeeRecord, ownerScopeSql, type OwnerScope } from './crm-visibility';
import { redactChatTasks, type ChatReader } from './crm-chat-privacy';
import type { ActivityListRow } from './crm';

export type TimelineRecordKind = 'contact' | 'company' | 'deal';

export interface TimelineRecordRef {
  kind: TimelineRecordKind;
  id: string;
}

export const TIMELINE_PAGE = 100;

export type RecordActivityRow = ActivityListRow & {
  /** 1 = viene de un registro asociado (contacto o deal de la empresa, contacto o empresa del deal). */
  rollup: 0 | 1;
  /** Quién la registró o la tiene asignada (owner; sin owner, el dueño del workspace). */
  author_id: string;
  author_name: string | null;
};

const SELECT = `
  SELECT a.*,
    NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name,
    co.name AS company_name,
    d.name AS deal_name,
    u.name AS owner_name,
    p.name AS project_name,
    p.color AS project_color,
    COALESCE(a.owner_id, a.user_id) AS author_id,
    COALESCE(u.name, wu.name) AS author_name
  FROM crm_activities a
  LEFT JOIN crm_contacts c ON c.id = a.contact_id
  LEFT JOIN crm_companies co ON co.id = a.company_id
  LEFT JOIN crm_deals d ON d.id = a.deal_id
  LEFT JOIN users u ON u.id = a.owner_id
  LEFT JOIN users wu ON wu.id = a.user_id
  LEFT JOIN crm_task_projects p ON p.id = a.project_id
`;

/** Condición de "propia" y de "asociada" para el registro, con sus args (en el orden del SQL). */
function recordConditions(ws: string, rec: TimelineRecordRef): { own: string; ownArgs: string[]; assoc: string | null; assocArgs: string[] } {
  if (rec.kind === 'contact') return { own: 'a.contact_id = ?', ownArgs: [rec.id], assoc: null, assocArgs: [] };
  if (rec.kind === 'company') {
    return {
      own: 'a.company_id = ?',
      ownArgs: [rec.id],
      assoc: `(a.contact_id IN (SELECT cc.contact_id FROM crm_contact_companies cc WHERE cc.user_id = ? AND cc.company_id = ?)
        OR a.contact_id IN (SELECT pc.id FROM crm_contacts pc WHERE pc.user_id = ? AND pc.company_id = ?)
        OR a.deal_id IN (SELECT dc.deal_id FROM crm_deal_companies dc WHERE dc.user_id = ? AND dc.company_id = ?))`,
      assocArgs: [ws, rec.id, ws, rec.id, ws, rec.id],
    };
  }
  return {
    own: 'a.deal_id = ?',
    ownArgs: [rec.id],
    assoc: `(a.contact_id IN (SELECT dct.contact_id FROM crm_deal_contacts dct JOIN crm_deals dd ON dd.id = dct.deal_id WHERE dd.user_id = ? AND dct.deal_id = ?)
      OR a.company_id IN (SELECT dco.company_id FROM crm_deal_companies dco WHERE dco.user_id = ? AND dco.deal_id = ?))`,
    assocArgs: [ws, rec.id, ws, rec.id],
  };
}

/**
 * Actividades del timeline de un registro: propias primero las fijadas, después por fecha (vencimiento o
 * creación) de la más nueva a la más vieja. Una fijada en un asociado no queda fijada acá.
 */
export async function listRecordActivities(
  ws: string,
  rec: TimelineRecordRef,
  opts: { ownerScope?: OwnerScope; chatReader?: ChatReader | null; offset?: number; limit?: number; includeAssociated?: boolean } = {},
): Promise<{ rows: RecordActivityRow[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? TIMELINE_PAGE, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const cond = recordConditions(ws, rec);
  const withAssoc = opts.includeAssociated !== false && cond.assoc !== null;
  const scope = activityScopeSql('a', opts.ownerScope);
  const where = [
    'a.user_id = ?',
    withAssoc ? `(${cond.own} OR ${cond.assoc})` : cond.own,
    ...(scope.sql ? [scope.sql] : []),
  ];
  const args: Array<string | number> = [
    ...cond.ownArgs, // el CASE de rollup
    ...cond.ownArgs, // el CASE de pinned
    ws,
    ...cond.ownArgs,
    ...(withAssoc ? cond.assocArgs : []),
    ...scope.args,
  ];
  const rows = (await getDb()
    .prepare(
      `${SELECT.replace('SELECT a.*,', `SELECT a.*, CASE WHEN ${cond.own} THEN 0 ELSE 1 END AS rollup, CASE WHEN ${cond.own} AND a.pinned = 1 THEN 1 ELSE 0 END AS pinned_here,`)}
       WHERE ${where.join(' AND ')}
       ORDER BY pinned_here DESC, COALESCE(a.due_at, a.created_at) DESC, a.created_at DESC, a.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, limit + 1, offset)) as Array<RecordActivityRow & { pinned_here: number }>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(({ pinned_here, ...r }) => ({
    ...r,
    rollup: (r.rollup ? 1 : 0) as 0 | 1,
    // En la ficha cuenta la fijación de este registro: la de un asociado no sube acá.
    pinned: (pinned_here ? 1 : 0) as 0 | 1,
  })) as RecordActivityRow[];
  return { rows: await redactChatTasks(ws, page, opts.chatReader), hasMore };
}

/**
 * Ids de los contactos cuyos emails se muestran en el timeline del registro, solo los que la persona ve.
 * En un contacto, él mismo; en una empresa, sus contactos; en un deal, sus contactos.
 */
export async function visibleEmailContacts(ws: string, rec: TimelineRecordRef, scope: OwnerScope | undefined): Promise<string[]> {
  const db = getDb();
  if (rec.kind === 'contact') return (await canSeeRecord(ws, 'crm_contacts', rec.id, scope)) ? [rec.id] : [];
  const s = ownerScopeSql('c', scope);
  const sql =
    rec.kind === 'company'
      ? `SELECT c.id FROM crm_contacts c WHERE c.user_id = ? AND (c.company_id = ? OR c.id IN (SELECT contact_id FROM crm_contact_companies WHERE user_id = ? AND company_id = ?))`
      : `SELECT c.id FROM crm_contacts c WHERE c.user_id = ? AND c.id IN (SELECT dc.contact_id FROM crm_deal_contacts dc WHERE dc.deal_id = ?)`;
  const args = rec.kind === 'company' ? [ws, rec.id, ws, rec.id] : [ws, rec.id];
  const rows = (await db.prepare(`${sql}${s.sql ? ` AND ${s.sql}` : ''} LIMIT 2000`).all(...args, ...s.args)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Un chat de Lines en el timeline: el nombre y los últimos mensajes, ya con lo que la persona puede ver. */
export interface WhatsappTimelineItem {
  id: string;
  type: 'whatsapp';
  subject: string;
  body: string;
  due_at: null;
  done: 0;
  pinned: 0;
  direction: string;
  outcome: string;
  duration_min: null;
  created_at: string;
  external: true;
  rollup: 0;
  wa: {
    chatId: string;
    group: boolean;
    messages: Array<{ id: string; at: string; out: boolean; who: string; text: string }>;
  };
}

/**
 * Los chats de Lines vinculados al contacto o la empresa, con lo que ve quien mira: sin la app Lines (o
 * apagada para esa persona) no ve ninguno; con líneas o etiquetas limitadas, solo esos; con teléfonos
 * ocultos, enmascarados. `reader` es el lector de tareas de chats (null = ve todos los chats sin máscara).
 */
export async function listRecordChats(
  ws: string,
  rec: TimelineRecordRef,
  who: { personId: string; role: import('./teams').TeamRole },
  reader: ChatReader | null,
  messagesPerChat = 5,
): Promise<WhatsappTimelineItem[]> {
  if (rec.kind === 'deal') return [];
  // Sin Lines: el lector existe pero sin viewer.
  if (reader && !reader.viewer) return [];
  const { groupsViewer } = await import('./groups-access');
  const viewer = reader?.viewer ?? (await groupsViewer(ws, who.personId, who.role));
  const { chatsForCrmRecord } = await import('./groups');
  const chats = await chatsForCrmRecord(ws, rec.kind, rec.id, messagesPerChat, viewer).catch(() => []);
  const { maskPhone, maskPhoneText } = await import('./groups-mask');
  const text = (s: string) => (viewer.mask ? maskPhoneText(s) : s);
  return chats.map(({ chat, messages }) => {
    const last = messages[messages.length - 1];
    return {
      id: `wa-${chat.id}`,
      type: 'whatsapp' as const,
      subject: text(chat.name || (chat.phone ? (viewer.mask ? maskPhone(chat.phone) : `+${chat.phone}`) : '')),
      body: '',
      due_at: null,
      done: 0 as const,
      pinned: 0 as const,
      direction: last?.direction === 'out' ? 'outbound' : last ? 'inbound' : '',
      outcome: '',
      duration_min: null,
      created_at: last?.createdAt ?? chat.lastMessageAt ?? chat.createdAt,
      external: true as const,
      rollup: 0 as const,
      wa: {
        chatId: chat.id,
        group: chat.kind === 'group',
        messages: messages
          .filter((m) => !m.deletedAt)
          .map((m) => ({
            id: m.id,
            at: m.createdAt,
            out: m.direction === 'out',
            who: m.direction === 'out' ? '' : text(m.senderName || (m.senderPhone ? (viewer.mask ? maskPhone(m.senderPhone) : `+${m.senderPhone}`) : '')),
            text: text(m.body || (m.media ? m.media.name || '' : '')).slice(0, 280),
          })),
      },
    };
  });
}

/**
 * Deja una sola actividad fijada en cada registro de esta actividad (contacto, empresa y deal), como en
 * HubSpot: desfija las otras de esos registros. Desfijar no muestra nada, así que no depende de la
 * visibilidad (si no, quedarían dos fijadas para quien ve más).
 */
export async function unpinSiblings(ws: string, activityId: string): Promise<void> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT contact_id, company_id, deal_id FROM crm_activities WHERE id = ? AND user_id = ?')
    .get(activityId, ws)) as { contact_id: string | null; company_id: string | null; deal_id: string | null } | undefined;
  if (!row) return;
  for (const [col, val] of [['contact_id', row.contact_id], ['company_id', row.company_id], ['deal_id', row.deal_id]] as const) {
    if (!val) continue;
    await db
      .prepare(`UPDATE crm_activities SET pinned = 0, updated_at = datetime('now') WHERE user_id = ? AND ${col} = ? AND pinned = 1 AND id <> ?`)
      .run(ws, val, activityId);
  }
}

/** Fija (o desfija) una actividad propia del registro. false si la actividad no es propia del registro. */
export async function pinOnRecord(ws: string, activityId: string, rec: TimelineRecordRef, pinned: boolean): Promise<boolean> {
  const db = getDb();
  const col = rec.kind === 'contact' ? 'contact_id' : rec.kind === 'company' ? 'company_id' : 'deal_id';
  const own = await db.prepare(`SELECT 1 FROM crm_activities WHERE id = ? AND user_id = ? AND ${col} = ?`).get(activityId, ws, rec.id);
  if (!own) return false;
  if (pinned) await unpinSiblings(ws, activityId);
  await db
    .prepare(`UPDATE crm_activities SET pinned = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(pinned ? 1 : 0, activityId, ws);
  return true;
}

/**
 * El timeline completo de una página: actividades (con rollup), emails y chats de Lines (solo en la
 * primera página), con adjuntos, detalles de llamadas, resúmenes y el origen de las tareas. Lo usan la
 * ficha (server) y "Ver más" (GET /api/crm/timeline).
 */
export async function buildRecordTimeline(
  user: import('./session').SessionUser,
  rec: TimelineRecordRef,
  opts: { ownerScope: OwnerScope; chatReader: ChatReader | null; offset?: number },
) {
  const offset = Math.max(opts.offset ?? 0, 0);
  const { listEmailThreads, mergeTimelineWithThreads } = await import('./crm-email');
  const { withActivityFiles } = await import('./crm-files');
  const { withCallDetails } = await import('./crm-voice');
  const { withCallSummaries } = await import('./crm-ai');
  const { withTaskSources } = await import('./tasks');
  const first = offset === 0;
  const [acts, threads, chats] = await Promise.all([
    listRecordActivities(user.id, rec, { ownerScope: opts.ownerScope, chatReader: opts.chatReader, offset }),
    // Los threads van en la primera página; en las siguientes solo se usan sus ids para no repetir como
    // tarjeta suelta un email que ya está dentro de un thread.
    visibleEmailContacts(user.id, rec, opts.ownerScope)
      .then((contactIds) => listEmailThreads(user.id, { contactIds, limit: 100 }))
      .then((t) => (first ? t : { threads: [], activityIds: t.activityIds })),
    first
      ? listRecordChats(user.id, rec, { personId: user.actingUser?.id ?? user.id, role: user.role }, opts.chatReader).catch(() => [])
      : Promise.resolve([] as WhatsappTimelineItem[]),
  ]);
  // Los emails de los contactos cuentan como propios de su empresa y su deal (HubSpot los asocia solo).
  const merged = mergeTimelineWithThreads(acts.rows, threads).map((i) => ('thread' in i && i.thread ? { ...i, rollup: 0 as const } : i));
  const withChats = chats.length ? mergeTimelineWithThreads([...merged, ...chats], { threads: [], activityIds: [] }) : merged;
  const items = await withCallSummaries(user.id, await withCallDetails(user.id, await withTaskSources(user, await withActivityFiles(withChats))));
  return { items, hasMore: acts.hasMore, nextOffset: offset + TIMELINE_PAGE };
}
