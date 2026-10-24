'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import CopyButton from '@/components/link/CopyButton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import ContactPicker, { type PickedContact } from './ContactPicker';
import { fmtDuration, topPages } from '@/lib/crm-media-schema';
import type { DocumentLinkView } from '@/lib/crm-media';

/**
 * Un documento: links de seguimiento por contacto (como "Share" de HubSpot
 * Documents), con vistas, tiempo total y páginas más leídas de cada uno.
 */
export default function DocumentDetail({
  doc,
  links: initialLinks,
  baseUrl,
  canManage,
}: {
  doc: { id: string; name: string; fileUrl: string };
  links: DocumentLinkView[];
  baseUrl: string;
  canManage: boolean;
}) {
  const t = useTranslations('crm.media');
  const locale = useLocale();
  const router = useRouter();
  const [links, setLinks] = useState(initialLinks);
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(doc.name);
  const [editing, setEditing] = useState(false);
  const [confirmDoc, setConfirmDoc] = useState(false);
  const [confirmLink, setConfirmLink] = useState<DocumentLinkView | null>(null);

  const urlOf = (token: string) => `${baseUrl}/${locale}/view/${token}`;
  const fmt = (d: string | null) =>
    d ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${d.replace(' ', 'T')}Z`)) : '';

  async function reload() {
    const res = await fetch(`/api/crm/documents/${doc.id}`).catch(() => null);
    if (res?.ok) setLinks(((await res.json()) as { links: DocumentLinkView[] }).links);
  }

  async function createLink() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/documents/${doc.id}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: contact?.id ?? null }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    setContact(null);
    await reload();
  }

  async function removeLink(link: DocumentLinkView) {
    setBusy(true);
    const res = await fetch(`/api/crm/documents/${doc.id}/links?linkId=${encodeURIComponent(link.id)}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirmLink(null);
    if (res?.status === 204) setLinks((prev) => prev.filter((l) => l.id !== link.id));
    else setError(t('errors.generic'));
  }

  async function rename() {
    if (!name.trim()) return;
    const res = await fetch(`/api/crm/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      setEditing(false);
      router.refresh();
    } else setError(t('errors.generic'));
  }

  async function removeDoc() {
    setBusy(true);
    const res = await fetch(`/api/crm/documents/${doc.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.status === 204) router.push('/app/crm/documents');
    else setError(t('errors.generic'));
  }

  return (
    <div className="media-detail" data-testid="document-detail">
      <div className="media-detail-actions">
        {editing ? (
          <form
            className="media-rename"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <input
              className="input"
              autoFocus
              value={name}
              aria-label={t('rename')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
              }}
              maxLength={200}
            />
            <button type="submit" className="btn btn-secondary btn-sm">
              {t('save')}
            </button>
          </form>
        ) : (
          canManage && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              {t('rename')}
            </button>
          )
        )}
        <a className="btn btn-secondary btn-sm" href={doc.fileUrl} target="_blank" rel="noreferrer">
          {t('openFile')}
        </a>
        {canManage && (
          <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirmDoc(true)}>
            {t('delete')}
          </button>
        )}
      </div>

      <section className="media-section">
        <h2 className="crm-panel-title">{t('shareTitle')}</h2>
        <p className="ui-help">{t('shareHelp')}</p>
        <div className="media-share-form">
          <ContactPicker value={contact} onChange={setContact} label={t('contact')} />
          <button type="button" className="btn btn-primary btn-sm" onClick={createLink} disabled={busy} data-testid="document-create-link">
            {contact ? t('createLinkFor', { name: contact.name }) : t('createLinkAnon')}
          </button>
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="media-section">
        <h2 className="crm-panel-title">{t('linksTitle')}</h2>
        {links.length === 0 ? (
          <EmptyState quiet title={t('linksEmptyTitle')} body={t('linksEmptyBody')} />
        ) : (
          <ul className="media-links" data-testid="document-links">
            {links.map((l) => {
              const url = urlOf(l.token);
              const top = topPages(l.pages, 3);
              return (
                <li key={l.id} className="media-link">
                  <div className="media-link-head">
                    {l.contact_id ? (
                      <Link href={`/app/crm/contacts/${l.contact_id}`} className="cell-link">
                        {l.contact_name || l.contact_email || t('contact')}
                      </Link>
                    ) : (
                      <span>{t('anyone')}</span>
                    )}
                    <span className="data muted">{t('viewsCount', { count: l.views })}</span>
                    {l.seconds > 0 && <span className="data muted">{t('timeViewed', { time: fmtDuration(l.seconds) })}</span>}
                    {l.last_viewed_at && <span className="data muted">{t('lastViewed', { date: fmt(l.last_viewed_at) })}</span>}
                  </div>
                  <div className="media-link-url">
                    <code className="data">{url}</code>
                    <CopyButton text={url} className="btn btn-secondary btn-sm" />
                    <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirmLink(l)} aria-label={t('deleteLink')}>
                      {t('delete')}
                    </button>
                  </div>
                  {top.length > 0 && (
                    <p className="muted media-pages">
                      {t('topPages')}{' '}
                      {top.map(([p, s]) => t('pageTime', { page: p, time: fmtDuration(s) })).join(' · ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmDoc}
        title={t('deleteDocTitle', { name: doc.name })}
        body={t('deleteDocBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={removeDoc}
        onCancel={() => setConfirmDoc(false)}
      />
      <ConfirmDialog
        open={confirmLink !== null}
        title={t('deleteLinkTitle')}
        body={t('deleteLinkBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={() => confirmLink && removeLink(confirmLink)}
        onCancel={() => setConfirmLink(null)}
      />
    </div>
  );
}
