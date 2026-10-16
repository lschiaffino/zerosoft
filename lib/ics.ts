/**
 * Archivos iCalendar (RFC 5545) para invitaciones de Cal. METHOD:REQUEST hace
 * que Gmail/Outlook/Apple muestren "Agregar al calendario"; CANCEL lo quita.
 * El UID es estable por booking y SEQUENCE sube en cada cambio.
 */

export interface IcsEvent {
  uid: string;
  sequence: number;
  method: 'REQUEST' | 'CANCEL';
  start: Date;
  end: Date;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Caracteres de control (CR/LF incluidos): en un parámetro o un mailto abrirían una línea nueva. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]+/g;

function escapeParam(s: string): string {
  return `"${s.replace(CONTROL_CHARS, ' ').replace(/"/g, "'")}"`;
}

function mailto(email: string): string {
  return `mailto:${email.replace(CONTROL_CHARS, '')}`;
}

/** Líneas de más de 75 octetos se pliegan con CRLF + espacio. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(ev: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zerosoft//Cal//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${ev.method}`,
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `SEQUENCE:${ev.sequence}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(ev.start)}`,
    `DTEND:${stamp(ev.end)}`,
    `SUMMARY:${escapeText(ev.title)}`,
    ev.description ? `DESCRIPTION:${escapeText(ev.description)}` : '',
    ev.location ? `LOCATION:${escapeText(ev.location)}` : '',
    ev.url ? `URL:${ev.url.replace(CONTROL_CHARS, '')}` : '',
    `ORGANIZER;CN=${escapeParam(ev.organizer.name)}:${mailto(ev.organizer.email)}`,
    `ATTENDEE;CN=${escapeParam(ev.attendee.name)};ROLE=REQ-PARTICIPANT;RSVP=FALSE:${mailto(ev.attendee.email)}`,
    `STATUS:${ev.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}
