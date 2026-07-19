import { NextRequest, NextResponse } from 'next/server';
import { listDueReminders, markReminderSent } from '@/lib/calendar';
import { sendBookingReminder } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Envía los recordatorios de bookings vencidos (calendar_reminders.send_at <= now,
 * no enviados, booking confirmado) y los marca como enviados.
 *
 * Pensado para un cron externo (ej. `curl -X POST .../api/calendar/reminders/due`
 * cada hora). Si CRON_SECRET está definido, exige `Authorization: Bearer <secret>`;
 * si no, queda abierto (desarrollo/self-hosted single-tenant).
 */
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const due = await listDueReminders();
  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    const res = await sendBookingReminder({
      to: reminder.invitee_email,
      guestName: reminder.invitee_name,
      eventTitle: reminder.event_title,
      start: new Date(reminder.starts_at),
      timezone: reminder.timezone,
      location: reminder.event_location,
    });
    if (res.ok) {
      await markReminderSent(reminder.id);
      sent += 1;
    } else {
      // No se marca: el próximo run del cron lo reintenta.
      failed += 1;
    }
  }

  return NextResponse.json({ total: due.length, sent, failed });
}

export async function POST(req: NextRequest) {
  return run(req);
}

export async function GET(req: NextRequest) {
  return run(req);
}
