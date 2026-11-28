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
import { activityScopeSql, canSeeOwner, canSeeRecord, ownerScopeSql, type OwnerScope } from './crm-visibility';
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
  opts: {
    ownerScope?: OwnerScope;
    chatReader?: ChatReader | null;
    offset?: number;
    limit?: number;
    includeAssociated?: boolean;
    /** 'created': la más nueva primero por fecha de creación (la última actividad de la fila desplegada). */
    order?: 'timeline' | 'created';
  } = {},
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
       ORDER BY ${opts.order === 'created' ? 'a.created_at DESC, a.rowid DESC' : 'pinned_here DESC, COALESCE(a.due_at, a.created_at) DESC, a.created_at DESC, a.id DESC'}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, limit + 1, offset)) as Array<RecordActivityRow & { pinned_here: number }>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(({ pinned_here, ...r }) => ({
    ...r,
    rollup: (r.rollup ? 1 : 0) as 0 | 1,
    // En la ficha cuenta la fijación de este registro: la de un asociado no sube acá.
    pinned: (pinned_here ? 1 : 0) as 0 | 1,
    // La cola y el recordatorio de una tarea no son del timeline (la cola puede ser privada de otra persona).
    queue_id: null,
    reminder_at: null,
    reminder_sent_at: null,
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

/** Un cambio de una propiedad del registro, como "Lifecycle stage changed" de HubSpot. */
export interface PropertyChange {
  /** Columna (`lifecycle_stage`, `stage`, `owner_id`, …) o `custom.<nombre>` de un campo propio. */
  field: string;
  /** Nombre de un campo propio (los de fábrica los nombra la ficha). */
  label?: string;
  from: string;
  to: string;
  /** Motivo de un cambio automático (`deal_won`); '' si lo hizo una persona. */
  reason: string;
  /** Quién lo cambió (nombre de alguien del workspace); '' si fue automático o no se sabe. */
  actor?: string;
  /** Había un valor que la persona no puede ver nombrado (una empresa que no ve, alguien que ya no está). */
  fromPrivate?: boolean;
  toPrivate?: boolean;
  /** Tipo de un campo propio (para mostrar sí/no, números, fechas y montos) y la moneda de uno de moneda. */
  valueType?: string;
  currency?: string;
}

/** Un cambio de propiedad en el timeline: una línea, sin acciones. */
export interface ChangeTimelineItem {
  id: string;
  type: 'change';
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
  change: PropertyChange;
}

/**
 * Los cambios de lifecycle hechos por el sistema (lib/crm-lifecycle-auto.ts) de un contacto o una
 * empresa. Quien llama ya comprobó que la persona ve el registro. El motivo dice qué pasó (deal creado o
 * ganado), sin nombrar el deal: puede ser uno que la persona no ve.
 */
export async function listSystemChanges(ws: string, rec: TimelineRecordRef, limit = 50): Promise<ChangeTimelineItem[]> {
  if (rec.kind === 'deal') return [];
  const rows = (await getDb()
    .prepare(
      `SELECT id, old_value, new_value, actor_email, created_at FROM crm_property_events
       WHERE user_id = ? AND entity = ? AND entity_id = ? AND field = 'lifecycle_stage' AND actor_email LIKE 'system:%'
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(ws, rec.kind, rec.id, limit)) as Array<{ id: string; old_value: string; new_value: string; actor_email: string; created_at: string }>;
  return rows.map((r) => ({
    id: `change-${r.id}`,
    type: 'change' as const,
    subject: '',
    body: '',
    due_at: null,
    done: 0 as const,
    pinned: 0 as const,
    direction: '',
    outcome: '',
    duration_min: null,
    created_at: r.created_at,
    external: true as const,
    rollup: 0 as const,
    change: { field: 'lifecycle_stage', from: r.old_value, to: r.new_value, reason: r.actor_email.slice('system:'.length) },
  }));
}

/** Propiedades de fábrica que el timeline muestra, por registro (columnas de crm_property_events). */
const CHANGE_FIELDS: Record<TimelineRecordKind, ReadonlySet<string>> = {
  contact: new Set(['first_name', 'last_name', 'email', 'phone', 'job_title', 'website', 'city', 'country', 'lifecycle_stage', 'lead_status', 'source', 'company_id', 'owner_id']),
  company: new Set([
    'name', 'domain', 'industry', 'employees', 'phone', 'website', 'city', 'country', 'lifecycle_stage', 'owner_id', 'parent_company_id',
    'description', 'founded_year', 'linkedin_url', 'twitter_url', 'facebook_url', 'instagram_url',
  ]),
  deal: new Set([
    'name', 'amount', 'currency', 'close_date', 'priority', 'source', 'description', 'lost_reason', 'deal_type', 'next_step', 'won_reason',
    'stage', 'owner_id', 'splits', 'forecast_category',
  ]),
};

const CUSTOM_ENTITY: Record<TimelineRecordKind, string> = { contact: 'contacts', company: 'companies', deal: 'deals' };
const MAX_CHANGE_VALUE = 200;

function clipValue(v: string): string {
  return v.length > MAX_CHANGE_VALUE ? `${v.slice(0, MAX_CHANGE_VALUE - 1)}…` : v;
}

/**
 * Los cambios de propiedades de un contacto, una empresa o un deal (los más nuevos, hasta `limit`), para
 * el timeline: los de personas y los automáticos, las etapas de un deal y los campos propios. Con lo que
 * la persona ve: un campo propio que tiene oculto no sale (ni ocupa lugar en el tope), una empresa
 * vinculada que no ve sale marcada como privada (sin nombre) y un owner sale por su nombre. Quien llama ya
 * comprobó que la persona ve el registro.
 */
export async function listPropertyChanges(
  user: import('./session').SessionUser,
  rec: TimelineRecordRef,
  scope: OwnerScope,
  limit = 100,
): Promise<ChangeTimelineItem[]> {
  const ws = user.id;
  const db = getDb();
  const { fieldAccessFor, sessionFieldViewer } = await import('./crm-field-perms');
  const { fieldCurrency } = await import('./crm-custom-fields');
  const access = await fieldAccessFor(sessionFieldViewer(user), CUSTOM_ENTITY[rec.kind]);
  const customDef = new Map(access.all.filter((d) => !access.hidden.has(d.name)).map((d) => [d.name, d]));
  // El filtro va en la consulta: lo que la persona no ve no ocupa lugar en el tope.
  const fields = [...CHANGE_FIELDS[rec.kind], ...[...customDef.keys()].map((n) => `custom.${n}`)];
  const rows = (await db
    .prepare(
      `SELECT id, field, old_value, new_value, actor_email, created_at FROM crm_property_events
       WHERE user_id = ? AND entity = ? AND entity_id = ? AND field IN (${fields.map(() => '?').join(', ')})
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(ws, rec.kind, rec.id, ...fields, limit)) as Array<{ id: string; field: string; old_value: string | null; new_value: string | null; actor_email: string | null; created_at: string }>;
  if (!rows.length) return [];

  // Personas del workspace (owner, campos de persona y quién cambió): las mismas que ofrece el selector de owner.
  const { listMembers } = await import('./teams');
  const { workspaceTeamId } = await import('./workspace');
  const teamId = workspaceTeamId(user);
  const members = teamId ? await listMembers(teamId) : [{ user_id: user.id, email: user.email, name: user.name ?? null }];
  const personById = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  const personByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.name || m.email]));

  // Empresas vinculadas: por nombre, y solo las que la persona ve (una consulta para todas).
  const companyIds = new Set<string>();
  for (const r of rows) {
    if (r.field !== 'company_id' && r.field !== 'parent_company_id') continue;
    if (r.old_value) companyIds.add(r.old_value);
    if (r.new_value) companyIds.add(r.new_value);
  }
  const companyName = new Map<string, string>();
  if (companyIds.size) {
    const ids = [...companyIds];
    const found = (await db
      .prepare(`SELECT id, name, owner_id FROM crm_companies WHERE user_id = ? AND id IN (${ids.map(() => '?').join(', ')})`)
      .all(ws, ...ids)) as Array<{ id: string; name: string; owner_id: string | null }>;
    for (const c of found) if (canSeeOwner(scope, c.owner_id, ws)) companyName.set(c.id, c.name || '');
  }

  /** El valor a mostrar; null = había algo que la persona no puede ver nombrado (empresa privada, persona que ya no está). */
  const value = (field: string, raw: string | null): string | null => {
    const v = raw ?? '';
    if (!v) return '';
    if (field === 'company_id' || field === 'parent_company_id') return companyName.has(v) ? companyName.get(v)! : null;
    if (field === 'owner_id') return personById.get(v) ?? null;
    if (field.startsWith('custom.') && customDef.get(field.slice(7))?.type === 'user') return personById.get(v) ?? null;
    return clipValue(v);
  };
  const out: ChangeTimelineItem[] = [];
  for (const r of rows) {
    const from = value(r.field, r.old_value);
    const to = value(r.field, r.new_value);
    // Nada que se pueda nombrar de ningún lado: la línea no dice nada.
    if (from === null && to === null) continue;
    const actor = r.actor_email ?? '';
    const system = actor.startsWith('system:');
    const def = r.field.startsWith('custom.') ? customDef.get(r.field.slice(7)) : undefined;
    out.push({
      id: `change-${r.id}`,
      type: 'change' as const,
      subject: '',
      body: '',
      due_at: null,
      done: 0 as const,
      pinned: 0 as const,
      direction: '',
      outcome: '',
      duration_min: null,
      created_at: r.created_at,
      external: true as const,
      rollup: 0 as const,
      change: {
        field: r.field,
        ...(def ? { label: def.label || def.name, valueType: def.type, ...(def.type === 'currency' ? { currency: fieldCurrency(def) } : {}) } : {}),
        from: from ?? '',
        to: to ?? '',
        ...(from === null ? { fromPrivate: true } : {}),
        ...(to === null ? { toPrivate: true } : {}),
        reason: system ? actor.slice('system:'.length) : '',
        actor: system || !actor ? '' : (personByEmail.get(actor.toLowerCase()) ?? (actor.includes('@') ? actor : '')),
      },
    });
  }
  return out;
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
  const [acts, threads, chats, changes] = await Promise.all([
    listRecordActivities(user.id, rec, { ownerScope: opts.ownerScope, chatReader: opts.chatReader, offset }),
    // Los threads van en la primera página; en las siguientes solo se usan sus ids para no repetir como
    // tarjeta suelta un email que ya está dentro de un thread.
    visibleEmailContacts(user.id, rec, opts.ownerScope)
      .then((contactIds) => listEmailThreads(user.id, { contactIds, limit: 100 }))
      .then((t) => (first ? t : { threads: [], activityIds: t.activityIds })),
    first
      ? listRecordChats(user.id, rec, { personId: user.actingUser?.id ?? user.id, role: user.role }, opts.chatReader).catch(() => [])
      : Promise.resolve([] as WhatsappTimelineItem[]),
    first ? listPropertyChanges(user, rec, opts.ownerScope).catch(() => []) : Promise.resolve([] as ChangeTimelineItem[]),
  ]);
  // Los emails de los contactos cuentan como propios de su empresa y su deal (HubSpot los asocia solo).
  const merged = mergeTimelineWithThreads(acts.rows, threads).map((i) => ('thread' in i && i.thread ? { ...i, rollup: 0 as const } : i));
  const extra = [...chats, ...changes];
  const withChats = extra.length ? mergeTimelineWithThreads([...merged, ...extra], { threads: [], activityIds: [] }) : merged;
  const { withCommentCounts } = await import('./crm-activity-comments');
  const items = await withCommentCounts(
    user.id,
    await withCallSummaries(user.id, await withCallDetails(user.id, await withTaskSources(user, await withActivityFiles(withChats)))),
    opts.ownerScope,
  );
  return { items, hasMore: acts.hasMore, nextOffset: offset + TIMELINE_PAGE };
}
