/**
 * CRM ↔ HubSpot, entrada (S2) — lo que ve la pantalla. Datos puros: sirve en
 * cliente y servidor. Solo conteos, fechas y códigos: nunca nombres, emails
 * ni contenidos de registros.
 */

export type InboundObjectName = 'companies' | 'contacts' | 'deals' | 'notes' | 'calls' | 'meetings' | 'tasks' | 'emails';
export const INBOUND_OBJECT_NAMES: readonly InboundObjectName[] = ['companies', 'contacts', 'deals', 'notes', 'calls', 'meetings', 'tasks', 'emails'];

export interface InboundCounts {
  /** Registros de HubSpot procesados (sin contar las relecturas del margen de cada vuelta). */
  read: number;
  created: number;
  updated: number;
  /** Leídos que ya estaban iguales. */
  unchanged: number;
  /** Registros con algún campo cambiado de los dos lados: quedó lo nuestro. */
  conflicts: number;
  /** No se trajeron (sin dónde mostrarlos, coincidencia ambigua, borrados acá). */
  skipped: number;
  failed: number;
  /** Archivados en HubSpot: el vínculo queda marcado; acá no se borra nada. */
  archived: number;
}

export const emptyInboundCounts = (): InboundCounts => ({ read: 0, created: 0, updated: 0, unchanged: 0, conflicts: 0, skipped: 0, failed: 0, archived: 0 });

/**
 * - off: nunca se arrancó, o se apagó (desconectar lo apaga).
 * - initial: trayendo todo por primera vez.
 * - live: al día; revisa cambios cada minuto.
 * - paused: un admin lo pausó.
 * - waiting: HubSpot cortó por el límite diario; sigue solo más tarde.
 * - retrying: falló la última vuelta (HubSpot ocupado, sin red); reintenta con esperas cada vez más largas.
 * - blocked: la clave ya no vale o entra a otra cuenta; hay que reconectar.
 */
export type InboundState = 'off' | 'initial' | 'live' | 'paused' | 'waiting' | 'retrying' | 'blocked';

export interface InboundObjectProgress {
  read: number;
  /** Total que informó HubSpot al empezar (solo en la primera vuelta). */
  total: number | null;
  /** Ya trajo todo lo de este objeto al menos una vez. */
  caughtUp: boolean;
  /** Código del último problema de este objeto ('' si no hay). */
  error: string;
}

export interface InboundErrorEntry {
  at: string;
  object: string;
  code: string;
  count: number;
}

export interface InboundView {
  state: InboundState;
  /** Se arrancó alguna vez (hay estado guardado). */
  started: boolean;
  objects: Record<InboundObjectName, boolean>;
  progress: Partial<Record<InboundObjectName, InboundObjectProgress>>;
  counts: Partial<Record<InboundObjectName, InboundCounts>>;
  /** Registros vinculados con HubSpot ahora, por objeto (las actividades juntas). */
  linked: { companies: number; contacts: number; deals: number; activities: number; archived: number };
  /** Registros con un conflicto anotado. */
  conflicts: number;
  errors: InboundErrorEntry[];
  /** Código del último problema general ('' si la última vuelta anduvo). */
  failure: string;
  startedAt: string | null;
  initialDoneAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  /** La clave no tiene el permiso para leer emails registrados: ese objeto no se puede prender. */
  emailScopeMissing: boolean;
}
