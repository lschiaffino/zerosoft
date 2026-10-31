/**
 * Texto de un aviso en el idioma de quien lo recibe, al guardarlo. Es para los
 * avisos que la bandeja muestra tal cual; los que arma al mostrarlos están en
 * lib/notification-text.ts. Sin users.locale vale el del workspace y después el
 * de la request que disparó el aviso.
 */
import { getDb } from './db';
import en from '@/messages/en/notificationCopy.json';
import es from '@/messages/es/notificationCopy.json';
import pt from '@/messages/pt/notificationCopy.json';

type Locale = 'en' | 'es' | 'pt';
const COPY: Record<Locale, Record<string, string>> = { en, es, pt };

export type NotificationCopyKey = keyof typeof en;
export interface LocalizedText {
  key: NotificationCopyKey;
  vars: Record<string, string | number | null | undefined>;
}
export type NotificationText = string | LocalizedText;

export function localized(key: NotificationCopyKey, vars: LocalizedText['vars'] = {}): LocalizedText {
  return { key, vars };
}

/** Un valor faltante se escribe "Sin título" si es un título y "Alguien" si es una persona. */
export function renderLocalized(text: LocalizedText, locale: Locale): string {
  const copy = COPY[locale];
  return copy[text.key].replace(/\{(\w+)\}/g, (_m, k: string) => {
    const value = text.vars[k];
    if (value !== undefined && value !== null && value !== '') return String(value);
    return k === 'title' ? copy.untitled : copy.someone;
  });
}

function asLocale(value: string | null | undefined): Locale | null {
  const short = value?.toLowerCase().slice(0, 2);
  return short === 'en' || short === 'es' || short === 'pt' ? short : null;
}

/** Idioma de la request en curso: la ruta, la página de origen, la cookie, el navegador. Fuera de una request, null. */
async function requestLocale(): Promise<Locale | null> {
  try {
    const { cookies, headers } = await import('next/headers');
    const h = await headers();
    const fromPath = /^(?:https?:\/\/[^/]+)?\/(en|es|pt)(?:[/?#]|$)/;
    for (const path of [h.get('x-zs-return-path'), h.get('referer')]) {
      const match = path ? fromPath.exec(path) : null;
      if (match) return match[1] as Locale;
    }
    return asLocale((await cookies()).get('NEXT_LOCALE')?.value) ?? asLocale(h.get('accept-language'));
  } catch {
    return null;
  }
}

export async function recipientLocale(userId: string): Promise<Locale> {
  const db = getDb();
  const own = (await db.prepare('SELECT locale FROM users WHERE id = ?').get(userId)) as { locale: string | null } | undefined;
  const mine = asLocale(own?.locale);
  if (mine) return mine;
  const owner = (await db
    .prepare(
      `SELECT u.locale FROM team_members m JOIN teams t ON t.id = m.team_id JOIN users u ON u.id = t.owner_id
       WHERE m.user_id = ? AND u.locale IS NOT NULL ORDER BY m.created_at LIMIT 1`,
    )
    .get(userId)) as { locale: string | null } | undefined;
  return asLocale(owner?.locale) ?? (await requestLocale()) ?? 'en';
}

/** Resuelve los textos de un aviso; solo busca el idioma si alguno lo necesita. */
export async function renderForRecipient(userId: string, texts: Array<NotificationText | undefined>): Promise<Array<string | undefined>> {
  if (texts.every((t) => t === undefined || typeof t === 'string')) return texts as Array<string | undefined>;
  const locale = await recipientLocale(userId);
  return texts.map((t) => (t === undefined || typeof t === 'string' ? t : renderLocalized(t, locale)));
}
