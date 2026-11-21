/**
 * CRM ↔ HubSpot — lectura por fecha de modificación. Server-only, sin DB.
 *
 * Lee contactos, empresas o negocios con la búsqueda de HubSpot ordenada por
 * fecha de modificación, de la más vieja a la más nueva. El cursor es esa
 * fecha: es el mismo recorrido que después usa el sync para traer "lo que
 * cambió desde la última vez".
 *
 * La búsqueda de HubSpot no devuelve más allá del resultado 10.000 de una
 * consulta. Acá nunca se llega: cada página es una consulta nueva que arranca
 * en la última fecha vista (no se manda `after`). Eso además evita el
 * problema de paginar por posición mientras los datos cambian: un registro
 * editado a mitad de la lectura se va al final y correría a los demás un
 * lugar, salteando uno.
 *
 * - La página siguiente pide "modificado desde <última fecha vista>", así que
 *   los registros de ese mismo milisegundo se leen otra vez: quien llama tiene
 *   que tolerar repetidos (guardar por id).
 * - Si una página entera comparte el mismo milisegundo (una carga masiva), la
 *   fecha no avanzaría: ese milisegundo se recorre por id de registro y
 *   después se sigue con el milisegundo siguiente.
 *
 * Lo que la búsqueda no trae: registros archivados, y lo creado en los últimos
 * segundos (el índice de HubSpot tarda en ponerse al día).
 */
import { hubspotStatusError, type HubspotClient } from '../hubspot/client';

export type SyncObject = 'contacts' | 'companies' | 'deals';
export const SYNC_OBJECTS: readonly SyncObject[] = ['contacts', 'companies', 'deals'];
/** Actividades del timeline (engagements) que el sync trae de HubSpot. */
export type ActivityObject = 'notes' | 'calls' | 'meetings' | 'tasks' | 'emails';
export const ACTIVITY_OBJECTS: readonly ActivityObject[] = ['notes', 'calls', 'meetings', 'tasks', 'emails'];
export type ReadableObject = SyncObject | ActivityObject;

/** La propiedad de fecha de modificación de cada objeto (la de contactos tiene otro nombre). */
export const MODIFIED_PROP: Record<ReadableObject, string> = {
  contacts: 'lastmodifieddate',
  companies: 'hs_lastmodifieddate',
  deals: 'hs_lastmodifieddate',
  notes: 'hs_lastmodifieddate',
  calls: 'hs_lastmodifieddate',
  meetings: 'hs_lastmodifieddate',
  tasks: 'hs_lastmodifieddate',
  emails: 'hs_lastmodifieddate',
};

/** Tope de resultados por página de la búsqueda de HubSpot. */
export const SEARCH_PAGE_MAX = 200;

export interface ModifiedCursor {
  /** Milisegundos (epoch) desde donde se lee, incluido. 0: desde el principio. */
  since: number;
  /** Recorriendo un solo milisegundo por id: el último id leído ('' si no). */
  tieAfter: string;
  tie: boolean;
}

export const START_CURSOR: ModifiedCursor = { since: 0, tieAfter: '', tie: false };

export interface HsRecord {
  id: string;
  properties: Record<string, string | null>;
  /** Fecha de modificación en milisegundos (0 si HubSpot no la mandó). */
  modifiedMs: number;
}

export interface ModifiedPage {
  records: HsRecord[];
  /** Total que informa la búsqueda para esta consulta (solo dice el total del objeto cuando since es 0). */
  total: number | null;
  /** null: no queda nada por leer (o no se puede seguir: ver `incomplete`). */
  next: ModifiedCursor | null;
  /**
   * HubSpot dice que hay más, pero el último registro de la página no trae
   * fecha de modificación: no hay desde dónde seguir. La lectura termina acá
   * y quien llama tiene que avisar que quedó incompleta.
   */
  incomplete?: boolean;
}

interface SearchResponse {
  total?: number;
  results?: Array<{ id: string | number; properties?: Record<string, string | null>; updatedAt?: string }>;
  paging?: { next?: { after?: string } };
}

function ms(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = /^\d{10,}$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Una página. Tira HubspotApiError si HubSpot no responde 2xx (auth, scope,
 * rate_limited con su política, http).
 */
export async function readModifiedPage(
  client: HubspotClient,
  object: ReadableObject,
  cursor: ModifiedCursor,
  properties: readonly string[],
  opts: { limit?: number; retries?: number; maxWaitMs?: number } = {},
): Promise<ModifiedPage> {
  const prop = MODIFIED_PROP[object];
  const limit = Math.max(1, Math.min(opts.limit ?? 100, SEARCH_PAGE_MAX));
  const wanted = [...new Set([...properties, prop])];
  const filters = cursor.tie
    ? [
        { propertyName: prop, operator: 'BETWEEN', value: String(cursor.since), highValue: String(cursor.since) },
        ...(cursor.tieAfter ? [{ propertyName: 'hs_object_id', operator: 'GT', value: cursor.tieAfter }] : []),
      ]
    : cursor.since > 0
      ? [{ propertyName: prop, operator: 'GTE', value: String(cursor.since) }]
      : [];
  const res = await client.send(`/crm/v3/objects/${object}/search`, {
    method: 'POST',
    body: {
      ...(filters.length ? { filterGroups: [{ filters }] } : {}),
      sorts: [{ propertyName: cursor.tie ? 'hs_object_id' : prop, direction: 'ASCENDING' }],
      properties: wanted,
      limit,
    },
    retries: opts.retries ?? 2,
    retry5xx: true,
    maxWaitMs: opts.maxWaitMs ?? 4_000,
  });
  if (!res.ok) throw hubspotStatusError(res.status, res.path);
  const body = res.json() as SearchResponse;
  const records: HsRecord[] = (body.results ?? []).map((r) => {
    const properties = r.properties ?? {};
    return { id: String(r.id), properties, modifiedMs: ms(properties[prop]) || ms(r.updatedAt) };
  });
  const total = typeof body.total === 'number' ? body.total : null;
  const more = Boolean(body.paging?.next?.after) && records.length > 0;
  const last = records[records.length - 1];

  if (cursor.tie) {
    // Ese milisegundo se terminó: se sigue con lo modificado después.
    if (!more) return { records, total, next: { since: cursor.since + 1, tieAfter: '', tie: false } };
    return { records, total, next: { since: cursor.since, tieAfter: last.id, tie: true } };
  }
  if (!more) return { records, total, next: null };
  // Sin fecha no hay por dónde seguir: se corta (mejor que quedar dando vueltas) y se avisa que quedó incompleta.
  if (!last.modifiedMs) return { records, total, next: null, incomplete: true };
  if (last.modifiedMs > cursor.since) return { records, total, next: { since: last.modifiedMs, tieAfter: '', tie: false } };
  // Toda la página es del mismo milisegundo: se recorre por id.
  return { records, total, next: { since: cursor.since, tieAfter: '', tie: true } };
}
