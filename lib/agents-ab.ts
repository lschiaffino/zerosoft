/**
 * Agents — tests A/B de la configuración. Con versiones activas, una versión
 * guardada (B) atiende un porcentaje de las conversaciones nuevas y el resto
 * sigue con lo publicado (A). Cada conversación queda con su variante
 * (agent_conversations.variant) desde el primer mensaje, así un visitante no
 * cambia de versión a mitad de la charla. La pestaña Versiones compara las
 * dos: conversaciones, resolución, derivaciones, pulgares y CSAT. Terminar
 * el test deja lo publicado o pone B en vivo (como restaurar una versión).
 *
 * El snapshot de B se copia en agents.ab_test al empezar: correr una
 * conversación B no lee la tabla de versiones. Server-only.
 */
import { getDb } from './db';
import type { AgentConversationRow, AgentRow } from './db';
import { applySnapshot, parseSnapshot, versioningOn, type AgentSnapshot } from './agents-draft';

export interface AgentAbTest {
  versionId: string;
  versionNumber: number;
  /** Porcentaje de conversaciones nuevas que van a B (5 a 95). */
  percent: number;
  startedAt: string;
  startedBy: string | null;
  snapshot: AgentSnapshot;
}

export interface AgentAbTestDto {
  versionId: string;
  versionNumber: number;
  percent: number;
  startedAt: string;
}

export interface AgentAbVariantStats {
  conversations: number;
  /** Sin derivar a una persona. */
  resolved: number;
  handoffs: number;
  thumbsUp: number;
  thumbsDown: number;
  /** CSAT promedio de las conversaciones puntuadas (null sin puntaje). */
  csat: number | null;
  scored: number;
}

export interface AgentAbResults {
  test: AgentAbTestDto | null;
  a: AgentAbVariantStats;
  b: AgentAbVariantStats;
}

export const AB_MIN_PERCENT = 5;
export const AB_MAX_PERCENT = 95;

export function parseAbTest(raw: string | null | undefined): AgentAbTest | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AgentAbTest>;
    const snapshot = v?.snapshot ? parseSnapshot(JSON.stringify(v.snapshot)) : null;
    if (!v || typeof v.versionId !== 'string' || !snapshot) return null;
    const percent = Math.min(AB_MAX_PERCENT, Math.max(AB_MIN_PERCENT, Math.round(Number(v.percent) || 50)));
    return {
      versionId: v.versionId,
      versionNumber: Number(v.versionNumber) || 0,
      percent,
      startedAt: typeof v.startedAt === 'string' ? v.startedAt : new Date().toISOString(),
      startedBy: typeof v.startedBy === 'string' ? v.startedBy : null,
      snapshot,
    };
  } catch {
    return null;
  }
}

export function abTestDto(row: Pick<AgentRow, 'ab_test'>): AgentAbTestDto | null {
  const t = parseAbTest(row.ab_test);
  return t ? { versionId: t.versionId, versionNumber: t.versionNumber, percent: t.percent, startedAt: t.startedAt } : null;
}

/** Variante de una conversación nueva: B con la probabilidad del test. */
export function pickVariant(percent: number, rand = Math.random()): 'a' | 'b' {
  return rand * 100 < percent ? 'b' : 'a';
}

/** Marca la variante de una conversación nueva (solo si hay un test en curso). */
export async function assignVariant(agent: Pick<AgentRow, 'ab_test' | 'published_version_id'>, conversationId: string, rand = Math.random()): Promise<'a' | 'b' | null> {
  const test = versioningOn(agent) ? parseAbTest(agent.ab_test) : null;
  if (!test) return null;
  const variant = pickVariant(test.percent, rand);
  await getDb().prepare('UPDATE agent_conversations SET variant = ? WHERE id = ? AND variant IS NULL').run(variant, conversationId);
  return variant;
}

/** La fila con la que corre esta conversación: B si le tocó B y el test sigue; si no, lo publicado. */
export async function variantRow(agent: AgentRow, conversation: Pick<AgentConversationRow, 'variant'>): Promise<AgentRow> {
  if (conversation.variant !== 'b') return agent;
  const test = versioningOn(agent) ? parseAbTest(agent.ab_test) : null;
  if (!test) return agent;
  return applySnapshot(agent, await withCheckedDocs(agent.user_id, test.snapshot));
}

/**
 * En cada corrida de B se revisa que la persona con cuyo acceso trabaja en
 * Docs siga pudiendo abrir (y editar, si escribe) cada página; si no, B corre
 * sin las herramientas de Docs.
 */
async function withCheckedDocs(workspaceId: string, snap: AgentSnapshot): Promise<AgentSnapshot> {
  const docsOn = snap.tools.docsPageIds.length > 0 && snap.tools.enabled.some((k) => k.startsWith('docs_'));
  if (!docsOn) return snap;
  const strip = (): AgentSnapshot => ({ ...snap, tools: { ...snap.tools, enabled: snap.tools.enabled.filter((k) => !k.startsWith('docs_')) } });
  if (!snap.tools.docsActorId) return strip();
  const { docsActorFor, pageFor } = await import('./docs-platform-access');
  const actor = await docsActorFor(workspaceId, snap.tools.docsActorId);
  if (!actor) return strip();
  const writes = snap.tools.enabled.some((k) => k === 'docs_write_page' || k === 'docs_write_row');
  for (const pageId of snap.tools.docsPageIds) {
    if (!(await pageFor(actor, pageId, { write: writes }))) return strip();
  }
  return snap;
}

export type AbResult = { ok: true; test: AgentAbTestDto | null } | { ok: false; error: string };

export async function startAbTest(row: AgentRow, versionId: string, percent: number, personId: string): Promise<AbResult> {
  if (!versioningOn(row)) return { ok: false, error: 'ab_needs_versions' };
  if (row.published_version_id === versionId) return { ok: false, error: 'ab_same_version' };
  const v = (await getDb()
    .prepare('SELECT id, number, snapshot FROM agent_versions WHERE id = ? AND agent_id = ? AND user_id = ?')
    .get(versionId, row.id, row.user_id)) as { id: string; number: number; snapshot: string } | undefined;
  const parsed = v ? parseSnapshot(v.snapshot) : null;
  if (!v || !parsed) return { ok: false, error: 'not_found' };
  // Como restaurar una versión: quien empieza el test pasa a ser la persona con
  // cuyo acceso trabaja B en Docs, y cada página se revalida con sus permisos.
  const { assertConfigRefs, resolveDocsActor } = await import('./agents');
  const payload: import('./agents-config').AgentUpdatePayload = { instructions: parsed.instructions, tools: parsed.tools, knowledge: parsed.knowledge };
  const baseRow = { ...row, tools: JSON.stringify(parsed.tools) } as AgentRow;
  if (await resolveDocsActor(row.user_id, baseRow, payload, personId)) return { ok: false, error: 'invalid_docs_page' };
  const refError = await assertConfigRefs(row.user_id, payload);
  if (refError) return { ok: false, error: refError };
  const snapshot: AgentSnapshot = { ...parsed, tools: payload.tools ?? parsed.tools };
  // Y la persona con cuyo acceso trabaja B tiene que poder abrir cada página hoy.
  const checked = await withCheckedDocs(row.user_id, snapshot);
  if (checked.tools.enabled.length !== snapshot.tools.enabled.length) return { ok: false, error: 'invalid_docs_page' };
  const test: AgentAbTest = {
    versionId: v.id,
    versionNumber: Number(v.number),
    percent: Math.min(AB_MAX_PERCENT, Math.max(AB_MIN_PERCENT, Math.round(percent))),
    startedAt: new Date().toISOString(),
    startedBy: personId,
    snapshot,
  };
  await getDb().prepare('UPDATE agents SET ab_test = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(test), test.startedAt, row.id, row.user_id);
  const { recordAgentChange, syncAgentKnowledgeSources, getAgentRow } = await import('./agents');
  await recordAgentChange(row.user_id, row.id, personId, 'ab_started', { version: test.versionNumber, percent: test.percent });
  // Las URLs y sitemaps de B también tienen que estar descargados.
  const updated = await getAgentRow(row.user_id, row.id);
  if (updated) await syncAgentKnowledgeSources(row.user_id, updated);
  return { ok: true, test: abTestDto({ ab_test: JSON.stringify(test) }) };
}

/** Termina el test. Con `promote`, la versión B queda en vivo (como restaurarla). */
export async function stopAbTest(row: AgentRow, personId: string, promote: boolean): Promise<AbResult> {
  const test = parseAbTest(row.ab_test);
  if (!test) return { ok: false, error: 'not_found' };
  await getDb().prepare('UPDATE agents SET ab_test = NULL, updated_at = ? WHERE id = ? AND user_id = ?').run(new Date().toISOString(), row.id, row.user_id);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(row.user_id, row.id, personId, 'ab_stopped', { version: test.versionNumber, promoted: promote });
  if (promote) {
    const { restoreVersion } = await import('./agents-versions');
    const res = await restoreVersion(row.user_id, row.id, test.versionId, personId);
    if (!res.ok) return { ok: false, error: res.error };
  }
  return { ok: true, test: null };
}

function emptyStats(): AgentAbVariantStats {
  return { conversations: 0, resolved: 0, handoffs: 0, thumbsUp: 0, thumbsDown: 0, csat: null, scored: 0 };
}

/** Comparación de A y B desde que empezó el test (sin el playground). */
export async function abResults(row: AgentRow): Promise<AgentAbResults> {
  const test = parseAbTest(row.ab_test);
  const out: AgentAbResults = { test: test ? abTestDto(row) : null, a: emptyStats(), b: emptyStats() };
  if (!test) return out;
  const db = getDb();
  const convs = (await db
    .prepare(
      `SELECT variant, COUNT(*) AS n, SUM(CASE WHEN handed_off = 1 THEN 1 ELSE 0 END) AS h,
         SUM(CASE WHEN csat IS NOT NULL THEN 1 ELSE 0 END) AS scored, AVG(csat) AS csat
       FROM agent_conversations
       WHERE agent_id = ? AND user_id = ? AND channel != 'playground' AND variant IN ('a', 'b') AND created_at >= ?
       GROUP BY variant`,
    )
    .all(row.id, row.user_id, test.startedAt)) as Array<{ variant: 'a' | 'b'; n: number; h: number; scored: number; csat: number | null }>;
  for (const c of convs) {
    const s = out[c.variant];
    s.conversations = Number(c.n);
    s.handoffs = Number(c.h ?? 0);
    s.resolved = s.conversations - s.handoffs;
    s.scored = Number(c.scored ?? 0);
    s.csat = s.scored > 0 && c.csat != null ? Math.round(Number(c.csat) * 10) / 10 : null;
  }
  const fb = (await db
    .prepare(
      `SELECT c.variant AS variant, SUM(CASE WHEN f.rating > 0 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN f.rating < 0 THEN 1 ELSE 0 END) AS down
       FROM agent_feedback f JOIN agent_conversations c ON c.id = f.conversation_id
       WHERE f.agent_id = ? AND c.variant IN ('a', 'b') AND c.created_at >= ?
       GROUP BY c.variant`,
    )
    .all(row.id, test.startedAt)) as Array<{ variant: 'a' | 'b'; up: number; down: number }>;
  for (const f of fb) {
    out[f.variant].thumbsUp = Number(f.up ?? 0);
    out[f.variant].thumbsDown = Number(f.down ?? 0);
  }
  return out;
}
