'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImportJobDto } from '@/lib/inbox/import-jobs';
import { api, notifyInboxChanged } from './api';

const ACTIVE = new Set(['running', 'waiting']);
const SEEN_KEY = 'zs:inbox-import-seen';

function seenIds(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * El avance de la importación de WhatsApp o Gmail arriba de la lista, como en
 * Lines: mientras corre, cuántos chats van; al terminar, un aviso que se
 * cierra. Lee lo mismo que Ajustes › Importar (/api/inbox/import).
 */
export default function ImportBanner() {
  const t = useTranslations('inbox.list');
  const [jobs, setJobs] = useState<ImportJobDto[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const wasActive = useRef(new Set<string>());

  useEffect(() => {
    setSeen(seenIds());
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const r = await api<{ imports: ImportJobDto[] }>('/api/inbox/import');
      if (stop) return;
      const list = r.ok ? r.data.imports.filter((j) => j.kind === 'whatsapp' || j.kind === 'gmail') : [];
      setJobs(list);
      // Lo que terminó mientras se miraba: la lista se actualiza sola.
      for (const j of list) {
        if (ACTIVE.has(j.status)) wasActive.current.add(j.id);
        else if (wasActive.current.delete(j.id)) notifyInboxChanged();
      }
      const busy = list.some((j) => ACTIVE.has(j.status));
      timer = setTimeout(() => void load(), busy ? 4000 : 60_000);
    };
    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const close = (id: string) => {
    const next = [...seen, id].slice(-20);
    setSeen(next);
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      /* sin storage: se cierra solo por ahora */
    }
  };

  // Solo lo que corre y lo que terminó hace poco (menos de un día) sin cerrar.
  const fresh = (j: ImportJobDto) => j.finishedAt && Date.now() - Date.parse(j.finishedAt) < 86_400_000;
  const shown = jobs.filter((j) => ACTIVE.has(j.status) || (j.status === 'done' && fresh(j) && !seen.includes(j.id)));
  if (!shown.length) return null;
  return (
    <>
      {shown.map((j) => {
        const p = j.progress;
        const done = p.chatsDone ?? 0;
        const total = Math.max(p.chats ?? 0, done);
        const active = ACTIVE.has(j.status);
        const text = !active
          ? t(j.kind === 'gmail' ? 'importDoneGmail' : 'importDone', { chats: total, messages: p.messages ?? 0 })
          : j.status === 'waiting' && !total
            ? t('importWaiting')
            : t(j.kind === 'gmail' ? 'importGmail' : 'importWa', { done, total });
        return (
          <div key={j.id} className={`wa-import${active ? '' : ' is-done'}`} role="status" data-testid="inbox-import-banner">
            <span>{text}</span>
            {active && (
              <span className="wa-import-bar" role="progressbar" aria-label={t('importProgress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={total ? Math.round((done / total) * 100) : 0}>
                <i style={{ width: `${total ? Math.max(3, (done / total) * 100) : 3}%` }} />
              </span>
            )}
            {!active && (
              <button type="button" className="wa-icon-btn wa-import-close" onClick={() => close(j.id)} aria-label={t('importClose')} title={t('importClose')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
