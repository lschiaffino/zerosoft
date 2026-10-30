'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { EnvelopeDto } from '@/lib/sign/core';
import PdfPages from './PdfPages';
import { api, EnvelopeStatus, RecipientStatus, SignDialog, useDate, useErrorText, useToast } from './ui';

/** Sobre enviado o cerrado: destinatarios, hashes, archivos, acciones y línea de tiempo. Inmutable. */
export default function EnvelopeDetail({ env }: { env: EnvelopeDto }) {
  const t = useTranslations('sign');
  const router = useRouter();
  const date = useDate();
  const errorText = useErrorText();
  const [toasts, toast] = useToast();
  const [voidOpen, setVoidOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (action: 'remind' | 'copy' | 'sign_link' | 'void', extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await api<{ id?: string; url?: string; reminded?: number }>(`/api/sign/envelopes/${env.id}/actions`, { method: 'POST', json: { action, ...extra } });
    setBusy(false);
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    if (action === 'copy' && r.data.id) router.push(`/app/sign/envelopes/${r.data.id}`);
    else if (action === 'sign_link' && r.data.url) window.location.assign(r.data.url);
    else {
      if (action === 'remind') toast(extra.rotate ? t('detail.linkRotated') : t('detail.reminded'));
      if (action === 'void') {
        setVoidOpen(false);
        toast(t('detail.voided'));
      }
      router.refresh();
    }
  };
  const remove = async () => {
    const r = await api(`/api/sign/envelopes/${env.id}`, { method: 'DELETE' });
    if (!r.ok) return toast(errorText(r.data.error), 'bad');
    router.push('/app/sign');
    router.refresh();
  };
  const eventText = (kind: string) => (t.has(`event.${kind}`) ? t(`event.${kind}`) : kind);
  const preview = env.hasFinal ? `/api/sign/envelopes/${env.id}/document?v=final` : env.hasDocument ? `/api/sign/envelopes/${env.id}/document?v=original` : null;

  return (
    <div className="app-page ui-page sg-page">
      {toasts}
      <PageHeader
        back={{ href: '/app/sign', label: t('nav.envelopes') }}
        title={env.title}
        description={
          <span className="sg-head-meta">
            <EnvelopeStatus status={env.status} />
            <span>{t('detail.sentBy', { name: env.senderName })}</span>
            {env.sentAt && <span>{t('detail.sentAt', { date: date(env.sentAt) })}</span>}
            {env.status === 'sent' && env.expiresAt && <span>{t('detail.expiresAt', { date: date(env.expiresAt, false) })}</span>}
          </span>
        }
        actions={
          <>
            {env.waitingOnMe && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('sign_link')}>
                {t('detail.signNow')}
              </button>
            )}
            {env.hasFinal && (
              <a className={`btn ${env.waitingOnMe ? 'btn-outline' : 'btn-primary'}`} href={`/api/sign/envelopes/${env.id}/document?v=final&download=1`}>
                {t('detail.downloadSigned')}
              </a>
            )}
          </>
        }
      />

      {env.status === 'voided' && env.voidReason && <p className="ui-help">{t('detail.voidReason', { reason: env.voidReason })}</p>}

      <div className="sg-detail">
        <div className="sg-detail-main">
          <section className="ui-section" aria-labelledby="sg-recipients">
            <h2 id="sg-recipients" className="sg-side-title">
              {t('detail.recipients')} · {t(`editor.${env.signingOrder}`)}
            </h2>
            <ol className="sg-rlist">
              {env.recipients.map((r) => (
                <li key={r.id} className={`sg-rcard${r.current ? ' is-current' : ''}`}>
                  <div className="sg-rcard-head">
                    <span className="sg-rowtitle">
                      {env.signingOrder === 'sequential' && <span className="num">{r.routingOrder}. </span>}
                      {r.name}
                    </span>
                    <RecipientStatus status={r.status} />
                  </div>
                  <span className="sg-rowmeta">
                    {r.email} · {t(`role.${r.role}`)}
                    {r.current ? ` · ${t('detail.current')}` : ''}
                  </span>
                  <span className="sg-rowmeta">
                    {[
                      r.notifiedAt && t('detail.notified', { date: date(r.notifiedAt) }),
                      r.viewedAt && t('detail.viewed', { date: date(r.viewedAt) }),
                      r.signedAt && t('detail.signed', { date: date(r.signedAt) }),
                      r.declinedAt && t('detail.declined', { date: date(r.declinedAt) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {r.declineReason && <span className="sg-rowmeta">{t('detail.reason', { reason: r.declineReason })}</span>}
                  {env.canManage && env.status === 'sent' && r.current && (
                    <span className="sg-row">
                      <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => void act('remind', { recipientId: r.id })}>
                        {t('detail.remind')}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void act('remind', { recipientId: r.id, rotate: true })}>
                        {t('detail.newLink')}
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {preview && env.pages.length > 0 && (
            <section className="ui-section" aria-labelledby="sg-preview">
              <h2 id="sg-preview" className="sg-side-title">
                {env.hasFinal ? t('detail.signedDocument') : t('detail.document')}
              </h2>
              <PdfPages src={preview} pages={env.pages} label={env.title} />
              {env.hasFinal && <p className="ui-help">{t('detail.certificateNote')}</p>}
            </section>
          )}
        </div>

        <aside className="sg-detail-side">
          <section className="ui-section" aria-labelledby="sg-hashes">
            <h2 id="sg-hashes" className="sg-side-title">
              {t('detail.hashes')}
            </h2>
            <dl className="sg-hashes">
              <dt>{t('detail.hashOriginal')}</dt>
              <dd className="sg-hash" data-testid="hash-original">
                {env.documentHash ?? '-'}
              </dd>
              {env.flattenedHash && (
                <>
                  <dt>{t('detail.hashFlattened')}</dt>
                  <dd className="sg-hash">{env.flattenedHash}</dd>
                </>
              )}
              {env.finalHash && (
                <>
                  <dt>{t('detail.hashFinal')}</dt>
                  <dd className="sg-hash" data-testid="hash-final">
                    {env.finalHash}
                  </dd>
                </>
              )}
            </dl>
            <p className="ui-help">{t('detail.hashHelp')}</p>
            {env.hasDocument && (
              <a className="sg-link" href={`/api/sign/envelopes/${env.id}/document?v=original&download=1`}>
                {t('detail.downloadOriginal')}
              </a>
            )}
          </section>

          {env.links.length > 0 && (
            <section className="ui-section" aria-labelledby="sg-links">
              <h2 id="sg-links" className="sg-side-title">
                {t('detail.linked')}
              </h2>
              <ul className="sg-plain-list">
                {env.links.map((l) => (
                  <li key={`${l.app}:${l.id}`}>
                    {l.app === 'crm' ? <Link href={`/app/crm/${l.kind === 'deal' ? 'deals' : 'contacts'}/${l.id}`}>{l.label ?? l.id}</Link> : <span>{`${l.app} · ${l.label ?? l.id}`}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {env.canManage && (
            <section className="ui-section" aria-label={t('detail.actions')}>
              <div className="sg-stack">
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void act('copy')}>
                  {t('detail.copy')}
                </button>
                {env.status === 'sent' && (
                  <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setVoidOpen(true)}>
                    {t('detail.void')}
                  </button>
                )}
                {env.canDelete && (
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDeleteOpen(true)}>
                    {t('detail.delete')}
                  </button>
                )}
              </div>
              {env.status === 'sent' && <p className="ui-help">{t('editor.immutable')}</p>}
            </section>
          )}

          <section className="ui-section" aria-labelledby="sg-timeline">
            <h2 id="sg-timeline" className="sg-side-title">
              {t('detail.timeline')}
            </h2>
            <ol className="sg-timeline">
              {env.events.map((e) => (
                <li key={e.id}>
                  <span className="sg-rowtitle">
                    {eventText(e.kind)}
                    {e.recipient ? ` · ${e.recipient.name}` : ''}
                  </span>
                  <span className="sg-rowmeta">
                    {date(e.at)}
                    {e.ip ? ` · IP ${e.ip}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <SignDialog open={voidOpen} title={t('detail.voidTitle')} onClose={() => setVoidOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) void act('void', { reason: reason.trim() });
          }}
        >
          <div className="ui-modal-body ui-fields">
            <p>{t('detail.voidBody')}</p>
            <label className="ui-field">
              <span className="label">{t('detail.voidReasonLabel')}</span>
              <input className="input" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </label>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setVoidOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || !reason.trim()}>
              {t('detail.void')}
            </button>
          </div>
        </form>
      </SignDialog>

      <SignDialog open={deleteOpen} title={t('detail.deleteTitle')} onClose={() => setDeleteOpen(false)}>
        <div className="ui-modal-body">
          <p>{t('detail.deleteBody')}</p>
          {env.status === 'completed' && <p className="ui-help">{t('detail.deleteCompleted')}</p>}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setDeleteOpen(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void remove()} autoFocus>
            {t('detail.delete')}
          </button>
        </div>
      </SignDialog>
    </div>
  );
}
