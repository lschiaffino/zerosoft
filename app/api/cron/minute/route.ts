import { runVoiceCron } from '@/lib/voice-jobs';
import { NextRequest, NextResponse } from 'next/server';
import { fireDueTasks } from '@/lib/crm';
import { processFlowQueue } from '@/lib/flow-worker';
import { sendOfflineReplyEmails } from '@/lib/chat-offline-email';
import { processChatCampaigns } from '@/lib/chat-campaigns';
import { pruneChatEvents } from '@/lib/chat-realtime';
import { fireNoteReminders } from '@/lib/notes-reminders';
import { fireNoteTasksDue } from '@/lib/notes-tasks';
import { processNoteFileQueue } from '@/lib/notes-file-text';
import { warmNoteEmbeddings } from '@/lib/notes-semantic';
import { fireDocReminders } from '@/lib/docs-reminders';
import { fireIssueReminders, sendImmediateTrackEmails } from '@/lib/track-notify';
import { processImportJobs as processCrmImportJobs } from '@/lib/crm-import-jobs';
import { processImportJobs } from '@/lib/import-runner';
import { runGroupsCron } from '@/lib/groups-cron';
import { processAiRuns } from '@/lib/crm-ai-agents';
import { retryDueWebhooks } from '@/lib/webhooks';
import { runSlaChecks } from '@/lib/track-sla';
import { processPendingAgentSessions } from '@/lib/track-agents';
import { processTrackIntegrationQueue } from '@/lib/track-events';
import { flushPageUpdatedEvents } from '@/lib/docs-events';
import { syncDueSources } from '@/lib/docs-sync';
import { processPendingRec } from '@/lib/rec-ai';
import { expirePendingOrders } from '@/lib/shop-orders';
import { runTalkCron } from '@/lib/talk-notify';
import { runSocialCron } from '@/lib/social-cron';
import { fetchPendingKnowledgeUrls } from '@/lib/agents';
import { processPendingSitemaps } from '@/lib/agents-knowledge';
import { processPendingSources } from '@/lib/agents-sources';
import { warmAgentEmbeddings } from '@/lib/agents-semantic';
import { GET as remindersCron } from '../../calendar/reminders/due/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
/** Hasta cuándo (desde el inicio) la cola de Flow empieza corridas nuevas. */
const FLOW_BUDGET_MS = 45_000;
/** Hasta cuándo (desde el inicio) se avanzan los imports en curso (Track, Cal, Docs). */
const IMPORT_BUDGET_MS = 100_000;
/** Hasta cuándo (desde el inicio) avanzan los imports del CRM. */
const CRM_IMPORT_BUDGET_MS = 200_000;

/**
 * Cron de cada minuto (Vercel Cron): recordatorios y pasos de workflows de Cal
 * (así "15 minutos antes" llega a tiempo), las tareas vencidas del CRM (trigger
 * task_due, con claim por fila en due_fired_at), los emails de Chat con respuestas
 * que el visitante no vio, los recordatorios de Notes (claim por fila en
 * note_reminders.sent_at), los recordatorios de las menciones de fecha de Docs
 * (claim por fila en docs_reminders.sent_at), los recordatorios de issues y los emails
 * inmediatos de Track (claims por fila y por persona), la cola de Flow con presupuesto de
 * tiempo (schedules vencidos, corridas en cola, delays y reintentos), los imports
 * en curso de Track, Cal y Docs y los del CRM desde HubSpot/Pipedrive (claim por
 * job en locked_until, cada corrida avanza unas páginas y guarda el cursor). El tick
 * horario sigue llamando a lo mismo para self-host con un solo cron. Las secuencias del CRM quedan en el tick: van después del
 * sync de Gmail, que es el que detecta respuestas y saca al contacto. Las dobles
 * corridas se evitan con los claims por fila (compare-and-set de next_run_at,
 * locks de corridas y jobs, sent_at de recordatorios y pasos). Misma
 * autorización que /api/cron/tick (CRON_SECRET como Bearer, la valida el
 * cron de recordatorios antes de hacer nada).
 */
export async function GET(req: NextRequest) {
  const start = Date.now();
  const reminders = await remindersCron(req);
  if (!reminders.ok) return reminders;
  const dueTasks = await fireDueTasks().catch(() => null);
  // Reintentos de webhooks con backoff (1m, 5m, 30m…): claim por entrega en claimed_until.
  const webhookRetries = await retryDueWebhooks(100).catch(() => null);
  const chatEmails = await sendOfflineReplyEmails({ limit: 200 }).catch(() => null);
  const chatCampaigns = await processChatCampaigns({ limit: 90 }).catch(() => null);
  await pruneChatEvents().catch(() => null);
  const noteReminders = await fireNoteReminders({ limit: 200 }).catch(() => null);
  const noteTasks = await fireNoteTasksDue({ limit: 200 }).catch(() => null);
  const noteEmbeddings = await warmNoteEmbeddings().catch(() => null);
  const docReminders = await fireDocReminders({ limit: 200 }).catch(() => null);
  const trackReminders = await fireIssueReminders({ limit: 200 }).catch(() => null);
  const trackEmails = await sendImmediateTrackEmails({ limit: 200 }).catch(() => null);
  // Track: avisos de SLA en riesgo / vencido (claim por fila) y trabajo pendiente de agentes (claim por sesión).
  const trackSla = await runSlaChecks({ limit: 200 }).catch(() => null);
  const trackAgents = await processPendingAgentSessions({ limit: 10, budgetMs: 20_000 }).catch(() => null);
  // Cola de Track hacia Slack y Sentry (claim por fila).
  const trackIntegrations = await processTrackIntegrationQueue({ limit: 100 }).catch(() => null);
  // Groups: envíos masivos y programados, chats sin responder y tickets vencidos (claims por fila).
  const groups = await runGroupsCron({ budgetMs: 30_000 }).catch(() => null);
  // Voice: grabaciones colgadas y notas con IA en cola (claim por fila en notes_status).
  const voice = await runVoiceCron({ budgetMs: 20_000, cleanup: false }).catch(() => null);
  // Agentes de datos y prospección del CRM (claim por ítem en claimed_at).
  const crmAiRuns = await processAiRuns({ budgetMs: 20_000 }).catch(() => null);
  // Docs: page.updated agrupado (claim por marca) y bases sincronizadas vencidas (claim por origen).
  const docsEvents = await flushPageUpdatedEvents().catch(() => null);
  const docsSync = await syncDueSources({ budgetMs: 20_000 }).catch(() => null);
  // Rec: transcripción y resumen de los videos que quedaron en cola.
  const rec = await processPendingRec({ limit: 5, budgetMs: 20_000 }).catch(() => null);
  // Shop: pedidos online sin pagar vencidos (compare-and-set por pedido): se cancelan y liberan stock y código.
  const shopExpired = await expirePendingOrders().catch(() => null);
  // Talk: mensajes programados (claim pending → sending), recordatorios (sent_at) y emails de menciones (talk_email_queue.sent_at).
  const talk = await runTalkCron().catch(() => null);
  // Social: publicaciones vencidas (claim por destino en claimed_until, reintentos con backoff), tokens por vencer,
  // bandeja y métricas por cuenta (claims en refresh/inbox/metrics_claimed_until).
  const social = await runSocialCron({ budgetMs: 30_000 }).catch(() => null);
  // Agents: páginas nuevas de un sitemap (claim por fila en fetched_at).
  const agentSitemaps = await processPendingSitemaps({ limit: 3 }).catch(() => null);
  const agentPages = await fetchPendingKnowledgeUrls({ limit: 15 }).catch(() => null);
  // Agents: artículos de Zendesk y embeddings de la búsqueda semántica (claim por fila).
  const agentSources = await processPendingSources({ limit: 2 }).catch(() => null);
  const agentEmbeddings = await warmAgentEmbeddings({ limit: 2 }).catch(() => null);
  const flow = await processFlowQueue({ limit: 200, budgetMs: Math.max(0, FLOW_BUDGET_MS - (Date.now() - start)) });
  // Imports grandes (Track, Cal, Docs) que no entraron en el request de la pestaña.
  const imports = await processImportJobs({ budgetMs: Math.max(5_000, IMPORT_BUDGET_MS - (Date.now() - start)) }).catch(() => null);
  // Imports del CRM con lo que queda de los 300 s (dejando margen).
  const crmImports = await processCrmImportJobs({ budgetMs: Math.max(0, CRM_IMPORT_BUDGET_MS - (Date.now() - start)) }).catch(() => null);
  // Notes: archivos para la búsqueda, al final y con tope de tiempo (no le saca el minuto a lo demás).
  const noteFiles = await processNoteFileQueue({ limit: 10, budgetMs: 20_000 }).catch(() => null);
  return NextResponse.json({ reminders: await reminders.json(), dueTasks, webhookRetries, chatEmails, chatCampaigns, noteReminders, noteTasks, noteFiles, noteEmbeddings, docReminders, trackReminders, trackEmails, trackSla, trackAgents, trackIntegrations, groups, voice, crmAiRuns, docsEvents, docsSync, rec, shopExpired, talk, social, agentSitemaps, agentPages, agentSources, agentEmbeddings, flow, imports, crmImports });
}
