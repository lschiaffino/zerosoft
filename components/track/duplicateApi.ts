'use client';

import type { DuplicateMarkView } from '@/lib/track-duplicates';

/**
 * Llamadas de "Marcar como duplicado" (lib/track-duplicates). Las usan la
 * página del issue, las listas y la vista rápida, con el mismo ⌘Z.
 */
export type DuplicateCallResult = { ok: true; mark: DuplicateMarkView | null } | { ok: false; error: string };

async function call(issueId: string, init: RequestInit): Promise<DuplicateCallResult> {
  const res = await fetch(`/api/track/issues/${issueId}/duplicate-of`, init).catch(() => null);
  if (!res) return { ok: false, error: 'network' };
  const body = (await res.json().catch(() => null)) as { mark?: DuplicateMarkView | null; error?: string } | null;
  if (!res.ok) return { ok: false, error: body?.error ?? 'error' };
  return { ok: true, mark: body?.mark ?? null };
}

export function requestMarkDuplicate(issueId: string, originalId: string): Promise<DuplicateCallResult> {
  return call(issueId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalId }),
  });
}

export function requestUnmarkDuplicate(issueId: string): Promise<DuplicateCallResult> {
  return call(issueId, { method: 'DELETE' });
}
