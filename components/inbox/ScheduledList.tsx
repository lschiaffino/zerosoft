'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ScheduledDto, ThreadDto } from '@/lib/inbox/types';
import { api, longWhen } from './api';
import ScheduleDialog, { type ScheduleTarget } from './ScheduleDialog';

/** Programados agrupados por secuencia (en el orden de salida). */
export function groupScheduled(list: ScheduledDto[]): ScheduledDto[][] {
  const groups = new Map<string, ScheduledDto[]>();
  for (const s of list) groups.set(s.batchId, [...(groups.get(s.batchId) ?? []), s]);
  return [...groups.values()].map((g) => g.sort((a, b) => a.seq - b.seq)).sort((a, b) => a[0].sendAt.localeCompare(b[0].sendAt));
}

/**
 * Debajo de la conversación: lo que está programado para este chat. Una
 * secuencia de varios mensajes se ve junta, con la espera y el archivo de cada
 * uno; se edita, se manda ya o se cancela entera.
 */
export default function ScheduledList({
  thread,
  scheduled,
  connected,
  onChange,
  onError,
}: {
  thread: ThreadDto;
  scheduled: ScheduledDto[];
  connected: boolean;
  onChange: () => void;
  onError: (code: string) => void;
}) {
  const t = useTranslations('inbox.scheduled');
  const ts = useTranslations('inbox.schedule');
  const locale = useLocale();
  const [edit, setEdit] = useState<ScheduleTarget | null>(null);
  const [busy, setBusy] = useState('');
  if (!scheduled.length) return null;

  const run = async (g: ScheduledDto[], kind: 'send' | 'cancel') => {
    setBusy(g[0].batchId);
    const r = await api(`/api/inbox/scheduled/${g[0].id}${kind === 'cancel' ? '?all=1' : ''}`, { method: kind === 'send' ? 'POST' : 'DELETE' });
    setBusy('');
    if (!r.ok) onError(r.data.error ?? 'generic');
    onChange();
  };

  return (
    <>
      <ul className="ib-scheduled" aria-label={t('title')}>
        {groupScheduled(scheduled).map((g) => {
          const head = g[0];
          const bad = g.some((s) => s.status === 'failed' || s.status === 'missed');
          const sending = g.some((s) => s.status === 'sending');
          const status = g.find((s) => s.status === 'failed' || s.status === 'missed')?.status ?? head.status;
          return (
            <li key={head.batchId} className={`ib-sched${bad ? ' is-bad' : ''}${g.length > 1 ? ' is-batch' : ''}`}>
              <span className="ib-sched-when">
                {status === 'pending' || status === 'sending' ? t('at', { when: longWhen(head.sendAt, locale) }) : t(`status.${status}`)}
                {g.length > 1 && <span className="ib-sched-count">{ts('count', { n: g.length })}</span>}
              </span>
              <ol className="ib-sched-parts">
                {g.map((s, i) => (
                  <li key={s.id} className="ib-sched-part">
                    {i > 0 && s.delaySec > 0 && <span className="ib-tag">{ts('after', { wait: ts(`delayShort.${shortDelay(s.delaySec)}`, { n: delayN(s.delaySec) }) })}</span>}
                    {s.mediaName && <span className="ib-tag">{ts('file', { name: s.mediaName })}</span>}
                    <span className="ib-sched-body">{s.body}</span>
                  </li>
                ))}
              </ol>
              <span className="ib-row">
                <button type="button" className="btn btn-ghost btn-sm" disabled={sending || busy === head.batchId} onClick={() => setEdit({ threadId: thread.id, channel: thread.channel, edit: g })}>
                  {ts('edit')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(g, 'send')} disabled={!connected || sending || busy === head.batchId}>
                  {t('sendNow')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(g, 'cancel')} disabled={sending || busy === head.batchId}>
                  {t('cancel')}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <ScheduleDialog
        target={edit}
        onClose={() => setEdit(null)}
        onDone={() => {
          setEdit(null);
          onChange();
        }}
      />
    </>
  );
}

/** Unidad para mostrar una espera: s, min, h o días. */
export function shortDelay(sec: number): 's' | 'm' | 'h' | 'd' {
  if (sec < 60) return 's';
  if (sec < 3600) return 'm';
  if (sec < 86_400) return 'h';
  return 'd';
}

export function delayN(sec: number): number {
  const u = shortDelay(sec);
  return Math.round(sec / (u === 's' ? 1 : u === 'm' ? 60 : u === 'h' ? 3600 : 86_400));
}
