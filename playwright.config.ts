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
      // Notion por API contra el workspace falso (token "fake-notion"): hub de importación.
      NOTION_IMPORT_FAKE: '1',
      // Datos de empresa desde el dominio sin salir a internet (lib/crm-enrich.ts).
      CRM_ENRICH_FAKE: '1',
      // Groups contra el proveedor de WhatsApp falso (lib/groups-provider-fake.ts): nada sale a WhatsApp.
      GROUPS_FAKE: '1',
      // IA de Groups contra el modelo falso: marcado de preguntas sin responder
      // (lib/groups-flag.ts), traducción y borradores (lib/groups-ai.ts); con la
      // cookie groups_ai_fake=off se ve el error ai_disabled.
      GROUPS_AI_FAKE: '1',
      // Integraciones de Groups (Slack, Freshdesk, Zoho Desk) contra el servidor falso y push web en memoria.
      GROUPS_INTEGRATIONS_FAKE: '1',
      GROUPS_PUSH_FAKE: '1',
      // Los e2e del cron (/api/cron/minute) mandan este Bearer: sin él, next start se niega a correrlo.
      CRON_SECRET: 'e2e-cron',
      // IA del CRM contra el modelo falso (lib/crm-ai-fake.ts): cuota y ai_usage
      // corren igual; con la cookie crm_ai_fake=off se ve el error ai_disabled.
      CRM_AI_FAKE: '1',
      // Apps del CRM (Slack, Zoom, Stripe) y CAPTCHA de formularios en modo de prueba: nada sale a internet.
      CRM_APPS_FAKE: '1',
      CAPTCHA_FAKE: '1',
      // Outlook / Microsoft 365 contra Graph falso (lib/microsoft-fake.ts) y llamadas
      // desde el navegador con el dispositivo simulado (lib/crm-voice-fake.ts).
      MS_GRAPH_FAKE: '1',
      // Cal: Google Calendar falso (lib/google-calendar-fake.ts) y SMS de workflows sin Twilio (lib/calendar-sms.ts).
      CAL_GOOGLE_FAKE: '1',
      CAL_SMS_FAKE: '1',
      CAL_ICLOUD_FAKE: '1',
      CRM_VOICE_FAKE: '1',
      // Autocompletar de las bases de Docs contra el modelo falso (lib/docs-db-ai.ts);
      // con la cookie docs_ai_fake=off se ve el error ai_disabled.
      DOCS_AI_FAKE: '1',
      // Dominio propio del sitio de Docs: un .test se verifica sin DNS y el
      // middleware pregunta por el host a este servidor (lib/docs-site.ts).
      DOCS_DOMAIN_FAKE: '1',
      DOCS_SITE_LOOKUP_ORIGIN: `http://localhost:${PORT}`,
      // Transcripción, título y resumen de Rec contra el modelo falso (lib/rec-ai.ts);
      // con la cookie rec_ai_fake=off se ve el error ai_disabled.
      REC_AI_FAKE: '1',
      // IA de Track (triage, resúmenes, agentes) contra el mismo modelo falso
      // (lib/track-ai.ts); con la cookie track_ai_fake=off se ve ai_disabled.
      TRACK_AI_FAKE: '1',
      // Importadores: Linear, GitHub, Jira, Asana, Shortcut y Calendly apuntan a un mock local
      // (tests/e2e/importers.spec.ts lo levanta en PORT + 1). Nada sale a internet.
      IMPORT_LINEAR_API_URL: `http://127.0.0.1:${PORT + 1}/linear`,
      IMPORT_GITHUB_API_URL: `http://127.0.0.1:${PORT + 1}/github`,
      IMPORT_CALENDLY_API_URL: `http://127.0.0.1:${PORT + 1}/calendly`,
      IMPORT_JIRA_API_URL: `http://127.0.0.1:${PORT + 1}/jira`,
      IMPORT_ASANA_API_URL: `http://127.0.0.1:${PORT + 1}/asana`,
      IMPORT_SHORTCUT_API_URL: `http://127.0.0.1:${PORT + 1}/shortcut`,
      // Track: Slack, GitHub App y Sentry/Zendesk/Intercom sin salir a internet
      // (lib/track-slack.ts, lib/track-github-app.ts, lib/track-support.ts).
      SLACK_FAKE: '1',
      GITHUB_APP_FAKE: '1',
      TRACK_SUPPORT_FAKE: '1',
      // Bookmarks de Docs sin salir a internet (lib/docs-unfurl.ts arma un HTML fijo por dominio).
      DOCS_UNFURL_FAKE: '1',
      // Voice: transcripción falsa (lib/voice-transcribe.ts, la cookie voice_fake_text elige qué "se dijo")
      // e IA falsa (lib/voice-ai.ts; con la cookie voice_ai_fake=off se ve ai_disabled).
      VOICE_TRANSCRIBE_PROVIDER: 'fake',
      VOICE_AI_FAKE: '1',
      // Voice → Notion sin salir a internet (lib/voice-send.ts).
      VOICE_NOTION_FAKE: '1',
      // Bases sincronizadas de Docs (GitHub, Jira, Salesforce) con datos fijos (lib/docs-sync.ts) y
      // page.updated sin espera (el cron de cada minuto lo emite en la próxima corrida).
      DOCS_SYNC_FAKE: '1',
      // Agents contra el modelo falso (lib/agents-ai.ts) solo en los requests con la
      // cookie agents_ai_fake=on: el resto de la suite sigue viendo el agente sin AI.
      AGENTS_AI_FAKE: '1',
      // Flow con el modelo falso (lib/flow-ai.ts) solo con la cookie flow_ai_fake=on.
      FLOW_AI_FAKE: '1',
      DOCS_EVENT_WINDOW_SEC: '0',
      // Talk con polling corto en vez de SSE: con el stream abierto la página nunca llega a networkidle.
      TALK_REALTIME: 'poll',
      // Chat: AI del agente contra el modelo falso (lib/chat-copilot.ts; con la cookie
      // chat_ai_fake=off se ve ai_disabled) y el canal email entrante sin firma de Resend
      // (lib/chat-email.ts, el texto viene en el payload del webhook).
      CHAT_AI_FAKE: '1',
      CHAT_INBOUND_FAKE: '1',
      CHAT_INBOUND_DOMAIN: 'inbound.zerosoft.test',
      // Link: Safe Browsing marca solo las URLs de prueba de Google (lib/link-safety.ts),
      // Rebrandly/Short.io devuelven links de prueba, Segment no sale a internet y la IA
      // de analytics usa el modelo falso (cookie link_ai_fake=off → ai_disabled).
      LINK_SAFETY_FAKE: '1',
      LINK_IMPORT_FAKE: '1',
      LINK_INTEGRATIONS_FAKE: '1',
      LINK_AI_FAKE: '1',
      // Robots: IA (constructor, pasos, columnas, arreglos) contra el modelo falso (lib/robots-ai.ts;
      // con la cookie robots_ai_fake=off se ve ai_disabled) y envíos a Sheets/Airtable sin salir a internet.
      ROBOTS_AI_FAKE: '1',
      ROBOTS_DESTINATIONS_FAKE: '1',
      // e2e de Robots con un https local autofirmado (redirección http → https).
      ROBOTS_TEST_IGNORE_HTTPS_ERRORS: '1',
      // Board: texto a diagrama, agrupar stickies y wireframe a código con el modelo
      // falso de lib/board-ai.ts (cookie board_ai_fake=off → ai_disabled).
      BOARD_AI_FAKE: '1',
      AI_GATEWAY_API_KEY: '',
      VERCEL_OIDC_TOKEN: '',
    },
  },
});
