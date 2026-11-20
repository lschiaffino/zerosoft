'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { Balance } from '@/lib/people-time';
import type { Policy, RequestDto } from '@/lib/people-timeoff';
import { api, useDay, useErrorText, useNumber } from './people-ui';
import RequestDialog, { type PolicyOption } from './RequestDialog';

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
  const [editing, setEditing] = useState<RequestDto | null>(null);

  const act = async (id: string, action: 'approve' | 'deny' | 'cancel') => {
    setBusy(id);
    const res = await api(`/api/people/time-off/${id}`, { method: 'PATCH', json: { action } });
    setBusy(null);
    if (!res.ok) return onChange(errText(res.data.error), 'bad');
    onChange(t(`timeoff.done.${action}`));
  };

  if (!requests.length) return <EmptyState compact quiet body={empty} />;
  return (
    <div className="table-wrap table-stack">
      {editing && (
        <EditRequest
          request={editing}
          onClose={() => setEditing(null)}
          onError={(code) => {
            setEditing(null);
            onChange(errText(code), 'bad');
          }}
          onDone={() => {
            setEditing(null);
            onChange(t('timeoff.done.edit'));
          }}
        />
      )}
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
              <td data-label={t('timeoff.type')}>{r.policyName ?? <span className="ppl-muted">{t('timeoff.out')}</span>}</td>
              <td className="num" data-label={t('timeoff.days')}>
                {num(r.days)}
              </td>
              <td data-label={t('timeoff.statusLabel')}>
                <RequestStatus status={r.status} />
              </td>
              <td className="ppl-actions table-stack-actions">
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
                {r.canEdit && (
                  <button type="button" className="btn btn-sm btn-secondary" disabled={busy === r.id} onClick={() => setEditing(r)} data-testid="people-request-edit">
                    {t('timeoff.edit')}
                  </button>
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

/** Editar un pedido: carga las políticas de esa persona (con el saldo que tendría sin este pedido) y abre el mismo formulario. */
function EditRequest({ request, onClose, onDone, onError }: { request: RequestDto; onClose: () => void; onDone: () => void; onError: (code?: string) => void }) {
  const [policies, setPolicies] = useState<PolicyOption[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api<{ balances: Array<{ policy: Policy; balance: Balance }> }>(`/api/people/employees/${request.employeeId}/balances`).then((res) => {
      if (!alive) return;
      if (!res.ok) return onError(res.data.error);
      setPolicies(
        res.data.balances.map((b) => ({
          id: b.policy.id,
          name: b.policy.name,
          halfDay: b.policy.halfDay,
          // Los días de este pedido vuelven al saldo si se queda en la misma política.
          available: b.policy.accrual === 'none' ? null : b.balance.available + (b.policy.id === request.policyId ? request.days : 0),
        })),
      );
    });
    return () => {
      alive = false;
    };
    // Una carga por pedido abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);
  if (!policies) return null;
  return <RequestDialog open editing={request} policies={policies} onClose={onClose} onDone={onDone} />;
}
