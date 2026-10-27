/**
 * Agents — versiones: publicar el borrador, volver a una versión anterior,
 * descartar el borrador y el registro de quién cambió qué.
 *
 * Publicar o restaurar cambia lo que está en vivo, así que cuenta como
 * modificar el agente: si lo hace otra persona, el agente pasa a trabajar en
 * Docs con su acceso y se revalida cada página con sus permisos
 * (resolveDocsActor, igual que al guardar). Server-only.
 */
import { getDb } from './db';
import type { AgentRow } from './db';
import {
  assertConfigRefs,
  getAgentRow,
  recordAgentChange,
  resolveDocsActor,
  syncAgentKnowledgeSources,
  toAgentDto,
  type AgentChangeKind,
} from './agents';
import { changedKeys, draftOf, hasDraft, parseSnapshot, snapshotColumns, snapshotOfRow, versioningOn, type AgentSnapshot } from './agents-draft';
import type { AgentDto, AgentUpdatePayload } from './agents-config';

export interface AgentVersionDto {
  id: string;
  number: number;
  note: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  live: boolean;
}

export interface AgentChangeDto {
  id: string;
  kind: AgentChangeKind;
  detail: Record<string, unknown>;
  personId: string | null;
  personName: string | null;
  createdAt: string;
}

export interface AgentVersioningDto {
  enabled: boolean;
  liveNumber: number | null;
  hasDraft: boolean;
  /** Partes del borrador que cambiaron respecto de lo publicado. */
  draftChanges: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

async function peopleNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const rows = (await getDb()
    .prepare(`SELECT id, name, email FROM users WHERE id IN (${unique.map(() => '?').join(', ')})`)
    .all(...unique)) as Array<{ id: string; name: string | null; email: string }>;
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

export async function versioningMeta(row: AgentRow): Promise<AgentVersioningDto> {
  let liveNumber: number | null = null;
  if (row.published_version_id) {
    const v = (await getDb().prepare('SELECT number FROM agent_versions WHERE id = ?').get(row.published_version_id)) as { number: number } | undefined;
    liveNumber = v ? Number(v.number) : null;
  }
  const draft = hasDraft(row);
  return {
    enabled: versioningOn(row),
    liveNumber,
    hasDraft: draft,
    draftChanges: draft ? changedKeys(draftOf(row), snapshotOfRow(row)) : [],
  };
}

export async function listVersions(workspaceId: string, agentId: string): Promise<AgentVersionDto[]> {
  const row = await getAgentRow(workspaceId, agentId);
  if (!row) return [];
  const rows = (await getDb()
    .prepare('SELECT id, number, note, created_by, created_at FROM agent_versions WHERE agent_id = ? AND user_id = ? ORDER BY number DESC LIMIT 100')
    .all(agentId, workspaceId)) as Array<{ id: string; number: number; note: string; created_by: string | null; created_at: string }>;
  const names = await peopleNames(rows.map((r) => r.created_by));
  return rows.map((r) => ({
    id: r.id,
    number: Number(r.number),
    note: r.note,
    createdBy: r.created_by,
    createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
    createdAt: r.created_at,
    live: r.id === row.published_version_id,
  }));
}

export async function listChanges(workspaceId: string, agentId: string, limit = 100): Promise<AgentChangeDto[]> {
  const rows = (await getDb()
    .prepare('SELECT id, kind, detail, person_id, created_at FROM agent_changes WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(agentId, workspaceId, Math.min(Math.max(limit, 1), 300))) as Array<{ id: string; kind: AgentChangeKind; detail: string; person_id: string | null; created_at: string }>;
  const names = await peopleNames(rows.map((r) => r.person_id));
  return rows.map((r) => {
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(r.detail) as Record<string, unknown>;
    } catch {
      detail = {};
    }
    return {
      id: r.id,
      kind: r.kind,
      detail,
      personId: r.person_id,
      personName: r.person_id ? (names.get(r.person_id) ?? null) : null,
      createdAt: r.created_at,
    };
  });
}

function payloadOf(s: AgentSnapshot): AgentUpdatePayload {
  return {
    instructions: s.instructions,
    welcomeMessage: s.welcomeMessage,
    model: s.model ?? null,
    temperature: s.temperature,
    knowledge: s.knowledge,
    tools: s.tools,
    handoff: s.handoff,
    guardrails: s.guardrails,
    settings: s.settings,
  };
}

export type VersionResult = { ok: true; agent: AgentDto; versioning: AgentVersioningDto } | { ok: false; error: string };

/**
 * Pone `snapshot` en vivo como versión nueva. `base` es la fila contra la que
 * se resuelve con el acceso de quién trabaja el agente en Docs.
 */
async function goLive(
  row: AgentRow,
  snapshot: AgentSnapshot,
  personId: string,
  note: string,
  kind: 'publish' | 'restore',
  extra: Record<string, unknown> = {},
): Promise<VersionResult> {
  const payload = payloadOf(snapshot);
  // Quien publica o restaura pasa a ser la persona con cuyo acceso trabaja el agente (y se revalida).
  const baseRow = { ...row, tools: JSON.stringify(snapshot.tools) } as AgentRow;
  const docsError = await resolveDocsActor(row.user_id, baseRow, payload, personId);
  if (docsError) return { ok: false, error: docsError };
  const refError = await assertConfigRefs(row.user_id, payload);
  if (refError) return { ok: false, error: refError };
  const final: AgentSnapshot = { ...snapshot, tools: payload.tools ?? snapshot.tools };
  const db = getDb();
  const max = (await db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM agent_versions WHERE agent_id = ?').get(row.id)) as { n: number };
  const number = Number(max.n) + 1;
  const id = crypto.randomUUID();
  const ts = nowIso();
  try {
    await db
      .prepare('INSERT INTO agent_versions (id, agent_id, user_id, number, snapshot, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, row.id, row.user_id, number, JSON.stringify(final), note.trim().slice(0, 300), personId, ts);
  } catch (err) {
    // Dos publicaciones a la vez: el número ya existe.
    if (/UNIQUE/.test(String(err))) return { ok: false, error: 'conflict' };
    throw err;
  }
  const cols = snapshotColumns(final);
  await db
    .prepare(`UPDATE agents SET ${cols.map(([c]) => `${c} = ?`).join(', ')}, draft = NULL, published_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(...cols.map(([, v]) => v), id, ts, row.id, row.user_id);
  const updated = (await getAgentRow(row.user_id, row.id)) as AgentRow;
  await syncAgentKnowledgeSources(row.user_id, updated);
  await recordAgentChange(row.user_id, row.id, personId, kind, { version: number, ...extra });
  return { ok: true, agent: toAgentDto(updated), versioning: await versioningMeta(updated) };
}

/** Publica el borrador (o, sin versiones todavía, lo que está guardado como v1). */
export async function publishAgent(workspaceId: string, agentId: string, personId: string, note = ''): Promise<VersionResult> {
  const row = await getAgentRow(workspaceId, agentId);
  if (!row) return { ok: false, error: 'not_found' };
  if (versioningOn(row) && !hasDraft(row)) return { ok: false, error: 'nothing_to_publish' };
  return goLive(row, draftOf(row), personId, note, 'publish');
}

/** Vuelve a una versión: queda en vivo como versión nueva y se descarta el borrador. */
export async function restoreVersion(workspaceId: string, agentId: string, versionId: string, personId: string): Promise<VersionResult> {
  const row = await getAgentRow(workspaceId, agentId);
  if (!row) return { ok: false, error: 'not_found' };
  const v = (await getDb()
    .prepare('SELECT number, snapshot FROM agent_versions WHERE id = ? AND agent_id = ? AND user_id = ?')
    .get(versionId, agentId, workspaceId)) as { number: number; snapshot: string } | undefined;
  const snap = v ? parseSnapshot(v.snapshot) : null;
  if (!v || !snap) return { ok: false, error: 'not_found' };
  return goLive(row, snap, personId, `v${v.number}`, 'restore', { from: Number(v.number) });
}

export async function discardDraft(workspaceId: string, agentId: string, personId: string): Promise<VersionResult> {
  const row = await getAgentRow(workspaceId, agentId);
  if (!row) return { ok: false, error: 'not_found' };
  if (!hasDraft(row)) return { ok: false, error: 'nothing_to_discard' };
  await getDb().prepare('UPDATE agents SET draft = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), agentId, workspaceId);
  const updated = (await getAgentRow(workspaceId, agentId)) as AgentRow;
  await syncAgentKnowledgeSources(workspaceId, updated);
  await recordAgentChange(workspaceId, agentId, personId, 'discard');
  return { ok: true, agent: toAgentDto(updated), versioning: await versioningMeta(updated) };
}
