import fs from 'fs';
import path from 'path';

/**
 * Cuarentena de e2e inestables (tests/e2e/quarantine.json). Un test en la lista sigue corriendo en CI, en un
 * job aparte que no bloquea el merge; el resto de la suite corre sin él. Cada entrada vence a los 21 días
 * (tests/unit/e2e-quarantine.test.ts): para entonces se arregló la causa y sale de la lista, o se borra el test.
 *
 * `test` es "<archivo relativo a tests/e2e> › <título del test>", como lo muestra el reporte de Playwright
 * (sin el describe).
 */
export interface QuarantineEntry {
  test: string;
  since: string;
  reason: string;
  owner: string;
}

export const QUARANTINE_MAX_DAYS = 21;

export function loadQuarantine(): QuarantineEntry[] {
  const file = path.join(process.cwd(), 'tests/e2e/quarantine.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as QuarantineEntry[];
}

export function splitTest(entry: Pick<QuarantineEntry, 'test'>): { file: string; title: string } {
  const at = entry.test.indexOf(' › ');
  if (at < 0) throw new Error(`quarantine: "${entry.test}" no tiene la forma "<archivo> › <título>"`);
  return { file: entry.test.slice(0, at).trim(), title: entry.test.slice(at + 3).trim() };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lo que Playwright compara con grep es "<raíz> <proyecto> <archivo> <describes...> <título> <@tags>" (raíz y
 * proyecto vacíos acá, así que empieza con espacios): el archivo va como palabra entera y el título al final
 * (antes de los tags), así un título no tapa a otro que lo contiene.
 */
export function quarantinePattern(entries: QuarantineEntry[]): RegExp | null {
  if (entries.length === 0) return null;
  const parts = entries.map((e) => {
    const { file, title } = splitTest(e);
    return `(?:^| )${escape(file)} (?:.* )?${escape(title)}(?: @\\S+)*$`;
  });
  return new RegExp(parts.join('|'));
}

/**
 * Filtro para playwright.config.ts según E2E_QUARANTINE:
 * - "only": corre solo los de la cuarentena (el job que no bloquea);
 * - "skip": corre todo menos ellos (por defecto en CI);
 * - "include": corre todo (por defecto fuera de CI: quien trabaja en un test en cuarentena lo corre a mano).
 */
export function quarantineFilter(mode = process.env.E2E_QUARANTINE ?? (process.env.CI ? 'skip' : 'include')): {
  grep?: RegExp;
  grepInvert?: RegExp;
} {
  if (mode === 'include') return {};
  const pattern = quarantinePattern(loadQuarantine());
  if (mode === 'only') return { grep: pattern ?? /$^/ };
  if (mode === 'skip') return pattern ? { grepInvert: pattern } : {};
  throw new Error(`E2E_QUARANTINE="${mode}": usar only, skip o include`);
}
