/**
 * CRM — vista previa y tarjetas del board configurables (HubSpot "Customize
 * the preview sidebar" y "Edit cards"). Puro, sin server: lo usan Ajustes, la
 * vista previa, el board y lib/crm-layouts.ts.
 *
 * Vista previa, por objeto (contactos, empresas, deals):
 * - `properties`: qué propiedades muestra "Acerca de" a la vista, en orden
 *   (propias del objeto o `custom.<name>`); el resto queda en "Ver todas".
 * - `sections`: qué tarjetas muestra debajo y en qué orden (etapa, actividad
 *   reciente, asociaciones, propiedades personalizadas).
 *
 * Tarjetas del board de deals, por pipeline: hasta MAX_CARD_PROPS
 * propiedades debajo del nombre.
 *
 * Privacidad: una propiedad personalizada configurada que la persona tiene
 * oculta no le llega (lib/crm-layouts.ts la saca antes de responder) y la
 * fila del registro ya viene sin ese valor.
 */

export const LAYOUT_ENTITIES = ['contacts', 'companies', 'deals'] as const;
export type LayoutEntity = (typeof LAYOUT_ENTITIES)[number];

export function isLayoutEntity(v: unknown): v is LayoutEntity {
  return typeof v === 'string' && (LAYOUT_ENTITIES as readonly string[]).includes(v);
}

export const CUSTOM_PREFIX = 'custom.';

export function customLayoutName(key: string): string | null {
  return key.startsWith(CUSTOM_PREFIX) && key.length > CUSTOM_PREFIX.length ? key.slice(CUSTOM_PREFIX.length) : null;
}

/** Propiedades propias que puede mostrar "Acerca de" (las que edita la vista previa). */
export const PREVIEW_PROPERTIES: Record<LayoutEntity, readonly string[]> = {
  contacts: ['firstName', 'lastName', 'email', 'phone', 'jobTitle', 'lifecycleStage', 'leadStatus', 'ownerId', 'source', 'website', 'city', 'country'],
  companies: ['name', 'domain', 'industry', 'phone', 'lifecycleStage', 'ownerId', 'city', 'country', 'employees', 'website', 'description'],
  deals: ['name', 'amount', 'closeDate', 'ownerId', 'priority', 'dealType', 'nextStep', 'source', 'currency', 'description'],
};

/** Lo que muestra "Acerca de" si nadie lo configuró (como "Información clave" de HubSpot). */
export const DEFAULT_PREVIEW_PROPERTIES: Record<LayoutEntity, readonly string[]> = {
  contacts: ['email', 'phone', 'jobTitle', 'lifecycleStage', 'leadStatus', 'ownerId'],
  companies: ['domain', 'industry', 'phone', 'lifecycleStage', 'ownerId', 'city'],
  deals: ['amount', 'closeDate', 'ownerId', 'priority', 'dealType', 'nextStep'],
};

/** Tarjetas de la vista previa debajo de "Acerca de". */
export const PREVIEW_SECTIONS: Record<LayoutEntity, readonly string[]> = {
  contacts: ['activity', 'companies', 'deals', 'custom'],
  companies: ['activity', 'contacts', 'deals', 'custom'],
  deals: ['stage', 'activity', 'contacts', 'companies', 'custom'],
};

/** Por defecto, todas en el orden del catálogo. */
export const DEFAULT_PREVIEW_SECTIONS: Record<LayoutEntity, readonly string[]> = PREVIEW_SECTIONS;

export const MAX_PREVIEW_PROPERTIES = 20;

export interface PreviewLayout {
  properties: string[];
  sections: string[];
}

/** Propiedades que puede mostrar una tarjeta de deal. */
export const CARD_PROPERTIES = [
  'amount',
  'company',
  'contact',
  'closeDate',
  'ownerId',
  'priority',
  'dealType',
  'source',
  'nextStep',
  'createdAt',
  'lastActivity',
] as const;

/** Lo que ya mostraba la tarjeta. */
export const DEFAULT_CARD_PROPERTIES: readonly string[] = ['amount', 'company', 'closeDate', 'priority', 'ownerId'];

/** HubSpot deja pocas propiedades por tarjeta: con más, el board deja de leerse de un vistazo. */
export const MAX_CARD_PROPERTIES = 6;

export interface CardLayout {
  properties: string[];
}

/**
 * Limpia una lista de claves: solo conocidas (propias del catálogo o
 * personalizadas que existen), sin repetir, como mucho `max`.
 */
export function sanitizeKeys(
  keys: ReadonlyArray<unknown>,
  builtins: readonly string[],
  customNames: ReadonlySet<string>,
  max: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (typeof k !== 'string' || seen.has(k)) continue;
    const name = customLayoutName(k);
    if (!builtins.includes(k) && !(name && customNames.has(name))) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

/** Secciones conocidas del objeto, sin repetir y en el orden pedido. */
export function sanitizeSections(entity: LayoutEntity, sections: ReadonlyArray<unknown>): string[] {
  const out: string[] = [];
  for (const s of sections) {
    if (typeof s === 'string' && PREVIEW_SECTIONS[entity].includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

export function sanitizePreviewLayout(
  entity: LayoutEntity,
  raw: { properties?: unknown; sections?: unknown },
  customNames: ReadonlySet<string>,
): PreviewLayout {
  return {
    properties: sanitizeKeys(Array.isArray(raw.properties) ? raw.properties : [], PREVIEW_PROPERTIES[entity], customNames, MAX_PREVIEW_PROPERTIES),
    sections: sanitizeSections(entity, Array.isArray(raw.sections) ? raw.sections : []),
  };
}

export function sanitizeCardLayout(raw: { properties?: unknown }, customNames: ReadonlySet<string>): CardLayout {
  return {
    properties: sanitizeKeys(Array.isArray(raw.properties) ? raw.properties : [], CARD_PROPERTIES, customNames, MAX_CARD_PROPERTIES),
  };
}

export function defaultPreviewLayout(entity: LayoutEntity): PreviewLayout {
  return { properties: [...DEFAULT_PREVIEW_PROPERTIES[entity]], sections: [...DEFAULT_PREVIEW_SECTIONS[entity]] };
}

export function defaultCardLayout(): CardLayout {
  return { properties: [...DEFAULT_CARD_PROPERTIES] };
}

/** Saca las personalizadas que la persona no ve. Puro: lo aplica el server antes de responder. */
export function withoutHidden<T extends { properties: string[] }>(layout: T, hidden: ReadonlySet<string>): T {
  if (!hidden.size) return layout;
  return { ...layout, properties: layout.properties.filter((k) => !hidden.has(customLayoutName(k) ?? '')) };
}

/** Clave de traducción (namespace crm) de una propiedad propia de la vista previa. */
export function previewLabelKey(entity: LayoutEntity, key: string): string {
  if (entity === 'deals') {
    if (key === 'ownerId') return 'deals.form.owner';
    return `deals.form.${key}`;
  }
  if (entity === 'companies' && key === 'description') return 'companiesEnrich.description';
  const ns = entity === 'contacts' ? 'contacts.form' : 'companies.form';
  if (key === 'lifecycleStage') return `${ns}.lifecycle`;
  if (key === 'ownerId') return `${ns}.owner`;
  return `${ns}.${key}`;
}

/** Clave de traducción de una propiedad propia de la tarjeta de deal. */
export function cardLabelKey(key: string): string {
  switch (key) {
    case 'company':
      return 'layouts.cardProps.company';
    case 'contact':
      return 'layouts.cardProps.contact';
    case 'createdAt':
      return 'layouts.cardProps.createdAt';
    case 'lastActivity':
      return 'layouts.cardProps.lastActivity';
    case 'ownerId':
      return 'deals.form.owner';
    default:
      return `deals.form.${key}`;
  }
}

/** Clave de traducción del nombre de una sección de la vista previa. */
export function sectionLabelKey(entity: LayoutEntity, id: string): string {
  return `layouts.sections.${entity === 'deals' && id === 'stage' ? 'stage' : id}`;
}
