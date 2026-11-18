'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LocalText from '@/components/ui/LocalText';
import type { GroupsPerson } from '@/lib/groups';
import type { AssignmentEventDto } from '@/lib/groups-assignments';
import { parseDbUtc } from '@/lib/utils';
import { useRelativeTime } from './relative-time';
import { api, useErrorText } from './ui';

const SHOWN = 5;

/**
 * Historial de asignaciones del chat en el panel de detalles: lista compacta
 * (de quién a quién, por qué y cuándo), las últimas cinco y "ver todas".
 * `version` cambia cuando cambia la persona asignada: se vuelve a pedir.
 */
export default function AssignmentHistory({ chatId, people, version }: { chatId: string; people: GroupsPerson[]; version: string }) {
  const t = useTranslations('groups.assignHistory');
  const locale = useLocale();
  const ago = useRelativeTime();
  const errText = useErrorText();
  const [events, setEvents] = useState<AssignmentEventDto[] | null>(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ events: AssignmentEventDto[] }>(`/api/groups/assignments?chat=${encodeURIComponent(chatId)}`);
    if (res.data) {
      setEvents(res.data.events);
      setError('');
    } else setError(errText(res.error));
  }, [chatId, errText]);

  useEffect(() => {
    setAll(false);
  }, [chatId]);
  useEffect(() => {
    void load();
  }, [load, version]);

  const nameOf = (id: string | null) => {
    if (!id) return t('nobody');
    const p = people.find((x) => x.id === id);
    return p ? p.name || p.email : t('someone');
  };
  const describe = (e: AssignmentEventDto) => {
    if (e.reason === 'auto') return t('auto', { to: nameOf(e.to), rule: e.rule ?? '' });
    if (e.reason === 'offline') return t('offline', { from: nameOf(e.from), to: nameOf(e.to), rule: e.rule ?? '' });
    if (!e.to) return t('removed', { by: nameOf(e.actorId) });
    if (e.actorId && e.actorId === e.to) return t('took', { by: nameOf(e.actorId) });
    return t('manual', { by: nameOf(e.actorId), to: nameOf(e.to) });
  };

  const list = events ?? [];
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <section className="gr-detail-section" aria-labelledby={`gr-assign-history-${chatId}`} data-testid="assign-history">
      <h3 className="gr-detail-title" id={`gr-assign-history-${chatId}`}>
        {t('title')}
      </h3>
      {error ? (
        <p className="ui-error" role="alert">
          {error}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            {t('retry')}
          </button>
        </p>
      ) : events === null ? (
        <p className="ui-help" aria-busy="true">
          {t('loading')}
        </p>
      ) : list.length === 0 ? (
        <p className="ui-help" data-testid="assign-history-empty">
          {t('empty')}
        </p>
      ) : (
        <>
          <ol className="gr-assign-history">
            {shown.map((e) => (
              <li key={e.id} data-testid="assign-history-item" data-reason={e.reason}>
                <i className={`gr-assign-reason is-${e.reason}`} aria-hidden="true" />
                <span className="gr-assign-text">{describe(e)}</span>
                <time
                  className="ui-help"
                  dateTime={e.createdAt}
                  title={parseDbUtc(e.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                >
                  <LocalText>{ago(e.createdAt)}</LocalText>
                </time>
              </li>
            ))}
          </ol>
          {list.length > SHOWN && (
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="assign-history-more">
              {all ? t('less') : t('more', { n: list.length - SHOWN })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
