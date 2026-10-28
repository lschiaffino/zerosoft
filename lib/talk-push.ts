/**
 * Talk: push del navegador. Usa la misma suscripción y el mismo service
 * worker que Groups y Chat (lib/groups-push.ts, public/sw.js): el servidor
 * manda un push vacío con firma VAPID, el service worker pide los avisos
 * pendientes con la sesión y los muestra. El texto nunca pasa por el
 * servicio de push.
 *
 * El link del aviso termina en `&n=<id del mensaje>`: si el mensaje se borra
 * o la persona pierde acceso al canal antes de que el aviso se entregue,
 * purgeMessageNotifications / purgeChannelFor lo borran (lib/talk.ts).
 *
 * Configuración: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT. Sin
 * ellas no sale nada (la UI lo dice). Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { sendPush, vapidKeys } from './groups-push';

export async function talkPush(workspaceId: string, personId: string, n: { title: string; body: string; href: string; messageId: string }): Promise<number> {
  try {
    const keys = vapidKeys();
    if (!keys) return 0;
    const db = getDb();
    // La suscripción es del navegador de la persona (en el workspace donde la activó).
    const subs = (await db.prepare('SELECT id, endpoint, user_id FROM groups_push_subscriptions WHERE person_id = ?').all(personId)) as Array<{
      id: string;
      endpoint: string;
      user_id: string;
    }>;
    if (!subs.length) return 0;
    const href = n.href.startsWith('/app/talk/') ? n.href : '/app/talk';
    const url = `${href}${href.includes('?') ? '&' : '?'}w=${encodeURIComponent(workspaceId)}&n=${n.messageId}`;
    const now = new Date().toISOString();
    for (const owner of new Set(subs.map((s) => s.user_id))) {
      await db
        .prepare('INSERT INTO groups_notifications (id, user_id, person_id, chat_id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), owner, personId, null, n.title.slice(0, 120), n.body.slice(0, 240), url, now);
    }
    let sent = 0;
    for (const s of subs) {
      const r = await sendPush(s.endpoint, keys);
      if (r === 'gone') await db.prepare('DELETE FROM groups_push_subscriptions WHERE id = ?').run(s.id);
      else if (r === 'error') await db.prepare("UPDATE groups_push_subscriptions SET last_error = 'push_failed' WHERE id = ?").run(s.id);
      else sent++;
    }
    return sent;
  } catch (err) {
    console.error('[talk] push failed', (err as Error)?.name ?? 'error');
    return 0;
  }
}
