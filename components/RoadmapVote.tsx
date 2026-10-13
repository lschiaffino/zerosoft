'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'zs_roadmap_votes';

function readVoted(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function rememberVoted(id: string) {
  try {
    const list = readVoted();
    if (!list.includes(id)) localStorage.setItem(STORAGE_KEY, JSON.stringify([...list, id].slice(-500)));
  } catch {
    // sin storage: el servidor igual deduplica por IP
  }
}

/** Botón de upvote (POST /api/roadmap/:id/vote). El servidor cuenta un voto por IP. */
export default function RoadmapVote({
  id,
  votes: initialVotes,
  labels,
}: {
  id: string;
  votes: number;
  labels: { upvote: string; voted: string; error: string };
}) {
  const [votes, setVotes] = useState(initialVotes);
  const [voted, setVoted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (readVoted().includes(id)) setVoted(true);
  }, [id]);

  async function vote() {
    if (voted || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/roadmap/${encodeURIComponent(id)}/vote`, { method: 'POST' }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as { votes?: number } | null;
      if (typeof data?.votes === 'number') setVotes(data.votes);
      setVoted(true);
      rememberVoted(id);
    } else {
      setError(true);
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      className={`rm-vote${voted ? ' is-voted' : ''}`}
      onClick={vote}
      disabled={busy}
      aria-pressed={voted}
      title={error ? labels.error : voted ? labels.voted : labels.upvote}
      aria-label={`${voted ? labels.voted : labels.upvote} (${votes})`}
    >
      <span className="rm-vote-caret" aria-hidden="true" />
      <span className="rm-vote-count mono">{votes}</span>
      <span className="rm-vote-label">{voted ? labels.voted : labels.upvote}</span>
    </button>
  );
}
