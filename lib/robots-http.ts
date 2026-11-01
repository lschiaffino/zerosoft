/**
 * Robots — helpers de las rutas API (app/api/robots/**). Errores
 * { error: '<code>' }; el editor los traduce con robots.errors.*.
 */
import { NextResponse } from 'next/server';
import type { SessionUser } from './session';
import { roleAtLeast, type TeamRole } from './teams';
import type { RobotRow } from './db';
import type { RobotWorkspaceConfig } from './robots';

export function robotError(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

export const unauthorized = () => robotError(401, 'unauthorized');
export const forbidden = () => robotError(403, 'forbidden');
export const notFound = () => robotError(404, 'not_found');

/** Crear, editar, borrar y correr robots: admins y owners (igual que Flow). */
export function canEditRobots(user: Pick<SessionUser, 'role'>): boolean {
  return roleAtLeast(user.role, 'admin');
}

/** ¿El robot usa un login, una sesión guardada o envíos con credenciales? Esos quedan para admins. */
export function robotUsesLogin(row: Pick<RobotRow, 'steps' | 'persist_session' | 'settings'>): boolean {
  if (row.persist_session === 1) return true;
  if (/\{\{[^{}]*\bcredentials\b/.test(row.steps ?? '')) return true;
  return /"kind"\s*:\s*"(sheets|airtable|s3)"/.test(row.settings ?? '');
}

/** ¿Es member (no invitado) en un workspace que deja armar robots a sus members? */
export function isRobotBuilder(role: TeamRole, config: Pick<RobotWorkspaceConfig, 'membersCanBuild'>): boolean {
  return roleAtLeast(role, 'admin') || (config.membersCanBuild && roleAtLeast(role, 'member'));
}

/** Editar un robot: admins, o el member que lo creó si no usa un login. */
export function canEditRobot(
  who: { role: TeamRole; personId: string },
  row: Pick<RobotRow, 'steps' | 'persist_session' | 'settings' | 'created_by'>,
  config: Pick<RobotWorkspaceConfig, 'membersCanBuild'>,
): boolean {
  if (roleAtLeast(who.role, 'admin')) return true;
  return isRobotBuilder(who.role, config) && row.created_by === who.personId && !robotUsesLogin(row);
}

/** Correr un robot: admins, o cualquier member (si el workspace lo permite) cuando no usa un login. */
export function canRunRobot(
  who: { role: TeamRole },
  row: Pick<RobotRow, 'steps' | 'persist_session' | 'settings'>,
  config: Pick<RobotWorkspaceConfig, 'membersCanBuild'>,
): boolean {
  if (roleAtLeast(who.role, 'admin')) return true;
  return isRobotBuilder(who.role, config) && !robotUsesLogin(row);
}

/** Lo que un member no puede guardar: logins en los pasos, sesión guardada ni envíos con credenciales. */
export function memberPatchError(patch: { steps?: unknown; persistSession?: boolean; settings?: unknown; import?: unknown }): string | null {
  const text = JSON.stringify([patch.steps ?? null, patch.import ?? null]);
  if (/\{\{[^{}]*\bcredentials\b/.test(text)) return 'admin_only_login';
  // El sitio de un login lo elige un admin: un member no lo deja preparado.
  if (/"origin"\s*:\s*"[^"]/.test(text)) return 'admin_only_login';
  if (patch.persistSession === true) return 'admin_only_login';
  const settings = JSON.stringify([patch.settings ?? null, patch.import ?? null]);
  if (/"kind"\s*:\s*"(sheets|airtable|s3)"/.test(settings)) return 'admin_only_login';
  return null;
}

/**
 * Lo que un member manda a otras apps o personas: el envío al CRM pide acceso al
 * CRM, y el email de cambios solo va a gente del workspace.
 */
export async function memberSettingsError(
  user: { role?: string | null; apps?: unknown },
  workspaceId: string,
  settings: unknown,
): Promise<string | null> {
  const s = (settings ?? {}) as { destinations?: Array<{ kind?: string }>; changeEmail?: { to?: string[] } };
  if (s.destinations?.some((d) => d.kind === 'crm')) {
    const { userCanUseApp } = await import('./workspace');
    if (!userCanUseApp(user as Parameters<typeof userCanUseApp>[0], 'crm')) return 'no_crm_access';
  }
  const to = s.changeEmail?.to ?? [];
  if (to.length) {
    const { workspaceMemberEmails } = await import('./robots-alerts');
    const members = await workspaceMemberEmails(workspaceId);
    if (to.some((a) => !members.has(String(a).toLowerCase()))) return 'outside_recipient';
  }
  return null;
}

/** Persona real logueada (no el dueño del workspace). */
export function realUserId(user: Pick<SessionUser, 'id' | 'actingUser'>): string {
  return user.actingUser?.id ?? user.id;
}

/** Quién mira corridas y tabla (los datos con login no son para todo el workspace). */
export function robotViewer(user: Pick<SessionUser, 'id' | 'actingUser' | 'role'>): { personId: string; admin: boolean } {
  return { personId: realUserId(user), admin: canEditRobots(user) };
}

/** Error de IA (AiError.code) → código de la API de Robots (la cuota de IA no es la de minutos). */
export function aiErrorCode(code: string): string {
  return code === 'quota_exceeded' ? 'ai_quota_exceeded' : code;
}

/** HTTP de cada error de startRobotRun. */
export function runErrorStatus(code: string): number {
  switch (code) {
    case 'not_found':
      return 404;
    case 'rate_limited':
    case 'quota_exceeded':
      return 429;
    case 'busy':
      return 409;
    case 'admin_only_login':
    case 'takeover_required':
      return 403;
    case 'runner_unavailable':
      return 503;
    default:
      return 400;
  }
}
