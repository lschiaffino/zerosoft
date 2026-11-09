/**
 * Formatos de la bandeja estilo WhatsApp Web: hora de la lista, separadores
 * de día, color estable por remitente, tamaños y duraciones. Puro (lo usan
 * la interfaz y los tests).
 */
import { parseDbUtc } from '@/lib/utils';

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function capitalize(s: string, locale: string): string {
  return s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s;
}

/** "hoy" / "ayer" en el idioma, con mayúscula. */
export function relativeDay(offset: 0 | -1, locale: string): string {
  try {
    return capitalize(new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(offset, 'day'), locale);
  } catch {
    return offset === 0 ? 'Today' : 'Yesterday';
  }
}

/**
 * Hora de la lista de chats, como WhatsApp: hoy la hora, ayer "Ayer", esta
 * semana el día, antes la fecha corta.
 */
export function listTime(iso: string | null | undefined, locale: string, now = new Date()): string {
  if (!iso) return '';
  const d = parseDbUtc(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days <= 0) return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return relativeDay(-1, locale);
  if (days < 7) return capitalize(d.toLocaleDateString(locale, { weekday: 'long' }), locale);
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Separador de día en el hilo: Hoy, Ayer, el día de la semana, o la fecha. */
export function dayLabel(iso: string, locale: string, now = new Date()): string {
  const d = parseDbUtc(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days <= 0) return relativeDay(0, locale);
  if (days === 1) return relativeDay(-1, locale);
  if (days < 7) return capitalize(d.toLocaleDateString(locale, { weekday: 'long' }), locale);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** Clave del día local (para agrupar mensajes por día en la zona de quien mira). */
export function localDayKey(iso: string): string {
  const d = parseDbUtc(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Color estable (0..11) para un remitente de grupo o un avatar sin foto. */
export function colorIndex(seed: string, n = 12): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % n;
}

/** Iniciales para el avatar (sin el "+" de un teléfono). */
export function initials(name: string): string {
  const words = name.replace(/^\+/, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '#';
  if (/^\d/.test(words[0])) return '#';
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

/** 1.2 MB, 340 kB. */
export function fileSize(bytes: number, locale: string): string {
  if (!bytes || bytes < 0) return '';
  const units = ['B', 'kB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toLocaleString(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

/** 0:07, 1:32. */
export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Extensión en mayúsculas para la tarjeta de documento ("PDF"). */
export function extensionOf(name: string, type: string): string {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  if (m) return m[1].toUpperCase();
  const t = /\/([a-z0-9.+-]+)$/i.exec(type)?.[1] ?? '';
  return t.replace(/^(x-|vnd\.)/, '').split(/[.+]/)[0].slice(0, 6).toUpperCase();
}

/** Texto con links: partes de texto y de URL (sin HTML). */
export function linkify(text: string): Array<{ text: string; href?: string }> {
  const out: Array<{ text: string; href?: string }> = [];
  const re = /\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], href: m[1] });
    last = m.index + m[1].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Solo emojis (1 a 3): WhatsApp los muestra grandes y sin burbuja de color. */
export function onlyEmoji(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  const stripped = t.replace(/[\s‍️]/g, '');
  if (!/^\p{Extended_Pictographic}+$/u.test(stripped.replace(/\p{Emoji_Modifier}/gu, ''))) return false;
  return Array.from(stripped.replace(/\p{Emoji_Modifier}/gu, '')).length <= 3;
}

/** URL de un video para mostrar su primer cuadro como miniatura (sin reproducirlo). */
export function posterFrame(url: string): string {
  return `${url}#t=0.1`;
}

/** Barras fijas por mensaje (parecen una onda, sin decodificar el audio). */
export function bars(seed: string, n = 36): number[] {
  const out: number[] = [];
  let h = colorIndex(seed, 9973) + 7;
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    out.push(0.25 + ((h >> 8) % 1000) / 1333);
  }
  return out;
}


/** La forma de onda que manda WhatsApp (0..100) → 36 barras de 0,25 a 1. */
export function waveBars(wave: number[] | undefined, seed: string, n = 36): number[] {
  if (!wave || wave.length < 8) return bars(seed, n);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * wave.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * wave.length) / n));
    const slice = wave.slice(a, b);
    const v = slice.reduce((s, x) => s + x, 0) / slice.length / 100;
    out.push(0.18 + Math.min(1, v) * 0.82);
  }
  return out;
}

/** Primer link http(s) de un texto (sin la puntuación del final). */
export function firstUrl(text: string): string {
  const m = /\bhttps?:\/\/[^\s<>"']+/i.exec(text ?? '');
  return m ? m[0].replace(/[).,;:!?]+$/, '') : '';
}
