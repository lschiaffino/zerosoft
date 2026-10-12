import { describe, expect, it } from 'vitest';
import { buildIcs } from '@/lib/ics';

const base = {
  uid: 'b1@zerosoft.ai',
  sequence: 3,
  start: new Date('2026-11-02T13:00:00Z'),
  end: new Date('2026-11-02T13:30:00Z'),
  title: 'Intro, 30 min; con José',
  location: 'https://meet.google.com/abc-defg-hij',
  organizer: { name: 'Host "H"', email: 'host@x.com' },
  attendee: { name: 'Guest', email: 'guest@x.com' },
};

describe('ics', () => {
  it('genera una invitación válida (CRLF, fechas UTC, escapes)', () => {
    const ics = buildIcs({ ...base, method: 'REQUEST', description: 'Línea 1\nLínea 2' });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('DTSTART:20261102T130000Z');
    expect(ics).toContain('DTEND:20261102T133000Z');
    expect(ics).toContain('SUMMARY:Intro\\, 30 min\; con José');
    expect(ics).toContain('DESCRIPTION:Línea 1\\nLínea 2');
    expect(ics).toContain("ORGANIZER;CN=\"Host 'H'\":mailto:host@x.com");
    expect(ics).toContain('SEQUENCE:3');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
  });

  it('cancelación', () => {
    const ics = buildIcs({ ...base, method: 'CANCEL' });
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
  });
});
