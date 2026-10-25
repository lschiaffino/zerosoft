import { NextRequest, NextResponse } from 'next/server';
import { retryDueWebhooks } from '@/lib/webhooks';
import { fireDueTasks } from '@/lib/crm';
import { purgeExpiredTrash } from '@/lib/crm-trash';
import { processFlowQueue } from '@/lib/flow-worker';
import { pruneFlowRuns } from '@/lib/flow';
import { runDueRobots } from '@/lib/robots';
import { resyncStaleKnowledgeUrls } from '@/lib/agents';
import { checkAgentAlerts } from '@/lib/agents-alerts';
import { syncDueMailboxes } from '@/lib/crm-email-sync';
import { syncDueOutlookMailboxes } from '@/lib/crm-outlook-sync';
import { processSequences } from '@/lib/crm-sequences';
import { runNightlyScoring } from '@/lib/crm-scoring';
import { sendOfflineReplyEmails } from '@/lib/chat-offline-email';
import { fireNoteReminders } from '@/lib/notes-reminders';
import { fireDocReminders } from '@/lib/docs-reminders';
import { fireVerificationExpiry } from '@/lib/docs-verify';
import { pruneDocsAudit } from '@/lib/docs-audit';
import { runAutoCycles } from '@/lib/track-auto-cycles';
import { runRecurringIssues } from '@/lib/track-recurring';
import { fireIssueReminders, sendImmediateTrackEmails, sendTrackDigests } from '@/lib/track-notify';
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
 * resumen diario a las 8 de cada persona (claim por persona y día).
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
  // Recordatorios de las menciones de fecha de Docs (también cada minuto; claim por fila).
  const docReminders = await fireDocReminders({ limit: 500 }).catch(() => null);
  // Wiki de Docs: avisa a los dueños de las páginas cuya verificación venció
  // (claim por fila en verify_notified_at) y poda la auditoría de más de un año.
  const docVerify = await fireVerificationExpiry({ limit: 500 }).catch(() => null);
  const docAuditPruned = await pruneDocsAudit().catch(() => null);
  // Track: lo que corre solo. Los recordatorios van antes que los emails.
  const trackCycles = await runAutoCycles().catch(() => null);
  const trackRecurring = await runRecurringIssues({ limit: 200 }).catch(() => null);
  const trackReminders = await fireIssueReminders({ limit: 500 }).catch(() => null);
  const trackEmails = await sendImmediateTrackEmails({ limit: 200 }).catch(() => null);
  const trackDigests = await sendTrackDigests({ limit: 500 }).catch(() => null);
  // Papelera del CRM: lo borrado hace más de 90 días se descarta para siempre.
  const trashPurged = await purgeExpiredTrash().catch(() => null);
  // Flow: corridas y pasos más viejos que la retención del workspace (lotes acotados).
  const flowPruned = await pruneFlowRuns({ budgetMs: 15_000 }).catch(() => null);
  // Primero el sync (detecta respuestas → salen de la secuencia), después los envíos.
  // Van antes de la cola de Flow: son acotados y no pueden quedar sin correr.
  const emailSync = await syncDueMailboxes({ limit: 25, maxMessages: 50 }).catch(() => null);
  const outlookSync = await syncDueOutlookMailboxes({ limit: 25, maxMessages: 50 }).catch(() => null);
  const sequences = await processSequences({ limit: 100 }).catch(() => null);
  // Lead scoring: recálculo completo una vez por día por workspace (ventanas de N días).
  const scoring = await runNightlyScoring(new Date(), 10).catch(() => null);
  // Flow con presupuesto: no empieza corridas nuevas pasados ~150 s del tick
  // (lo que quede sigue en cola para el próximo tick o el worker).
  // Agents: re-descarga las URLs de conocimiento con más de 24 h (de a pocas por tick).
  const agentKnowledge = await resyncStaleKnowledgeUrls({ limit: 30 }).catch(() => null);
  // Agents: picos de la última hora → email al dueño (con throttle por agente).
  const agentAlerts = await checkAgentAlerts().catch(() => null);
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
  return NextResponse.json({ reminders: await reminders.json(), webhookRetries, dueTasks, chatEmails, noteReminders, docReminders, docVerify, docAuditPruned, trackCycles, trackRecurring, trackReminders, trackEmails, trackDigests, trashPurged, flowPruned, flow, emailSync, outlookSync, sequences, scoring, agentKnowledge, agentAlerts, robots, ideas });
}
