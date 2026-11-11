'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { api } from '../client';

/**
 * De qué sesiones hay grabación, para los links desde eventos en vivo. Pide las
 * que no conoce y, cada tanto, vuelve a mirar: los chunks llegan después que los
 * eventos. Si falla, sin link: no es lo principal de esa página.
 */
export function useSessionRecordings(projectId: string, events: ReadonlyArray<{ properties: Record<string, unknown> }>): Record<string, string> {
  const [found, setFound] = useState<Record<string, string>>({});
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      const s = e.properties.$session_id;
      if (typeof s === 'string' && s) set.add(s);
      if (set.size >= 100) break;
    }
    return [...set];
  }, [events]);
  const missing = ids.filter((s) => !found[s]).join(',');

  useEffect(() => {
    if (!missing) return;
    let gone = false;
    const look = async () => {
      try {
        const sp = new URLSearchParams({ project: projectId, ids: missing });
        const r = await api<{ recordings: Record<string, string> }>(`/api/analytics/replay/sessions?${sp}`);
        if (!gone && Object.keys(r.recordings).length) setFound((f) => ({ ...f, ...r.recordings }));
      } catch {
        // Sin link.
      }
    };
    void look();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void look();
    }, 20_000);
    return () => {
      gone = true;
      clearInterval(id);
    };
  }, [missing, projectId]);

  return found;
}

export function RecordingLink({ recordings, sessionId }: { recordings: Record<string, string>; sessionId: unknown }) {
  const t = useTranslations('analyticsReplay.recordings');
  const id = typeof sessionId === 'string' ? recordings[sessionId] : undefined;
  if (!id) return null;
  return (
    <Link href={`/app/pulse/replay/${id}`} className="an-link an-replay-eventlink" data-testid="an-event-recording">
      {t('watch')}
    </Link>
  );
}
