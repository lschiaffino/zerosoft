'use client';

import { useEffect, useRef, useState } from 'react';
import TrackIcon from './TrackIcon';

interface IssueSubscriptionProps {
  issueId: string;
  initialSubscribed: boolean;
  /** Cambia cuando hay actividad nueva (comentar o asignarse suscribe solo): se vuelve a leer. */
  refreshKey?: number;
  labels: {
    subscribe: string;
    unsubscribe: string;
    subscribed: string;
    notSubscribed: string;
    error: string;
  };
}

/** Suscribirse o darse de baja de los avisos del issue (bandeja de Track). */
export default function IssueSubscription({
  issueId,
  initialSubscribed,
  refreshKey,
  labels,
  compact = false,
  apiRef,
}: IssueSubscriptionProps & {
  /** Solo la campana (header del issue, como Linear). */
  compact?: boolean;
  /** Para ⌘K ("Subscribe to issue") y el atajo ⇧S. */
  apiRef?: { current: { subscribed: boolean; toggle: () => void } | null };
}) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let alive = true;
    void fetch(`/api/track/issues/${issueId}/subscription`)
      .then((res) => (res.ok ? (res.json() as Promise<{ subscribed: boolean }>) : null))
      .then((data) => {
        if (alive && data) setSubscribed(data.subscribed);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [issueId, refreshKey]);

  async function toggle() {
    const next = !subscribed;
    setBusy(true);
    setError(false);
    setSubscribed(next);
    const res = await fetch(`/api/track/issues/${issueId}/subscription`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed: next }),
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { subscribed: boolean };
      setSubscribed(data.subscribed);
    } else {
      setSubscribed(!next);
      setError(true);
    }
    setBusy(false);
  }

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { subscribed, toggle: () => void toggleRef.current() };
  }, [apiRef, subscribed]);

  return (
    <>
      <button
        type="button"
        className={compact ? `btn btn-ghost btn-icon track-head-icon${subscribed ? ' is-on' : ''}` : 'btn'}
        aria-busy={busy || undefined}
        aria-pressed={compact ? subscribed : undefined}
        aria-label={compact ? (subscribed ? labels.unsubscribe : labels.subscribe) : undefined}
        disabled={busy}
        onClick={() => void toggle()}
        title={subscribed ? labels.subscribed : labels.notSubscribed}
        data-testid="track-issue-subscribe"
      >
        <TrackIcon name="bell" />
        {!compact && (subscribed ? labels.unsubscribe : labels.subscribe)}
      </button>
      <span className="sr-only" role="status">
        {error ? labels.error : ''}
      </span>
    </>
  );
}
