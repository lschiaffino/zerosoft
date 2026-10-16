'use client';

import { useState } from 'react';

export interface BoardVoteLabels {
  upvote: string;
  voted: string;
  error: string;
  loginToVote: string;
}

/**
 * Voto del board (POST /api/board/items/:id/vote, toggle). Sin sesión, la
 * API responde 401 y se manda a login con vuelta a esta página.
 */
export default function BoardVote({
  id,
  votes: initialVotes,
  voted: initialVoted,
  closed = false,
  signedIn,
  loginHref,
  locale,
  labels,
  onChange,
}: {
  id: string;
  votes: number;
  voted: boolean;
  closed?: boolean;
  signedIn: boolean;
  loginHref: string;
  locale: string;
  labels: BoardVoteLabels;
  onChange?: (state: { votes: number; voted: boolean }) => void;
}) {
  const [votes, setVotes] = useState(initialVotes);
  const [voted, setVoted] = useState(initialVoted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (closed) {
    return (
      <span className="bp-vote bp-vote-static" aria-label={`${votes}`}>
        <span className="bp-vote-caret" aria-hidden="true" />
        <span className="bp-vote-count">{votes}</span>
      </span>
    );
  }

  async function toggle() {
    if (busy) return;
    if (!signedIn) {
      window.location.href = loginHref;
      return;
    }
    setBusy(true);
    setError(false);
    const next = !voted;
    // Optimista: se corrige con la respuesta del servidor.
    setVoted(next);
    setVotes((v) => v + (next ? 1 : -1));
    const res = await fetch(`/api/board/items/${encodeURIComponent(id)}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voted: next, locale }),
    }).catch(() => null);
    if (res?.status === 401) {
      window.location.href = loginHref;
      return;
    }
    const data = res?.ok ? ((await res.json().catch(() => null)) as { votes?: number; voted?: boolean } | null) : null;
    if (data && typeof data.votes === 'number' && typeof data.voted === 'boolean') {
      setVotes(data.votes);
      setVoted(data.voted);
      onChange?.({ votes: data.votes, voted: data.voted });
    } else {
      setVoted(!next);
      setVotes((v) => v + (next ? -1 : 1));
      setError(true);
    }
    setBusy(false);
  }

  const label = !signedIn ? labels.loginToVote : voted ? labels.voted : labels.upvote;
  return (
    <button
      type="button"
      className={`bp-vote${voted ? ' is-voted' : ''}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={voted}
      title={error ? labels.error : label}
      aria-label={`${label} (${votes})`}
    >
      <span className="bp-vote-caret" aria-hidden="true" />
      <span className="bp-vote-count">{votes}</span>
    </button>
  );
}
