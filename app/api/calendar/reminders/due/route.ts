import { NextRequest, NextResponse } from 'next/server';
import { expireUnpaidHolds, listDueReminders, markReminderSent } from '@/lib/calendar';
import { processDueWorkflowRuns } from '@/lib/calendar-workflows';
import { sendBookingReminder } from '@/lib/email';
import { manageUrl } from '@/lib/calendar-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Recordatorios por tanda y tiempo máximo para vaciar la cola en un tick. */
const BATCH = 50;
const BUDGET_MS = 45_000;

/**
 * Envía los recordatorios de bookings vencidos (calendar_reminders.send_at <= now,
 * no enviados, booking confirmado) y los marca como enviados.
 *
 * Pensado para un cron externo (ej. `curl -X POST .../api/calendar/reminders/due`
 * cada hora). Si CRON_SECRET está definido, exige `Authorization: Bearer <secret>`
 * (Vercel Cron lo manda solo). En producción sin CRON_SECRET se niega a correr;
 * fuera de producción queda abierto para desarrollo.
 */
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'cron_secret_not_configured' }, { status: 503 });
  }
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  // Tandas hasta vaciar la cola (con un cron horario, un solo LIMIT dejaría
  // atrasados los que no entran). Se corta si una tanda no envió ninguno
  // (los fallidos siguen pendientes y se repetirían) o se acaba el tiempo.
  const startedAt = Date.now();
  let total = 0;
  let sent = 0;
  let failed = 0;
  let pending = false;
  for (;;) {
    const due = await listDueReminders(BATCH);
    total += due.length;
    const sentBefore = sent;
    for (const reminder of due) {
      const res = await sendBookingReminder({
        to: reminder.invitee_email,
        guestName: reminder.invitee_name,
        eventTitle: reminder.event_title,
        start: new Date(reminder.starts_at),
        timezone: reminder.timezone,
        location: reminder.meeting_url || reminder.event_location,
        manageUrl: reminder.manage_token ? manageUrl({ manage_token: reminder.manage_token }, reminder.locale) : null,
        locale: reminder.locale,
      });
      if (res.ok) {
        await markReminderSent(reminder.id);
        sent += 1;
      } else {
        // No se marca: el próximo run del cron lo reintenta.
        failed += 1;
      }
    }
    if (due.length < BATCH || sent === sentBefore) break;
    if (Date.now() - startedAt > BUDGET_MS) {
      pending = true;
      break;
    }
  }
  if (pending) console.warn('[cal] recordatorios pendientes para el próximo tick (presupuesto de tiempo agotado)');

  // Pasos de workflows por tipo de evento y holds de pago vencidos.
  const workflows = await processDueWorkflowRuns();
  const expiredHolds = await expireUnpaidHolds();

  return NextResponse.json({ total, sent, failed, pending, workflows, expiredHolds });
}

export async function POST(req: NextRequest) {
  return run(req);
}

export async function GET(req: NextRequest) {
  return run(req);
}
