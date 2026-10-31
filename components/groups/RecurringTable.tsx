'use client';

import { useMounted } from '@/components/ui/useMounted';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { RecurringDto } from '@/lib/groups-recurring';
import { Modal, api, useErrorText, useToast } from './ui';
import { useRuleText } from './RecurringParts';
import { parseDbUtc } from '@/lib/utils';

/** Mensajes recurrentes: regla, próxima corrida, estado; pausar, renombrar y borrar sin recargar. */
export default function RecurringTable({ initial }: { initial: RecurringDto[] }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const mounted = useMounted();
  const errText = useErrorText();
  const ruleText = useRuleText();
  const [toast, showToast] = useToast();
  const [rows, setRows] = useState(initial);
  const [renaming, setRenaming] = useState<RecurringDto | null>(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<RecurringDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const replace = (r: RecurringDto) => setRows((list) => list.map((x) => (x.id === r.id ? r : x)));
  const title = (r: RecurringDto) => r.name || (r.poll ? `📊 ${r.poll.question}` : r.body.slice(0, 60)) || t('broadcasts.untitled');

  async function toggle(r: RecurringDto) {
    setBusy(r.id);
    const res = await api<RecurringDto>(`/api/groups/recurring/${r.id}`, { method: 'PATCH', body: { status: r.status === 'active' ? 'paused' : 'active' } });
    setBusy(null);
    if (res.data) replace(res.data);
    else showToast(errText(res.error), true);
  }
  async function rename() {
    if (!renaming) return;
    const res = await api<RecurringDto>(`/api/groups/recurring/${renaming.id}`, { method: 'PATCH', body: { name } });
    if (!res.data) return showToast(errText(res.error), true);
    replace(res.data);
    setRenaming(null);
  }
  async function remove() {
    if (!removing) return;
    const res = await api(`/api/groups/recurring/${removing.id}`, { method: 'DELETE' });
    if (res.data) setRows((list) => list.filter((x) => x.id !== removing.id));
    else showToast(errText(res.error), true);
    setRemoving(null);
  }

  if (rows.length === 0) {
    return (
      <p className="ui-help">
        {t('recurring.empty')} <Link href="/app/groups/broadcasts/new?repeat=1">{t('recurring.new')}</Link>
      </p>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table gr-table">
          <thead>
            <tr>
              <th>{t('broadcasts.colName')}</th>
              <th className="gr-hide-sm">{t('recurring.colRule')}</th>
              <th>{t('recurring.colNext')}</th>
              <th className="num">{t('recurring.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/app/groups/broadcasts/recurring/${r.id}`}>{title(r)}</Link>
                  <span className="ui-help"> · {t('recurring.chats', { n: r.chatIds.length })}</span>
                </td>
                <td className="gr-hide-sm ui-help">{ruleText(r.rule)}</td>
                <td>
                  {r.status === 'active' && r.nextRunAt ? (
                    <time dateTime={r.nextRunAt}>{(mounted ? parseDbUtc(r.nextRunAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '')}</time>
                  ) : (
                    <span className="badge badge-outline">{t(`recurring.status.${r.status}`)}</span>
                  )}
                </td>
                <td className="num">
                  <span className="gr-inline-form gr-row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggle(r)} disabled={busy === r.id || r.status === 'ended'}>
                      {r.status === 'active' ? t('recurring.pause') : t('recurring.resume')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setRenaming(r);
                        setName(r.name);
                      }}
                    >
                      {t('recurring.rename')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(r)}>
                      {t('common.delete')}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!renaming}
        title={t('recurring.renameTitle')}
        onClose={() => setRenaming(null)}
        onSubmit={() => void rename()}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </>
        }
      >
        <label className="ui-field">
          <span className="label">{t('broadcasts.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </label>
      </Modal>
      <ConfirmDialog
        open={!!removing}
        title={t('recurring.deleteTitle', { name: removing ? title(removing) : '' })}
        body={t('recurring.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast}
    </>
  );
}
