/**
 * CRM ↔ HubSpot, conflictos (S4) — lo que ve la pantalla. Datos puros: sirve
 * en cliente y servidor. Los valores de cada lado solo viajan en la respuesta
 * del detalle; lo guardado son nombres de campos.
 */

export type ConflictObject = 'contact' | 'company' | 'deal' | 'activity';
export type ConflictKeep = 'here' | 'hubspot';

export interface ConflictItem {
  object: ConflictObject;
  recordId: string;
  /** 'fields': campos cambiados de los dos lados; 'merge': HubSpot fusionó dos registros que acá son dos. */
  kind: 'fields' | 'merge';
  fields: string[];
  /** Nombre del registro (el admin ve todo el CRM); '' para actividades. */
  name: string;
  /** Se puede resolver campo por campo (contactos, empresas y negocios con conflicto de campos). */
  resolvable: boolean;
  updatedAt: string;
}

export interface ConflictList {
  total: number;
  byObject: Partial<Record<ConflictObject, number>>;
  items: ConflictItem[];
  /** Hay más después de esta página. */
  more: boolean;
}

export interface ConflictValue {
  field: string;
  /** Lo de acá, para mostrar ('' vacío). */
  here: string;
  /** Lo de HubSpot ahora, para mostrar ('' vacío; null si acá no tiene equivalente). */
  hubspot: string | null;
  /** Ya son iguales (alguien lo arregló de un lado): resolverlo solo lo saca de la lista. */
  equal: boolean;
}

export type ConflictErrorCode = 'not_connected' | 'blocked' | 'not_found' | 'not_resolvable' | 'hubspot_missing' | 'hubspot_busy' | 'provider_error';

export type DetailResult = { ok: true; item: ConflictItem; values: ConflictValue[] } | { ok: false; code: ConflictErrorCode };

export interface ResolveSummary {
  /** Campos resueltos. */
  resolved: number;
  /** Campos que siguen en conflicto, con su código (sin valores). */
  kept: Array<{ field: string; code: 'hubspot_value_unmapped' | 'email_taken' }>;
  /** Registros que ya no estaban acá o vinculados: se sacaron de la lista. */
  orphans?: number;
  /** Registros que HubSpot ya no tiene: quedan en la lista hasta que la entrada marque su vínculo. */
  missing?: number;
}

export type ResolveResult = ({ ok: true } & ResolveSummary & { remaining: number }) | { ok: false; code: ConflictErrorCode };
