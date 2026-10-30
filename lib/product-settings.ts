/**
 * Ajustes mínimos de las apps que no tenían (Docs, Notes, Board, Flow,
 * Agents, Robots) y de las que se están construyendo (Voice, Rec, Talk): pestañas y atajos a lo que ya existe. Los textos están en
 * settings.products.links.<label>. Link tiene su página propia
 * (/app/links/settings: dominios, importar, exportar).
 */
export const MINIMAL_SETTINGS_APPS = ['docs', 'notes', 'board', 'flow', 'agents', 'robots', 'voice', 'rec', 'talk', 'design'] as const;
export type MinimalSettingsApp = (typeof MINIMAL_SETTINGS_APPS)[number];

export const PRODUCT_SETTINGS_SHORTCUTS: Record<MinimalSettingsApp, Array<{ href: string; label: string }>> = {
  docs: [
    { href: '/app/docs/import', label: 'notionImport' },
    { href: '/app/docs#templates', label: 'docsTemplates' },
    { href: '/app/settings/members', label: 'members' },
  ],
  notes: [
    { href: '/app/notes', label: 'evernoteImport' },
    { href: '/app/notes/clip', label: 'clipper' },
    { href: '/app/settings/import', label: 'importHub' },
  ],
  board: [
    { href: '/app/board?new=1', label: 'newBoard' },
    { href: '/app/settings/members', label: 'members' },
  ],
  flow: [
    { href: '/app/flow/credentials', label: 'flowCredentials' },
    { href: '/app/flow/tables', label: 'flowTables' },
    { href: '/app/settings/api', label: 'api' },
  ],
  agents: [
    { href: '/app/settings/billing', label: 'aiUsage' },
    { href: '/app/flow/credentials', label: 'flowCredentials' },
  ],
  robots: [
    { href: '/app/robots/recorder', label: 'recorder' },
    { href: '/app/settings/billing', label: 'aiUsage' },
  ],
  voice: [
    { href: '/app/settings/billing', label: 'aiUsage' },
    { href: '/app/settings/members', label: 'members' },
  ],
  rec: [
    { href: '/app/settings/members', label: 'members' },
    { href: '/app/settings/billing', label: 'aiUsage' },
  ],
  talk: [{ href: '/app/settings/members', label: 'members' }],
  design: [
    { href: '/app/design/brand', label: 'designBrand' },
    { href: '/app/design/templates', label: 'designTemplates' },
    { href: '/app/settings/members', label: 'members' },
    { href: '/app/settings/billing', label: 'aiUsage' },
  ],
};

/** Pestañas de los ajustes de Link (?tab=), la primera es la de entrada. */
export const LINK_SETTINGS_TABS = ['domains', 'conversions', 'integrations', 'import', 'export', 'activity'] as const;
export type LinkSettingsTab = (typeof LINK_SETTINGS_TABS)[number];

export function linkSettingsTab(value: string | undefined): LinkSettingsTab {
  return (LINK_SETTINGS_TABS as readonly string[]).includes(value ?? '') ? (value as LinkSettingsTab) : 'domains';
}
