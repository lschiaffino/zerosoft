import { runVoiceCron } from '@/lib/voice-jobs';
import { applyRetention } from '@/lib/talk-admin';
import { NextRequest, NextResponse } from 'next/server';
import { retryDueWebhooks } from '@/lib/webhooks';
import { fireDueTasks } from '@/lib/crm';
import { purgeExpiredTrash } from '@/lib/crm-trash';
import { purgeExpiredSiteDomains } from '@/lib/docs-site';
import { processFlowQueue } from '@/lib/flow-worker';
import { pruneFlowRuns } from '@/lib/flow';
import { runDueRobots } from '@/lib/robots';
import { resyncStaleKnowledgeUrls } from '@/lib/agents';
import { checkAgentAlerts } from '@/lib/agents-alerts';
import { processIdleConversations } from '@/lib/agents-quality';
import { redactIdleConversations } from '@/lib/agents-privacy';
import { syncDueMailboxes } from '@/lib/crm-email-sync';
import { syncDueOutlookMailboxes } from '@/lib/crm-outlook-sync';
import { processSequences } from '@/lib/crm-sequences';
import { runNightlyScoring } from '@/lib/crm-scoring';
import { sendOfflineReplyEmails } from '@/lib/chat-offline-email';
import { fireNoteReminders } from '@/lib/notes-reminders';
import { fireDocReminders } from '@/lib/docs-reminders';
import { fireVerificationExpiry } from '@/lib/docs-verify';
import { pruneDocsAudit } from '@/lib/docs-audit';
import { pruneEvents as pruneDocsLiveEvents } from '@/lib/docs-coedit';
import { runAutoCycles } from '@/lib/track-auto-cycles';
import { runRecurringIssues } from '@/lib/track-recurring';
import { runHousekeeping } from '@/lib/track-housekeeping';
import { runPlanUpdateReminders } from '@/lib/track-plan-updates';
import { fireIssueReminders, sendImmediateTrackEmails, sendTrackDigests } from '@/lib/track-notify';
import { runSlaChecks } from '@/lib/track-sla';
import { processPendingAgentSessions } from '@/lib/track-agents';
import { recheckLinkSafety } from '@/lib/link-safety';
import { pruneDeferredClicks } from '@/lib/link-deferred';
import { pruneLinkHistory } from '@/lib/link-activity';
import { backfillSearchText, purgeExpiredTrash as purgeBoardTrash } from '@/lib/boards';
import { pruneBoardEvents } from '@/lib/board-live';
import { runAnalyticsCron } from '@/lib/analytics/cron';
import { purgeExpiredCandidates } from '@/lib/hiring/candidates';
import { sendFeedbackReminders } from '@/lib/hiring/evaluation';
import { syncAllInterviews } from '@/lib/hiring/interviews';
import { peopleTick } from '@/lib/people-timeoff';
import { importResearchIdeas, researchIdeaSchema } from '@/lib/roadmap';
import researchIdeas from '@/research/ideas.json';
import { GET as remindersCron } from '../../calendar/reminders/due/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Robots programados corren dentro del tick (hasta ~5 min por corrida).
export const maxDuration = 300;
/** Hasta cuándo (desde el inicio del tick) la cola de Flow empieza corridas nuevas. */
const FLOW_BUDGET_MS = 150_000;

/**
 * Tarea periódica única (Vercel Cron): recordatorios de Cal, reintentos de
 * webhooks, vencimiento de tareas del CRM (trigger task_due), el sync de
 * Gmail del CRM y los pasos de secuencias vencidos (ambos acotados y con lock
 * por fila; corre cada hora, esa es la granularidad de las secuencias), la
 * cola de Flow con presupuesto de tiempo (schedules vencidos, corridas en
 * cola, delays y reintentos) y al final los robots programados
 * (lib/robots.ts → runDueRobots). En Vercel los recordatorios de Cal y la
 * cola de Flow corren además cada minuto en /api/cron/minute (claims por fila
 * evitan dobles envíos); acá quedan para self-host con un solo cron. También
 * carga al backlog las ideas nuevas de research/ideas.json (una vez por
 * título), re-descarga las URLs de conocimiento de Agents con más de 24 h y
 * vacía de la papelera del CRM lo borrado hace más de 90 días. Purga las
 * corridas de Flow más viejas que la retención de cada workspace, en lotes. Una vez por
 * hora revisa los picos de pulgares abajo, errores de herramientas y topes
 * de pasos de Agents y avisa por email al dueño (lib/agents-alerts.ts).
 * Track: cycles automáticos (una vez por día y proyecto), issues que se
 * repiten (claim por regla), recordatorios de issues, emails inmediatos y el
 * resumen diario a las 8 de cada persona (claim por persona y día). Planificación:
 * recordatorio de update al lead de cada plan en curso (claim sobre
 * next_reminder_at) y, una vez por día y proyecto, auto-cierre, auto-archivo y
 * cierre de cycles vencidos con rollover (claim en housekeeping_day).
 * Misma autorización que el cron de
 * recordatorios (CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const tickStart = Date.now();
  const reminders = await remindersCron(req);
  if (!reminders.ok) return reminders;
  const webhookRetries = await retryDueWebhooks();
  const dueTasks = await fireDueTasks();
  // Respuestas de Chat sin leer → email al visitante (también cada minuto en Vercel).
  const chatEmails = await sendOfflineReplyEmails({ limit: 200 }).catch(() => null);
  // Recordatorios de Notes (también cada minuto en Vercel; claim por fila).
  const noteReminders = await fireNoteReminders({ limit: 500 }).catch(() => null);
  // Talk: retención de mensajes por workspace (borrado por tandas; idempotente).
  const talkRetention = await applyRetention().catch(() => null);
  // Recordatorios de las menciones de fecha de Docs (también cada minuto; claim por fila).
  const docReminders = await fireDocReminders({ limit: 500 }).catch(() => null);
  // Wiki de Docs: avisa a los dueños de las páginas cuya verificación venció
  // (claim por fila en verify_notified_at) y poda la auditoría de más de un año.
  const docVerify = await fireVerificationExpiry({ limit: 500 }).catch(() => null);
  const docAuditPruned = await pruneDocsAudit().catch(() => null);
  // Feed en vivo de Docs: operaciones de más de una hora y el resto (cursores, avisos) de más de dos minutos.
  await pruneDocsLiveEvents().catch(() => null);
  // Track: lo que corre solo. Los recordatorios van antes que los emails.
  const trackCycles = await runAutoCycles().catch(() => null);
  const trackRecurring = await runRecurringIssues({ limit: 200 }).catch(() => null);
  const trackReminders = await fireIssueReminders({ limit: 500 }).catch(() => null);
  const trackPlanReminders = await runPlanUpdateReminders({ limit: 500 }).catch(() => null);
  const trackHousekeeping = await runHousekeeping({ limit: 200 }).catch(() => null);
  const trackSla = await runSlaChecks({ limit: 500 }).catch(() => null);
  const trackAgents = await processPendingAgentSessions({ limit: 20, budgetMs: 20_000 }).catch(() => null);
  const trackEmails = await sendImmediateTrackEmails({ limit: 200 }).catch(() => null);
  const trackDigests = await sendTrackDigests({ limit: 500 }).catch(() => null);
  // Link: revisión semanal de destinos contra Safe Browsing (claim por fila) y
  // limpieza de las visitas para deep linking diferido (viven una hora).
  const linkSafety = await recheckLinkSafety({ limit: 500 }).catch(() => null);
  const linkDeferred = await pruneDeferredClicks().catch(() => null);
  const linkHistory = await pruneLinkHistory().catch(() => null);
  // Analytics: rollup diario, retención por proyecto y purga de proyectos borrados (claim por proyecto).
  const analytics = await runAnalyticsCron({ budgetMs: 20_000 }).catch(() => null);
  // Hiring: retención de candidatos (compare-and-set en purge_claimed_at), recordatorios de
  // scorecards (claim en reminded_at) y reservas de Cal de las entrevistas.
  const hiring = {
    purged: await purgeExpiredCandidates().catch(() => null),
    reminders: await sendFeedbackReminders().catch(() => null),
    interviews: await syncAllInterviews().catch(() => null),
  };
  // People: las licencias aprobadas que empiezan hoy ponen "fuera de la oficina" en Talk (claim por pedido).
  const peopleOoo = await peopleTick().catch(() => null);
  // Books: facturas recurrentes (claim por fila en claimed_until + next_date), vencidas (status con compare-and-set) y
  // recordatorios de pago (reminder_count con compare-and-set).
  const books = await import('@/lib/books-recurring').then((m) => m.runBooksCron({ budgetMs: 20_000 })).catch(() => null);
  // Papelera del CRM: lo borrado hace más de 90 días se descarta para siempre.
  const trashPurged = await purgeExpiredTrash().catch(() => null);
  // Board: papelera de más de 30 días y eventos de tiempo real viejos (son efímeros).
  const boardTrashPurged = await purgeBoardTrash().catch(() => null);
  const boardEventsPruned = await pruneBoardEvents().catch(() => null);
  // Board: texto buscable de las pizarras de antes (por lotes, con claim por fila).
  const boardSearchBackfill = await backfillSearchText({ limit: 200 }).catch(() => null);
  // Docs: dominios del sitio publicado que nadie verificó en UNVERIFIED_TTL_DAYS se liberan.
  const docsDomainsPurged = await purgeExpiredSiteDomains().catch(() => null);
  // Flow: corridas y pasos más viejos que la retención del workspace (lotes acotados).
  const flowPruned = await pruneFlowRuns({ budgetMs: 15_000 }).catch(() => null);
  // Primero el sync (detecta respuestas → salen de la secuencia), después los envíos.
  // Van antes de la cola de Flow: son acotados y no pueden quedar sin correr.
  const emailSync = await syncDueMailboxes({ limit: 25, maxMessages: 50 }).catch(() => null);
  const outlookSync = await syncDueOutlookMailboxes({ limit: 25, maxMessages: 50 }).catch(() => null);
  const sequences = await processSequences({ limit: 100 }).catch(() => null);
  // Voice: lo mismo que cada minuto, más la limpieza de reuniones vacías y subidas huérfanas.
  const voice = await runVoiceCron({ budgetMs: 20_000 }).catch(() => null);
  // Lead scoring: recálculo completo una vez por día por workspace (ventanas de N días).
  const scoring = await runNightlyScoring(new Date(), 10).catch(() => null);
  // Flow con presupuesto: no empieza corridas nuevas pasados ~150 s del tick
  // (lo que quede sigue en cola para el próximo tick o el worker).
  // Agents: re-descarga las URLs de conocimiento con más de 24 h (de a pocas por tick).
  const agentKnowledge = await resyncStaleKnowledgeUrls({ limit: 30 }).catch(() => null);
  // Agents: eventos ya procesados de Slack/Messenger/Instagram de más de 3 días.
  await import('@/lib/agents-channels').then((m) => m.pruneChannelEvents()).catch(() => null);
  // Agents: picos de la última hora → email al dueño (con throttle por agente).
  const agentAlerts = await checkAgentAlerts().catch(() => null);
  // Agents: puntaje con AI y memoria de las conversaciones inactivas (claim por fila), y redacción de datos personales.
  const agentQuality = await processIdleConversations({ limit: 40, budgetMs: 40_000 }).catch(() => null);
  const agentRedacted = await redactIdleConversations({ limit: 100 }).catch(() => null);
  const flow = await processFlowQueue({ limit: 200, budgetMs: Math.max(0, FLOW_BUDGET_MS - (Date.now() - tickStart)) });
  // Robots al final: son lo más lento y usan el tiempo que queda (con margen).
  // En Vercel también los corre /api/cron/robots cada 5 min; self-host puede
  // llamar solo al tick. El compare-and-set de next_run_at evita dobles corridas.
  const robots = await runDueRobots(new Date(), 100, Math.max(0, 270_000 - (Date.now() - tickStart)));
  const ideas = await importResearchIdeas(
    (researchIdeas as unknown[]).flatMap((i) => {
      const p = researchIdeaSchema.safeParse(i);
      return p.success ? [p.data] : [];
    }),
  )
    .then((r) => ({ created: r.created.length }))
    .catch(() => null);
  return NextResponse.json({ reminders: await reminders.json(), webhookRetries, dueTasks, chatEmails, noteReminders, talkRetention, docReminders, docVerify, docAuditPruned, trackCycles, trackRecurring, trackReminders, trackPlanReminders, trackHousekeeping, trackSla, trackAgents, trackEmails, trackDigests, linkSafety, linkDeferred, linkHistory, analytics, peopleOoo, hiring, books, trashPurged, boardTrashPurged, boardEventsPruned, boardSearchBackfill,
    docsDomainsPurged, flowPruned, flow, emailSync, outlookSync, sequences, voice, scoring, agentKnowledge, agentAlerts, agentQuality, agentRedacted, robots, ideas });
}
