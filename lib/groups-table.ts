/**
 * Lines › Grupos: la tabla de grupos (como una vista de Linear). Una fila por
 * grupo de WhatsApp aunque esté en varias líneas (lib/groups-identity.ts),
 * con las líneas donde está, su empresa de HubSpot (link incluido) y los
 * valores de las propiedades de la empresa que se piden como columnas.
 *
 * Acceso: los chats que entran (y las líneas que se muestran de cada grupo)
 * son solo los que quien mira puede ver (chatAccessSql). Los datos de HubSpot
 * salen de las tablas del workspace de la sesión, nunca de otro.
 */
import { getDb } from './db';
import { labelsFor, listChats, toChatDto, type ChatRow, type LabelDto } from './groups';
import { chatAccessSql, maskChat, type GroupsViewer } from './groups-access';
import { parseLinesFilters, type LinesFilters } from './groups-filters';
import { hubspotRecordUrl } from './groups-hubspot';
import { HUBSPOT_PROP_NAME } from './groups-hubspot-shared';
import { mergeGroupChats, type IdentityChat } from './groups-identity';
import { GROUPS_TABLE_MAX } from './groups-table-view';

/** Columnas de HubSpot que se pueden pedir a la vez. */
export const GROUPS_TABLE_MAX_HS = 40;

export interface GroupTableCompany {
  id: string;
  name: string;
  url: string;
  /** La empresa se borró o se fusionó en HubSpot. */
  broken: boolean;
}

export interface GroupTableRow {
  /** JID del grupo (o el id del chat si no tiene). */
  key: string;
  /** El chat que se abre al tocar la fila. */
  chatId: string;
  lines: Array<{ numberId: string; chatId: string }>;
  name: string;
  memberCount: number;
  status: 'open' | 'closed';
  leftAt: string | null;
  flagged: boolean;
  labels: LabelDto[];
  properties: Record<string, unknown>;
  lastActivity: string;
  createdAt: string;
  company: GroupTableCompany | null;
  /** Valores de las propiedades de la empresa pedidas (solo las que tienen valor). */
  hs: Record<string, string>;
}

export interface GroupsTableDto {
  rows: GroupTableRow[];
  /** Hay más chats que GROUPS_TABLE_MAX con estos filtros: se muestran los más recientes. */
  truncated: boolean;
  hubspot: boolean;
}

export interface GroupsTableQuery {
  filters?: LinesFilters;
  /** Abiertos, cerrados o los dos (vacío o sin esto: los dos). Pisa el estado de `filters`. */
  status?: Array<'open' | 'closed'>;
  q?: string;
  tzOffsetMin?: number;
  /** Nombres de propiedades de la empresa de HubSpot que se muestran como columnas. */
  hs?: string[];
}

function parseObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Los nombres de propiedades de HubSpot pedidos, válidos y sin repetir. */
export function cleanHsColumns(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return [...new Set(list.map((x) => String(x).trim()).filter((x) => HUBSPOT_PROP_NAME.test(x)))].slice(0, GROUPS_TABLE_MAX_HS);
}

export async function listGroupsTable(ws: string, me: string, viewer: GroupsViewer, query: GroupsTableQuery = {}): Promise<GroupsTableDto> {
  const db = getDb();
  const f = parseLinesFilters(query.filters ?? {});
  // La tabla es de grupos; sin filtro de estado muestra abiertos y cerrados.
  const status = (['open', 'closed'] as const).filter((s) => query.status?.includes(s));
  const filters: LinesFilters = { ...f, kinds: ['group'], status: status.length ? status : ['open', 'closed'] };
  const matched = await listChats(ws, me, {
    filters,
    q: query.q ?? '',
    tzOffsetMin: query.tzOffsetMin ?? 0,
    hubspot: f.hubspot,
    hsProps: f.hsProps,
    viewer,
    limit: GROUPS_TABLE_MAX,
  });
  const ids = matched.rows.map((r) => r.id);
  const hubspotRow = (await db.prepare("SELECT portal_id, ui_domain FROM groups_hubspot WHERE user_id = ? AND token != ''").get(ws)) as
    | { portal_id: string; ui_domain: string }
    | undefined;
  if (ids.length === 0) return { rows: [], truncated: false, hubspot: Boolean(hubspotRow) };

  // Las otras líneas de esos grupos, solo las que quien mira ve.
  const access = chatAccessSql(viewer);
  const all = (await db
    .prepare(
      `SELECT c.* FROM groups_chats c
       WHERE c.user_id = ? AND c.kind = 'group' AND c.hidden_at IS NULL
         AND c.provider_chat_id IN (SELECT z.provider_chat_id FROM groups_chats z WHERE z.user_id = ? AND z.id IN (${marks(ids.length)}))
         ${access ? `AND ${access.sql}` : ''}`,
    )
    .all(ws, ws, ...ids, ...(access?.args ?? []))) as ChatRow[];
  const matchedIds = new Set(ids);
  const jidOf = new Map(all.map((r) => [r.id, r.provider_chat_id]));
  const siblings = all.filter((r) => !matchedIds.has(r.id));
  const siblingLabels = await labelsFor(siblings.map((r) => r.id));
  const chats: IdentityChat[] = [
    ...matched.rows.map((c) => ({ ...c, jid: jidOf.get(c.id) ?? '', matched: true })),
    ...siblings.map((r) => ({ ...maskChat(viewer, toChatDto(r, siblingLabels.get(r.id) ?? [])), jid: r.provider_chat_id, matched: false })),
  ].map((c) => ({
    id: c.id,
    jid: c.jid,
    numberId: c.numberId,
    matched: c.matched,
    name: c.name,
    memberCount: c.memberCount,
    status: c.status,
    leftAt: c.leftAt,
    flagged: c.flagged,
    archived: c.archived,
    labels: c.labels,
    properties: c.properties,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
  }));
  const merged = mergeGroupChats(chats);

  // HubSpot: la empresa de cada grupo (la de su identidad; si no tiene, la del chat) y sus valores.
  const companyOf = new Map<string, string>();
  const linkName = new Map<string, string>();
  if (hubspotRow) {
    const jids = [...new Set(merged.map((g) => g.key).filter((k) => !k.startsWith('chat:')))];
    if (jids.length) {
      const idRows = (await db
        .prepare(`SELECT jid, company_id FROM groups_identities WHERE user_id = ? AND company_id != '' AND jid IN (${marks(jids.length)})`)
        .all(ws, ...jids)) as Array<{ jid: string; company_id: string }>;
      for (const r of idRows) companyOf.set(r.jid, r.company_id);
    }
    const allIds = merged.flatMap((g) => g.chatIds);
    const links = (await db
      .prepare(`SELECT chat_id, object_id, name FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'company' AND chat_id IN (${marks(allIds.length)})`)
      .all(ws, ...allIds)) as Array<{ chat_id: string; object_id: string; name: string }>;
    const byChat = new Map(links.map((l) => [l.chat_id, l]));
    for (const g of merged) {
      if (!companyOf.has(g.key)) {
        const l = g.chatIds.map((id) => byChat.get(id)).find(Boolean);
        if (l) companyOf.set(g.key, l.object_id);
      }
      const id = companyOf.get(g.key);
      const l = id ? g.chatIds.map((cid) => byChat.get(cid)).find((x) => x?.object_id === id) : undefined;
      if (id && l?.name) linkName.set(id, l.name);
    }
  }
  const companyIds = [...new Set(companyOf.values())];
  const companies = new Map<string, { name: string; props: string; missing: number }>();
  if (companyIds.length) {
    const rows = (await db
      .prepare(`SELECT company_id, name, props, missing FROM groups_hubspot_companies WHERE user_id = ? AND company_id IN (${marks(companyIds.length)})`)
      .all(ws, ...companyIds)) as Array<{ company_id: string; name: string; props: string; missing: number }>;
    for (const r of rows) companies.set(r.company_id, r);
  }
  const wanted = cleanHsColumns(query.hs);
  let shown: string[] = [];
  const masked = new Set<string>();
  if (wanted.length && companyIds.length) {
    const defs = (await db
      .prepare(`SELECT name, field_type FROM groups_hubspot_props WHERE user_id = ? AND hidden = 0 AND archived = 0 AND name IN (${marks(wanted.length)})`)
      .all(ws, ...wanted)) as Array<{ name: string; field_type: string }>;
    shown = defs.map((d) => d.name);
    // Quien tiene los teléfonos ocultos tampoco ve los de la empresa.
    if (viewer.mask) for (const d of defs) if (d.field_type === 'phonenumber') masked.add(d.name);
  }
  const conn = hubspotRow ? { portalId: hubspotRow.portal_id, uiDomain: hubspotRow.ui_domain || 'app.hubspot.com' } : null;

  return {
    truncated: matched.total > GROUPS_TABLE_MAX,
    hubspot: Boolean(hubspotRow),
    rows: merged.map((g) => {
      const id = companyOf.get(g.key);
      const c = id ? companies.get(id) : undefined;
      const values = parseObject(c?.props);
      const hs: Record<string, string> = {};
      for (const name of shown) {
        const v = values[name];
        if (v !== undefined && v !== null && v !== '') hs[name] = masked.has(name) ? '•••' : String(v);
      }
      return {
        key: g.key,
        chatId: g.chatId,
        lines: g.lines,
        name: g.name,
        memberCount: g.memberCount,
        status: g.status,
        leftAt: g.leftAt,
        flagged: g.flagged,
        labels: g.labels,
        properties: g.properties,
        lastActivity: g.lastActivity,
        createdAt: g.createdAt,
        company: id && conn ? { id, name: c?.name || linkName.get(id) || id, url: hubspotRecordUrl(conn, 'company', id), broken: c?.missing === 1 } : null,
        hs,
      };
    }),
  };
}
