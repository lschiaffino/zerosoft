/** Pestañas de Ajustes del CRM (?tab=). La primera es la de entrada. */
export const CRM_SETTINGS_TABS = ['team', 'sales', 'data', 'automation', 'integrations', 'import'] as const;
export type CrmSettingsTab = (typeof CRM_SETTINGS_TABS)[number];

/**
 * Qué pestaña mostrar. Un valor desconocido cae en la primera; si vuelve el
 * callback de Gmail (?gmail=…) sin pestaña, abre Integraciones.
 */
export function crmSettingsTab(tab: string | undefined, gmailNotice?: string): CrmSettingsTab {
  if (tab && (CRM_SETTINGS_TABS as readonly string[]).includes(tab)) return tab as CrmSettingsTab;
  if (gmailNotice) return 'integrations';
  return 'team';
}

/** Anclas viejas (#quotas, #pipelines…) → pestaña nueva, para links guardados. */
export const LEGACY_ANCHORS: Record<string, CrmSettingsTab> = {
  team: 'team',
  access: 'team',
  assignment: 'automation',
  scoring: 'automation',
  quotas: 'sales',
  integrations: 'integrations',
  pipelines: 'sales',
  fields: 'data',
  tags: 'data',
  currency: 'sales',
  import: 'import',
  export: 'import',
};
