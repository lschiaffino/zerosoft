/**
 * Hub de importación (/app/settings/import): qué se puede traer a cada app,
 * con qué se conecta (token hoy; OAuth después) y qué permisos pide cada
 * herramienta. Datos puros: los usan la página del hub, el sidebar, Cmd+K y
 * las rutas de import (quién puede importar). Los textos (pasos para sacar el
 * token, qué trae) van en messages/<locale>/settings.json › importHub.
 *
 * `panel` dice dónde vive el flujo: los importadores con su propio panel se
 * muestran dentro del hub; los que todavía viven en su app abren esa página.
 */
import type { ProductKey } from './products';

export type ImportAuthKind = 'token' | 'file';

/** App destino de un import (las claves de lib/products.ts). */
export type ImportHubApp = Extract<ProductKey, 'crm' | 'docs' | 'track' | 'cal' | 'link' | 'notes'>;

export const IMPORT_HUB_APPS: readonly ImportHubApp[] = ['crm', 'docs', 'track', 'cal', 'link', 'notes'];

export type ImportPanel = 'crm' | 'docs-api' | 'docs-zip' | 'track' | 'cal' | 'external';

export interface ImportSourceDef {
  /** `<app>:<fuente>`, el valor de ?source= en el hub. */
  id: string;
  app: ImportHubApp;
  /** Fuente dentro de la app (lo que guarda el job). */
  source: string;
  /** Nombre de la herramienta (marca, sin traducir). */
  name: string;
  auth: ImportAuthKind;
  /** Claves de settings.importHub.entities: qué trae. */
  entities: string[];
  /** Permisos exactos que tiene que tener el token (tal cual los muestra la herramienta). */
  scopes?: string[];
  /** Pasos de settings.importHub.steps.<clave> (de dónde sacar el token o el archivo). */
  steps: string;
  stepCount: number;
  /** Dónde se crea el token o se exporta el archivo. */
  tokenUrl?: string;
  /** Documentación oficial. */
  docsUrl?: string;
  /** Solo admins del workspace (importan para todos). */
  adminOnly: boolean;
  panel: ImportPanel;
  /** `external`: la página del importador. */
  href?: string;
  /** Fuente que el panel abre ya elegida (Track y Docs por archivo). */
  panelSource?: string;
}

export const HUBSPOT_PRIVATE_APP_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.objects.owners.read',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read',
  'crm.lists.read',
  'sales-email-read',
] as const;

export const IMPORT_SOURCES: readonly ImportSourceDef[] = [
  {
    id: 'crm:hubspot',
    app: 'crm',
    source: 'hubspot',
    name: 'HubSpot',
    auth: 'token',
    entities: ['contacts', 'companies', 'deals', 'pipelines', 'owners', 'activities', 'customFields', 'lists'],
    scopes: [...HUBSPOT_PRIVATE_APP_SCOPES],
    steps: 'hubspot',
    stepCount: 5,
    tokenUrl: 'https://app.hubspot.com/private-apps/',
    docsUrl: 'https://developers.hubspot.com/docs/guides/apps/private-apps/overview',
    adminOnly: true,
    panel: 'crm',
  },
  {
    id: 'crm:pipedrive',
    app: 'crm',
    source: 'pipedrive',
    name: 'Pipedrive',
    auth: 'token',
    entities: ['contacts', 'companies', 'deals', 'pipelines', 'owners', 'activities', 'customFields'],
    steps: 'pipedrive',
    stepCount: 3,
    tokenUrl: 'https://app.pipedrive.com/settings/api',
    docsUrl: 'https://pipedrive.readme.io/docs/how-to-find-the-api-token',
    adminOnly: true,
    panel: 'crm',
  },
  {
    id: 'docs:notion_api',
    app: 'docs',
    source: 'notion_api',
    name: 'Notion',
    auth: 'token',
    entities: ['pages', 'databases', 'files', 'links'],
    scopes: ['Read content', 'Read user information including email addresses'],
    steps: 'notionApi',
    stepCount: 5,
    tokenUrl: 'https://www.notion.so/profile/integrations',
    docsUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
    adminOnly: true,
    panel: 'docs-api',
  },
  {
    id: 'docs:notion',
    app: 'docs',
    source: 'notion',
    name: 'Notion',
    auth: 'file',
    entities: ['pages', 'databases', 'files'],
    steps: 'notionZip',
    stepCount: 3,
    docsUrl: 'https://www.notion.com/help/export-your-content',
    adminOnly: false,
    panel: 'docs-zip',
    panelSource: 'notion',
  },
  {
    id: 'docs:confluence',
    app: 'docs',
    source: 'confluence',
    name: 'Confluence',
    auth: 'file',
    entities: ['pages', 'files'],
    steps: 'confluence',
    stepCount: 2,
    adminOnly: false,
    panel: 'docs-zip',
    panelSource: 'confluence',
  },
  {
    id: 'docs:gdocs',
    app: 'docs',
    source: 'gdocs',
    name: 'Google Docs',
    auth: 'file',
    entities: ['pages', 'files'],
    steps: 'gdocs',
    stepCount: 2,
    adminOnly: false,
    panel: 'docs-zip',
    panelSource: 'gdocs',
  },
  {
    id: 'track:linear',
    app: 'track',
    source: 'linear',
    name: 'Linear',
    auth: 'token',
    entities: ['issues', 'projects', 'states', 'labels', 'comments'],
    scopes: ['Read'],
    steps: 'linear',
    stepCount: 3,
    tokenUrl: 'https://linear.app/settings/account/security',
    docsUrl: 'https://linear.app/developers/graphql',
    adminOnly: true,
    panel: 'track',
    panelSource: 'linear',
  },
  {
    id: 'track:jira',
    app: 'track',
    source: 'jira',
    name: 'Jira',
    auth: 'token',
    entities: ['issues', 'projects', 'states', 'comments'],
    steps: 'jira',
    stepCount: 3,
    tokenUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    docsUrl: 'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/',
    adminOnly: true,
    panel: 'track',
    panelSource: 'jira',
  },
  {
    id: 'track:github',
    app: 'track',
    source: 'github',
    name: 'GitHub Issues',
    auth: 'token',
    entities: ['issues', 'labels', 'comments'],
    scopes: ['Issues: Read-only', 'Metadata: Read-only'],
    steps: 'github',
    stepCount: 3,
    tokenUrl: 'https://github.com/settings/personal-access-tokens/new',
    adminOnly: true,
    panel: 'track',
    panelSource: 'github',
  },
  {
    id: 'track:asana',
    app: 'track',
    source: 'asana',
    name: 'Asana',
    auth: 'token',
    entities: ['issues', 'states', 'comments'],
    steps: 'asana',
    stepCount: 2,
    tokenUrl: 'https://app.asana.com/0/my-apps',
    adminOnly: true,
    panel: 'track',
    panelSource: 'asana',
  },
  {
    id: 'track:shortcut',
    app: 'track',
    source: 'shortcut',
    name: 'Shortcut',
    auth: 'token',
    entities: ['issues', 'states', 'comments'],
    steps: 'shortcut',
    stepCount: 2,
    adminOnly: true,
    panel: 'track',
    panelSource: 'shortcut',
  },
  {
    id: 'track:csv',
    app: 'track',
    source: 'csv',
    name: 'CSV',
    auth: 'file',
    entities: ['issues'],
    steps: 'trackCsv',
    stepCount: 2,
    adminOnly: true,
    panel: 'track',
    panelSource: 'csv',
  },
  {
    id: 'cal:calendly',
    app: 'cal',
    source: 'calendly',
    name: 'Calendly',
    auth: 'token',
    entities: ['eventTypes', 'availability', 'bookings'],
    steps: 'calendly',
    stepCount: 3,
    tokenUrl: 'https://calendly.com/integrations/api_webhooks',
    docsUrl: 'https://developer.calendly.com/how-to-authenticate-with-personal-access-tokens',
    adminOnly: true,
    panel: 'cal',
  },
  {
    id: 'link:bitly',
    app: 'link',
    source: 'bitly',
    name: 'Bitly',
    auth: 'token',
    entities: ['shortLinks', 'tags'],
    steps: 'bitly',
    stepCount: 2,
    tokenUrl: 'https://app.bitly.com/settings/api/',
    adminOnly: true,
    panel: 'external',
    href: '/app/links/settings?tab=import',
  },
  {
    id: 'notes:evernote',
    app: 'notes',
    source: 'evernote',
    name: 'Evernote',
    auth: 'file',
    entities: ['notes', 'files'],
    steps: 'evernote',
    stepCount: 2,
    adminOnly: false,
    panel: 'external',
    href: '/app/notes',
  },
];

export function importSource(id: string | null | undefined): ImportSourceDef | null {
  return IMPORT_SOURCES.find((s) => s.id === id) ?? null;
}

export function importSourcesFor(app: ImportHubApp): ImportSourceDef[] {
  return IMPORT_SOURCES.filter((s) => s.app === app);
}

export function isImportHubApp(v: unknown): v is ImportHubApp {
  return typeof v === 'string' && (IMPORT_HUB_APPS as readonly string[]).includes(v);
}

/** Link del hub para una app (el atajo "Importar" de cada app) o una fuente. */
export function importHubHref(opts: { app?: string | null; source?: string | null } = {}): string {
  if (opts.source && importSource(opts.source)) return `/app/settings/import?source=${encodeURIComponent(opts.source)}`;
  if (opts.app && isImportHubApp(opts.app)) return `/app/settings/import?app=${opts.app}`;
  return '/app/settings/import';
}

/**
 * Quién puede importar en los jobs de lib/import-runner.ts: Track, Cal y
 * Notion por API escriben para todo el workspace (solo admins); Docs por
 * archivo, cualquier miembro en un teamspace donde puede crear páginas.
 */
export function importNeedsAdmin(app: string, source: string): boolean {
  if (app === 'docs') return source === 'notion_api';
  return true;
}
