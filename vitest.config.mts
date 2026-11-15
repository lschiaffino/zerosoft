import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { genFragments } from './scripts/gen-fragments.mjs';

// Changelog y migraciones de a un archivo por cambio (scripts/gen-fragments.mjs).
genFragments();

// Cada corrida usa una base SQLite nueva en el tmp del sistema.
const dbFile = path.join(os.tmpdir(), `zerosoft-test-${process.pid}-${Date.now()}.db`);

export default defineConfig({
  resolve: { alias: { '@': path.dirname(fileURLToPath(import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    // Las que corren todas las migraciones sobre una base vacía tardan más de 5 s en un runner cargado.
    testTimeout: 20_000,
    env: { TURSO_DATABASE_URL: `file:${dbFile}`, NEXTAUTH_SECRET: 'test-secret' },
  },
});
