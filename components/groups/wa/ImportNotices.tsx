'use client';

import { useCallback, useEffect, useState } from 'react';
import { DONE_VISIBLE_MS, type ImportNotice } from '@/lib/wa-import-notice';
import { Close } from './icons';

function readClosed(storageKey: string): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(-50) : [];
  } catch {
    return [];
  }
}

/**
 * Los avisos de importación arriba de la lista de chats (Lines e Inbox). En
 * cualquier estado se pueden cerrar, y lo cerrado queda cerrado en este
 * navegador para esa importación (lib/wa-import-notice.ts, `key`). "Terminó"
 * se va solo a los pocos segundos de estar a la vista.
 */
export default function ImportNotices({
  notices,
  storageKey,
  text,
  closeLabel,
  progressLabel,
  testid,
}: {
  notices: ImportNotice[];
  storageKey: string;
  text: (n: ImportNotice) => string;
  closeLabel: string;
  progressLabel: string;
  testid: string;
}) {
  // null hasta leer el almacenamiento: no se muestra un aviso ya cerrado durante un instante al recargar.
  const [closed, setClosed] = useState<string[] | null>(null);
  useEffect(() => setClosed(readClosed(storageKey)), [storageKey]);

  const close = useCallback(
    (key: string) => {
      setClosed((cur) => {
        const next = [...(cur ?? []).filter((k) => k !== key), key].slice(-50);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* sin almacenamiento: queda cerrado en esta vista */
        }
        return next;
      });
    },
    [storageKey],
  );

  const shown = closed ? notices.filter((n) => !closed.includes(n.key)) : [];
  // "Terminó" se va solo, contando el tiempo que la pestaña estuvo a la vista (quien vuelve después llega a leerlo).
  const doneKeys = shown.filter((n) => n.tone === 'done').map((n) => n.key).join('|');
  useEffect(() => {
    if (!doneKeys) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState === 'visible') timer = setTimeout(() => doneKeys.split('|').forEach(close), DONE_VISIBLE_MS);
    };
    arm();
    document.addEventListener('visibilitychange', arm);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', arm);
    };
  }, [doneKeys, close]);

  return (
    <>
      {shown.map((n) => (
        <div key={n.id} className={`wa-import wa-import-notice${n.tone === 'bad' ? ' is-bad' : n.tone === 'done' ? ' is-done' : ''}`} role="status" data-testid={testid} data-kind={n.kind}>
          <div className="wa-import-main">
            <span>{text(n)}</span>
            {n.percent !== null && (
              <span className="wa-import-bar" role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={n.percent}>
                <i style={{ width: `${Math.max(3, n.percent)}%` }} />
              </span>
            )}
          </div>
          <button
            type="button"
            className="wa-icon-btn wa-import-close"
            onClick={() => close(n.key)}
            // Enter y Espacio son de este botón: los atajos de una tecla de la bandeja (Enter abre el chat marcado) no se los llevan.
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <Close size={16} />
          </button>
        </div>
      ))}
    </>
  );
}
