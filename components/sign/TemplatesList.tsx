'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { TemplateDto } from '@/lib/sign/templates';
import { api, SignDialog, useDate, useErrorText } from './ui';

/** Plantillas del workspace: lista, búsqueda y crear. */
export default function TemplatesList({ items, q }: { items: TemplateDto[]; q: string }) {
  const t = useTranslations('sign');
  const router = useRouter();
  const date = useDate();
  const errorText = useErrorText();
  const [query, setQuery] = useState(q);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const r = await api<{ template: TemplateDto }>('/api/sign/templates', { method: 'POST', json: { name: name.trim() } });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data.error));
    router.push(`/app/sign/templates/${r.data.template.id}`);
  };

  return (
    <div className="app-page ui-page sg-page">
      <PageHeader
        title={t('nav.templates')}
        description={t('templates.desc')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            {t('templates.new')}
          </button>
        }
      />
      <div className="sg-toolbar">
        <form
          role="search"
          className="sg-search"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/app/sign/templates${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
          }}
        >
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('templates.search')} aria-label={t('templates.search')} />
        </form>
      </div>
      {items.length === 0 ? (
        q ? (
          <EmptyState compact body={t('home.noMatch')} />
        ) : (
          <EmptyState
            product="sign"
            title={t('templates.emptyTitle')}
            body={t('templates.emptyBody')}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
                {t('templates.new')}
              </button>
            }
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table sg-table">
            <thead>
              <tr>
                <th scope="col">{t('templates.colName')}</th>
                <th scope="col">{t('templates.colRoles')}</th>
                <th scope="col" className="sg-hide-sm">
                  {t('home.colUpdated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((tp) => (
                <tr key={tp.id}>
                  <th scope="row">
                    <Link href={`/app/sign/templates/${tp.id}`} className="sg-rowlink">
                      <span className="sg-rowtitle">{tp.name}</span>
                      <span className="sg-rowmeta">{tp.hasDocument ? tp.documentName : t('templates.noDocument')}</span>
                    </Link>
                  </th>
                  <td>{tp.roles.map((r) => r.name).join(', ')}</td>
                  <td className="sg-hide-sm">{date(tp.updatedAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SignDialog open={open} title={t('templates.new')} onClose={() => setOpen(false)}>
        <form onSubmit={create}>
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('templates.colName')}</span>
              <input className="input" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            {error && (
              <p className="ui-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              {t('common.create')}
            </button>
          </div>
        </form>
      </SignDialog>
    </div>
  );
}
