/**
 * CRM ↔ HubSpot, salida (S3) — lo que ve la pantalla. Datos puros: sirve en
 * cliente y servidor. Solo conteos, nombres de campos, fechas y códigos:
 * nunca nombres, emails ni valores de registros.
 */

export type OutboundObjectName = 'companies' | 'contacts' | 'deals';
export const OUTBOUND_OBJECT_NAMES: readonly OutboundObjectName[] = ['companies', 'contacts', 'deals'];

export interface OutboundCounts {
  /** Registros actualizados en HubSpot. */
  updated: number;
  /** Registros creados en HubSpot. */
  created: number;
  /** Registros nuevos de acá vinculados a uno que ya estaba en HubSpot (mismo email o dominio). */
  matched: number;
  /** Asociaciones agregadas en HubSpot. */
  associations: number;
  /** Registros con un campo cambiado de los dos lados: ese campo no se mandó. */
  conflicts: number;
  /** Cambios sin nada para mandar (lo trajo el sync de entrada, o ya estaba igual allá). */
  skipped: number;
  /** HubSpot no aceptó el cambio (se reintenta un par de veces y queda anotado). */
  failed: number;
}

export const emptyOutboundCounts = (): OutboundCounts => ({ updated: 0, created: 0, matched: 0, associations: 0, conflicts: 0, skipped: 0, failed: 0 });

/**
 * - unavailable: falta el sync de entrada al día (la escritura se apoya en sus vínculos).
 * - off: la escritura está apagada (por defecto).
 * - on: prendida; manda los cambios cada minuto.
 * - paused: el sync está pausado (pausa las dos direcciones).
 * - waiting: HubSpot cortó por el límite diario; sigue solo más tarde.
 * - retrying: falló la última vuelta; reintenta con esperas cada vez más largas.
 * - blocked: la clave ya no vale, entra a otra cuenta o no tiene permiso de escritura.
 */
export type OutboundState = 'unavailable' | 'off' | 'on' | 'paused' | 'waiting' | 'retrying' | 'blocked';

export interface OutboundPreviewObject {
  /** Registros vinculados con algún campo cambiado acá desde el último sync. */
  records: number;
  /** Cuántos registros cambiaron cada campo (nombre de campo nuestro; los propios como `custom.<nombre>`). */
  fields: Record<string, number>;
  /** Registros de acá sin vínculo en la cola: se crearían en HubSpot (o se vincularían por email o dominio). */
  create: number;
  /** Asociaciones agregadas acá en la cola. */
  associations: number;
  /** Se leyeron solo los primeros registros (tope): los números son de esos. */
  truncated?: boolean;
}

export interface OutboundPreview {
  at: string;
  objects: Partial<Record<OutboundObjectName, OutboundPreviewObject>>;
}

export interface OutboundErrorEntry {
  at: string;
  object: string;
  code: string;
  count: number;
}

export interface OutboundView {
  state: OutboundState;
  /** La escritura está prendida (aunque ahora esté esperando o pausada). */
  enabled: boolean;
  /** Qué falta para poder prenderla ('' si nada): read_sync_first, missing_write_scope, not_connected. */
  blocker: '' | 'not_connected' | 'read_sync_first' | 'missing_write_scope';
  /** Permisos de escritura que le faltan a la clave. */
  missingScopes: string[];
  /** Objetos que el sync trae (y que se escriben): los mismos interruptores del sync de entrada. */
  objects: Record<OutboundObjectName, boolean>;
  counts: Partial<Record<OutboundObjectName, OutboundCounts>>;
  /** Cambios esperando en la cola. */
  queued: number;
  /** De esos, los que ya pueden salir (sin una espera por reintento). */
  due: number;
  /** Cambios que HubSpot rechazó varias veces: quedan anotados hasta que el registro se vuelva a editar. */
  failedItems: number;
  errors: OutboundErrorEntry[];
  failure: string;
  preview: OutboundPreview | null;
  /** Hay una vista previa reciente: se puede prender. */
  previewFresh: boolean;
  enabledAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
}
