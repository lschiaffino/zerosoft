'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import type { CustomerRequestDto, CustomerOption } from '@/lib/track-customers';
import { call } from './api';

/**
 * Fila de un pedido de cliente y buscador de clientes del CRM. Solo usa
 * trackTriage.customers: lo comparten el issue, Track › Clientes y las fichas
 * del CRM.
 */

// ---------- Pedidos de clientes ----------

function TriangleIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M8 2 15 14H1Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function crmHref(r: Pick<CustomerRequestDto, 'companyId' | 'contactId'>): string | null {
  if (r.companyId) return `/app/crm/companies/${r.companyId}`;
  if (r.contactId) return `/app/crm/contacts/${r.contactId}`;
  return null;
}

export function RequestRow({
  r,
  locale,
  onChange,
  showIssue = false,
}: {
  r: CustomerRequestDto;
  locale: string;
  onChange: (next: CustomerRequestDto | null) => void;
  showIssue?: boolean;
}) {
  const t = useTranslations('trackTriage.customers');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const href = crmHref(r);

  const toggle = async () => {
    setBusy(true);
    const res = await call<CustomerRequestDto>(`/api/track/customer-requests/${r.id}`, { method: 'PATCH', json: { important: !r.important } });
    setBusy(false);
    if (res.ok) onChange({ ...r, important: res.data.important });
    else setError(true);
  };
  const remove = async () => {
    setBusy(true);
    const res = await call(`/api/track/customer-requests/${r.id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) onChange(null);
    else setError(true);
  };

  return (
    <li className="track-request" data-testid="track-request">
      <div className="track-request-head">
        <button
          type="button"
          className={`btn btn-ghost btn-sm btn-icon track-request-important${r.important ? ' is-on' : ''}`}
          aria-pressed={r.important}
          aria-label={r.important ? t('unmarkImportant') : t('markImportant')}
          title={r.important ? t('important') : t('markImportant')}
          disabled={busy}
          onClick={() => void toggle()}
          data-testid="track-request-important"
        >
          <TriangleIcon filled={r.important} />
        </button>
        {href ? (
          <Link href={href} className="track-request-customer">
            {r.customer}
          </Link>
        ) : (
          <span className="track-request-customer">{r.customer}</span>
        )}
        {r.contactName && r.contactName !== r.customer && <span className="track-request-meta">{r.contactName}</span>}
        {showIssue && r.issue && (
          <Link href={`/app/track/issues/${r.issueId}`} className="track-request-issue">
            <span className="track-identifier">{r.issue.identifier}</span> {r.issue.title}
          </Link>
        )}
        <span className="track-request-meta">
          {t(`sources.${r.source}`)} · {relDate(r.createdAt, locale)}
          {r.sourceUrl && (
            <>
              {' · '}
              <a href={r.sourceUrl} target="_blank" rel="noreferrer">
                {t('openSource')}
              </a>
            </>
          )}
        </span>
        <button type="button" className="btn btn-ghost btn-sm track-request-remove" onClick={() => void remove()} disabled={busy} data-testid="track-request-remove">
          {t('remove')}
        </button>
      </div>
      {r.body && <blockquote className="track-request-quote">{r.body}</blockquote>}
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
    </li>
  );
}

/** Buscador de clientes del CRM (empresas y contactos) con lista de opciones accesible. */
export function CustomerPicker({
  value,
  onPick,
  autoFocus,
}: {
  value: CustomerOption | null;
  onPick: (o: CustomerOption | null, typed: string) => void;
  autoFocus?: boolean;
}) {
  const t = useTranslations('trackTriage.customers');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CustomerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useRef(`cp-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    if (!q.trim() || value) {
      setRows([]);
      return;
    }
    const id = setTimeout(async () => {
      const res = await call<{ rows: CustomerOption[] }>(`/api/track/customers/search?q=${encodeURIComponent(q.trim())}`);
      if (res.ok) {
        setRows(res.data.rows);
        setActive(0);
        setOpen(true);
      }
    }, 150);
    return () => clearTimeout(id);
  }, [q, value]);

  if (value) {
    return (
      <span className="track-request-picked" data-testid="track-request-picked">
        <span>{value.name}</span>
        <span className="track-request-meta">{value.meta}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(null, '')}>
          {t('change')}
        </button>
      </span>
    );
  }

  return (
    <span className="track-request-picker">
      <input
        className="input"
        role="combobox"
        aria-expanded={open && rows.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={t('customer')}
        placeholder={t('searchPlaceholder')}
        value={q}
        autoFocus={autoFocus}
        maxLength={200}
        onChange={(e) => {
          setQ(e.target.value);
          onPick(null, e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open || rows.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % rows.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + rows.length) % rows.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onPick(rows[active], '');
            setOpen(false);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        data-testid="track-request-customer"
      />
      {open && rows.length > 0 && (
        <ul className="track-request-options" role="listbox" id={listId}>
          {rows.map((o, i) => (
            <li
              key={`${o.kind}:${o.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(o, '');
                setOpen(false);
              }}
              data-testid="track-request-option"
            >
              <span>{o.name}</span>
              <span className="track-request-meta">
                {t(`kinds.${o.kind}`)}
                {o.meta ? ` · ${o.meta}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

