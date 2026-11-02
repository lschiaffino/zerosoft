'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { SpaceListItem } from '@/lib/send/spaces';
import { api, SendDialog, useDate, useErrorText } from './ui';

/** Espacios: varios documentos detrás de un link. */
export default function SpacesList({ items, q }: { items: SpaceListItem[]; q: string }) {
  const t = useTranslations('send.spaces');
  const tc = useTranslations('send.common');
  const router = useRouter();
  const date = useDate();
  const errorText = useErrorText();
  const [query, setQuery] = useState(q);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const r = await api<{ space: { id: string } }>('/api/send/spaces', { method: 'POST', json: { title } });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data.error));
    router.push(`/app/send/spaces/${r.data.space.id}`);
  };
  const newButton = (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="send-space-new">
      {t('new')}
    </button>
  );

  return (
    <div className="app-page ui-page sd-page">
      <PageHeader title={t('title')} description={t('desc')} actions={newButton} />
      {(items.length > 0 || q) && (
        <form
          role="search"
          className="sd-search"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/app/send/spaces${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
          }}
        >
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
        </form>
      )}
      {items.length === 0 ? (
        q ? (
          <EmptyState compact body={t('noMatch')} />
        ) : (
          <EmptyState product="send" title={t('emptyTitle')} body={t('emptyBody')} action={newButton} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table sd-table">
            <thead>
              <tr>
                <th scope="col">{t('colTitle')}</th>
                <th scope="col" className="num">
                  {t('colDocuments')}
                </th>
                <th scope="col" className="num sd-hide-sm">
                  {t('colLinks')}
                </th>
                <th scope="col" className="num">
                  {t('colVisits')}
                </th>
                <th scope="col" className="sd-hide-sm">
                  {t('colUpdated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} data-testid="send-space-row">
                  <th scope="row">
                    <Link href={`/app/send/spaces/${s.id}`} className="sd-rowlink">
                      <span className="sd-rowtitle">{s.title}</span>
                    </Link>
                  </th>
                  <td className="num">{s.documents}</td>
                  <td className="num sd-hide-sm">{s.links}</td>
                  <td className="num">{s.visits}</td>
                  <td className="sd-hide-sm">{date(s.updatedAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SendDialog open={creating} title={t('new')} onClose={() => setCreating(false)}>
        <form onSubmit={create}>
          <div className="ui-modal-body">
            <div className="sd-field">
              <label htmlFor="sp-title">{t('colTitle')}</label>
              <input id="sp-title" className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required autoFocus data-testid="send-space-title" />
            </div>
            {error && (
              <p className="sd-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
              {tc('cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="send-space-create">
              {t('create')}
            </button>
          </div>
        </form>
      </SendDialog>
    </div>
  );
}
