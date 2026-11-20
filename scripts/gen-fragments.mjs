#!/usr/bin/env node
/**
 * Un archivo por cambio, para que dos PRs no choquen nunca en la misma lista:
 * - content/changelog-entries/<fecha>-<id>.ts  → content/changelog-entries.generated.ts
 * - lib/schema/migration-files/<AAAAMMDD_HHMM_nombre>.ts → lib/schema/migration-files.generated.ts
 * Cada archivo exporta por default una entrada del changelog o una migración. Los .generated.ts
 * no se versionan: los arman next.config.mjs, vitest y los scripts de npm (typecheck, lint,
 * postinstall). Si dos migraciones tienen el mismo id, falla.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function list(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => /\.ts$/.test(f) && !f.endsWith('.d.ts'))
    .sort();
}

function write(file, body) {
  const abs = path.join(root, file);
  const text = `// Generado por scripts/gen-fragments.mjs. No editar: agregá un archivo en la carpeta.\n${body}`;
  if (!fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== text) fs.writeFileSync(abs, text);
}

/**
 * Orden del changelog: el más nuevo primero. El nombre empieza con la fecha (AAAA-MM-DD-) y puede seguir con la
 * hora en UTC (HHMM-): dentro del mismo día va primero el de hora más tarde, y los que no dicen hora van después
 * de los que sí. Sin hora, el orden dentro del día es el alfabético al revés (como antes), que no dice nada de
 * cuál salió último: por eso el aviso de "versión nueva" podía mostrar cambios de la mañana como lo más nuevo.
 */
export function changelogOrder(files) {
  const key = (f) => {
    const m = /^(\d{4}-\d{2}-\d{2})-(?:(\d{4})-)?/.exec(f);
    return { date: m?.[1] ?? '', time: m?.[2] ?? '', name: f };
  };
  return [...files].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x.date !== y.date) return x.date < y.date ? 1 : -1;
    if (x.time !== y.time) return x.time < y.time ? 1 : -1;
    return x.name < y.name ? 1 : x.name > y.name ? -1 : 0;
  });
}

export function genFragments() {
  const entries = changelogOrder(list('content/changelog-entries'));
  write(
    'content/changelog-entries.generated.ts',
    `import type { ChangelogEntry } from './changelog';\n` +
      entries.map((f, i) => `import e${i} from './changelog-entries/${f.replace(/\.ts$/, '')}';\n`).join('') +
      `\nexport const CHANGELOG_FRAGMENTS: ChangelogEntry[] = [${entries.map((_, i) => `e${i}`).join(', ')}];\n`,
  );
  // Migraciones: en orden de id (AAAAMMDD_HHMM_nombre), después de las numeradas de siempre.
  const migrations = list('lib/schema/migration-files');
  const bad = migrations.filter((f) => !/^\d{8}_\d{4}_[a-z0-9_]+\.ts$/.test(f));
  if (bad.length) throw new Error(`migraciones con nombre inválido (AAAAMMDD_HHMM_nombre.ts): ${bad.join(', ')}`);
  write(
    'lib/schema/migration-files.generated.ts',
    `import type { Migration } from './migrations';\n` +
      migrations.map((f, i) => `import m${i} from './migration-files/${f.replace(/\.ts$/, '')}';\n`).join('') +
      `\nexport const MIGRATION_FILES: Migration[] = [${migrations.map((_, i) => `m${i}`).join(', ')}];\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) genFragments();
