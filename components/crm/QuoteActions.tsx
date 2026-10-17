'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { partySummary } from '@/lib/crm-admin-format';

export interface QuoteEditable {
  id: string;
  status: string;
  title: string;
  expires_at: string | null;
  terms: string;
  notes: string;
  sender_name: string;
  sender_email: string;
  sender_company: string;
  recipient_name: string;
  recipient_email: string;
  recipient_company: string;
}

interface QuoteActionsProps {
  quote: QuoteEditable;
  publicUrl: string;
  dealHref: string;
}

/** Barra de acciones del quote en la app (publicar, link, imprimir, editar, borrar). */
export default function QuoteActions({ quote, publicUrl, dealHref }: QuoteActionsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const draft = quote.status === 'draft';

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/quotes/${quote.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.refresh();
      return true;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic'));
    return false;
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/crm/quotes/${quote.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.push(dealHref);
    else setError(t('errors.generic'));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t('quotes.copyLink'), publicUrl);
    }
  }

  return (
    <div className="quote-actions">
      <div className="quote-actions-row">
        {draft ? (
          <button type="button" className="btn btn-primary btn-sm" aria-busy={busy || undefined} onClick={() => patch({ status: 'sent' })}>
            {t('quotes.markSent')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={copy}>
              {copied ? t('quotes.linkCopied') : t('quotes.copyLink')}
            </button>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
              {t('quotes.openPublic')}
            </a>
          </>
        )}
        {draft && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(true)}>
            {t('common.edit')}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          {t('quotes.print')}
        </button>
        {draft && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => patch({ refreshItems: true })}>
            {t('quotes.refreshItems')}
          </button>
        )}
        <span className="quote-actions-spacer" />
        {confirmDelete ? (
          <>
            <button type="button" className="btn btn-primary btn-danger btn-sm" disabled={busy} onClick={remove}>
              {t('quotes.confirmDelete')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
            {t('common.delete')}
          </button>
        )}
      </div>
      {draft && <p className="ui-help">{t('quotes.draftHint')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {editing && <QuoteEditModal quote={quote} onClose={() => setEditing(false)} onSave={patch} />}
    </div>
  );
}

function QuoteEditModal({
  quote,
  onClose,
  onSave,
}: {
  quote: QuoteEditable;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useTranslations('crm');
  const [v, setV] = useState({
    title: quote.title,
    expiresAt: quote.expires_at ?? '',
    terms: quote.terms,
    notes: quote.notes,
    senderName: quote.sender_name,
    senderEmail: quote.sender_email,
    senderCompany: quote.sender_company,
    recipientName: quote.recipient_name,
    recipientEmail: quote.recipient_email,
    recipientCompany: quote.recipient_company,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={`CRM › ${t('quotes.editTitle')}`}
      onSubmit={async () => {
        setBusy(true);
        const ok = await onSave({ ...v, title: v.title.trim(), expiresAt: v.expiresAt || null });
        setBusy(false);
        if (ok) onClose();
      }}
      submitLabel={busy ? t('common.saving') : t('quotes.saveQuote')}
      cancelLabel={t('common.cancel')}
      busy={busy}
      width={640}
    >
      <QuoteFields values={v} onChange={set} />
    </QuickModal>
  );
}

export interface QuoteFieldValues {
  title: string;
  expiresAt: string;
  terms: string;
  notes: string;
  senderName: string;
  senderEmail: string;
  senderCompany: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientCompany?: string;
}

/**
 * Campos del quote (compartidos por "Crear quote" y "Editar"). Remitente y
 * destinatario vienen precargados (tu perfil y el contacto del deal), así que
 * quedan colapsados en un resumen; se abren solo para cambiarlos.
 */
export function QuoteFields<T extends QuoteFieldValues>({
  values,
  onChange,
}: {
  values: T;
  onChange: (k: keyof T) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const t = useTranslations('crm');
  const hasRecipient = values.recipientName !== undefined;
  const from = partySummary(values.senderName, values.senderCompany, values.senderEmail) || t('quotes.parties.missing');
  const to = hasRecipient
    ? partySummary(values.recipientName, values.recipientCompany, values.recipientEmail) || t('quotes.parties.missing')
    : t('quotes.parties.fromDeal');
  return (
    <>
      <input
        data-autofocus
        className="qm-title"
        value={values.title}
        onChange={onChange('title')}
        placeholder={t('quotes.form.title')}
        aria-label={t('quotes.form.title')}
        maxLength={500}
      />
      <div className="qm-row">
        <label className="qm-field">
          <span>{t('quotes.form.expiresAt')}</span>
          <input type="date" value={values.expiresAt} onChange={onChange('expiresAt')} />
        </label>
      </div>
      <label className="qm-field">
        <span>{t('quotes.form.notes')}</span>
        <textarea rows={2} value={values.notes} onChange={onChange('notes')} maxLength={5000} />
      </label>
      <label className="qm-field">
        <span>{t('quotes.form.terms')}</span>
        <textarea rows={3} value={values.terms} onChange={onChange('terms')} maxLength={5000} />
      </label>
      <AdvancedSection
        storageKey="crm.quote.parties"
        label={t('quotes.parties.label')}
        hint={t('quotes.parties.summary', { from, to })}
        className="quote-parties"
        defaultOpen={!values.senderName.trim() && !values.senderEmail.trim()}
      >
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('quotes.form.senderName')}</span>
            <input value={values.senderName} onChange={onChange('senderName')} maxLength={500} />
          </label>
          <label className="qm-field">
            <span>{t('quotes.form.senderEmail')}</span>
            <input type="email" value={values.senderEmail} onChange={onChange('senderEmail')} maxLength={320} />
          </label>
          <label className="qm-field">
            <span>{t('quotes.form.senderCompany')}</span>
            <input value={values.senderCompany} onChange={onChange('senderCompany')} maxLength={500} />
          </label>
        </div>
        {hasRecipient && (
          <div className="qm-row">
            <label className="qm-field">
              <span>{t('quotes.form.recipientName')}</span>
              <input value={values.recipientName} onChange={onChange('recipientName')} maxLength={500} />
            </label>
            <label className="qm-field">
              <span>{t('quotes.form.recipientEmail')}</span>
              <input type="email" value={values.recipientEmail ?? ''} onChange={onChange('recipientEmail')} maxLength={320} />
            </label>
            <label className="qm-field">
              <span>{t('quotes.form.recipientCompany')}</span>
              <input value={values.recipientCompany ?? ''} onChange={onChange('recipientCompany')} maxLength={500} />
            </label>
          </div>
        )}
      </AdvancedSection>
    </>
  );
}
