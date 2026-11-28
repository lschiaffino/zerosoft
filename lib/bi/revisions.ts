/**
 * Historial de versiones de las preguntas de Analytics. Cada guardado que
 * cambia algo deja una foto completa (nombre, descripción, fuente, colección,
 * consulta y gráfico) y la lista de lo que cambió; volver a una versión
 * vieja es un guardado más, así que también se puede deshacer. Las
 * preguntas de antes de esta función arrancan con una versión "anterior al
 * historial" la primera vez que se guardan. Server-only (salvo los tipos y
 * diffSnapshots, que son puros).
 */
import { nanoid } from 'nanoid';
import { getDb } from '../db';
import type { BiQuery, Viz } from './types';

/** Versiones que se guardan por pregunta; las más viejas se borran. */
export const MAX_REVISIONS = 50;

export const REVISION_FIELDS = ['name', 'description', 'source', 'collection', 'query', 'viz'] as const;
export type RevisionField = (typeof REVISION_FIELDS)[number];
export type RevisionKind = 'create' | 'edit' | 'revert' | 'baseline';

export interface QuestionSnapshot {
  name: string;
  description: string;
  source: string;
  collectionId: string | null;
  query: BiQuery;
  viz: Viz;
}

export interface RevisionDto {
  id: string;
  kind: RevisionKind;
  changes: RevisionField[];
  authorName: string;
  createdAt: string;
  /** La versión que está guardada ahora (la más nueva). */
  current: boolean;
}

/** Qué cambió entre dos fotos (en el orden de REVISION_FIELDS). */
export function diffSnapshots(a: QuestionSnapshot, b: QuestionSnapshot): RevisionField[] {
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const pick: Record<RevisionField, (s: QuestionSnapshot) => unknown> = {
    name: (s) => s.name,
    description: (s) => s.description,
    source: (s) => s.source,
    collection: (s) => s.collectionId,
    query: (s) => s.query,
    viz: (s) => s.viz,
  };
  return REVISION_FIELDS.filter((f) => !same(pick[f](a), pick[f](b)));
}

const db = () => getDb();

export async function recordRevision(
  workspaceId: string,
  itemId: string,
  input: { kind: RevisionKind; changes: RevisionField[]; snapshot: QuestionSnapshot; authorId: string; at?: string },
): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO bi_revisions (id, workspace_id, item_kind, item_id, kind, changes_json, snapshot_json, author_id, created_at)
       VALUES (?, ?, 'question', ?, ?, ?, ?, ?, ?)`,
    )
    .run(`birev_${nanoid(12)}`, workspaceId, itemId, input.kind, JSON.stringify(input.changes), JSON.stringify(input.snapshot), input.authorId, input.at ?? new Date().toISOString());
  // Tope por pregunta: se van las más viejas.
  await db()
    .prepare(
      `DELETE FROM bi_revisions WHERE workspace_id = ? AND item_kind = 'question' AND item_id = ? AND id NOT IN (
         SELECT id FROM bi_revisions WHERE workspace_id = ? AND item_kind = 'question' AND item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
    )
    .run(workspaceId, itemId, workspaceId, itemId, MAX_REVISIONS);
}

/** Pregunta guardada antes del historial: su estado actual queda como primera versión. */
export async function ensureBaseline(workspaceId: string, itemId: string, snapshot: QuestionSnapshot, authorId: string, at: string): Promise<void> {
  const has = await db().prepare("SELECT 1 FROM bi_revisions WHERE workspace_id = ? AND item_kind = 'question' AND item_id = ? LIMIT 1").get(workspaceId, itemId);
  if (!has) await recordRevision(workspaceId, itemId, { kind: 'baseline', changes: [], snapshot, authorId, at });
}

type Row = { id: string; kind: string; changes_json: string; author_id: string; created_at: string; author_name: string | null; author_email: string | null };

export async function revisionsOf(workspaceId: string, itemId: string): Promise<RevisionDto[]> {
  const rows = (await db()
    .prepare(
      `SELECT r.id, r.kind, r.changes_json, r.author_id, r.created_at, u.name AS author_name, u.email AS author_email
       FROM bi_revisions r LEFT JOIN users u ON u.id = r.author_id
       WHERE r.workspace_id = ? AND r.item_kind = 'question' AND r.item_id = ?
       ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`,
    )
    .all(workspaceId, itemId, MAX_REVISIONS)) as Row[];
  return rows.map((r, i) => {
    let changes: RevisionField[] = [];
    try {
      changes = (JSON.parse(r.changes_json) as string[]).filter((c): c is RevisionField => (REVISION_FIELDS as readonly string[]).includes(c));
    } catch {
      changes = [];
    }
    return {
      id: r.id,
      kind: (['create', 'edit', 'revert', 'baseline'] as const).find((k) => k === r.kind) ?? 'edit',
      changes,
      authorName: r.author_name || r.author_email || '',
      createdAt: r.created_at,
      current: i === 0,
    };
  });
}

export async function revisionSnapshot(workspaceId: string, itemId: string, revisionId: string): Promise<QuestionSnapshot | null> {
  const r = (await db()
    .prepare("SELECT snapshot_json FROM bi_revisions WHERE workspace_id = ? AND item_kind = 'question' AND item_id = ? AND id = ?")
    .get(workspaceId, itemId, revisionId)) as { snapshot_json: string } | undefined;
  if (!r) return null;
  return JSON.parse(r.snapshot_json) as QuestionSnapshot;
}

export async function deleteRevisions(workspaceId: string, itemId: string): Promise<void> {
  await db().prepare("DELETE FROM bi_revisions WHERE workspace_id = ? AND item_kind = 'question' AND item_id = ?").run(workspaceId, itemId);
}
