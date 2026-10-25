/**
 * Track T3 — helpers de las rutas de triage, SLAs, pedidos, IA y agentes:
 * sesión + acceso al issue o proyecto (mismo workspace) y errores.
 */
import { NextResponse } from 'next/server';
import { AiError } from './ai';
import { getCurrentUser, isWorkspaceAdmin, realUserId, type SessionUser } from './session';
import { canAccessTrackProject, getIssue, getProject, type TrackIssueWithStatus } from './track-data';
import type { TrackProjectRow } from './db';
import { notFound, trackError, unauthorized } from './track-http';
import { requestLocale } from './request-locale';

/** Idioma del request (cookie de next-intl o Accept-Language) para los textos de IA. */
export function reqLocale(req: { cookies: { get(name: string): { value: string } | undefined }; headers: Headers }): string {
  return requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
}

export type IssueAccess =
  | { ok: true; user: SessionUser; actorId: string; issue: TrackIssueWithStatus; project: TrackProjectRow }
  | { ok: false; res: NextResponse };

export async function issueAccess(id: string): Promise<IssueAccess> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, res: unauthorized() };
  const issue = await getIssue(id);
  const project = issue ? await getProject(issue.project_id) : undefined;
  if (!issue || !project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return { ok: false, res: notFound() };
  return { ok: true, user, actorId: realUserId(user), issue, project };
}

export type ProjectAccess =
  | { ok: true; user: SessionUser; actorId: string; project: TrackProjectRow; admin: boolean }
  | { ok: false; res: NextResponse };

export async function projectAccess(id: string): Promise<ProjectAccess> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, res: unauthorized() };
  const project = await getProject(id);
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) return { ok: false, res: notFound() };
  return { ok: true, user, actorId: realUserId(user), project, admin: isWorkspaceAdmin(user) };
}

/** Errores de dominio (code + status) y de IA a JSON { error }. */
export function domainError(err: unknown): NextResponse {
  if (err instanceof AiError) return trackError(err.code === 'ai_disabled' ? 503 : 429, err.code);
  if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
    const e = err as { code: string; status: number };
    return trackError(e.status, e.code);
  }
  throw err;
}
