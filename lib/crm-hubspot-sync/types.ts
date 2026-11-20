/**
 * CRM ↔ HubSpot — la forma de la vista previa (lo que ve la pantalla). Datos
 * puros: sirve en cliente y servidor.
 */

export type PreviewObject = 'contacts' | 'companies' | 'deals';
export const PREVIEW_OBJECTS: readonly PreviewObject[] = ['contacts', 'companies', 'deals'];

/**
 * En qué queda cada registro:
 * - linked: ya vinculado (por un import anterior o por el sync).
 * - matched: se vincularía ahora (mismo email o mismo dominio, uno de cada lado).
 * - create_zerosoft: solo está en HubSpot; se crearía en zerosoft.
 * - create_hubspot: solo está en zerosoft; se crearía en HubSpot.
 * - update: par vinculado o coincidente con valores distintos (subconjunto de linked + matched).
 * - no_key_hubspot / no_key_zerosoft: sin email (contacto) o sin dominio (empresa): no se puede emparejar solo.
 * - multi_zerosoft: un registro de HubSpot coincide con varios de zerosoft.
 * - multi_hubspot: varios registros de HubSpot para uno de zerosoft, o con la misma clave entre ellos.
 * - duplicate_zerosoft: registro de zerosoft cuyo email o dominio ya es de otro par (un duplicado de este lado).
 * - conflict: vinculado a un registro, pero su email pertenece a otro.
 * - gone_hubspot: vinculado desde zerosoft a un registro que HubSpot ya no devuelve.
 */
export const PREVIEW_BUCKETS = [
  'linked',
  'matched',
  'create_zerosoft',
  'create_hubspot',
  'update',
  'no_key_hubspot',
  'no_key_zerosoft',
  'multi_zerosoft',
  'multi_hubspot',
  'duplicate_zerosoft',
  'conflict',
  'gone_hubspot',
] as const;
export type PreviewBucket = (typeof PREVIEW_BUCKETS)[number];

/** Los que alguien tiene que mirar antes de sincronizar. */
export const REVIEW_BUCKETS: readonly PreviewBucket[] = ['no_key_hubspot', 'no_key_zerosoft', 'multi_zerosoft', 'multi_hubspot', 'duplicate_zerosoft', 'conflict', 'gone_hubspot'];

/** Filas de muestra por grupo. */
export const PREVIEW_SAMPLE_SIZE = 10;
/** Tope de filas en las listas de dueños, etapas y propiedades. */
export const PREVIEW_LIST_MAX = 50;

export interface PreviewSample {
  label: string;
  detail: string;
  /** Id del registro en HubSpot, si la fila es de HubSpot. */
  hubspotId?: string;
  /** Id del registro en zerosoft, si la fila tiene uno de este lado. */
  zerosoftId?: string;
  /** update: campos con valores distintos de los dos lados. */
  conflicting?: string[];
  /** update: campos vacíos de un lado que se completarían con el otro. */
  filling?: string[];
  /** update: qué lado cambió último. */
  newer?: 'hubspot' | 'zerosoft' | '';
}

export interface ObjectReport {
  hubspot: number;
  zerosoft: number;
  counts: Record<PreviewBucket, number>;
  /** De los pares que se actualizarían: en cuántos chocan valores, y qué lado cambió último. */
  update: { conflicting: number; hubspotNewer: number; zerosoftNewer: number };
  samples: Partial<Record<PreviewBucket, PreviewSample[]>>;
  /**
   * La lectura de HubSpot se cortó antes del final: un registro sin fecha de
   * modificación no deja seguir. Los números son de lo leído hasta ahí.
   */
  incomplete?: boolean;
}

export interface PreviewPerson {
  name: string;
  email: string;
}

export interface OwnersReport {
  hubspot: number;
  zerosoft: number;
  matched: number;
  /** Dueños de HubSpot sin una persona del workspace con ese email. */
  hubspotOnly: PreviewPerson[];
  hubspotOnlyTotal: number;
  /** Personas del workspace sin un dueño en HubSpot con ese email. */
  zerosoftOnly: PreviewPerson[];
  zerosoftOnlyTotal: number;
  /** Dueños desactivados en HubSpot (no se emparejan). */
  archived: number;
}

export interface PipelineReport {
  name: string;
  /** Nombre del pipeline de zerosoft equivalente, o null. */
  match: string | null;
  stages: Array<{ name: string; matched: boolean }>;
}

export interface PipelinesReport {
  hubspot: PipelineReport[];
  /** Pipelines de zerosoft sin equivalente en HubSpot. */
  zerosoftOnly: Array<{ name: string; stages: string[] }>;
  /** Etapas de zerosoft sin equivalente, dentro de un pipeline que sí lo tiene. */
  zerosoftOnlyStages: Array<{ pipeline: string; stage: string }>;
  unmatchedStages: number;
}

export interface PropertyRow {
  name: string;
  label: string;
}

export interface PropertiesReport {
  /** Campos estándar que el sync empareja (nombre del campo de zerosoft). */
  standard: string[];
  /** De esos, los que HubSpot no deja escribir: solo viajan de HubSpot a zerosoft. */
  readOnlyInHubspot: string[];
  /** Propiedades propias de HubSpot que ya tienen un campo propio en zerosoft. */
  customMatched: number;
  /** Propiedades propias de HubSpot sin campo en zerosoft. */
  hubspotOnly: PropertyRow[];
  hubspotOnlyTotal: number;
  /** Campos propios de zerosoft sin propiedad en HubSpot. */
  zerosoftOnly: PropertyRow[];
  zerosoftOnlyTotal: number;
  /** Campos estándar de zerosoft sin equivalente en HubSpot (claves de texto fijas). */
  zerosoftStandardOnly: string[];
  /** Propiedades internas de HubSpot que el sync no toca. */
  hubspotBuiltIn: number;
}

export interface PreviewReport {
  objects: Partial<Record<PreviewObject, ObjectReport>>;
  owners?: OwnersReport;
  pipelines?: PipelinesReport;
  properties?: Partial<Record<PreviewObject, PropertiesReport>>;
}

export type PreviewStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';
export const PREVIEW_ACTIVE: readonly PreviewStatus[] = ['queued', 'running', 'waiting'];

export type PreviewStage = 'schema' | 'contacts' | 'companies' | 'deals' | 'compare';

export interface PreviewProgress {
  stage: PreviewStage;
  objects: Partial<Record<PreviewObject, { read: number; total: number | null }>>;
}

export interface PreviewView {
  id: string;
  status: PreviewStatus;
  portalId: string;
  createdAt: string;
  finishedAt: string | null;
  /** Código del motivo si falló ('' si no). */
  failure: string;
  /** waiting: desde cuándo se vuelve a intentar (HubSpot cortó por el límite diario). */
  resumeAfter: string | null;
  progress: PreviewProgress;
  /** Solo cuando terminó. */
  report: PreviewReport | null;
}

export function emptyCounts(): Record<PreviewBucket, number> {
  return Object.fromEntries(PREVIEW_BUCKETS.map((b) => [b, 0])) as Record<PreviewBucket, number>;
}

/** Cuántos registros de un objeto necesitan que alguien los mire. */
export function reviewTotal(r: ObjectReport): number {
  return REVIEW_BUCKETS.reduce((n, b) => n + (r.counts[b] ?? 0), 0);
}
