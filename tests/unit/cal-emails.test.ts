import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBooking, createEventType, getOrCreateCalendarUser, setAvailability } from '@/lib/calendar';
import { notifyBooking } from '@/lib/calendar-notify';
import { sendBookingReminder } from '@/lib/email';
import { makeUser } from './helpers';

function nextMonday(): string {
  const d = new Date(Date.now() + 3 * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('emails de Cal en el idioma del invitado', () => {
  afterEach(() => vi.restoreAllMocks());

  it('confirmación en español con .ics y link de gestión', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const u = await makeUser('es');
    await getOrCreateCalendarUser(u.id);
    const et = await createEventType(u.id, { slug: `e-${crypto.randomUUID().slice(0, 6)}`, title: 'Charla', durationMin: 30, active: true } as Parameters<typeof createEventType>[1]);
    await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] });
    const b = await createBooking({ eventTypeId: et.id, email: 'g@x.com', name: 'Gabi', start: `${nextMonday()}T09:00:00.000Z`, locale: 'es' });
    expect(b.locale).toBe('es');
    await notifyBooking(b, 'created');
    const out = logs.join('\n');
    expect(out).toContain('Reserva confirmada: Charla');
    expect(out).toContain('Hola Gabi');
    expect(out).toContain('Reprogramar o cancelar');
    expect(out).toContain('/es/book/manage/');
    expect(out).toContain('invite.ics');
  });

  it('recordatorio en portugués', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    await sendBookingReminder({ to: 'a@b.com', guestName: 'Ana', eventTitle: 'Call', start: new Date(), timezone: 'UTC', location: '', locale: 'pt' });
    expect(logs.join('\n')).toContain('Lembrete: Call amanhã');
  });
});
