'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { EnvelopeListItem, SignBox } from '@/lib/sign/core';
import { EnvelopeStatus, useDate } from './ui';

const BOXES: SignBox[] = ['all', 'action', 'waiting', 'completed', 'closed', 'drafts'];

/** Sobres: cajas (esperan mi firma, esperan a otros, completados, cerrados, borradores) y búsqueda. */
export default function SignHome({ items, counts, box, q }: { items: EnvelopeListItem[]; counts: Record<SignBox, number>; box: SignBox; q: string }) {
  const t = useTranslations('sign');
  const router = useRouter();
  const date = useDate();
  const [query, setQuery] = useState(q);
  const go = (next: { box?: SignBox; q?: string }) => {
    const sp = new URLSearchParams();
    const nb = next.box ?? box;
    const nq = next.q ?? query;
    if (nb !== 'all') sp.set('box', nb);
    if (nq.trim()) sp.set('q', nq.trim());
    router.push(`/app/sign${sp.size ? `?${sp}` : ''}`);
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    go({ q: query });
  };
  const signed = (e: EnvelopeListItem) => e.recipients.filter((r) => r.role !== 'cc' && (r.status === 'signed' || r.status === 'approved')).length;
  const acting = (e: EnvelopeListItem) => e.recipients.filter((r) => r.role !== 'cc').length;

  return (
    <div className="app-page ui-page sg-page">
      <PageHeader
        title={t('home.title')}
        description={t('home.desc')}
        actions={
          <Link className="btn btn-primary" href="/app/sign/new">
            {t('nav.new')}
          </Link>
        }
      />
      <div className="sg-toolbar">
        <div className="ui-tabs sg-tabs" role="tablist" aria-label={t('home.boxes')}>
          {BOXES.map((b) => (
            <button key={b} type="button" role="tab" className="ui-tab" aria-selected={box === b} onClick={() => go({ box: b })}>
              {t(`box.${b}`)}
              <span className="sg-count num">{counts[b] ?? 0}</span>
            </button>
          ))}
        </div>
        <form onSubmit={search} role="search" className="sg-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('home.search')} aria-label={t('home.search')} />
        </form>
      </div>
      {items.length === 0 ? (
        q || box !== 'all' ? (
          <EmptyState compact body={t('home.noMatch')} />
        ) : (
          <EmptyState product="sign" title={t('home.emptyTitle')} body={t('home.emptyBody')} action={{ label: t('nav.new'), href: '/app/sign/new' }} />
        )
      ) : (
        <div className="table-wrap">
          <table className="table sg-table">
            <thead>
              <tr>
                <th scope="col">{t('home.colTitle')}</th>
                <th scope="col">{t('home.colStatus')}</th>
                <th scope="col" className="sg-hide-sm">
                  {t('home.colUpdated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} data-box={e.box}>
                  <th scope="row">
                    <Link href={`/app/sign/envelopes/${e.id}`} className="sg-rowlink">
                      <span className="sg-rowtitle">{e.title}</span>
                      <span className="sg-rowmeta">
                        {[e.recipients.map((r) => r.name).join(', ') || t('home.noRecipients'), e.mine ? null : t('home.from', { name: e.senderName })].filter(Boolean).join(' · ')}
                      </span>
                    </Link>
                  </th>
                  <td>
                    <span className="sg-status-cell">
                      {e.box === 'action' ? <span className="badge badge-warn">{t('box.action')}</span> : <EnvelopeStatus status={e.status} />}
                      {e.status === 'sent' && <span className="sg-rowmeta num">{t('home.progress', { done: signed(e), total: acting(e) })}</span>}
                    </span>
                  </td>
                  <td className="sg-hide-sm">{date(e.updatedAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
