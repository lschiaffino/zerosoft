/**
 * Rotación de la clave maestra: recorre todas las tablas y columnas de texto, busca
 * valores cifrados con una clave que no es la activa (lib/secret-box.ts "enc:", también
 * dentro de un JSON, y credenciales de Flow "cred:") y los vuelve a cifrar con la activa.
 * Cada fila se actualiza con compare-and-set (si cambió mientras tanto, se saltea y la
 * próxima corrida la toma). Server-only; lo corre scripts/rotate-encryption-keys.ts.
 */
import type { Client } from '@libsql/client';
import { needsRotation, reseal, SEALED_TOKEN_RE } from './secret-box';
import { credentialNeedsRotation, decryptCredential, encryptCredential } from './flow-credentials';

export interface RotationReport {
  /** Valores con una clave vieja (antes de aplicar). */
  pending: number;
  /** Valores reescritos con la clave activa. */
  rotated: number;
  /** Valores que no se pudieron abrir (falta la clave vieja o el dato está roto). */
  unreadable: number;
  /** Filas que cambiaron durante la corrida (se reintentan en la próxima). */
  skipped: number;
  /** tabla.columna → valores pendientes. */
  byColumn: Record<string, number>;
  /** Columnas con valores cifrados en tablas WITHOUT ROWID: no se reescriben, hay que verlas a mano. */
  skippedTables: string[];
  /** Dónde están los ilegibles (tabla.columna#rowid), para revisarlos a mano. */
  unreadableAt: string[];
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const PAGE = 200;

function rotateText(text: string, report: RotationReport, apply: boolean, where: string): string | null {
  let changed = false;
  const out = text.replace(SEALED_TOKEN_RE, (token) => {
    if (!needsRotation(token)) return token;
    report.pending++;
    if (!apply) return token;
    const next = reseal(token);
    if (next === null) {
      report.unreadable++;
      report.unreadableAt.push(where);
      return token;
    }
    changed = true;
    return next;
  });
  return changed ? out : null;
}

export async function rotateEncryptedValues(client: Client, opts: { apply: boolean; log?: (line: string) => void }): Promise<RotationReport> {
  const report: RotationReport = { pending: 0, rotated: 0, unreadable: 0, skipped: 0, byColumn: {}, skippedTables: [], unreadableAt: [] };
  // Tablas reales: sin las virtuales (FTS) ni sus tablas internas, que repiten texto de otras.
  const all = (await client.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")).rows.map((r) => ({
    name: String(r.name),
    sql: String(r.sql ?? ''),
  }));
  const virtual = all.filter((t) => /^CREATE VIRTUAL TABLE/i.test(t.sql)).map((t) => t.name);
  const tables = all.filter((t) => !virtual.includes(t.name) && !virtual.some((v) => t.name.startsWith(`${v}_`))).map((t) => t.name);
  for (const table of tables) {
    const cols = (await client.execute({ sql: 'SELECT name FROM pragma_table_info(?)', args: [table] })).rows.map((c) => String(c.name));
    for (const col of cols) {
      const before = report.pending;
      let lastRowid = -1;
      for (;;) {
        let rows;
        try {
          rows = (
            await client.execute({
              sql: `SELECT rowid AS rid, ${quote(col)} AS v${table === 'flow_credentials' ? ', id, user_id' : ''} FROM ${quote(table)}
                    WHERE rowid > ? AND typeof(${quote(col)}) = 'text' AND (${quote(col)} LIKE '%enc:v%' OR ${quote(col)} LIKE 'cred:v%')
                    ORDER BY rowid LIMIT ${PAGE}`,
              args: [lastRowid],
            })
          ).rows;
        } catch (err) {
          // Solo una tabla sin rowid se saltea (y se informa); cualquier otro error corta la corrida.
          if (!/no such column: rowid/i.test(String(err))) throw err;
          // Tabla WITHOUT ROWID: no se reescribe acá, pero si tiene valores cifrados se informa
          // (y la corrida no da "0 pendientes").
          const n = Number(
            (
              await client.execute(
                `SELECT COUNT(*) AS n FROM ${quote(table)} WHERE typeof(${quote(col)}) = 'text' AND (${quote(col)} LIKE '%enc:v%' OR ${quote(col)} LIKE 'cred:v%')`,
              )
            ).rows[0]?.n ?? 0,
          );
          if (n) {
            report.pending += n;
            report.skippedTables.push(`${table}.${col}`);
          }
          break;
        }
        if (!rows.length) break;
        for (const row of rows) {
          lastRowid = Number(row.rid);
          const value = String(row.v ?? '');
          const where = `${table}.${col}#${lastRowid}`;
          let next: string | null = null;
          if (value.startsWith('cred:v') && table === 'flow_credentials') {
            if (!credentialNeedsRotation(value)) continue;
            report.pending++;
            if (!opts.apply) continue;
            const data = decryptCredential(String(row.user_id), String(row.id), value);
            if (!data) {
              report.unreadable++;
              report.unreadableAt.push(where);
              continue;
            }
            next = encryptCredential(String(row.user_id), String(row.id), data);
          } else {
            next = rotateText(value, report, opts.apply, where);
          }
          if (next === null) continue;
          const res = await client.execute({
            sql: `UPDATE ${quote(table)} SET ${quote(col)} = ? WHERE rowid = ? AND ${quote(col)} = ?`,
            args: [next, lastRowid, value],
          });
          if (res.rowsAffected) report.rotated++;
          else report.skipped++;
        }
        if (rows.length < PAGE) break;
      }
      const found = report.pending - before;
      if (found) {
        report.byColumn[`${table}.${col}`] = found;
        opts.log?.(`${table}.${col}: ${found}`);
      }
    }
  }
  return report;
}
