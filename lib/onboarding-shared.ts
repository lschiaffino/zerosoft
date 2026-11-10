/**
 * Lo del onboarding que no toca la base: roles, herramientas de origen, apps
 * sugeridas, la forma del perfil (users.profile) y del borrador. Lo usan el
 * servidor (lib/onboarding.ts, lib/onboarding-state.ts) y el cliente
 * (components/settings/WelcomeFlow.tsx).
 */
import { APP_SWITCHER_ORDER, isComingSoon, isProductKey, type ProductKey } from './products';
import { featuredApps, WORKSPACE_SIZES_LIST, type WorkspaceMode } from './workspace-mode';

export const ONBOARDING_ROLES = ['founder', 'sales', 'support', 'marketing', 'engineering', 'product', 'operations', 'design', 'other'] as const;
export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

/**
 * Herramientas de las que viene la gente, con la app de zerosoft que la
 * reemplaza y el importador que ya existe (null = todavía no hay).
 */
export const SOURCE_TOOLS: Record<string, { app: ProductKey; importHref: string | null; name: string }> = {
  hubspot: { app: 'crm', name: 'HubSpot', importHref: '/app/settings/import?source=crm:hubspot' },
  pipedrive: { app: 'crm', name: 'Pipedrive', importHref: '/app/settings/import?source=crm:pipedrive' },
  salesforce: { app: 'crm', name: 'Salesforce', importHref: null },
  notion: { app: 'docs', name: 'Notion', importHref: '/app/settings/import?source=docs:notion_api' },
  confluence: { app: 'docs', name: 'Confluence', importHref: '/app/settings/import?source=docs:confluence' },
  linear: { app: 'track', name: 'Linear', importHref: '/app/settings/import?source=track:linear' },
  jira: { app: 'track', name: 'Jira', importHref: '/app/settings/import?source=track:jira' },
  github: { app: 'track', name: 'GitHub Issues', importHref: '/app/settings/import?source=track:github' },
  asana: { app: 'track', name: 'Asana', importHref: '/app/settings/import?source=track:asana' },
  periskope: { app: 'groups', name: 'Periskope', importHref: '/app/lines/settings?tab=numbers' },
  calendly: { app: 'cal', name: 'Calendly', importHref: '/app/settings/import?source=cal:calendly' },
  bitly: { app: 'link', name: 'Bitly', importHref: '/app/settings/import?source=link:bitly' },
  evernote: { app: 'notes', name: 'Evernote', importHref: '/app/settings/import?source=notes:evernote' },
  slack: { app: 'talk', name: 'Slack', importHref: null },
  intercom: { app: 'chat', name: 'Intercom', importHref: null },
  miro: { app: 'board', name: 'Miro', importHref: null },
  zapier: { app: 'flow', name: 'Zapier', importHref: null },
  loom: { app: 'rec', name: 'Loom', importHref: null },
};
export const SOURCE_TOOL_KEYS = Object.keys(SOURCE_TOOLS);

export interface OnboardingProfile {
  /** 2 = pasó por el onboarding con apps, conexiones y escritorio (ve "Primeros pasos" en el inicio). */
  v?: number;
  role?: OnboardingRole;
  sourceTool?: string;
  entryApp?: ProductKey;
  /** Apps que la persona dijo que va a usar: arman "Tus apps" del inicio, del switcher y del sidebar. */
  apps?: ProductKey[];
  goals?: string[];
  nameEdited?: boolean;
  sampleData?: boolean;
  /** Borrador del primer tramo (/app/welcome antes de guardar): se retoma al volver. */
  draft?: OnboardingDraft;
  /** Segundo tramo (conectar, importar, escritorio): paso actual y cuándo terminó o se salteó. */
  setupStep?: SetupStep;
  setupDoneAt?: string;
  /** "Primeros pasos" del inicio cerrado a mano. */
  checklistDismissedAt?: string;
  /** La app de escritorio se abrió con esta cuenta (lo avisa la propia app, ver DesktopSeen). */
  desktopSeenAt?: string;
  desktopPlatform?: string;
  desktopVersion?: string;
  /** Tocó un instalador (no prueba que lo instaló: eso es desktopSeenAt). */
  desktopDownloadedAt?: string;
}

/** Pasos del segundo tramo del onboarding, en orden. */
export const SETUP_STEPS = ['connect', 'import', 'desktop'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export function isSetupStep(v: unknown): v is SetupStep {
  return typeof v === 'string' && (SETUP_STEPS as readonly string[]).includes(v);
}

export const DRAFT_STEPS = ['use', 'team', 'you', 'apps', 'invite'] as const;
export interface OnboardingDraft {
  step?: (typeof DRAFT_STEPS)[number];
  mode?: WorkspaceMode;
  teamName?: string;
  size?: string;
  name?: string;
  role?: string;
  apps?: string[];
  sampleData?: boolean;
  invites?: string;
}

/** Limpia un borrador que llega del navegador (todo opcional, todo acotado). */
export function cleanDraft(raw: unknown): OnboardingDraft {
  if (!raw || typeof raw !== 'object') return {};
  const d = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const out: OnboardingDraft = {};
  if (typeof d.step === 'string' && (DRAFT_STEPS as readonly string[]).includes(d.step)) out.step = d.step as OnboardingDraft['step'];
  if (d.mode === 'team' || d.mode === 'personal') out.mode = d.mode;
  const teamName = str(d.teamName, 80);
  if (teamName !== undefined) out.teamName = teamName;
  if (typeof d.size === 'string' && (WORKSPACE_SIZES_LIST as readonly string[]).includes(d.size)) out.size = d.size;
  const name = str(d.name, 80);
  if (name !== undefined) out.name = name;
  if (typeof d.role === 'string' && (ONBOARDING_ROLES as readonly string[]).includes(d.role)) out.role = d.role;
  if (Array.isArray(d.apps)) out.apps = cleanApps(d.apps);
  if (typeof d.sampleData === 'boolean') out.sampleData = d.sampleData;
  const invites = str(d.invites, 4000);
  if (invites !== undefined) out.invites = invites;
  return out;
}

/**
 * Apps válidas, sin repetir, en el orden en que llegan (primero las del rol,
 * después las que la persona sumó): ese orden es el de "Tus apps" y la
 * primera es la app de entrada.
 */
export function cleanApps(raw: unknown): ProductKey[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((k): k is ProductKey => typeof k === 'string' && isProductKey(k) && !isComingSoon(k)))].slice(0, APP_SWITCHER_ORDER.length);
}

/**
 * Apps sugeridas según lo que hace la persona (preelegidas en el paso "Tus apps").
 * Sin rol, las destacadas del modo.
 */
const ROLE_APPS: Record<OnboardingRole, readonly ProductKey[]> = {
  founder: ['crm', 'track', 'docs', 'cal', 'chat'],
  sales: ['crm', 'cal', 'link', 'send', 'docs'],
  support: ['chat', 'groups', 'docs', 'track'],
  marketing: ['link', 'social', 'forms', 'pulse', 'docs'],
  engineering: ['track', 'docs', 'talk', 'board'],
  product: ['track', 'docs', 'board', 'pulse'],
  operations: ['docs', 'track', 'people', 'books'],
  design: ['design', 'board', 'docs', 'track'],
  other: ['docs', 'track', 'cal', 'notes'],
};
const PERSONAL_EXTRA: readonly ProductKey[] = ['notes', 'cal'];

export function suggestedApps(role: string | null | undefined, mode: WorkspaceMode): ProductKey[] {
  const base: readonly ProductKey[] =
    role && (ONBOARDING_ROLES as readonly string[]).includes(role) ? ROLE_APPS[role as OnboardingRole] : featuredApps({ mode });
  const list = mode === 'personal' ? [...base, ...PERSONAL_EXTRA] : [...base];
  return cleanApps(list);
}

/** Las apps elegidas de un perfil (null si nunca eligió: se usan las del modo). */
export function chosenApps(profileRaw: unknown): ProductKey[] | null {
  const apps = cleanApps(parseProfile(profileRaw).apps);
  return apps.length ? apps : null;
}

export function parseProfile(raw: unknown): OnboardingProfile {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' ? (v as OnboardingProfile) : {};
  } catch {
    return {};
  }
}

