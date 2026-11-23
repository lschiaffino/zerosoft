'use client';

import type { DuplicateMarkView } from '@/lib/track-duplicates';

/**
 * Llamadas de "Marcar como duplicado" (lib/track-duplicates). Las usan la
 * página del issue, las listas y la vista rápida, con el mismo ⌘Z.
 */
export type DuplicateCallResult =
  | { ok: true; mark: DuplicateMarkView | null; /** La marca cambió de original: ⌘Z vuelve a este. */ previousOriginalId: string | null }
  | { ok: false; error: string };

async function call(issueId: string, init: RequestInit): Promise<DuplicateCallResult> {
  const res = await fetch(`/api/track/issues/${issueId}/duplicate-of`, init).catch(() => null);
  if (!res) return { ok: false, error: 'network' };
  const body = (await res.json().catch(() => null)) as { mark?: DuplicateMarkView | null; previousOriginalId?: string | null; error?: string } | null;
  if (!res.ok) return { ok: false, error: body?.error ?? 'error' };
  return { ok: true, mark: body?.mark ?? null, previousOriginalId: body?.previousOriginalId ?? null };
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

/** La marca vigente del issue (para el banner después de cambios de otros). */
export async function fetchDuplicateMark(issueId: string): Promise<DuplicateMarkView | null | undefined> {
  const res = await fetch(`/api/track/issues/${issueId}/duplicate-of`).catch(() => null);
  if (!res?.ok) return undefined;
  return ((await res.json().catch(() => null)) as { mark?: DuplicateMarkView | null } | null)?.mark ?? null;
}

/**
 * ⌘Z de una marca: si cambió de original vuelve al de antes; si no, la quita.
 * (Volver a marcar el anterior repone lo que la marca nueva le sacó.)
 */
export function undoMarkDuplicate(issueId: string, previousOriginalId: string | null): Promise<DuplicateCallResult> {
  return previousOriginalId ? requestMarkDuplicate(issueId, previousOriginalId) : requestUnmarkDuplicate(issueId);
}
