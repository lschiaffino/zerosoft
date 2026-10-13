'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  computeInvoice,
  currencyDigits,
  formatMoney,
  INVOICE_CURRENCIES,
  type InvoiceDiscount,
  type InvoiceItem,
} from '@/lib/tools/invoice';
import { safeUrl } from '@/lib/tools/signature';
import { Field, readLocal, removeLocal, writeLocal } from './shared';

const STORAGE_KEY = 'zs-tools-invoice';

interface Draft {
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  logoUrl: string;
  fromName: string;
  fromDetails: string;
  toName: string;
  toDetails: string;
  items: InvoiceItem[];
  discount: InvoiceDiscount;
  notes: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function blankDraft(currency: string): Draft {
  const today = new Date();
  const due = new Date(today.getTime() + 30 * 86400000);
  return {
    number: `INV-${today.getFullYear()}-001`,
    issueDate: isoDate(today),
    dueDate: isoDate(due),
    currency,
    logoUrl: '',
    fromName: '',
    fromDetails: '',
    toName: '',
    toDetails: '',
    items: [{ description: '', qty: 1, price: 0, taxRate: 0 }],
    discount: { type: 'percent', value: 0 },
    notes: '',
  };
}

const DEFAULT_CURRENCY: Record<string, string> = { en: 'USD', es: 'USD', pt: 'BRL' };

export default function InvoiceGenerator() {
  const t = useTranslations('tools.invoice');
  const locale = useLocale();
  const [d, setD] = useState<Draft>(() => blankDraft(DEFAULT_CURRENCY[locale] ?? 'USD'));
  const [saved, setSaved] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    const draft = readLocal<Draft>(STORAGE_KEY);
    if (draft && Array.isArray(draft.items)) setD((cur) => ({ ...cur, ...draft }));
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const id = setTimeout(() => {
      writeLocal(STORAGE_KEY, d);
      setSaved(true);
    }, 400);
    return () => clearTimeout(id);
  }, [d]);

  const digits = currencyDigits(d.currency);
  const totals = useMemo(() => computeInvoice(d.items, d.discount, digits), [d.items, d.discount, digits]);
  const money = (v: number) => formatMoney(v, d.currency, locale);
  const fmtDate = (iso: string) => {
    const dt = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(dt.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(dt);
  };

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setD((cur) => ({ ...cur, [k]: e.target.value }));
  const setItem = (i: number, k: keyof InvoiceItem, v: string) =>
    setD((cur) => ({
      ...cur,
      items: cur.items.map((it, j) => (j === i ? { ...it, [k]: k === 'description' ? v : v === '' ? 0 : Number(v) } : it)),
    }));
  const addItem = () => setD((cur) => ({ ...cur, items: [...cur.items, { description: '', qty: 1, price: 0, taxRate: cur.items.at(-1)?.taxRate ?? 0 }] }));
  const removeItem = (i: number) => setD((cur) => ({ ...cur, items: cur.items.length > 1 ? cur.items.filter((_, j) => j !== i) : cur.items }));
  const reset = () => {
    if (!window.confirm(t('confirmReset'))) return;
    removeLocal(STORAGE_KEY);
    setD(blankDraft(d.currency));
  };

  const logo = safeUrl(d.logoUrl);

  return (
    <div className="tl-split tl-split-invoice">
      <form className="tl-form tl-noprint" onSubmit={(e) => e.preventDefault()}>
        <div className="tl-grid">
          <Field label={t('fields.number')}>
            <input className="input" value={d.number} onChange={set('number')} />
          </Field>
          <Field label={t('fields.currency')}>
            <select className="select" value={d.currency} onChange={set('currency')}>
              {INVOICE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('fields.issueDate')}>
            <input type="date" className="input" value={d.issueDate} onChange={set('issueDate')} />
          </Field>
          <Field label={t('fields.dueDate')}>
            <input type="date" className="input" value={d.dueDate} onChange={set('dueDate')} />
          </Field>
          <Field label={t('fields.fromName')}>
            <input className="input" value={d.fromName} onChange={set('fromName')} placeholder={t('placeholders.fromName')} />
          </Field>
          <Field label={t('fields.toName')}>
            <input className="input" value={d.toName} onChange={set('toName')} placeholder={t('placeholders.toName')} />
          </Field>
          <Field label={t('fields.fromDetails')}>
            <textarea className="textarea" rows={3} value={d.fromDetails} onChange={set('fromDetails')} placeholder={t('placeholders.details')} />
          </Field>
          <Field label={t('fields.toDetails')}>
            <textarea className="textarea" rows={3} value={d.toDetails} onChange={set('toDetails')} placeholder={t('placeholders.details')} />
          </Field>
          <Field label={t('fields.logoUrl')} wide>
            <input className="input" value={d.logoUrl} onChange={set('logoUrl')} inputMode="url" placeholder="https://…/logo.png" />
          </Field>
        </div>

        <div className="tl-items">
          <div className="tl-items-head label" aria-hidden="true">
            <span>{t('fields.description')}</span>
            <span>{t('fields.qty')}</span>
            <span>{t('fields.price')}</span>
            <span>{t('fields.tax')}</span>
            <span />
          </div>
          {d.items.map((it, i) => (
            <div className="tl-item" key={i}>
              <input
                className="input"
                aria-label={t('fields.description')}
                value={it.description}
                placeholder={t('placeholders.item')}
                onChange={(e) => setItem(i, 'description', e.target.value)}
              />
              <input
                className="input"
                aria-label={t('fields.qty')}
                type="number"
                min={0}
                step="any"
                value={Number.isFinite(it.qty) ? it.qty : 0}
                onChange={(e) => setItem(i, 'qty', e.target.value)}
              />
              <input
                className="input"
                aria-label={t('fields.price')}
                type="number"
                min={0}
                step="any"
                value={Number.isFinite(it.price) ? it.price : 0}
                onChange={(e) => setItem(i, 'price', e.target.value)}
              />
              <input
                className="input"
                aria-label={t('fields.tax')}
                type="number"
                min={0}
                max={100}
                step="any"
                value={Number.isFinite(it.taxRate) ? it.taxRate : 0}
                onChange={(e) => setItem(i, 'taxRate', e.target.value)}
              />
              <button type="button" className="tl-icon-btn" aria-label={t('removeItem')} onClick={() => removeItem(i)} disabled={d.items.length === 1}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-small" onClick={addItem}>
            + {t('addItem')}
          </button>
        </div>

        <div className="tl-grid">
          <Field label={t('fields.discount')}>
            <div className="tl-inline">
              <input
                className="input"
                type="number"
                min={0}
                step="any"
                value={d.discount.value}
                onChange={(e) => setD((cur) => ({ ...cur, discount: { ...cur.discount, value: Number(e.target.value) || 0 } }))}
              />
              <select
                className="select"
                aria-label={t('fields.discountType')}
                value={d.discount.type}
                onChange={(e) => setD((cur) => ({ ...cur, discount: { ...cur.discount, type: e.target.value as InvoiceDiscount['type'] } }))}
              >
                <option value="percent">%</option>
                <option value="amount">{d.currency}</option>
              </select>
            </div>
          </Field>
          <Field label={t('fields.notes')} wide>
            <textarea className="textarea" rows={3} value={d.notes} onChange={set('notes')} placeholder={t('placeholders.notes')} />
          </Field>
        </div>
      </form>

      <div className="tl-output">
        <article className="inv-paper" aria-label={t('preview')}>
          <header className="inv-head">
            <div>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="inv-logo" />
              ) : null}
              <p className="inv-from-name">{d.fromName || t('placeholders.fromName')}</p>
              <p className="inv-pre">{d.fromDetails}</p>
            </div>
            <div className="inv-meta">
              <h2 className="inv-title">{t('doc.invoice')}</h2>
              <dl>
                <dt>{t('doc.number')}</dt>
                <dd>{d.number}</dd>
                <dt>{t('doc.issued')}</dt>
                <dd>{fmtDate(d.issueDate)}</dd>
                <dt>{t('doc.due')}</dt>
                <dd>{fmtDate(d.dueDate)}</dd>
              </dl>
            </div>
          </header>
          <div className="inv-to">
            <p className="inv-label">{t('doc.billTo')}</p>
            <p className="inv-to-name">{d.toName || t('placeholders.toName')}</p>
            <p className="inv-pre">{d.toDetails}</p>
          </div>
          <table className="inv-table">
            <thead>
              <tr>
                <th>{t('doc.description')}</th>
                <th className="num">{t('doc.qty')}</th>
                <th className="num">{t('doc.price')}</th>
                <th className="num">{t('doc.tax')}</th>
                <th className="num">{t('doc.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.description || '—'}</td>
                  <td className="num">{it.qty}</td>
                  <td className="num">{money(it.price)}</td>
                  <td className="num">{it.taxRate ? `${it.taxRate}%` : '—'}</td>
                  <td className="num">{money(totals.lines[i]?.amount ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="inv-totals">
            <div className="inv-total-row">
              <dt>{t('doc.subtotal')}</dt>
              <dd>{money(totals.subtotal)}</dd>
            </div>
            {totals.discount > 0 && (
              <div className="inv-total-row">
                <dt>
                  {t('doc.discount')}
                  {d.discount.type === 'percent' ? ` (${d.discount.value}%)` : ''}
                </dt>
                <dd>−{money(totals.discount)}</dd>
              </div>
            )}
            {totals.taxes.map((tx) => (
              <div key={tx.rate} className="inv-total-row">
                <dt>{t('doc.taxAt', { rate: tx.rate })}</dt>
                <dd>{money(tx.amount)}</dd>
              </div>
            ))}
            <div className="inv-total-row inv-grand">
              <dt>{t('doc.total')}</dt>
              <dd>{money(totals.total)}</dd>
            </div>
          </dl>
          {d.notes && (
            <div className="inv-notes">
              <p className="inv-label">{t('doc.notes')}</p>
              <p className="inv-pre">{d.notes}</p>
            </div>
          )}
        </article>
        <div className="tl-actions tl-noprint">
          <button type="button" className="btn btn-solid btn-small" onClick={() => window.print()}>
            {t('downloadPdf')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={reset}>
            {t('newInvoice')}
          </button>
          {saved && <span className="tl-hint">{t('savedLocally')}</span>}
        </div>
        <p className="tl-hint tl-noprint">{t('pdfHint')}</p>
      </div>
    </div>
  );
}
