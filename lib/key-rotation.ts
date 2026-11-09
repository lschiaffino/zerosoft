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
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const PAGE = 200;

function rotateText(text: string, report: RotationReport, apply: boolean): string | null {
  let changed = false;
  const out = text.replace(SEALED_TOKEN_RE, (token) => {
    if (!needsRotation(token)) return token;
    report.pending++;
    if (!apply) return token;
    const next = reseal(token);
    if (next === null) {
      report.unreadable++;
      return token;
    }
    changed = true;
    return next;
  });
  return changed ? out : null;
}

export async function rotateEncryptedValues(client: Client, opts: { apply: boolean; log?: (line: string) => void }): Promise<RotationReport> {
  const report: RotationReport = { pending: 0, rotated: 0, unreadable: 0, skipped: 0, byColumn: {} };
  const tables = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'")).rows.map((r) => String(r.name));
  for (const table of tables) {
    const cols = (await client.execute(`SELECT name, type FROM pragma_table_info(${quote(table)})`)).rows
      .filter((c) => !c.type || /TEXT|CHAR|CLOB|^$/i.test(String(c.type)))
      .map((c) => String(c.name));
    for (const col of cols) {
      const before = report.pending;
      let lastRowid = -1;
      for (;;) {
        let rows;
        try {
          rows = (
            await client.execute({
              sql: `SELECT rowid AS rid, ${quote(col)} AS v${table === 'flow_credentials' ? ', id, user_id' : ''} FROM ${quote(table)}
                    WHERE rowid > ? AND (${quote(col)} LIKE '%enc:v%' OR ${quote(col)} LIKE 'cred:v%') ORDER BY rowid LIMIT ${PAGE}`,
              args: [lastRowid],
            })
          ).rows;
        } catch {
          break; // tabla sin rowid o vista: no guarda secretos de secret-box
        }
        if (!rows.length) break;
        for (const row of rows) {
          lastRowid = Number(row.rid);
          const value = String(row.v ?? '');
          let next: string | null = null;
          if (value.startsWith('cred:v') && table === 'flow_credentials') {
            if (!credentialNeedsRotation(value)) continue;
            report.pending++;
            if (!opts.apply) continue;
            const data = decryptCredential(String(row.user_id), String(row.id), value);
            if (!data) {
              report.unreadable++;
              continue;
            }
            next = encryptCredential(String(row.user_id), String(row.id), data);
          } else {
            next = rotateText(value, report, opts.apply);
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
