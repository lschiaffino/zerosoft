import { defineConfig } from '@playwright/test';
import os from 'os';
import path from 'path';

/**
 * E2E con sesiones reales: sin DEMO_MODE ni la cookie de identidad, cada persona
 * entra con su código por email (se lee del archivo de captura). Corre contra el
 * build de producción. La suite común (playwright.config.ts) es la de DEMO_MODE:
 * esta cuida lo que allá no se ve, como un cambio de sesión o de workspace activo.
 */
const PORT = Number(process.env.E2E_REAL_PORT) || 3220;
process.env.E2E_DB_FILE ??= path.join(os.tmpdir(), `zerosoft-real-${Date.now()}.db`);
process.env.E2E_MAIL_FILE ??= path.join(os.tmpdir(), `zerosoft-real-mail-${Date.now()}.jsonl`);

export default defineConfig({
  testDir: 'tests/e2e-real',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npx next start -p ${PORT} --keepAliveTimeout 120000`,
    url: `http://localhost:${PORT}/en`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      TURSO_DATABASE_URL: `file:${process.env.E2E_DB_FILE}`,
      NEXTAUTH_SECRET: 'e2e-real-secret',
      NEXTAUTH_URL: `http://localhost:${PORT}`,
      SHORT_DOMAIN: `localhost:${PORT}`,
      EMAIL_CAPTURE_FILE: process.env.E2E_MAIL_FILE,
      RESEND_API_KEY: '',
      AI_GATEWAY_API_KEY: '',
      VERCEL_OIDC_TOKEN: '',
      CRON_SECRET: 'e2e-cron',
      // Las cuentas de prueba abren las apps "Próximamente" (lib/workspace-apps.ts, solo CI y tests); las -e2e.io no.
      E2E_COMING_SOON_OPEN: '1',
    },
  },
});
