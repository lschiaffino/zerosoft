'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ClientDto, TaskDto } from '@/lib/time/core';
import { CURRENCIES } from '@/lib/time/types';
import { api, TimeDialog, useErrorText, useToast } from './ui';

type Kind = 'tasks' | 'clients';
type Item = {
  id: string;
  name: string;
  archived: boolean;
  billable?: boolean;
  projects?: number;
};

/** Ajustes de Time: tareas, clientes y moneda. Solo quien administra cambia algo. */
export default function TimeSettings({ tasks, clients, currency: initialCurrency, admin }: { tasks: TaskDto[]; clients: ClientDto[]; currency: string; admin: boolean }) {
  const t = useTranslations('time');
  const errorText = useErrorText();
  const [toast, push] = useToast();
  const [lists, setLists] = useState<Record<Kind, Item[]>>({ tasks, clients });
  const [names, setNames] = useState<Record<Kind, string>>({
    tasks: '',
    clients: '',
  });
  const [currency, setCurrency] = useState(initialCurrency);
  const [renaming, setRenaming] = useState<{
    kind: Kind;
    item: Item;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: Kind; item: Item } | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (kind: Kind, e: FormEvent) => {
    e.preventDefault();
    const name = names[kind].trim();
    if (!name) return;
    setBusy(true);
    const r = await api<{ item: Item }>(`/api/time/${kind}`, {
      method: 'POST',
      json: { name },
    });
    setBusy(false);
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    setLists((cur) => ({
      ...cur,
      [kind]: [...cur[kind], r.data.item].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name)),
    }));
    setNames((cur) => ({ ...cur, [kind]: '' }));
  };

  const patch = async (kind: Kind, item: Item, body: Partial<Item>) => {
    setBusy(true);
    const r = await api(`/api/time/${kind}/${item.id}`, {
      method: 'PATCH',
      json: body,
    });
    setBusy(false);
    if (!r.ok) {
      push(errorText(r.data.error), 'bad');
      return false;
    }
    setLists((cur) => ({
      ...cur,
      [kind]: cur[kind].map((x) => (x.id === item.id ? { ...x, ...body } : x)),
    }));
    return true;
  };

  const remove = async () => {
    if (!deleting) return;
    const { kind, item } = deleting;
    setBusy(true);
    const r = await api(`/api/time/${kind}/${item.id}`, { method: 'DELETE' });
    setBusy(false);
    setDeleting(null);
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    setLists((cur) => ({
      ...cur,
      [kind]: cur[kind].filter((x) => x.id !== item.id),
    }));
  };

  const saveCurrency = async (value: string) => {
    const prev = currency;
    setCurrency(value);
    const r = await api('/api/time/settings', {
      method: 'PATCH',
      json: { currency: value },
    });
    if (!r.ok) {
      setCurrency(prev);
      return push(errorText(r.data.error), 'bad');
    }
    push(t('settings.saved'));
  };

  const section = (kind: Kind) => (
    <section className="ui-section" aria-labelledby={`tm-${kind}`} data-testid={`time-settings-${kind}`}>
      <div className="ui-section-body">
        <div className="ui-section-head">
          <h2 className="ui-section-title" id={`tm-${kind}`}>
            {t(`settings.${kind}`)}
          </h2>
          <p className="ui-section-desc">{t(`settings.${kind}Desc`)}</p>
        </div>
        {lists[kind].length === 0 ? (
          <p className="tm-muted">{t('settings.noClients')}</p>
        ) : (
          <ul className="tm-list">
            {lists[kind].map((item) => (
              <li key={item.id} className={`tm-list-row${item.archived ? ' is-archived' : ''}`} data-testid={`time-${kind}-row`}>
                <span className="tm-list-name">
                  {item.name}
                  {kind === 'tasks' && !item.billable && <span className="badge badge-outline">{t('settings.nonBillable')}</span>}
                  {item.archived && <span className="badge badge-outline">{t('settings.archivedBadge')}</span>}
                  {kind === 'clients' && (
                    <span className="tm-muted tm-small">
                      {t('settings.projectsCount', {
                        count: item.projects ?? 0,
                      })}
                    </span>
                  )}
                </span>
                {admin && (
                  <span className="tm-list-actions">
                    {kind === 'tasks' && (
                      <label className="ui-check tm-small">
                        <input
                          type="checkbox"
                          checked={Boolean(item.billable)}
                          onChange={(e) =>
                            void patch(kind, item, {
                              billable: e.target.checked,
                            })
                          }
                          disabled={busy}
                        />
                        <span>{t('settings.billable')}</span>
                      </label>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming({ kind, item, name: item.name })} aria-label={`${t('settings.rename')}: ${item.name}`}>
                      {t('settings.rename')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void patch(kind, item, { archived: !item.archived })} disabled={busy}>
                      {item.archived ? t('common.restore') : t('common.archive')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm tm-danger" onClick={() => setDeleting({ kind, item })} aria-label={`${t('common.delete')}: ${item.name}`}>
                      {t('common.delete')}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {admin && (
          <form className="tm-add" onSubmit={(e) => void add(kind, e)}>
            <input
              className="input"
              maxLength={120}
              value={names[kind]}
              onChange={(e) => setNames((cur) => ({ ...cur, [kind]: e.target.value }))}
              placeholder={t(kind === 'tasks' ? 'settings.newTask' : 'settings.newClient')}
              aria-label={t(kind === 'tasks' ? 'settings.newTask' : 'settings.newClient')}
            />
            <button type="submit" className="btn btn-secondary" disabled={busy || !names[kind].trim()}>
              {t('settings.add')}
            </button>
          </form>
        )}
      </div>
    </section>
  );

  return (
    <div className="app-page ui-page tm-page tm-narrow">
      <PageHeader title={t('nav.settings')} description={admin ? t('settings.desc') : `${t('settings.desc')} ${t('common.adminOnly')}`} />
      <section className="ui-section" aria-labelledby="tm-currency">
        <div className="ui-section-body">
          <div className="ui-section-head">
            <h2 className="ui-section-title" id="tm-currency">
              {t('settings.currency')}
            </h2>
            <p className="ui-section-desc">{t('settings.currencyDesc')}</p>
          </div>
          <select className="input tm-currency" value={currency} onChange={(e) => void saveCurrency(e.target.value)} disabled={!admin} aria-label={t('settings.currency')} data-testid="time-currency">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </section>
      {section('tasks')}
      {section('clients')}

      <TimeDialog open={renaming !== null} title={renaming?.kind === 'tasks' ? t('settings.renameTask') : t('settings.renameClient')} onClose={() => setRenaming(null)}>
        {renaming && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await patch(renaming.kind, renaming.item, {
                  name: renaming.name.trim(),
                })
              )
                setRenaming(null);
            }}
          >
            <div className="ui-modal-body ui-fields">
              <label className="ui-field">
                <span className="label">{t('projects.name')}</span>
                <input className="input" required maxLength={120} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} autoFocus />
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !renaming.name.trim()}>
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </TimeDialog>
      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.kind === 'tasks' ? t('settings.deleteTaskTitle') : t('settings.deleteClientTitle')}
        body={deleting?.kind === 'tasks' ? t('settings.deleteTaskBody') : t('settings.deleteClientBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
      {toast}
    </div>
  );
}
