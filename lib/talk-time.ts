/**
 * Talk: cuándos de recordatorios, mensajes programados y estados. Puro. Las
 * horas "de reloj" (mañana a las 9) se calculan con la hora local del
 * navegador que llama (el Date que recibe), así respeta la zona de la persona.
 */

export type RemindPreset = '20m' | '1h' | '3h' | 'tomorrow' | 'nextweek';
export const REMIND_PRESETS: RemindPreset[] = ['20m', '1h', '3h', 'tomorrow', 'nextweek'];

/** Momento de un preset de recordatorio (mañana y la semana próxima, a las 9:00 locales). */
export function presetTime(preset: RemindPreset, now: Date = new Date()): Date {
  switch (preset) {
    case '20m':
      return new Date(now.getTime() + 20 * 60_000);
    case '1h':
      return new Date(now.getTime() + 3_600_000);
    case '3h':
      return new Date(now.getTime() + 3 * 3_600_000);
    case 'tomorrow': {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case 'nextweek': {
      const d = new Date(now);
      // Próximo lunes (si hoy es lunes, el de la semana que viene).
      const add = ((8 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + add);
      d.setHours(9, 0, 0, 0);
      return d;
    }
  }
}

const UNIT_MS: Record<string, number> = {
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, minuto: 60_000, minutos: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000, hora: 3_600_000, horas: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000, dia: 86_400_000, dias: 86_400_000, día: 86_400_000, días: 86_400_000,
  w: 7 * 86_400_000, week: 7 * 86_400_000, weeks: 7 * 86_400_000, semana: 7 * 86_400_000, semanas: 7 * 86_400_000,
};

function atClock(base: Date, h: number, m: number, ampm?: string): Date {
  let hour = h;
  if (ampm) {
    const pm = /^p/i.test(ampm);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  const d = new Date(base);
  d.setHours(hour, m, 0, 0);
  return d;
}

/**
 * "in 1h", "en 20 minutos", "em 2 horas", "tomorrow", "mañana a las 10",
 * "amanhã às 9:30", "at 15:00", "a las 18", "next week" → Date, o null.
 */
export function parseWhen(raw: string, now: Date = new Date()): Date | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  const rel = /^(?:in|en|em|dentro de)\s+(\d{1,4})\s*([a-zíá]+)$/.exec(s) ?? /^(\d{1,4})\s*([a-zíá]+)$/.exec(s);
  if (rel && UNIT_MS[rel[2]]) return new Date(now.getTime() + Number(rel[1]) * UNIT_MS[rel[2]]);
  if (/^(next week|la semana que viene|la próxima semana|la proxima semana|semana que vem|próxima semana|proxima semana)$/.test(s)) return presetTime('nextweek', now);
  const clock = /(?:^|\s)(?:at|a las|a la|às|as)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|hs|h)?$/;
  const tomorrow = /^(tomorrow|mañana|manana|amanhã|amanha)(?=\s|$)(.*)$/.exec(s);
  if (tomorrow) {
    const base = new Date(now);
    base.setDate(base.getDate() + 1);
    const rest = tomorrow[2].trim();
    if (!rest) return atClock(base, 9, 0);
    const c = clock.exec(rest);
    if (!c) return null;
    const h = Number(c[1]);
    const m = Number(c[2] ?? 0);
    if (h > 23 || m > 59) return null;
    return atClock(base, h, m, c[3] === 'am' || c[3] === 'pm' ? c[3] : undefined);
  }
  const today = /^(?:today|hoy|hoje)?\s*(?:at|a las|a la|às|as)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|hs|h)?$/.exec(s);
  if (today) {
    const h = Number(today[1]);
    const m = Number(today[2] ?? 0);
    if (h > 23 || m > 59) return null;
    const d = atClock(now, h, m, today[3] === 'am' || today[3] === 'pm' ? today[3] : undefined);
    // Si esa hora ya pasó hoy, es mañana.
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  return null;
}

export interface RemindCommand {
  text: string;
  at: Date;
}

/**
 * "/remind me in 1h to call Ana", "/remind me to call Ana in 1h",
 * "/recordar en 20 min revisar el deploy", "/lembrar amanhã às 9 pagar".
 * null si no se entiende el cuándo.
 */
export function parseRemindCommand(input: string, now: Date = new Date()): RemindCommand | null {
  const m = /^\/(remind|recordar|recordarme|lembrar|lembrete)\s+(.*)$/is.exec(input.trim());
  if (!m) return null;
  let rest = m[2].trim().replace(/^(me|yo|eu)\s+/i, '');
  // Forma 1: <cuándo> (to|que|de) <texto>
  const lead = /^((?:in|en|em|dentro de)\s+\d{1,4}\s*[a-zíá]+|tomorrow(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|mañana(?:\s+a las\s+\d{1,2}(?::\d{2})?)?|manana|amanhã(?:\s+às\s+\d{1,2}(?::\d{2})?)?|amanha|next week|la semana que viene|semana que vem|(?:at|a las|às)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:(?:to|que|de|a|para)\s+)?(.+)$/i.exec(rest);
  if (lead) {
    const at = parseWhen(lead[1], now);
    if (at && lead[2].trim()) return { text: lead[2].trim(), at };
  }
  // Forma 2: (to|que)? <texto> <cuándo>
  rest = rest.replace(/^(to|que|de|para)\s+/i, '');
  const words = rest.split(' ');
  for (let k = Math.min(5, words.length - 1); k >= 1; k--) {
    const when = words.slice(words.length - k).join(' ');
    const at = parseWhen(when, now);
    const text = words.slice(0, words.length - k).join(' ').trim();
    if (at && text) return { text, at };
  }
  return null;
}

/** Programar mensaje: mañana 9:00 y el lunes 9:00, como Slack. */
export function schedulePresets(now: Date = new Date()): Array<{ key: 'tomorrow' | 'monday'; at: Date }> {
  return [
    { key: 'tomorrow', at: presetTime('tomorrow', now) },
    { key: 'monday', at: presetTime('nextweek', now) },
  ];
}

/** Vence un estado "por hoy": fin del día local. */
export function endOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 0);
  return d;
}

/** Línea del separador por día: "hoy", "ayer" o la fecha. La etiqueta la pone la UI. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
