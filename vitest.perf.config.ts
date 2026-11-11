import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Medición de velocidad de WhatsApp (Lines e Inbox): no es parte de `npm test`.
//   npx vitest run -c vitest.perf.config.ts
// BENCH_RT_MS=<ms> suma esa espera a cada ida a la base (modela la red hasta Turso).
const dbFile = path.join(os.tmpdir(), `zerosoft-perf-${process.pid}-${Date.now()}.db`);

export default defineConfig({
  resolve: { alias: { '@': path.dirname(fileURLToPath(import.meta.url)) } },
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 600_000,
    env: { TURSO_DATABASE_URL: `file:${dbFile}`, NEXTAUTH_SECRET: 'test-secret' },
  },
});
