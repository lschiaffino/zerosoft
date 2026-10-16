export const RECORD_TABS = ['activity', 'properties', 'related'] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

/** `?tab=` → tab válido; cualquier otra cosa cae en Actividad (el default). */
export function parseRecordTab(value: string | string[] | undefined): RecordTab {
  return typeof value === 'string' && (RECORD_TABS as readonly string[]).includes(value)
    ? (value as RecordTab)
    : 'activity';
}

/** Href a un tab del mismo registro (p. ej. desde el resumen de Actividad). */
export function recordTabHref(base: string, tab: RecordTab): string {
  return tab === 'activity' ? base : `${base}?tab=${tab}`;
}
