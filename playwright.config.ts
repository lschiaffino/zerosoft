import { defineConfig } from '@playwright/test';
import os from 'os';
import path from 'path';

const PORT = 3210;
const dbFile = path.join(os.tmpdir(), `zerosoft-e2e-${Date.now()}.db`);

/**
 * E2E contra la app real en DEMO_MODE (todo request es el usuario demo) y una
 * base SQLite nueva. En CI corre el build de producción; local, `next dev`.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/en`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DEMO_MODE: 'true',
      DEMO_MODE_ALLOW_PRODUCTION: 'true',
      TURSO_DATABASE_URL: `file:${dbFile}`,
      NEXTAUTH_SECRET: 'e2e-secret',
      NEXTAUTH_URL: `http://localhost:${PORT}`,
      SHORT_DOMAIN: `localhost:${PORT}`,
    },
  },
});
