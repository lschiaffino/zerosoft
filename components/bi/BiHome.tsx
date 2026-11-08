'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LocalDate from '@/components/ui/LocalDate';
import BiDialog, { NameDialog } from './BiDialog';
import { BI_CHANGED, biApi, biErrorText, notifyBiChanged } from './client';
import type { CollectionDto, ListItem } from '@/lib/bi/store';

type Dialog =
  | { kind: 'newDashboard' }
  | { kind: 'newCollection' }
  | { kind: 'renameItem'; item: ListItem }
  | { kind: 'moveItem'; item: ListItem }
  | { kind: 'deleteItem'; item: ListItem }
  | { kind: 'renameCollection'; col: CollectionDto }
  | { kind: 'deleteCollection'; col: CollectionDto }
  | null;

function itemHref(i: ListItem): string {
  return i.kind === 'dashboard' ? `/app/analytics/dashboards/${i.id}` : `/app/analytics/questions/${i.id}`;
}

export default function BiHome({ initialItems, initialCollections, aiAvailable }: { initialItems: ListItem[]; initialCollections: CollectionDto[]; aiAvailable: boolean }) {
  const t = useTranslations('bi');
  const router = useRouter();
  const locale = useLocale();
  const sp = useSearchParams();
  const selected = sp.get('collection') ?? 'all';
  const [items, setItems] = useState(initialItems);
  const [collections, setCollections] = useState(initialCollections);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('');
  const [ask, setAsk] = useState('');
  const [dialog, setDialog] = useState<Dialog>(sp.get('new') === '1' ? { kind: 'newDashboard' } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await biApi<{ items: ListItem[]; collections: CollectionDto[] }>('/api/bi/items');
      setItems(data.items);
      setCollections(data.collections);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    window.addEventListener(BI_CHANGED, reload);
    return () => window.removeEventListener(BI_CHANGED, reload);
  }, [reload]);

  const close = () => {
    setDialog(null);
    setError(null);
    if (sp.get('new')) router.replace('/app/analytics');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      notifyBiChanged();
    } catch (err) {
      setError(biErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const personal = collections.find((c) => c.personal && c.mine);
  const shared = collections.filter((c) => !c.personal);
  const others = collections.filter((c) => c.personal && !c.mine);
  const currentCol = collections.find((c) => c.id === selected);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((i) => {
      if (selected === 'root' && i.collectionId) return false;
      if (selected !== 'all' && selected !== 'root' && i.collectionId !== selected) return false;
      return !q || i.name.toLowerCase().includes(q);
    });
  }, [items, selected, filter]);
  const colName = (id: string | null) => (id ? (collections.find((c) => c.id === id)?.name ?? '') : t('home.unfiled'));
  const targetCollection = currentCol && (!currentCol.personal || currentCol.mine) ? currentCol.id : null;
  const newQuestionHref = (mode?: string) => {
    const p = new URLSearchParams();
    if (mode) p.set('mode', mode);
    if (targetCollection) p.set('collection', targetCollection);
    const s = p.toString();
    return `/app/analytics/questions/new${s ? `?${s}` : ''}`;
  };

  const colLink = (key: string, label: string, extra?: React.ReactNode) => (
    <li key={key} className={`bi-col-row${selected === key ? ' active' : ''}`}>
      <Link href={key === 'all' ? '/app/analytics' : `/app/analytics?collection=${key}`} className="bi-col-link" aria-current={selected === key ? 'page' : undefined}>
        {label}
      </Link>
      {extra}
    </li>
  );

  return (
    <div className="app-page ui-page bi-page">
      <PageHeader
        title={t('home.title')}
        description={t('home.description')}
        actions={
          <div className="bi-actions">
            <Link className="btn btn-primary btn-sm" href={newQuestionHref()}>
              {t('home.newQuestion')}
            </Link>
            <Link className="btn btn-sm" href={newQuestionHref('sql')}>
              {t('home.newSql')}
            </Link>
            <button type="button" className="btn btn-sm" onClick={() => setDialog({ kind: 'newDashboard' })}>
              {t('home.newDashboard')}
            </button>
          </div>
        }
      />

      <form
        className="bi-ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (ask.trim()) router.push(`/app/analytics/questions/new?ask=${encodeURIComponent(ask.trim())}`);
        }}
      >
        <label className="sr-only" htmlFor="bi-ask-input">
          {t('ask.label')}
        </label>
        <input id="bi-ask-input" className="input" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={t('ask.placeholder')} maxLength={1000} disabled={!aiAvailable} />
        <button type="submit" className="btn btn-sm" disabled={!aiAvailable || !ask.trim()}>
          {t('ask.submit')}
        </button>
        {!aiAvailable && <p className="bi-muted bi-ask-off">{t('ask.unavailable')}</p>}
      </form>

      <div className="bi-browse">
        <nav className="bi-cols" aria-label={t('home.collections')}>
          <ul role="list">
            {colLink('all', t('home.all'))}
            {colLink('root', t('home.unfiled'))}
            {personal && colLink(personal.id, t('home.myCollection'))}
          </ul>
          <div className="bi-cols-head">
            <span>{t('home.collections')}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'newCollection' })} aria-label={t('home.newCollection')}>
              +
            </button>
          </div>
          <ul role="list">
            {shared.length === 0 && <li className="bi-muted bi-cols-empty">{t('home.noCollections')}</li>}
            {shared.map((c) =>
              colLink(
                c.id,
                c.name,
                <span className="bi-col-tools">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'renameCollection', col: c })} aria-label={`${t('common.rename')}: ${c.name}`}>
                    {t('common.rename')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'deleteCollection', col: c })} aria-label={`${t('common.delete')}: ${c.name}`}>
                    {t('common.delete')}
                  </button>
                </span>,
              ),
            )}
          </ul>
          {others.length > 0 && (
            <>
              <div className="bi-cols-head">
                <span>{t('home.otherPersonal')}</span>
              </div>
              <ul role="list">{others.map((c) => colLink(c.id, c.name))}</ul>
            </>
          )}
        </nav>

        <section className="bi-items" aria-busy={loading}>
          <div className="bi-items-head">
            <h2 className="bi-h2">{selected === 'all' ? t('home.all') : selected === 'root' ? t('home.unfiled') : currentCol?.mine ? t('home.myCollection') : (currentCol?.name ?? '')}</h2>
            <input className="input bi-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('home.filter')} aria-label={t('home.filter')} />
          </div>
          {loadError && (
            <p className="ui-error" role="alert">
              {t('errors.load')}{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reload()}>
                {t('common.retry')}
              </button>
            </p>
          )}
          {items.length === 0 ? (
            <EmptyState
              product="analytics"
              title={t('home.emptyTitle')}
              body={t('home.emptyBody')}
              action={{ label: t('home.newQuestion'), href: '/app/analytics/questions/new' }}
            />
          ) : visible.length === 0 ? (
            <p className="bi-empty-result">{filter ? t('home.noMatch') : t('home.emptyCollection')}</p>
          ) : (
            <div className="table-wrap table-stack">
              <table className="table bi-list" data-testid="bi-items">
                <thead>
                  <tr>
                    <th scope="col">{t('home.name')}</th>
                    <th scope="col">{t('home.type')}</th>
                    <th scope="col">{t('home.collection')}</th>
                    <th scope="col">{t('home.updated')}</th>
                    <th scope="col">
                      <span className="sr-only">{t('common.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={itemHref(i)} className="bi-row-link">
                          <span className={`bi-kind bi-kind-${i.kind}`} aria-hidden="true" />
                          {i.name}
                        </Link>
                      </td>
                      <td className="bi-muted" data-label={t('home.type')}>
                        {i.kind === 'dashboard' ? t('home.kindDashboard') : t('home.kindQuestion')}
                      </td>
                      <td className="bi-muted" data-label={t('home.collection')}>
                        {colName(i.collectionId)}
                      </td>
                      <td className="bi-muted" data-label={t('home.updated')}>
                        <LocalDate value={i.updatedAt} locale={locale} kind="date" />
                      </td>
                      <td className="table-stack-actions bi-row-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'renameItem', item: i })} aria-label={`${t('common.rename')}: ${i.name}`}>
                          {t('common.rename')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'moveItem', item: i })} aria-label={`${t('common.move')}: ${i.name}`}>
                          {t('common.move')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'deleteItem', item: i })} aria-label={`${t('common.delete')}: ${i.name}`}>
                          {t('common.delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <NameDialog
        open={dialog?.kind === 'newDashboard'}
        title={t('home.newDashboard')}
        label={t('home.name')}
        submitLabel={t('common.create')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        error={error}
        onClose={close}
        onSubmit={(name) =>
          run(async () => {
            const { dashboard } = await biApi<{ dashboard: { id: string } }>('/api/bi/dashboards', { body: { name, collectionId: targetCollection } });
            setDialog(null);
            router.push(`/app/analytics/dashboards/${dashboard.id}?edit=1`);
          })
        }
      />
      <NameDialog
        open={dialog?.kind === 'newCollection'}
        title={t('home.newCollection')}
        label={t('home.name')}
        submitLabel={t('common.create')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        error={error}
        onClose={close}
        onSubmit={(name) =>
          run(async () => {
            const col = await biApi<CollectionDto>('/api/bi/collections', { body: { name } });
            setDialog(null);
            router.push(`/app/analytics?collection=${col.id}`);
          })
        }
      />
      <NameDialog
        open={dialog?.kind === 'renameItem' || dialog?.kind === 'renameCollection'}
        title={t('common.rename')}
        label={t('home.name')}
        initial={dialog?.kind === 'renameItem' ? dialog.item.name : dialog?.kind === 'renameCollection' ? dialog.col.name : ''}
        submitLabel={t('common.save')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        error={error}
        onClose={close}
        onSubmit={(name) =>
          run(async () => {
            if (dialog?.kind === 'renameItem') {
              await biApi(`/api/bi/${dialog.item.kind === 'dashboard' ? 'dashboards' : 'questions'}/${dialog.item.id}`, { method: 'PATCH', body: { name } });
            } else if (dialog?.kind === 'renameCollection') {
              await biApi(`/api/bi/collections/${dialog.col.id}`, { method: 'PATCH', body: { name } });
            }
            setDialog(null);
          })
        }
      />
      <BiDialog open={dialog?.kind === 'moveItem'} title={t('common.move')} onClose={close}>
        {dialog?.kind === 'moveItem' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = String(new FormData(e.currentTarget).get('collection') ?? '');
              void run(async () => {
                await biApi(`/api/bi/${dialog.item.kind === 'dashboard' ? 'dashboards' : 'questions'}/${dialog.item.id}`, { method: 'PATCH', body: { collectionId: v || null } });
                setDialog(null);
              });
            }}
          >
            <div className="ui-modal-body ui-fields">
              <label className="ui-field">
                <span className="label">{t('home.collection')}</span>
                <select className="input" name="collection" defaultValue={dialog.item.collectionId ?? ''}>
                  <option value="">{t('home.unfiled')}</option>
                  {personal && <option value={personal.id}>{t('home.myCollection')}</option>}
                  {shared.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {error && (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-sm" onClick={close} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
                {t('common.move')}
              </button>
            </div>
          </form>
        )}
      </BiDialog>
      <ConfirmDialog
        open={dialog?.kind === 'deleteItem' || dialog?.kind === 'deleteCollection'}
        title={dialog?.kind === 'deleteItem' ? t('common.deleteTitle', { name: dialog.item.name }) : dialog?.kind === 'deleteCollection' ? t('common.deleteTitle', { name: dialog.col.name }) : ''}
        body={error ?? (dialog?.kind === 'deleteCollection' ? t('home.deleteCollectionBody') : t('home.deleteItemBody'))}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onCancel={close}
        onConfirm={() =>
          run(async () => {
            if (dialog?.kind === 'deleteItem') await biApi(`/api/bi/${dialog.item.kind === 'dashboard' ? 'dashboards' : 'questions'}/${dialog.item.id}`, { method: 'DELETE' });
            if (dialog?.kind === 'deleteCollection') {
              await biApi(`/api/bi/collections/${dialog.col.id}`, { method: 'DELETE' });
              if (selected === dialog.col.id) router.replace('/app/analytics');
            }
            setDialog(null);
          })
        }
      />
    </div>
  );
}
