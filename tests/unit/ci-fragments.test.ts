import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { CHANGELOG } from '@/content/changelog';
import { CHANGELOG_FRAGMENTS } from '@/content/changelog-entries.generated';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { MIGRATION_FILES } from '@/lib/schema/migration-files.generated';

describe('un archivo por cambio (scripts/gen-fragments.mjs)', () => {
  it('las entradas sueltas del changelog van primero y las migraciones sueltas al final, sin repetir ids', () => {
    expect(CHANGELOG.slice(0, CHANGELOG_FRAGMENTS.length)).toEqual(CHANGELOG_FRAGMENTS);
    expect(MIGRATIONS.slice(MIGRATIONS.length - MIGRATION_FILES.length)).toEqual(MIGRATION_FILES);
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MIGRATION_FILES) expect(m.id).toMatch(/^\d{8}_\d{4}_[a-z0-9_]+$/);
  });
});

describe('partes de e2e por duración (scripts/e2e-shard.mjs)', () => {
  it('cada archivo de tests cae en una sola parte', () => {
    const parts = [1, 2, 3, 4, 5, 6].map((i) => execFileSync('node', ['scripts/e2e-shard.mjs', String(i), '6'], { encoding: 'utf8' }).split(' ').filter(Boolean));
    const all = parts.flat();
    const files = (fs.readdirSync('tests/e2e', { recursive: true }) as string[]).filter((f) => f.endsWith('.spec.ts'));
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(files.length);
  });
});
