import { NextRequest, NextResponse } from 'next/server';
import { listDueReminders, markReminderSent } from '@/lib/calendar';
import { sendBookingReminder } from '@/lib/email';
import { manageUrl } from '@/lib/calendar-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      manageUrl: reminder.manage_token ? manageUrl({ manage_token: reminder.manage_token }) : null,
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
