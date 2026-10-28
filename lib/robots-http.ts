/**
 * Robots — helpers de las rutas API (app/api/robots/**). Errores
 * { error: '<code>' }; el editor los traduce con robots.errors.*.
 */
import { NextResponse } from 'next/server';
import type { SessionUser } from './session';
import { roleAtLeast } from './teams';

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
    case 'runner_unavailable':
      return 503;
    default:
      return 400;
  }
}
