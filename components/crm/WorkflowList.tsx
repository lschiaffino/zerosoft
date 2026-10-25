'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { Workflow } from '@/lib/crm-workflows';
import { parseDbUtc } from '@/lib/utils';

/**
 * Lista de workflows en una tabla densa: nombre, cuándo corre, cuántas
 * acciones, interruptor de estado y acciones de fila (ejecutar, borrar con
 * confirmación en línea).
 */
export default function WorkflowList({ workflows, canEdit }: { workflows: Workflow[]; canEdit: boolean }) {
  const t = useTranslations('crm.workflows');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  async function call(id: string, path: string, init: RequestInit, done?: string) {
    setBusy(id);
    const res = await fetch(`/api/crm/workflows/${id}${path}`, init).catch(() => null);
    setBusy(null);
    setFlash(res?.ok ? (done ?? null) : t('problems.save'));
    router.refresh();
  }

  const trig = (type: string) => (t.has(`triggerTypes.${type}`) ? t(`triggerTypes.${type}` as 'triggerTypes.manual') : type);

  return (
    <>
      <div className="table-wrap">
        <table className="table wf-table crm-stack">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('name')}</th>
              <th scope="col">{t('whenTrigger')}</th>
              <th scope="col" className="num">
                {t('actions')}
              </th>
              <th scope="col">{t('updated')}</th>
              <th scope="col">{t('state')}</th>
              <th scope="col">
                <span className="sr-only">{t('rowActions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {workflows.map((wf) => (
              <tr key={wf.id} aria-busy={busy === wf.id || undefined}>
                <td className="crm-stack-main">
                  <Link href={`/app/crm/workflows/${wf.id}`} className="cell-link">
                    {wf.name}
                  </Link>
                </td>
                <td data-label={t('whenTrigger')}>{wf.triggers.map((x) => trig(x.type)).join(', ') || t('noTrigger')}</td>
                <td className="num" data-label={t('actions')}>
                  {wf.actions.length}
                </td>
                <td className="data" data-label={t('updated')}>
                  {fmt.format(parseDbUtc(wf.updated_at))}
                </td>
                <td className="crm-stack-state">
                  <label className="ui-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={wf.enabled}
                      disabled={!canEdit || busy === wf.id}
                      aria-label={`${wf.enabled ? t('enabled') : t('disabled')}: ${wf.name}`}
                      onChange={(e) =>
                        call(wf.id, '/toggle', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ enabled: e.target.checked }),
                        })
                      }
                    />
                    {wf.enabled ? t('enabled') : t('disabled')}
                  </label>
                </td>
                <td className="crm-row-actions">
                  {canEdit &&
                    (confirm === wf.id ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-danger btn-sm"
                          onClick={() => {
                            setConfirm(null);
                            void call(wf.id, '', { method: 'DELETE' });
                          }}
                        >
                          {t('confirmDelete')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>
                          {t('cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy === wf.id}
                          onClick={() => call(wf.id, '/run', { method: 'POST' }, t('ranNow', { name: wf.name }))}
                        >
                          {t('runNow')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirm(wf.id)}>
                          {t('delete')}
                        </button>
                      </>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ui-help" role="status" aria-live="polite">
        {flash}
      </p>
    </>
  );
}
