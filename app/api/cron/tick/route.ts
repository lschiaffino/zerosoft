import { NextRequest, NextResponse } from 'next/server';
import { retryDueWebhooks } from '@/lib/webhooks';
import { fireDueTasks } from '@/lib/crm';
import { GET as remindersCron } from '../../calendar/reminders/due/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tarea periódica única (Vercel Cron): recordatorios de Cal, reintentos de
 * webhooks y vencimiento de tareas del CRM (trigger task_due). Misma
 * autorización que el cron de recordatorios (CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const reminders = await remindersCron(req);
  if (!reminders.ok) return reminders;
  const webhookRetries = await retryDueWebhooks();
  const dueTasks = await fireDueTasks();
  return NextResponse.json({ reminders: await reminders.json(), webhookRetries, dueTasks });
}
