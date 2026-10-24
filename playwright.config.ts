import { defineConfig } from '@playwright/test';
import os from 'os';
import path from 'path';

// E2E_PORT deja correr varias suites a la vez (agentes en paralelo) sin pisarse el puerto.
const PORT = Number(process.env.E2E_PORT) || 3210;
// Una sola base por corrida: el config se evalúa también en cada worker, así que
// el path se fija en el proceso principal y los workers lo heredan por env.
// Los tests que tocan la base directo (p. ej. simular DNS verificado) la leen de acá.
process.env.E2E_DB_FILE ??= path.join(os.tmpdir(), `zerosoft-e2e-${Date.now()}.db`);
const dbFile = process.env.E2E_DB_FILE;

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
      // El receptor de webhooks del test escucha en 127.0.0.1.
      ALLOW_PRIVATE_WEBHOOKS: 'true',
      // El usuario demo administra feedback, roadmap y changelog (pestaña Admin de Ajustes).
      ADMIN_EMAILS: 'demo@zerosoft.ai',
      // Sin AI real: .env.local puede traer un VERCEL_OIDC_TOKEN y el resultado
      // dependería de la máquina (y de los créditos del Gateway).
      // Import de CRM contra el proveedor falso (lib/crm-import-fake.ts, token "fake").
      CRM_IMPORT_FAKE: '1',
      // Datos de empresa desde el dominio sin salir a internet (lib/crm-enrich.ts).
      CRM_ENRICH_FAKE: '1',
      // Groups contra el proveedor de WhatsApp falso (lib/groups-provider-fake.ts): nada sale a WhatsApp.
      GROUPS_FAKE: '1',
      // IA del CRM contra el modelo falso (lib/crm-ai-fake.ts): cuota y ai_usage
      // corren igual; con la cookie crm_ai_fake=off se ve el error ai_disabled.
      CRM_AI_FAKE: '1',
      // Importadores: Linear, GitHub y Calendly apuntan a un mock local
      // (tests/e2e/importers.spec.ts lo levanta en PORT + 1). Nada sale a internet.
      IMPORT_LINEAR_API_URL: `http://127.0.0.1:${PORT + 1}/linear`,
      IMPORT_GITHUB_API_URL: `http://127.0.0.1:${PORT + 1}/github`,
      IMPORT_CALENDLY_API_URL: `http://127.0.0.1:${PORT + 1}/calendly`,
      AI_GATEWAY_API_KEY: '',
      VERCEL_OIDC_TOKEN: '',
    },
  },
});
