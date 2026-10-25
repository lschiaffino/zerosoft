'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IssueSlaDto } from '@/lib/track-sla';
import type { CustomerRequestDto } from '@/lib/track-customers';
import type { AgentOption, AgentSessionDto } from '@/lib/track-agents';
import type { TriageSuggestion } from '@/lib/track-ai';

/** fetch JSON con { error } en los fallos (código de la API, o 'network'). */
export async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  }).catch(() => null);
  if (!res) return { ok: false, error: 'network' };
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) return { ok: false, error: typeof data?.error === 'string' ? data.error : 'error' };
  return { ok: true, data };
}

/** Clave de texto para un error de IA (ai.disabled, ai.quota…) o el genérico que se pase. */
export function aiErrorKey(code: string, fallback: string): string {
  if (code === 'ai_disabled') return 'ai.disabled';
  if (code === 'quota_exceeded') return 'ai.quota';
  if (code === 'rate_limited') return 'ai.rateLimited';
  return fallback;
}

export interface IssueInsights {
  sla: IssueSlaDto | null;
  slaEnabled: boolean;
  requests: CustomerRequestDto[];
  sessions: AgentSessionDto[];
  agents: AgentOption[];
  summary: { summary: string; generatedAt: string | null };
  suggestions: TriageSuggestion[];
  aiAvailable: boolean;
}

// Una sola carga por issue para los bloques del detalle (columna y panel lateral).
const cache = new Map<string, IssueInsights>();
const EVENT = 'track-insights-changed';

export function useIssueInsights(issueId: string) {
  const [data, setData] = useState<IssueInsights | null>(() => cache.get(issueId) ?? null);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    const res = await call<IssueInsights>(`/api/track/issues/${issueId}/insights`);
    if (res.ok) {
      cache.set(issueId, res.data);
      setError(false);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: issueId }));
    } else setError(true);
  }, [issueId]);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === issueId) setData(cache.get(issueId) ?? null);
    };
    window.addEventListener(EVENT, on);
    if (!cache.has(issueId)) void reload();
    else setData(cache.get(issueId) ?? null);
    return () => window.removeEventListener(EVENT, on);
  }, [issueId, reload]);

  const patch = useCallback(
    (fn: (prev: IssueInsights) => IssueInsights) => {
      const prev = cache.get(issueId);
      if (!prev) return;
      cache.set(issueId, fn(prev));
      window.dispatchEvent(new CustomEvent(EVENT, { detail: issueId }));
    },
    [issueId],
  );

  return { data, error, reload, patch };
}
