/**
 * Ajustes mínimos de las apps que no tenían (Docs, Notes, Board, Flow,
 * Agents, Robots): pestañas y atajos a lo que ya existe. Los textos están en
 * settings.products.links.<label>. Link tiene su página propia
 * (/app/links/settings: dominios, importar, exportar).
 */
export const MINIMAL_SETTINGS_APPS = ['docs', 'notes', 'board', 'flow', 'agents', 'robots'] as const;
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
};

/** Pestañas de los ajustes de Link (?tab=), la primera es la de entrada. */
export const LINK_SETTINGS_TABS = ['domains', 'import', 'export'] as const;
export type LinkSettingsTab = (typeof LINK_SETTINGS_TABS)[number];

export function linkSettingsTab(value: string | undefined): LinkSettingsTab {
  return (LINK_SETTINGS_TABS as readonly string[]).includes(value ?? '') ? (value as LinkSettingsTab) : 'domains';
}
