'use client';

import { useEffect } from 'react';
import { NOTIFICATIONS_CHANGED_EVENT } from './NotificationBell';

/**
 * Una sola vez al caer en el inicio: qué cambió en el workspace del que la
 * persona salió y a quién preguntarle. Marcarlo leído lo saca para la próxima.
 */
export default function LostAccessNotice({ id, title, body }: { id: string; title: string; body: string | null }) {
  useEffect(() => {
    void fetch(`/api/notifications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: true }),
    })
      .then(() => window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT)))
      .catch(() => undefined);
  }, [id]);
  return (
    <div className="home-blocked" role="status" data-testid="home-lost-access">
      <p className="home-blocked-title">{title}</p>
      {body && <p className="home-blocked-body">{body}</p>}
    </div>
  );
}
