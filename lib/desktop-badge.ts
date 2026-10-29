/**
 * Contador del dock / barra de tareas de la app de escritorio y avisos
 * nuevos para mostrar como notificación del sistema. Server-only.
 *
 * total = Talk (menciones y DMs/grupos sin leer, como el ícono de Slack)
 *       + campana (avisos sin leer de las otras apps).
 * Los avisos de Talk también están en la campana: ahí se cuentan una sola
 * vez (en Talk) y la campana excluye /app/talk.
 */
import { getDb } from './db';
import { countUnreadNotifications } from './notifications';
import { appFromPath, userCanUseApp } from './workspace';
import { PRODUCT_CONFIG, type ProductKey } from './products';
import { realUserId, type SessionUser } from './session';
import { listMyChannels } from './talk';
import { resolveTalkActor } from './talk-guests';

export interface DesktopBadge {
  total: number;
  talk: number;
  bell: number;
  notifications: Array<{ id: string; title: string; body: string | null; href: string | null; createdAt: string }>;
  now: string;
}

/** Menciones + conversaciones directas con algo sin leer. */
export function talkBadgeCount(channels: Array<{ kind: string; unread: boolean; mentions: number }>): number {
  let n = 0;
  for (const c of channels) {
    const direct = c.kind === 'dm' || c.kind === 'group';
    n += direct && c.unread ? Math.max(c.mentions, 1) : c.mentions;
  }
  return n;
}

function hiddenAppPaths(user: SessionUser): string[] {
  if (!user.actingUser) return [];
  return (Object.keys(PRODUCT_CONFIG) as ProductKey[]).filter((k) => !userCanUseApp(user, k)).map((k) => PRODUCT_CONFIG[k].launch);
}

export async function desktopBadge(user: SessionUser, since: string | null): Promise<DesktopBadge> {
  const userId = realUserId(user);
  const hide = hiddenAppPaths(user);
  const now = new Date().toISOString();
  let talk = 0;
  if (userCanUseApp(user, 'talk')) {
    try {
      const actor = await resolveTalkActor(user);
      talk = talkBadgeCount(await listMyChannels(actor));
    } catch {
      talk = 0;
    }
  }
  const bell = await countUnreadNotifications(userId, { hidePaths: [...hide, '/app/talk'] });
  // Avisos nuevos desde la última consulta (como mucho 10); sin `since`, los de los últimos 2 minutos.
  const from = since && !Number.isNaN(Date.parse(since)) ? new Date(Date.parse(since)).toISOString() : new Date(Date.now() - 2 * 60_000).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, body, href, created_at FROM notifications
       WHERE user_id = ? AND read_at IS NULL AND created_at > ? AND (snoozed_until IS NULL OR snoozed_until <= ?)
       ORDER BY created_at DESC LIMIT 10`,
    )
    .all(userId, from, now)) as Array<{ id: string; title: string; body: string | null; href: string | null; created_at: string }>;
  const notifications = rows
    .filter((r) => {
      const app = appFromPath(r.href);
      return !app || userCanUseApp(user, app);
    })
    .map((r) => ({ id: r.id, title: r.title, body: r.body, href: r.href, createdAt: r.created_at }));
  return { total: talk + bell, talk, bell, notifications, now };
}
