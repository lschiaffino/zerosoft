/**
 * Proyectos de Analytics: cada workspace tiene varios, cada uno con su key
 * pública (va en el snippet) y una key secreta opcional (ingesta de servidor
 * y borrar personas). Server-only.
 */
import { cookies } from 'next/headers';
import { cache } from 'react';
import { customAlphabet, nanoid } from 'nanoid';
import { getDb } from '../db';
import { sha256 } from '../api-auth';
import { normalizeDomains } from './ingest-core';
import type { ProjectDto } from './types';

export const PROJECT_COOKIE = 'zs_analytics_project';
const keyId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 28);

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  public_key: string;
  secret_hash: string | null;
  secret_hint: string | null;
  allowed_domains: string;
  respect_dnt: number;
  anonymize_ip: number;
  autocapture: number;
  retention_days: number;
  tz_offset_min: number;
  rolled_through: string | null;
  dirty_from: string | null;
  deleted_at: number | null;
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();

export function parseDomainList(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function toProjectDto(r: ProjectRow): ProjectDto {
  return {
    id: r.id,
    name: r.name,
    publicKey: r.public_key,
    secretHint: r.secret_hint,
    allowedDomains: parseDomainList(r.allowed_domains),
    respectDnt: r.respect_dnt === 1,
    anonymizeIp: r.anonymize_ip === 1,
    autocapture: r.autocapture === 1,
    retentionDays: Number(r.retention_days),
    tzOffsetMin: Number(r.tz_offset_min),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listProjects(workspaceId: string): Promise<ProjectRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM analytics_projects WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY created_at, id')
    .all(workspaceId)) as unknown as ProjectRow[];
}

/** Proyecto del workspace (null si no existe, es de otro workspace o se borró). */
export async function getProject(workspaceId: string, id: string): Promise<ProjectRow | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM analytics_projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL')
    .get(id, workspaceId)) as ProjectRow | undefined;
  return row ?? null;
}

export const RETENTION_OPTIONS = [30, 90, 180, 365, 730] as const;

export async function createProject(workspaceId: string, personId: string, name: string): Promise<ProjectRow> {
  const id = `ap_${nanoid(12)}`;
  const ts = now();
  await getDb()
    .prepare(
      `INSERT INTO analytics_projects (id, workspace_id, name, public_key, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, name.trim().slice(0, 100) || 'Project', `zsp_${keyId()}`, personId, ts, ts);
  return (await getProject(workspaceId, id))!;
}

export interface ProjectPatch {
  name?: string;
  allowedDomains?: string[];
  respectDnt?: boolean;
  anonymizeIp?: boolean;
  autocapture?: boolean;
  retentionDays?: number;
  tzOffsetMin?: number;
}

export async function updateProject(workspaceId: string, id: string, patch: ProjectPatch): Promise<ProjectRow | null> {
  const p = await getProject(workspaceId, id);
  if (!p) return null;
  const sets: string[] = [];
  const args: Array<string | number> = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name.trim().slice(0, 100) || p.name);
  }
  if (patch.allowedDomains !== undefined) {
    sets.push('allowed_domains = ?');
    args.push(JSON.stringify(normalizeDomains(patch.allowedDomains)));
  }
  if (patch.respectDnt !== undefined) {
    sets.push('respect_dnt = ?');
    args.push(patch.respectDnt ? 1 : 0);
  }
  if (patch.anonymizeIp !== undefined) {
    sets.push('anonymize_ip = ?');
    args.push(patch.anonymizeIp ? 1 : 0);
  }
  if (patch.autocapture !== undefined) {
    sets.push('autocapture = ?');
    args.push(patch.autocapture ? 1 : 0);
  }
  if (patch.retentionDays !== undefined) {
    sets.push('retention_days = ?');
    args.push(Math.min(3650, Math.max(1, Math.round(patch.retentionDays))));
  }
  if (patch.tzOffsetMin !== undefined) {
    sets.push('tz_offset_min = ?');
    args.push(Math.min(840, Math.max(-720, Math.round(patch.tzOffsetMin))));
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    args.push(now());
    await getDb()
      .prepare(`UPDATE analytics_projects SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`)
      .run(...args, id, workspaceId);
    forgetProjectCache();
  }
  return getProject(workspaceId, id);
}

/**
 * Borra el proyecto: deja de aceptar eventos al instante y desaparece de la
 * app; los eventos, personas y sesiones los purga el cron por tandas.
 */
export async function deleteProject(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE analytics_projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL')
    .run(Date.now(), now(), id, workspaceId);
  forgetProjectCache();
  return res.changes > 0;
}

/** Nueva key secreta (se muestra una sola vez; se guarda su hash). */
export async function rotateSecret(workspaceId: string, id: string): Promise<string | null> {
  const p = await getProject(workspaceId, id);
  if (!p) return null;
  const secret = `zss_${keyId()}${keyId()}`;
  await getDb()
    .prepare('UPDATE analytics_projects SET secret_hash = ?, secret_hint = ?, updated_at = ? WHERE id = ?')
    .run(sha256(secret), `zss_…${secret.slice(-4)}`, now(), id);
  forgetProjectCache();
  return secret;
}

// ---------- Búsqueda por key (ingesta, decide) ----------

const TTL_MS = 30_000;
const byKey = new Map<string, { row: ProjectRow | null; at: number }>();

export function forgetProjectCache(): void {
  byKey.clear();
}

/** Proyecto por key pública o secreta, con caché de 30 s por instancia (la ingesta lo pide en cada pedido). */
export async function projectByKey(key: string, kind: 'public' | 'secret'): Promise<ProjectRow | null> {
  const cacheKey = `${kind}:${kind === 'secret' ? sha256(key) : key}`;
  const hit = byKey.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const row = (await getDb()
    .prepare(
      kind === 'public'
        ? 'SELECT * FROM analytics_projects WHERE public_key = ? AND deleted_at IS NULL'
        : 'SELECT * FROM analytics_projects WHERE secret_hash = ? AND deleted_at IS NULL',
    )
    .get(kind === 'public' ? key : sha256(key))) as ProjectRow | undefined;
  if (byKey.size > 2000) byKey.clear();
  byKey.set(cacheKey, { row: row ?? null, at: Date.now() });
  return row ?? null;
}

// ---------- Proyecto actual ----------

/**
 * Proyecto que mira la persona: el de la cookie si es del workspace, si no
 * el primero. null si el workspace todavía no tiene proyectos.
 */
export const currentProject = cache(async (workspaceId: string, wanted?: string | null): Promise<{ project: ProjectRow | null; projects: ProjectRow[] }> => {
  const projects = await listProjects(workspaceId);
  let id = wanted ?? null;
  if (!id) {
    try {
      id = (await cookies()).get(PROJECT_COOKIE)?.value ?? null;
    } catch {
      id = null;
    }
  }
  const project = projects.find((p) => p.id === id) ?? projects[0] ?? null;
  return { project, projects };
});
