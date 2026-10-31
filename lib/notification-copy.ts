/**
 * Texto de un aviso en el idioma de quien lo recibe, al guardarlo. Es para los
 * avisos que la bandeja muestra tal cual; los que arma al mostrarlos están en
 * lib/notification-text.ts. Sin users.locale vale el del workspace y después el
 * de la página de la app desde la que se disparó (nunca el de un visitante).
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

/**
 * Idioma de la página de la app desde la que alguien con sesión disparó el aviso.
 * Un checkout público, un webhook o un cron no cuentan: el navegador de un cliente
 * no elige el idioma de los avisos del equipo. Fuera de una request, null.
 */
async function inAppRequestLocale(): Promise<Locale | null> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const fromApp = /^(?:https?:\/\/[^/]+)?\/(en|es|pt)\/app(?:[/?#]|$)/;
    let locale: Locale | null = null;
    for (const path of [h.get('x-zs-return-path'), h.get('referer')]) {
      const match = path ? fromApp.exec(path) : null;
      if (match) {
        locale = match[1] as Locale;
        break;
      }
    }
    if (!locale) return null;
    const { getCurrentUser } = await import('./session');
    return (await getCurrentUser()) ? locale : null;
  } catch {
    return null;
  }
}

/** Idioma del workspace de la persona: el de quien lo creó y, si no lo eligió, el del primer miembro que sí. */
async function workspaceLocale(userId: string): Promise<Locale | null> {
  const db = getDb();
  const owner = (await db
    .prepare(
      `SELECT u.locale FROM teams t JOIN users u ON u.id = t.owner_id
       WHERE u.locale IS NOT NULL AND (t.owner_id = ? OR t.id IN (SELECT team_id FROM team_members WHERE user_id = ?))
       ORDER BY t.created_at LIMIT 1`,
    )
    .get(userId, userId)) as { locale: string | null } | undefined;
  if (asLocale(owner?.locale)) return asLocale(owner?.locale);
  const member = (await db
    .prepare(
      `SELECT u.locale FROM team_members m JOIN users u ON u.id = m.user_id
       WHERE u.locale IS NOT NULL AND m.team_id IN (
         SELECT team_id FROM team_members WHERE user_id = ? UNION SELECT id FROM teams WHERE owner_id = ?
       ) ORDER BY m.created_at LIMIT 1`,
    )
    .get(userId, userId)) as { locale: string | null } | undefined;
  return asLocale(member?.locale);
}

export async function recipientLocale(userId: string): Promise<Locale> {
  const own = (await getDb().prepare('SELECT locale FROM users WHERE id = ?').get(userId)) as { locale: string | null } | undefined;
  return asLocale(own?.locale) ?? (await workspaceLocale(userId)) ?? (await inAppRequestLocale()) ?? 'en';
}

/** Resuelve los textos de un aviso; solo busca el idioma si alguno lo necesita. */
export async function renderForRecipient(userId: string, texts: Array<NotificationText | undefined>): Promise<Array<string | undefined>> {
  if (texts.every((t) => t === undefined || typeof t === 'string')) return texts as Array<string | undefined>;
  const locale = await recipientLocale(userId);
  return texts.map((t) => (t === undefined || typeof t === 'string' ? t : renderLocalized(t, locale)));
}
