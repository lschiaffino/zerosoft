'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { GroupsPerson, PropertyDef } from '@/lib/groups';
import type { TicketDto } from '@/lib/groups-tickets';
import PropertyInput, { PropertyValueText, filterOptions } from './PropertyInput';
import { Modal, api, useErrorText, useRelativeTime, useToast } from './ui';

const STATUS_FILTERS = ['active', 'open', 'in_progress', 'resolved', 'closed', 'all'] as const;

/**
 * Tickets de los chats: filtros (también por campo propio), y estado,
 * prioridad y asignado editables en la fila. Los campos propios se editan
 * en el ticket (clic en el título del panel o "Campos"); los obligatorios
 * se piden al resolver o cerrar.
 */
export default function TicketsBoard({
  initial,
  people,
  me,
  openId,
  fields = [],
}: {
  initial: TicketDto[];
  people: GroupsPerson[];
  me: string;
  openId: string | null;
  fields?: PropertyDef[];
}) {
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
  const [fieldKey, setFieldKey] = useState('');
  const [fieldValue, setFieldValue] = useState('');
  const [editing, setEditing] = useState<{ ticket: TicketDto; status?: string } | null>(null);
  const fieldDef = fields.find((f) => f.key === fieldKey) ?? null;
  const shownFields = fields.slice(0, 2);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ status });
    if (assignee) p.set('assignee', assignee);
    if (breached) p.set('breached', '1');
    if (q.trim()) p.set('q', q.trim());
    if (fieldKey) p.set('fields', JSON.stringify([fieldValue ? { key: fieldKey, op: 'is', value: fieldValue } : { key: fieldKey, op: 'set' }]));
    const res = await api<{ tickets: TicketDto[] }>(`/api/groups/tickets?${p}`);
    if (res.data) {
      setTickets(res.data.tickets);
      setError(false);
    } else setError(true);
  }, [status, assignee, breached, q, fieldKey, fieldValue]);

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
    if (res.data) {
      setTickets((list) => (list ?? []).map((x) => (x.id === id ? (res.data as TicketDto) : x)));
      return true;
    }
    // Faltan campos obligatorios para resolver o cerrar: se abre el ticket para completarlos.
    const tk = (tickets ?? []).find((x) => x.id === id);
    if (res.error.startsWith('missing_fields') && tk) {
      setEditing({ ticket: tk, status: typeof body.status === 'string' ? body.status : undefined });
      showToast(errText('missing_fields'), true);
    } else showToast(errText(res.error), true);
    return false;
  }

  const exportQuery = (() => {
    const p = new URLSearchParams({ type: 'tickets', status });
    if (assignee) p.set('assignee', assignee);
    if (breached) p.set('breached', '1');
    if (q.trim()) p.set('q', q.trim());
    if (fieldKey) p.set('fields', JSON.stringify([fieldValue ? { key: fieldKey, op: 'is', value: fieldValue } : { key: fieldKey, op: 'set' }]));
    return p.toString();
  })();

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
        {fields.length > 0 && (
          <select
            className="select"
            value={fieldKey}
            onChange={(e) => {
              setFieldKey(e.target.value);
              setFieldValue('');
            }}
            aria-label={t('ticketFields.filter')}
          >
            <option value="">{t('ticketFields.anyField')}</option>
            {fields.map((f) => (
              <option key={f.id} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        )}
        {fieldDef &&
          (filterOptions(fieldDef).length > 0 ? (
            <select className="select" value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} aria-label={t('lists.propertyValue')}>
              <option value="">{t('lists.hasValue')}</option>
              {filterOptions(fieldDef).map((o) => (
                <option key={o} value={o}>
                  {o === 'true' && fieldDef.type === 'checkbox' ? t('props.yes') : o}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} placeholder={t('lists.hasValue')} aria-label={t('lists.propertyValue')} />
          ))}
        <span className="gr-toolbar-spacer" />
        <a className="btn btn-secondary" href={`/api/groups/export?${exportQuery}`}>
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
          <table className="table gr-table gr-tickets-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{t('tickets.title')}</th>
                <th>{t('tickets.status')}</th>
                <th>{t('tickets.priority')}</th>
                <th className="gr-hide-sm">{t('tickets.assignee')}</th>
                <th className="gr-hide-sm">{t('tickets.due')}</th>
                {shownFields.map((f) => (
                  <th key={f.id} className="gr-hide-sm">
                    {f.label}
                  </th>
                ))}
                {fields.length > 0 && (
                  <th>
                    <span className="sr-only">{t('ticketFields.title')}</span>
                  </th>
                )}
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
                  {shownFields.map((f) => (
                    <td key={f.id} className="gr-hide-sm">
                      <PropertyValueText def={f} value={tk.fields[f.key]} />
                    </td>
                  ))}
                  {fields.length > 0 && (
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ ticket: tk })} aria-label={t('ticketFields.editAria', { n: tk.number })}>
                        {t('ticketFields.edit')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TicketFieldsModal
        state={editing}
        fields={fields}
        onClose={() => setEditing(null)}
        onSave={async (values, nextStatus) => {
          if (!editing) return;
          const ok = await update(editing.ticket.id, { fields: values, ...(nextStatus ? { status: nextStatus } : {}) });
          if (ok) {
            setEditing(null);
            showToast(t('common.saved'));
          }
        }}
      />
      {toast}
    </>
  );
}

/** Campos propios de un ticket. Si viene `status`, se guarda junto (resolver con los obligatorios completos). */
function TicketFieldsModal({
  state,
  fields,
  onClose,
  onSave,
}: {
  state: { ticket: TicketDto; status?: string } | null;
  fields: PropertyDef[];
  onClose: () => void;
  onSave: (values: Record<string, unknown>, status?: string) => Promise<void>;
}) {
  const t = useTranslations('groups');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (state) setValues({ ...state.ticket.fields });
  }, [state]);
  return (
    <Modal
      open={!!state}
      wide
      title={state ? t('ticketFields.modalTitle', { n: state.ticket.number, title: state.ticket.title }) : ''}
      onClose={onClose}
      busy={busy}
      onSubmit={async () => {
        setBusy(true);
        await onSave(values, state?.status);
        setBusy(false);
      }}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
            {state?.status ? t('ticketFields.saveAnd', { status: t(`ticketStatus.${state.status}`) }) : t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {state?.status && <p className="gr-banner is-warn">{t('ticketFields.requiredBanner')}</p>}
        <div className="gr-ticket-fields-grid">
          {fields.map((f) => (
            <PropertyInput key={f.id} def={f} value={values[f.key]} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} />
          ))}
        </div>
        {fields.some((f) => f.required) && <p className="ui-help">{t('ticketFields.requiredHelp')}</p>}
      </div>
    </Modal>
  );
}
