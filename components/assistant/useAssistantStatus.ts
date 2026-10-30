'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AssistantStatus } from './client';

/** Estado del asistente (configurado, herramientas de la sesión). Se pide al abrir. */
export function useAssistantStatus(enabled: boolean) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    const res = await fetch('/api/assistant').catch(() => null);
    const data = (await res?.json().catch(() => null)) as AssistantStatus | null;
    if (!res?.ok || !data) {
      setError(true);
      return;
    }
    setStatus(data);
  }, []);
  useEffect(() => {
    if (enabled && !status) void load();
  }, [enabled, status, load]);
  return { status, error, reload: load };
}

/** Sección de la app según el path (/app/crm/... → crm). */
export function sectionOf(pathname: string): string {
  const m = /^\/app\/([^/?#]+)/.exec(pathname);
  if (!m) return 'home';
  const seg = m[1];
  if (seg === 'links') return 'link';
  if (seg === 'calendar') return 'cal';
  if (seg === 'assistant') return 'home';
  return seg;
}

const SECTIONS = ['home', 'crm', 'track', 'docs', 'flow', 'robots', 'settings', 'cal', 'link', 'talk', 'voice', 'chat', 'groups', 'agents', 'notes', 'board', 'shop', 'analytics', 'hiring', 'people', 'books'] as const;

/** Preguntas sugeridas según la página (tres por sección, traducidas). */
export function useSuggestions(pathname: string): string[] {
  const t = useTranslations('assistant.suggest');
  const section = sectionOf(pathname);
  const key = (SECTIONS as readonly string[]).includes(section) ? section : 'home';
  return [t(`${key}.a`), t(`${key}.b`), t(`${key}.c`)];
}
