/**
 * Onboarding (/app/welcome): primer ingreso de una persona.
 *
 * - Cuenta nueva: uso personal o en equipo; si es equipo, nombre, tamaño,
 *   invitar compañeros; rol, herramienta de origen (con atajo a su
 *   importador) y app de entrada. Las respuestas quedan en users.profile y
 *   la ficha del workspace (lib/workspace.ts).
 * - Quien entra por una invitación: nombre, idioma y zona, y directo al
 *   workspace que lo invitó.
 *
 * Los usuarios de antes de 128 tienen onboarded_at = created_at: no lo ven.
 */
import { getDb, type UserRow } from './db';
import { PRODUCT_CONFIG, isProductKey, type ProductKey } from './products';
import { isValidTimeZone } from './user-tz';
import { cleanLine, ensureWorkspace, updateWorkspace, WORKSPACE_SIZES } from './workspace';
import type { WorkspaceMode } from './workspace-mode';

export const ONBOARDING_ROLES = ['founder', 'sales', 'support', 'marketing', 'engineering', 'product', 'operations', 'design', 'other'] as const;
export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

/**
 * Herramientas de las que viene la gente, con la app de zerosoft que la
 * reemplaza y el importador que ya existe (null = todavía no hay).
 */
export const SOURCE_TOOLS: Record<string, { app: ProductKey; importHref: string | null }> = {
  hubspot: { app: 'crm', importHref: '/app/crm/settings?tab=import&from=hubspot' },
  pipedrive: { app: 'crm', importHref: '/app/crm/settings?tab=import&from=pipedrive' },
  salesforce: { app: 'crm', importHref: null },
  notion: { app: 'docs', importHref: '/app/docs/import' },
  confluence: { app: 'docs', importHref: null },
  linear: { app: 'track', importHref: '/app/track/settings?tab=import' },
  jira: { app: 'track', importHref: '/app/track/settings?tab=import' },
  github: { app: 'track', importHref: '/app/track/settings?tab=import' },
  calendly: { app: 'cal', importHref: '/app/calendar/settings?tab=import' },
  bitly: { app: 'link', importHref: '/app/links/settings?tab=import' },
  evernote: { app: 'notes', importHref: '/app/notes' },
  slack: { app: 'talk', importHref: null },
  intercom: { app: 'chat', importHref: null },
  miro: { app: 'board', importHref: null },
  zapier: { app: 'flow', importHref: null },
  loom: { app: 'rec', importHref: null },
};
export const SOURCE_TOOL_KEYS = Object.keys(SOURCE_TOOLS);

export interface OnboardingProfile {
  role?: OnboardingRole;
  sourceTool?: string;
  entryApp?: ProductKey;
  goals?: string[];
  nameEdited?: boolean;
  sampleData?: boolean;
}

export function parseProfile(raw: unknown): OnboardingProfile {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' ? (v as OnboardingProfile) : {};
  } catch {
    return {};
  }
}

export function needsOnboarding(user: Pick<UserRow, 'onboarded_at'>): boolean {
  return !user.onboarded_at;
}

/** Nombre sugerido del equipo a partir del dominio del email ("ana@getdarwin.ai" → "Getdarwin"). */
export function suggestTeamName(email: string, fallback: string): string {
  const domain = email.split('@')[1] ?? '';
  const base = domain.split('.')[0] ?? '';
  const generic = new Set(['gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'yahoo', 'icloud', 'me', 'proton', 'protonmail', 'test', 'example']);
  if (!base || generic.has(base)) return fallback;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** A dónde va la persona al terminar: el importador de su herramienta o la app de entrada. */
export function onboardingDestination(profile: OnboardingProfile, importNow: boolean): string {
  const tool = profile.sourceTool ? SOURCE_TOOLS[profile.sourceTool] : undefined;
  if (importNow && tool?.importHref) return tool.importHref;
  const app = profile.entryApp ?? tool?.app;
  return app ? PRODUCT_CONFIG[app].launch : '/app';
}

function cleanLocale(raw: unknown): 'en' | 'es' | 'pt' | null {
  return raw === 'en' || raw === 'es' || raw === 'pt' ? raw : null;
}

function cleanTz(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= 64 && isValidTimeZone(raw) ? raw : null;
}

async function saveProfileRow(
  userId: string,
  patch: { name?: string | null; locale?: string | null; timeZone?: string | null; profile: OnboardingProfile; finish: boolean },
): Promise<void> {
  const db = getDb();
  const current = (await db.prepare('SELECT profile FROM users WHERE id = ?').get(userId)) as { profile?: string } | undefined;
  const merged = { ...parseProfile(current?.profile), ...patch.profile };
  await db
    .prepare(
      `UPDATE users SET name = COALESCE(?, name), locale = COALESCE(?, locale), time_zone = COALESCE(?, time_zone), profile = ?,
       onboarded_at = CASE WHEN ? = 1 THEN COALESCE(onboarded_at, ?) ELSE onboarded_at END WHERE id = ?`,
    )
    .run(
      patch.name ?? null,
      patch.locale ?? null,
      patch.timeZone ?? null,
      JSON.stringify(merged),
      patch.finish ? 1 : 0,
      new Date().toISOString(),
      userId,
    );
}

/** Perfil corto (invitados y Ajustes › Perfil): nombre, idioma y zona. */
export async function saveBasicProfile(
  userId: string,
  input: { name?: unknown; locale?: unknown; timeZone?: unknown; finish?: boolean },
): Promise<void> {
  const name = typeof input.name === 'string' ? cleanLine(input.name) : '';
  await saveProfileRow(userId, {
    name: name || null,
    locale: cleanLocale(input.locale),
    timeZone: cleanTz(input.timeZone),
    profile: name ? { nameEdited: true } : {},
    finish: input.finish !== false,
  });
}

export interface OnboardingInput {
  mode: WorkspaceMode;
  teamName?: string;
  size?: string;
  role?: string;
  sourceTool?: string;
  entryApp?: string;
  goals?: string[];
  name?: string;
  locale?: string;
  timeZone?: string;
  sampleData?: boolean;
}

/**
 * Guarda el onboarding completo: ficha del workspace (modo, nombre, tamaño),
 * perfil de la persona y la marca de terminado. Las invitaciones las manda
 * la ruta (necesita el origen público). Devuelve el perfil guardado.
 */
export async function saveOnboarding(user: Pick<UserRow, 'id' | 'name' | 'email'>, input: OnboardingInput): Promise<OnboardingProfile> {
  const team = await ensureWorkspace(user.id);
  const mode: WorkspaceMode = input.mode === 'team' ? 'team' : 'personal';
  const size = input.size && (WORKSPACE_SIZES as readonly string[]).includes(input.size) ? input.size : undefined;
  const teamName = input.teamName ? cleanLine(input.teamName) : undefined;
  await updateWorkspace(team.id, {
    mode,
    ...(mode === 'team' && teamName ? { name: teamName } : {}),
    ...(size ? { size } : mode === 'personal' ? { size: '1' } : {}),
  });
  const profile: OnboardingProfile = {
    role: (ONBOARDING_ROLES as readonly string[]).includes(input.role ?? '') ? (input.role as OnboardingRole) : undefined,
    sourceTool: input.sourceTool && SOURCE_TOOL_KEYS.includes(input.sourceTool) ? input.sourceTool : undefined,
    entryApp: input.entryApp && isProductKey(input.entryApp) ? input.entryApp : undefined,
    goals: Array.isArray(input.goals) ? input.goals.filter((g) => typeof g === 'string').slice(0, 10).map((g) => g.slice(0, 40)) : undefined,
    sampleData: Boolean(input.sampleData),
  };
  const name = input.name ? cleanLine(input.name) : undefined;
  await saveProfileRow(user.id, {
    name: name || null,
    locale: cleanLocale(input.locale),
    timeZone: cleanTz(input.timeZone),
    profile: { ...profile, ...(name && name !== user.name ? { nameEdited: true } : {}) },
    finish: true,
  });
  if (input.sampleData) {
    const { seedUserIfNeeded } = await import('./seed');
    await seedUserIfNeeded(user.id);
  }
  return profile;
}
