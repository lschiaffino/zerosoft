'use client';

import { useState } from 'react';

/** Seguir / dejar de seguir un ítem (emails cuando cambia de estado). */
export default function BoardSubscribe({
  itemId,
  initial,
  signedIn,
  loginHref,
  locale,
  labels,
}: {
  itemId: string;
  initial: boolean;
  signedIn: boolean;
  loginHref: string;
  locale: string;
  labels: { subscribe: string; unsubscribe: string; hint: string };
}) {
  const [subscribed, setSubscribed] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!signedIn) {
      window.location.href = loginHref;
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/board/items/${encodeURIComponent(itemId)}/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscribed: !subscribed, locale }),
    }).catch(() => null);
    if (res?.ok) setSubscribed(!subscribed);
    setBusy(false);
  }

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-small" onClick={toggle} disabled={busy} aria-pressed={subscribed}>
        {subscribed ? labels.unsubscribe : labels.subscribe}
      </button>
      <p className="bp-hint bp-subscribe-hint">
        {labels.hint}
      </p>
    </div>
  );
}
