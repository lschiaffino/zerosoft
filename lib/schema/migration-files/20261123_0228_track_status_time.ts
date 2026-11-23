import type { Client } from '@libsql/client';
import type { Migration } from '../migrations';

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const BATCH = 400;

type Period = { statusId: string | null; name: string | null; category: string | null; at: string };

/** Fecha guardada (con o sin T/Z) a ISO UTC. */
function iso(v: string): string {
  if (!v) return new Date().toISOString();
  // Sin zona es UTC (así guarda SQLite): nunca la hora local de quien corre la migración.
  const s = v.includes('T') ? (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`) : `${v.replace(' ', 'T')}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Time in status (como Linear): cada vez que un issue entra a un status queda
 * una fila en track_issue_status_log, y track_issues.status_changed_at guarda
 * desde cuándo está en el actual (para ordenar y filtrar listas en SQL).
 *
 * Lo escriben triggers de SQLite: cualquier camino que cambie status_id (la
 * app, la API, el MCP, bulk, importadores, borrar un status) queda registrado
 * sin tocar cada función. El nombre y la categoría del status se copian al
 * entrar, así un status borrado sigue teniendo nombre en el historial.
 *
 * Backfill: los issues que ya existían se reconstruyen con la actividad
 * `status_change` (from/to por nombre, mapeados a ids del team). Los triggers
 * se crean antes, y el backfill solo toca issues sin status_changed_at: si uno
 * cambió en el medio, su período actual ya es el bueno. Idempotente: ids
 * determinísticos (INSERT OR IGNORE) y el mismo filtro al repetir.
 */
export default {
  id: '20261123_0228_track_status_time',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS track_issue_status_log (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      status_id TEXT,
      status_name TEXT,
      status_category TEXT,
      entered_at TEXT NOT NULL
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_track_issue_status_log_issue ON track_issue_status_log(issue_id, entered_at)');
    await addColumn(c, 'ALTER TABLE track_issues ADD COLUMN status_changed_at TEXT');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_track_issues_status_changed ON track_issues(project_id, status_changed_at)');

    const snapshot = (statusExpr: string) =>
      `(SELECT ts.name FROM track_statuses ts WHERE ts.id = ${statusExpr}), (SELECT ts.category FROM track_statuses ts WHERE ts.id = ${statusExpr})`;
    const created = `COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at), ${NOW})`;
    await c.execute(`CREATE TRIGGER IF NOT EXISTS trg_track_issue_status_ai AFTER INSERT ON track_issues BEGIN
      INSERT INTO track_issue_status_log (id, issue_id, status_id, status_name, status_category, entered_at)
        VALUES (lower(hex(randomblob(16))), NEW.id, NEW.status_id, ${snapshot('NEW.status_id')}, ${created});
      UPDATE track_issues SET status_changed_at = ${created} WHERE id = NEW.id;
    END`);
    await c.execute(`CREATE TRIGGER IF NOT EXISTS trg_track_issue_status_au AFTER UPDATE OF status_id ON track_issues
      WHEN OLD.status_id IS NOT NEW.status_id BEGIN
      INSERT INTO track_issue_status_log (id, issue_id, status_id, status_name, status_category, entered_at)
        VALUES (lower(hex(randomblob(16))), NEW.id, NEW.status_id, ${snapshot('NEW.status_id')}, ${NOW});
      UPDATE track_issues SET status_changed_at = ${NOW} WHERE id = NEW.id;
    END`);
    await c.execute(`CREATE TRIGGER IF NOT EXISTS trg_track_issue_status_ad AFTER DELETE ON track_issues BEGIN
      DELETE FROM track_issue_status_log WHERE issue_id = OLD.id;
    END`);

    // Statuses por team, para mapear los nombres de la actividad a ids.
    const statusRows = (await c.execute('SELECT id, project_id, name, category FROM track_statuses')).rows as unknown as Array<{
      id: string;
      project_id: string;
      name: string;
      category: string;
    }>;
    const byTeam = new Map<string, Map<string, { id: string; name: string; category: string }>>();
    const byId = new Map<string, { id: string; name: string; category: string }>();
    for (const s of statusRows) {
      const m = byTeam.get(s.project_id) ?? new Map();
      if (!m.has(s.name.toLowerCase())) m.set(s.name.toLowerCase(), s);
      byTeam.set(s.project_id, m);
      byId.set(s.id, s);
    }

    for (;;) {
      const issues = (await c.execute({
        sql: `SELECT id, project_id, status_id, created_at, updated_at FROM track_issues
               WHERE status_changed_at IS NULL ORDER BY id LIMIT ?`,
        args: [BATCH],
      })).rows as unknown as Array<{ id: string; project_id: string; status_id: string | null; created_at: string; updated_at: string }>;
      if (issues.length === 0) break;
      const acts = (await c.execute({
        sql: `SELECT id, issue_id, meta, created_at FROM track_issue_activities
               WHERE type = 'status_change' AND issue_id IN (${issues.map(() => '?').join(', ')})
               ORDER BY created_at ASC, id ASC`,
        args: issues.map((i) => i.id),
      })).rows as unknown as Array<{ id: string; issue_id: string; meta: string; created_at: string }>;
      const actsBy = new Map<string, typeof acts>();
      for (const a of acts) actsBy.set(a.issue_id, [...(actsBy.get(a.issue_id) ?? []), a]);

      const stmts: Array<{ sql: string; args: Array<string | null> }> = [];
      for (const issue of issues) {
        const team = byTeam.get(issue.project_id) ?? new Map();
        const lookup = (name: unknown, category?: unknown): Omit<Period, 'at'> => {
          const n = typeof name === 'string' ? name : '';
          const hit = n ? team.get(n.toLowerCase()) : undefined;
          return { statusId: hit?.id ?? null, name: hit?.name ?? (n || null), category: hit?.category ?? (typeof category === 'string' && category ? category : null) };
        };
        const current = issue.status_id ? byId.get(issue.status_id) : undefined;
        const periods: Period[] = [];
        const list = actsBy.get(issue.id) ?? [];
        if (list.length === 0) {
          periods.push({ statusId: issue.status_id, name: current?.name ?? null, category: current?.category ?? null, at: iso(issue.created_at) });
        } else {
          const meta = (raw: string): Record<string, unknown> => {
            try {
              const v = JSON.parse(raw);
              return v && typeof v === 'object' ? v : {};
            } catch {
              return {};
            }
          };
          const first = meta(list[0].meta);
          periods.push({ ...lookup(first.from, first.fromCategory), at: iso(issue.created_at) });
          for (const a of list) {
            const m = meta(a.meta);
            periods.push({ ...lookup(m.to, m.toCategory), at: iso(a.created_at) });
          }
          const last = periods[periods.length - 1];
          // Un cambio sin actividad (bulk viejo, importador): el actual entra con la última edición.
          if (issue.status_id && last.statusId !== issue.status_id) {
            if (!last.statusId && current && last.name?.toLowerCase() === current.name.toLowerCase()) last.statusId = current.id;
            else periods.push({ statusId: issue.status_id, name: current?.name ?? null, category: current?.category ?? null, at: iso(issue.updated_at) });
          }
        }
        // Orden por fecha y sin retrocesos (actividad con relojes distintos).
        for (let k = 1; k < periods.length; k++) if (periods[k].at < periods[k - 1].at) periods[k].at = periods[k - 1].at;
        periods.forEach((p, k) =>
          stmts.push({
            sql: 'INSERT OR IGNORE INTO track_issue_status_log (id, issue_id, status_id, status_name, status_category, entered_at) VALUES (?, ?, ?, ?, ?, ?)',
            args: [`bf:${issue.id}:${k}`, issue.id, p.statusId, p.name, p.category, p.at],
          }),
        );
        stmts.push({
          sql: 'UPDATE track_issues SET status_changed_at = ? WHERE id = ? AND status_changed_at IS NULL',
          args: [periods[periods.length - 1].at, issue.id],
        });
      }
      await c.batch(stmts, 'write');
    }
  },
} satisfies Migration;
