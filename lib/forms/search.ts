/** Forms en ⌘K: formularios por nombre, solo los que la persona ve. Server-only. */
import { getDb } from '../db';
import { visibleSql } from './core';
import type { FormsActor } from './types';

export interface FormsSearchHit {
  id: string;
  label: string;
  meta: string;
  href: string;
}

export async function searchForms(actor: FormsActor, q: string, limit = 8): Promise<FormsSearchHit[]> {
  const term = q.trim();
  if (!term) return [];
  const vis = visibleSql(actor);
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = (await getDb()
    .prepare(`SELECT f.id, f.name, f.status, f.response_count FROM forms_forms f WHERE ${vis.sql} AND (f.name LIKE ? ESCAPE '\\' OR f.slug LIKE ? ESCAPE '\\') ORDER BY f.updated_at DESC LIMIT ?`)
    .all(...vis.args, like, like, limit)) as Array<{ id: string; name: string; status: string; response_count: number }>;
  return rows.map((r) => ({ id: r.id, label: r.name, meta: `${r.status} · ${r.response_count}`, href: `/app/forms/${r.id}` }));
}
