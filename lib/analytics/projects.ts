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
import { offsetMsAt } from './tz';
import { z } from 'zod';
import { propertyFilterSchema, type ProjectDto, type PropertyFilter } from './types';

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
  replay_enabled: number;
  replay_sample_rate: number;
  replay_mask_text: number;
  heatmaps_enabled: number;
  capture_exceptions: number;
  web_vitals: number;
  retention_days: number;
  tz_offset_min: number;
  /** Zona IANA; null = el desfase fijo de tz_offset_min. */
  tz_name: string | null;
  keep_bots: number;
  cookieless: number;
  bots_filtered: number;
  cookieless_dropped?: number;
  test_filters: string;
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

export function parseTestFilters(raw: string | null | undefined): PropertyFilter[] {
  try {
    const parsed = z.array(propertyFilterSchema).max(20).safeParse(JSON.parse(raw ?? '[]'));
    return parsed.success ? parsed.data : [];
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
    replayEnabled: r.replay_enabled === 1,
    replaySampleRate: Number(r.replay_sample_rate ?? 100),
    replayMaskText: r.replay_mask_text !== 0,
    heatmapsEnabled: r.heatmaps_enabled === 1,
    captureExceptions: r.capture_exceptions === 1,
    webVitals: r.web_vitals === 1,
    retentionDays: Number(r.retention_days),
    // Con zona, el desfase de ahora: lo usan las fechas de las encuestas.
    tzOffsetMin: r.tz_name ? offsetMsAt(r.tz_name, Date.now()) / 60_000 : Number(r.tz_offset_min),
    tzName: r.tz_name,
    keepBots: r.keep_bots === 1,
    cookieless: r.cookieless === 1,
    botsFiltered: Number(r.bots_filtered ?? 0),
    cookielessDropped: Number(r.cookieless_dropped ?? 0),
    testFilters: parseTestFilters(r.test_filters),
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
/** Sin workspace: solo para el cron, que ya sabe de qué fila viene. */
export async function getProjectById(id: string): Promise<ProjectRow | null> {
  return ((await getDb().prepare('SELECT * FROM analytics_projects WHERE id = ? AND deleted_at IS NULL').get(id)) as ProjectRow | undefined) ?? null;
}

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
  replayEnabled?: boolean;
  replaySampleRate?: number;
  replayMaskText?: boolean;
  heatmapsEnabled?: boolean;
  captureExceptions?: boolean;
  webVitals?: boolean;
  retentionDays?: number;
  tzOffsetMin?: number;
  tzName?: string | null;
  keepBots?: boolean;
  cookieless?: boolean;
  testFilters?: PropertyFilter[];
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
  if (patch.testFilters !== undefined) {
    sets.push('test_filters = ?');
    args.push(JSON.stringify(patch.testFilters));
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
  if (patch.replayEnabled !== undefined) {
    sets.push('replay_enabled = ?');
    args.push(patch.replayEnabled ? 1 : 0);
  }
  if (patch.replaySampleRate !== undefined) {
    sets.push('replay_sample_rate = ?');
    args.push(Math.min(100, Math.max(1, Math.round(patch.replaySampleRate))));
  }
  if (patch.replayMaskText !== undefined) {
    sets.push('replay_mask_text = ?');
    args.push(patch.replayMaskText ? 1 : 0);
  }
  if (patch.heatmapsEnabled !== undefined) {
    sets.push('heatmaps_enabled = ?');
    args.push(patch.heatmapsEnabled ? 1 : 0);
  }
  if (patch.captureExceptions !== undefined) {
    sets.push('capture_exceptions = ?');
    args.push(patch.captureExceptions ? 1 : 0);
  }
  if (patch.webVitals !== undefined) {
    sets.push('web_vitals = ?');
    args.push(patch.webVitals ? 1 : 0);
  }
  if (patch.retentionDays !== undefined) {
    sets.push('retention_days = ?');
    args.push(Math.min(3650, Math.max(1, Math.round(patch.retentionDays))));
  }
  if (patch.tzOffsetMin !== undefined) {
    sets.push('tz_offset_min = ?');
    args.push(Math.min(840, Math.max(-720, Math.round(patch.tzOffsetMin))));
  }
  if (patch.cookieless !== undefined) {
    sets.push('cookieless = ?');
    args.push(patch.cookieless ? 1 : 0);
  }
  if (patch.keepBots !== undefined) {
    sets.push('keep_bots = ?');
    args.push(patch.keepBots ? 1 : 0);
  }
  if (patch.tzName !== undefined) {
    sets.push('tz_name = ?');
    args.push(patch.tzName as string);
  }
  // Los rollups diarios están cortados con la zona anterior: se rehacen de a poco y mientras tanto se lee del crudo.
  const nextName = patch.tzName !== undefined ? patch.tzName : p.tz_name;
  const nextOffset = patch.tzOffsetMin !== undefined ? Math.min(840, Math.max(-720, Math.round(patch.tzOffsetMin))) : Number(p.tz_offset_min);
  const zoneChanged = nextName !== p.tz_name || (!nextName && nextOffset !== Number(p.tz_offset_min));
  if (zoneChanged) {
    sets.push('rolled_through = NULL', 'dirty_from = NULL');
    await getDb().prepare('DELETE FROM analytics_daily WHERE project_id = ?').run(id);
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

/**
 * Proyecto por key pública o secreta, con caché de 30 s por instancia (la
 * ingesta lo pide en cada pedido). También guarda las keys que no existen (un
 * barrido de keys falsas no va a la base). Al cambiar, rotar o borrar se vacía
 * el caché de esta instancia; las demás instancias lo ven en hasta 30 s.
 */
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
