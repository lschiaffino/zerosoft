/**
 * La línea de la app de escritorio en los emails de avisos (Track y Talk):
 * esos avisos llegan como notificación del sistema en la app. Solo a quien no
 * la instaló, y nunca en emails de seguridad (códigos, links de ingreso) ni
 * en los que van a personas de afuera (invitados, clientes). Server-only.
 */
import { escapeHtml } from './email';
import { getDb } from './db';
import { siteUrl } from './board-urls';
import { desktopEmailUrl, lifecycleCopy } from './lifecycle/templates';
import type { LifecycleLocale } from './lifecycle/types';

/** Ya instaló la app de escritorio (lifecycle_events). Ante la duda, sí: no se ofrece. */
export async function hasDesktopApp(userId: string): Promise<boolean> {
  try {
    return Boolean(await getDb().prepare("SELECT 1 AS x FROM lifecycle_events WHERE user_id = ? AND event = 'desktop_installed'").get(userId));
  } catch {
    return true;
  }
}

export function desktopNotifyNote(locale: LifecycleLocale, origin = siteUrl()): { html: string; text: string } {
  const c = lifecycleCopy(locale).common.desktopNotify;
  const url = desktopEmailUrl(origin, locale);
  return {
    html: `${escapeHtml(c.text)} <a href="${escapeHtml(url)}" style="color:#888888;">${escapeHtml(c.link)}</a>`,
    text: `${c.text} ${c.link}: ${url}`,
  };
}

/** La nota para esta persona, o null si ya tiene la app. */
export async function desktopNoteFor(userId: string, locale: LifecycleLocale): Promise<{ html: string; text: string } | null> {
  return (await hasDesktopApp(userId)) ? null : desktopNotifyNote(locale);
}
