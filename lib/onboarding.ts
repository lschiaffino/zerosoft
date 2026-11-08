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
import { PRODUCT_CONFIG, isProductKey } from './products';
import { isValidTimeZone } from './user-tz';
import { cleanLine, ensureWorkspace, updateWorkspace, WORKSPACE_SIZES } from './workspace';
import type { WorkspaceMode } from './workspace-mode';
import {
  cleanApps,
  cleanDraft,
  ONBOARDING_ROLES,
  parseProfile,
  SOURCE_TOOL_KEYS,
  SOURCE_TOOLS,
  type OnboardingProfile,
  type OnboardingRole,
  type SetupStep,
} from './onboarding-shared';

export * from './onboarding-shared';

export function needsOnboarding(user: Pick<UserRow, 'onboarded_at'>): boolean {
  return !user.onboarded_at;
}

/** Nombre sugerido del equipo a partir del dominio del email ("ana@acme.io" → "Acme"). */
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
  return app ? PRODUCT_CONFIG[app].launch : '/app/start';
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

/**
 * Cambia campos del perfil en una sola sentencia (json_patch, RFC 7396): dos
 * pedidos a la vez (el borrador y el aviso de la app de escritorio) no se pisan.
 * Un valor null borra la clave.
 */
export async function patchProfile(userId: string, patch: Record<string, unknown>): Promise<void> {
  await getDb()
    .prepare(
      "UPDATE users SET profile = json_patch(CASE WHEN json_valid(profile) THEN profile ELSE '{}' END, ?) WHERE id = ?",
    )
    .run(JSON.stringify(patch), userId);
}

export async function getProfile(userId: string): Promise<OnboardingProfile> {
  const row = (await getDb().prepare('SELECT profile FROM users WHERE id = ?').get(userId)) as { profile?: string } | undefined;
  return parseProfile(row?.profile);
}

/** Guarda el borrador del primer tramo (se retoma si la persona cierra la pestaña). */
export async function saveDraft(userId: string, raw: unknown): Promise<void> {
  await patchProfile(userId, { draft: cleanDraft(raw) });
}

/** Segundo tramo: en qué paso quedó, o terminado (done). */
export async function saveSetupProgress(userId: string, input: { step?: SetupStep; done?: boolean; sourceTool?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.step) patch.setupStep = input.step;
  if (input.done) patch.setupDoneAt = new Date().toISOString();
  if (input.sourceTool !== undefined) patch.sourceTool = input.sourceTool && SOURCE_TOOL_KEYS.includes(input.sourceTool) ? input.sourceTool : null;
  if (Object.keys(patch).length) await patchProfile(userId, patch);
}

/** La app de escritorio avisa que se abrió con esta cuenta (la primera vez queda la fecha). */
export async function markDesktopSeen(userId: string, info: { platform?: unknown; version?: unknown }): Promise<void> {
  const profile = await getProfile(userId);
  const platform = info.platform === 'darwin' || info.platform === 'win32' ? info.platform : undefined;
  const version = typeof info.version === 'string' && /^[0-9A-Za-z.+-]{1,32}$/.test(info.version) ? info.version : undefined;
  await patchProfile(userId, {
    desktopSeenAt: profile.desktopSeenAt ?? new Date().toISOString(),
    ...(platform ? { desktopPlatform: platform } : {}),
    ...(version ? { desktopVersion: version } : {}),
  });
}

export async function markDesktopDownloaded(userId: string): Promise<void> {
  await patchProfile(userId, { desktopDownloadedAt: new Date().toISOString() });
}

export async function dismissChecklist(userId: string, dismissed = true): Promise<void> {
  await patchProfile(userId, { checklistDismissedAt: dismissed ? new Date().toISOString() : null });
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
    // Quien entra por invitación también ve "Primeros pasos" (escritorio, calendario).
    profile: { ...(name ? { nameEdited: true } : {}), ...(input.finish !== false ? { v: 2, setupDoneAt: new Date().toISOString() } : {}) },
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
  apps?: string[];
  goals?: string[];
  name?: string;
  locale?: string;
  timeZone?: string;
  sampleData?: boolean;
}

/**
 * Guarda el primer tramo del onboarding: ficha del workspace (modo, nombre,
 * tamaño), perfil de la persona (rol, apps) y la marca de terminado. Las
 * invitaciones las manda la ruta (necesita el origen público). Después sigue
 * el segundo tramo (conectar, importar, escritorio), que se puede saltear.
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
  const apps = cleanApps(input.apps);
  const entryApp = input.entryApp && isProductKey(input.entryApp) ? input.entryApp : apps[0];
  const profile: OnboardingProfile = {
    v: 2,
    role: (ONBOARDING_ROLES as readonly string[]).includes(input.role ?? '') ? (input.role as OnboardingRole) : undefined,
    sourceTool: input.sourceTool && SOURCE_TOOL_KEYS.includes(input.sourceTool) ? input.sourceTool : undefined,
    entryApp,
    apps: apps.length ? apps : undefined,
    goals: Array.isArray(input.goals) ? input.goals.filter((g) => typeof g === 'string').slice(0, 10).map((g) => g.slice(0, 40)) : undefined,
    sampleData: Boolean(input.sampleData),
    setupStep: 'connect',
  };
  const name = input.name ? cleanLine(input.name) : undefined;
  await saveProfileRow(user.id, {
    name: name || null,
    locale: cleanLocale(input.locale),
    timeZone: cleanTz(input.timeZone),
    profile: { ...profile, ...(name && name !== user.name ? { nameEdited: true } : {}) },
    finish: true,
  });
  // El borrador ya no hace falta.
  await patchProfile(user.id, { draft: null });
  if (input.sampleData) {
    const { seedUserIfNeeded } = await import('./seed');
    await seedUserIfNeeded(user.id, { groups: true });
  }
  return profile;
}
