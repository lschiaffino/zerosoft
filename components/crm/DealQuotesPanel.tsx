'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import { formatMoney } from '@/lib/crm-money';
import { QuoteFields, type QuoteFieldValues } from './QuoteActions';

interface DealQuotesPanelProps {
  dealId: string;
  dealName: string;
  locale: string;
  hasLineItems: boolean;
  quotes: Array<{ id: string; number: string; status: string; total: number; currency: string; title: string }>;
  sender: { name: string; email: string; company: string };
}

/** Quotes del deal + "Crear quote" (snapshot de los line items actuales). */
export default function DealQuotesPanel({ dealId, dealName, locale, hasLineItems, quotes, sender }: DealQuotesPanelProps) {
  const t = useTranslations('crm');
  const [open, setOpen] = useState(false);

  return (
    <div className="dq-panel">
      {quotes.length === 0 ? (
        <p className="muted">{t('quotes.emptyDeal')}</p>
      ) : (
        <ul className="dq-list">
          {quotes.map((q) => (
            <li key={q.id}>
              <Link href={`/app/crm/quotes/${q.id}`} className="dq-link">
                <span className="mono">{q.number}</span>
                <span className="dq-title">{q.title}</span>
              </Link>
              <span className={`crm-dot-status q-${q.status}`}>{t(`enums.quoteStatus.${q.status}`)}</span>
              <span className="mono dq-total">{formatMoney(q.total, q.currency, locale, true)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="dq-foot">
        <button
          type="button"
          className="btn btn-small"
          disabled={!hasLineItems}
          onClick={() => setOpen(true)}
          data-testid="crm-create-quote"
        >
          {t('quotes.create')}
        </button>
        {!hasLineItems && <span className="muted dq-hint">{t('quotes.needsLineItems')}</span>}
      </div>
      {open && <CreateQuoteModal dealId={dealId} dealName={dealName} sender={sender} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CreateQuoteModal({
  dealId,
  dealName,
  sender,
  onClose,
}: {
  dealId: string;
  dealName: string;
  sender: { name: string; email: string; company: string };
  onClose: () => void;
}) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [v, setV] = useState<QuoteFieldValues>(() => ({
    title: dealName,
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    terms: '',
    notes: '',
    senderName: sender.name,
    senderEmail: sender.email,
    senderCompany: sender.company,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof QuoteFieldValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((prev) => ({ ...prev, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/quotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dealId, ...v, title: v.title.trim(), expiresAt: v.expiresAt || null }),
    }).catch(() => null);
    if (res?.status === 201) {
      const quote = (await res.json().catch(() => null)) as { id?: string } | null;
      if (quote?.id) {
        router.push(`/app/crm/quotes/${quote.id}`);
        return;
      }
    }
    setBusy(false);
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic'));
  }

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={`CRM › ${t('quotes.create')}`}
      onSubmit={submit}
      submitLabel={busy ? t('common.creating') : t('quotes.createSubmit')}
      cancelLabel={t('common.cancel')}
      submitDisabled={!v.title.trim()}
      busy={busy}
      error={error}
      hint={t('quotes.createHint')}
      width={640}
    >
      <QuoteFields values={v} onChange={set} />
    </QuickModal>
  );
}
