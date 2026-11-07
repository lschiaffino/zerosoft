/**
 * Keeps the line between the AGPL core and ee/ clean. Fails when:
 *   - a file under ee/ (other than ee/LICENSE) lacks the SPDX header
 *     "SPDX-License-Identifier: LicenseRef-Zerosoft-EE" in its first lines;
 *   - a file outside ee/ imports anything from ee/ other than ee/lib/license.ts.
 *
 *   npx tsx scripts/check-ee-boundary.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const EE_SPDX = 'SPDX-License-Identifier: LicenseRef-Zerosoft-EE';
/** The one file in ee/ that core code may import. */
export const EE_ENTRY = 'ee/lib/license';

const CODE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'dist', 'build', 'coverage', 'data', 'test-results', 'playwright-report']);
const HEADER_LINES = 5;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const toPosix = (p: string) => p.split(sep).join('/');

/** Every module specifier in a source file: import/export from, import(), require(). */
export function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) found.push(m[1]);
  return found;
}

/** The repo-relative path a specifier points to, or null for packages. */
export function resolveSpecifier(spec: string, fromFile: string, root: string): string | null {
  let abs: string;
  if (spec.startsWith('@/')) abs = join(root, spec.slice(2));
  else if (spec.startsWith('.')) abs = resolve(dirname(fromFile), spec);
  else return null;
  return toPosix(relative(root, abs));
}

export function isForbiddenEeImport(target: string): boolean {
  if (target !== 'ee' && !target.startsWith('ee/')) return false;
  return target.replace(/\.(?:ts|js)$/, '') !== EE_ENTRY;
}

export function findViolations(root: string): string[] {
  const problems: string[] = [];
  for (const file of walk(root)) {
    const rel = toPosix(relative(root, file));
    if (rel.startsWith('ee/')) {
      if (rel === 'ee/LICENSE') continue;
      const head = readFileSync(file, 'utf8').split('\n').slice(0, HEADER_LINES).join('\n');
      if (!head.includes(EE_SPDX)) problems.push(`${rel}: missing "${EE_SPDX}" header`);
      continue;
    }
    if (!CODE_EXT.test(rel)) continue;
    const source = readFileSync(file, 'utf8');
    for (const spec of specifiers(source)) {
      const target = resolveSpecifier(spec, file, root);
      if (target && isForbiddenEeImport(target)) {
        problems.push(`${rel}: imports "${spec}"; core may only import from ee/lib/license.ts`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && /check-ee-boundary\.[cm]?[jt]s$/.test(process.argv[1])) {
  const root = resolve(dirname(process.argv[1]), '..');
  const problems = findViolations(root);
  if (problems.length) {
    console.error(`ee/ boundary check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('ee/ boundary check passed');
}
