'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { GroupsPerson } from '@/lib/groups';
import type { TicketDto } from '@/lib/groups-tickets';
import { api, useErrorText, useRelativeTime, useToast } from './ui';

const STATUS_FILTERS = ['active', 'open', 'in_progress', 'resolved', 'closed', 'all'] as const;

/** Tickets de los chats: filtros, y estado, prioridad y asignado editables en la fila. */
export default function TicketsBoard({ initial, people, me, openId }: { initial: TicketDto[]; people: GroupsPerson[]; me: string; openId: string | null }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const rel = useRelativeTime();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [tickets, setTickets] = useState<TicketDto[] | null>(initial);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('active');
  const [assignee, setAssignee] = useState('');
  const [breached, setBreached] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);
  const [first, setFirst] = useState(true);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ status });
    if (assignee) p.set('assignee', assignee);
    if (breached) p.set('breached', '1');
    if (q.trim()) p.set('q', q.trim());
    const res = await api<{ tickets: TicketDto[] }>(`/api/groups/tickets?${p}`);
    if (res.data) {
      setTickets(res.data.tickets);
      setError(false);
    } else setError(true);
  }, [status, assignee, breached, q]);

  useEffect(() => {
    if (first) {
      setFirst(false);
      return;
    }
    const id = setTimeout(() => void load(), 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    if (openId) document.getElementById(`t-${openId}`)?.scrollIntoView({ block: 'center' });
  }, [openId]);

  async function update(id: string, body: Record<string, unknown>) {
    const res = await api<TicketDto>(`/api/groups/tickets/${id}`, { method: 'PATCH', body });
    if (res.data) setTickets((list) => (list ?? []).map((x) => (x.id === id ? (res.data as TicketDto) : x)));
    else showToast(errText(res.error), true);
  }

  return (
    <>
      <div className="gr-toolbar">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tickets.search')} aria-label={t('tickets.search')} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUS_FILTERS)[number])} aria-label={t('tickets.status')}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`tickets.filter.${s}`)}
            </option>
          ))}
        </select>
        <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={t('tickets.assignee')}>
          <option value="">{t('tickets.anyone')}</option>
          <option value="me">{t('tickets.mine')}</option>
          <option value="none">{t('thread.unassigned')}</option>
        </select>
        <label className="gr-check-label">
          <input type="checkbox" className="ui-check" checked={breached} onChange={(e) => setBreached(e.target.checked)} />
          {t('tickets.onlyBreached')}
        </label>
        <span className="gr-toolbar-spacer" />
        <a className="btn btn-secondary" href={`/api/groups/export?type=tickets`}>
          {t('common.exportCsv')}
        </a>
      </div>
      {error && (
        <div className="gr-error" role="alert">
          {t('tickets.loadError')}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {tickets === null ? (
        <div className="ui-skeleton ui-skeleton-block" aria-busy="true" />
      ) : tickets.length === 0 ? (
        <EmptyState quiet title={t('tickets.emptyTitle')} body={t('tickets.emptyBody')} product="groups" />
      ) : (
        <div className="table-wrap">
          <table className="table gr-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{t('tickets.title')}</th>
                <th>{t('tickets.status')}</th>
                <th>{t('tickets.priority')}</th>
                <th className="gr-hide-sm">{t('tickets.assignee')}</th>
                <th className="gr-hide-sm">{t('tickets.due')}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((tk) => (
                <tr key={tk.id} id={`t-${tk.id}`} className={tk.id === openId ? 'gr-row-target' : undefined}>
                  <td className="num">{tk.number}</td>
                  <td>
                    <div className="gr-ticket-title">
                      {tk.chatId ? (
                        <Link href={`/app/groups/inbox/${tk.chatId}${tk.messageId ? `#m-${tk.messageId}` : ''}`}>{tk.title}</Link>
                      ) : (
                        <span>{tk.title}</span>
                      )}
                      <span className="ui-help">
                        {tk.chatName} · {t(`tickets.source.${tk.source}`)} · {rel(tk.createdAt)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <select className="select" value={tk.status} onChange={(e) => void update(tk.id, { status: e.target.value })} aria-label={t('tickets.status')}>
                      {['open', 'in_progress', 'resolved', 'closed'].map((s) => (
                        <option key={s} value={s}>
                          {t(`ticketStatus.${s}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="select" value={tk.priority} onChange={(e) => void update(tk.id, { priority: e.target.value })} aria-label={t('tickets.priority')}>
                      {['low', 'medium', 'high', 'urgent'].map((p) => (
                        <option key={p} value={p}>
                          {t(`priority.${p}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="gr-hide-sm">
                    <select
                      className="select"
                      value={tk.assigneeId ?? ''}
                      onChange={(e) => void update(tk.id, { assigneeId: e.target.value || null })}
                      aria-label={t('tickets.assignee')}
                    >
                      <option value="">{t('thread.unassigned')}</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id === me ? t('tickets.me', { name: p.name || p.email }) : p.name || p.email}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="gr-hide-sm">
                    {tk.status === 'resolved' || tk.status === 'closed' ? (
                      <span className="ui-help">{tk.resolvedAt ? t('tickets.resolvedAt', { time: rel(tk.resolvedAt) }) : ''}</span>
                    ) : tk.breached ? (
                      <span className="badge badge-bad">{t('tickets.breached')}</span>
                    ) : tk.dueAt ? (
                      <span className="ui-help">{new Date(tk.dueAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toast}
    </>
  );
}
