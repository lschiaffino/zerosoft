/**
 * CRM en vivo (server). Lo que otra persona cambia en contactos, empresas,
 * negocios y leads aparece en las tablas, el tablero y la ficha sin recargar.
 *
 * Los triggers de la migración 20261123_0440_crm_live suben un contador por
 * workspace (crm_live_rev) y marcan cada registro tocado con ese valor
 * (crm_live_changes). La pantalla trae el contador con la página y pregunta
 * cada pocos segundos "¿cambió algo de lo que muestro desde N?": con todo
 * quieto es una fila leída por clave primaria. Si cambió, el cliente pide la
 * página de nuevo (router.refresh) cuando la persona no está editando
 * (components/crm/CrmLive.tsx).
 *
 * La respuesta no lleva ids ni datos: solo si hay que refrescar y si el
 * registro de la ficha ya no existe.
 */
import { getDb } from './db';

export const CRM_LIVE_ENTITIES = ['contact', 'company', 'deal', 'lead'] as const;
export type CrmLiveEntity = (typeof CRM_LIVE_ENTITIES)[number];

const TABLE: Record<CrmLiveEntity, string> = {
  contact: 'crm_contacts',
  company: 'crm_companies',
  deal: 'crm_deals',
  lead: 'crm_leads',
};

export interface CrmLiveWatch {
  /** Cualquier cambio en estas entidades (una tabla, un tablero). */
  entities: CrmLiveEntity[];
  /** Un registro (la ficha): sus cambios, sus asociaciones y sus notas. */
  record?: { entity: CrmLiveEntity; id: string } | null;
}

export interface CrmLiveState {
  rev: number;
  changed: boolean;
  /** El registro de la ficha se borró. */
  gone: boolean;
}

export function isCrmLiveEntity(v: unknown): v is CrmLiveEntity {
  return typeof v === 'string' && (CRM_LIVE_ENTITIES as readonly string[]).includes(v);
}

/**
 * Qué mira una pantalla, desde la query (`w=contact,company&r=deal:<id>`).
 * null si no mira nada válido.
 */
export function parseCrmLiveWatch(params: URLSearchParams): CrmLiveWatch | null {
  const entities = [...new Set((params.get('w') ?? '').split(',').filter(isCrmLiveEntity))];
  const raw = params.get('r') ?? '';
  const sep = raw.indexOf(':');
  const entity = sep > 0 ? raw.slice(0, sep) : '';
  const id = sep > 0 ? raw.slice(sep + 1) : '';
  const record = isCrmLiveEntity(entity) && id && id.length <= 64 ? { entity, id } : null;
  if (!entities.length && !record) return null;
  return { entities, record };
}

/** El contador del workspace (0 si nunca cambió nada). */
export async function crmLiveRev(workspaceId: string): Promise<number> {
  const row = (await getDb().prepare('SELECT rev FROM crm_live_rev WHERE user_id = ?').get(workspaceId)) as
    | { rev: number }
    | undefined;
  return Number(row?.rev ?? 0);
}

/** ¿Cambió algo de lo que mira la pantalla desde el contador `since`? */
export async function crmLiveCheck(workspaceId: string, since: number, watch: CrmLiveWatch): Promise<CrmLiveState> {
  const rev = await crmLiveRev(workspaceId);
  // Con todo quieto (o una base nueva, rev menor): no hay nada más que leer.
  if (rev <= since) return { rev, changed: false, gone: false };
  const db = getDb();
  let changed = false;
  if (watch.entities.length) {
    const marks = watch.entities.map(() => '?').join(', ');
    changed = !!(await db
      .prepare(`SELECT 1 FROM crm_live_changes WHERE user_id = ? AND rev > ? AND entity IN (${marks}) LIMIT 1`)
      .get(workspaceId, since, ...watch.entities));
  }
  let gone = false;
  if (!changed && watch.record) {
    changed = !!(await db
      .prepare('SELECT 1 FROM crm_live_changes WHERE user_id = ? AND entity = ? AND record_id = ? AND rev > ?')
      .get(workspaceId, watch.record.entity, watch.record.id, since));
  }
  if (changed && watch.record) {
    gone = !(await db
      .prepare(`SELECT 1 FROM ${TABLE[watch.record.entity]} WHERE id = ? AND user_id = ?`)
      .get(watch.record.id, workspaceId));
  }
  return { rev, changed, gone };
}
