'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  DATA_KINDS,
  generatePolicy,
  JURISDICTIONS,
  policyToHtml,
  policyToMarkdown,
  THIRD_PARTIES,
  THIRD_PARTY_NAMES,
  type DataKind,
  type PolicyInput,
  type ThirdParty,
} from '@/lib/tools/privacy-policy';
import { downloadFile, Field, useCopy } from './shared';

function toggle<T>(list: T[], v: T, on: boolean): T[] {
  return on ? [...new Set([...list, v])] : list.filter((x) => x !== v);
}

export default function PrivacyPolicyGenerator() {
  const t = useTranslations('tools.privacy');
  const tc = useTranslations('tools.common');
  const locale = useLocale();
  const { copied, copy } = useCopy();
  const [input, setInput] = useState<PolicyInput>(() => ({
    company: '',
    website: '',
    email: '',
    address: '',
    jurisdiction: locale === 'pt' ? 'br' : locale === 'es' ? 'ar' : 'us',
    effectiveDate: new Date().toISOString().slice(0, 10),
    data: ['contact', 'usage', 'device'],
    cookies: true,
    analytics: true,
    ads: false,
    newsletter: false,
    thirdParties: [],
    noChildren: true,
  }));

  const policy = useMemo(() => generatePolicy(input, locale), [input, locale]);
  const set = (k: 'company' | 'website' | 'email' | 'address' | 'effectiveDate') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInput((c) => ({ ...c, [k]: e.target.value }));
  const flag = (k: 'cookies' | 'analytics' | 'ads' | 'newsletter' | 'noChildren') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInput((c) => ({ ...c, [k]: e.target.checked }));

  const fileBase = (input.company.trim() || 'privacy-policy')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return (
    <div className="tl-split">
      <form className="tl-form" onSubmit={(e) => e.preventDefault()}>
        <p className="tl-disclaimer">{t('disclaimer')}</p>
        <div className="tl-grid">
          <Field label={t('fields.company')}>
            <input className="input" value={input.company} onChange={set('company')} placeholder="Acme Inc." />
          </Field>
          <Field label={t('fields.website')}>
            <input className="input" value={input.website} onChange={set('website')} placeholder="acme.com" inputMode="url" />
          </Field>
          <Field label={t('fields.email')}>
            <input className="input" value={input.email} onChange={set('email')} placeholder="privacy@acme.com" inputMode="email" />
          </Field>
          <Field label={t('fields.jurisdiction')}>
            <select
              className="select"
              value={input.jurisdiction}
              onChange={(e) => setInput((c) => ({ ...c, jurisdiction: e.target.value as PolicyInput['jurisdiction'] }))}
            >
              {JURISDICTIONS.map((j) => (
                <option key={j} value={j}>
                  {t(`jurisdictions.${j}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('fields.address')}>
            <input className="input" value={input.address} onChange={set('address')} />
          </Field>
          <Field label={t('fields.effectiveDate')}>
            <input className="input" type="date" value={input.effectiveDate} onChange={set('effectiveDate')} />
          </Field>
        </div>

        <fieldset className="tl-fieldset">
          <legend className="label">{t('fields.data')}</legend>
          <div className="tl-checks">
            {DATA_KINDS.map((k: DataKind) => (
              <label key={k} className="tl-check">
                <input
                  type="checkbox"
                  checked={input.data.includes(k)}
                  onChange={(e) => setInput((c) => ({ ...c, data: toggle(c.data, k, e.target.checked) }))}
                />
                {t(`data.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="tl-fieldset">
          <legend className="label">{t('fields.practices')}</legend>
          <div className="tl-checks">
            <label className="tl-check">
              <input type="checkbox" checked={input.cookies} onChange={flag('cookies')} />
              {t('practices.cookies')}
            </label>
            <label className="tl-check">
              <input type="checkbox" checked={input.analytics} onChange={flag('analytics')} />
              {t('practices.analytics')}
            </label>
            <label className="tl-check">
              <input type="checkbox" checked={input.ads} onChange={flag('ads')} />
              {t('practices.ads')}
            </label>
            <label className="tl-check">
              <input type="checkbox" checked={input.newsletter} onChange={flag('newsletter')} />
              {t('practices.newsletter')}
            </label>
            <label className="tl-check">
              <input type="checkbox" checked={input.noChildren} onChange={flag('noChildren')} />
              {t('practices.noChildren')}
            </label>
          </div>
        </fieldset>

        <fieldset className="tl-fieldset">
          <legend className="label">{t('fields.thirdParties')}</legend>
          <div className="tl-checks">
            {THIRD_PARTIES.map((k: ThirdParty) => (
              <label key={k} className="tl-check">
                <input
                  type="checkbox"
                  checked={input.thirdParties.includes(k)}
                  onChange={(e) => setInput((c) => ({ ...c, thirdParties: toggle(c.thirdParties, k, e.target.checked) }))}
                />
                {THIRD_PARTY_NAMES[k]}
              </label>
            ))}
          </div>
        </fieldset>
      </form>

      <div className="tl-output">
        <article className="tl-doc" lang={locale}>
          <h2>{policy.title}</h2>
          <p className="tl-doc-date">{policy.updated}</p>
          {policy.sections.map((s) => (
            <div key={s.id}>
              {s.title && <h3>{s.title}</h3>}
              {s.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {s.bullets?.length ? (
                <ul>
                  {s.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          <p className="tl-doc-disclaimer">{policy.disclaimer}</p>
        </article>
        <div className="tl-actions">
          <button type="button" className="btn btn-solid btn-small" onClick={() => copy(policyToMarkdown(policy), 'md')}>
            {copied === 'md' ? tc('copied') : t('copy')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => downloadFile(`${fileBase}.md`, policyToMarkdown(policy), 'text/markdown;charset=utf-8')}
          >
            {t('downloadMd')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => downloadFile(`${fileBase}.html`, policyToHtml(policy), 'text/html;charset=utf-8')}
          >
            {t('downloadHtml')}
          </button>
        </div>
      </div>
    </div>
  );
}
