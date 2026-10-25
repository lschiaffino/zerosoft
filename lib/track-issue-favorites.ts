/**
 * Issues favoritos (la estrella del header del issue, como Linear): por
 * persona, se ven en el sidebar de Track arriba de los teams. Al listar solo
 * salen los issues que la persona puede ver ahora (privados, otro workspace).
 */
import { getDb } from './db';
import { getAccessibleIssue } from './track-data';

export interface FavoriteIssue {
  id: string;
  identifier: string;
  title: string;
  status_color: string | null;
  status_category: string | null;
}

export async function isIssueFavorite(issueId: string, userId: string): Promise<boolean> {
  const row = await getDb().prepare('SELECT 1 AS x FROM track_issue_favorites WHERE user_id = ? AND issue_id = ?').get(userId, issueId);
  return Boolean(row);
}

export async function setIssueFavorite(issueId: string, userId: string, on: boolean): Promise<boolean> {
  const db = getDb();
  if (on) await db.prepare('INSERT OR IGNORE INTO track_issue_favorites (user_id, issue_id) VALUES (?, ?)').run(userId, issueId);
  else await db.prepare('DELETE FROM track_issue_favorites WHERE user_id = ? AND issue_id = ?').run(userId, issueId);
  return isIssueFavorite(issueId, userId);
}

export async function listFavoriteIssues(teamId: string | null, ownerId: string, userId: string): Promise<FavoriteIssue[]> {
  const rows = (await getDb()
    .prepare('SELECT issue_id FROM track_issue_favorites WHERE user_id = ? ORDER BY created_at ASC LIMIT 50')
    .all(userId)) as Array<{ issue_id: string }>;
  const out: FavoriteIssue[] = [];
  for (const r of rows) {
    const found = await getAccessibleIssue(r.issue_id, teamId, ownerId);
    if (!found || found.issue.archived_at) continue;
    const i = found.issue;
    out.push({ id: i.id, identifier: i.identifier, title: i.title, status_color: i.status_color, status_category: i.status_category });
  }
  return out;
}
