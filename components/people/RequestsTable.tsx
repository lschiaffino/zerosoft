'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { RequestDto } from '@/lib/people-timeoff';
import { api, useDay, useErrorText, useNumber } from './people-ui';

const STATUS_CLASS: Record<string, string> = { pending: 'badge-warn', approved: 'badge-ok', denied: 'badge-bad', cancelled: 'badge-outline' };

export function RequestStatus({ status }: { status: string }) {
  const t = useTranslations('people.timeoff.status');
  return (
    <span className={`badge ${STATUS_CLASS[status] ?? 'badge-outline'}`} data-status={status}>
      {t(status)}
    </span>
  );
}

/** Lista de pedidos con sus acciones (aprobar, rechazar, cancelar) según lo que la API dice que se puede. */
export default function RequestsTable({ requests, showPerson, onChange, empty }: { requests: RequestDto[]; showPerson: boolean; onChange: (msg: string, tone?: 'ok' | 'bad') => void; empty: string }) {
  const t = useTranslations('people');
  const day = useDay();
  const num = useNumber();
  const errText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, action: 'approve' | 'deny' | 'cancel') => {
    setBusy(id);
    const res = await api(`/api/people/time-off/${id}`, { method: 'PATCH', json: { action } });
    setBusy(null);
    if (!res.ok) return onChange(errText(res.data.error), 'bad');
    onChange(t(`timeoff.done.${action}`));
  };

  if (!requests.length) return <EmptyState compact quiet body={empty} />;
  return (
    <div className="table-wrap">
      <table className="table ppl-table" data-testid="people-requests">
        <thead>
          <tr>
            {showPerson && <th scope="col">{t('fields.name')}</th>}
            <th scope="col">{t('timeoff.dates')}</th>
            <th scope="col">{t('timeoff.type')}</th>
            <th scope="col" className="num">
              {t('timeoff.days')}
            </th>
            <th scope="col">{t('timeoff.statusLabel')}</th>
            <th scope="col">
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} data-request={r.id}>
              {showPerson && (
                <th scope="row">
                  <Link href={`/app/people/${r.employeeId}?tab=timeoff`}>{r.employeeName}</Link>
                </th>
              )}
              <td>
                {day(r.startDate)}
                {r.endDate !== r.startDate && ` · ${day(r.endDate)}`}
                {r.half && <span className="ppl-muted"> ({t(r.half === 'am' ? 'timeoff.morning' : 'timeoff.afternoon')})</span>}
                {r.note && <div className="ppl-rowmeta">{r.note}</div>}
              </td>
              <td>{r.policyName ?? <span className="ppl-muted">{t('timeoff.out')}</span>}</td>
              <td className="num">{num(r.days)}</td>
              <td>
                <RequestStatus status={r.status} />
              </td>
              <td className="ppl-actions">
                {r.canDecide && (
                  <>
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => act(r.id, 'approve')}>
                      {t('timeoff.approve')}
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" disabled={busy === r.id} onClick={() => act(r.id, 'deny')}>
                      {t('timeoff.deny')}
                    </button>
                  </>
                )}
                {r.canCancel && !r.canDecide && (
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy === r.id} onClick={() => act(r.id, 'cancel')}>
                    {t('timeoff.cancel')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
