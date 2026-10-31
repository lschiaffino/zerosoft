'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

interface Company {
  id: string;
  name: string;
}

/** Empresa y atributos propios de la persona, en su ficha y en el panel de la conversación. */
export default function VisitorProfile({ visitorId }: { visitorId: string }) {
  const t = useTranslations('chat');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [attrs, setAttrs] = useState<Array<[string, string]>>([]);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    Promise.all([fetch('/api/chat/companies').then((r) => r.json()), fetch(`/api/chat/visitors/${visitorId}`).then((r) => r.json())])
      .then(([c, v]: [{ companies?: Company[] }, { company_id?: string | null; attributes?: string | null }]) => {
        if (!live) return;
        setCompanies(c.companies ?? []);
        setCompanyId(v.company_id ?? '');
        let parsed: Record<string, string> = {};
        try {
          parsed = JSON.parse(v.attributes ?? '{}') as Record<string, string>;
        } catch {
          /* vacío */
        }
        setAttrs(Object.entries(parsed));
        setLoaded(true);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [visitorId]);

  async function patch(body: Record<string, unknown>) {
    setError(false);
    const res = await fetch(`/api/chat/visitors/${visitorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) setError(true);
  }

  function saveAttrs(next: Array<[string, string]>) {
    setAttrs(next);
    void patch({ attributes: Object.fromEntries(next) });
  }

  function add() {
    const k = key.trim();
    const v = value.trim();
    if (!k || !v) return;
    saveAttrs([...attrs.filter(([x]) => x !== k), [k, v]]);
    setKey('');
    setValue('');
  }

  if (!loaded && !error) return <span className="ui-skeleton ui-skeleton-row" aria-label={t('common.loading')} />;

  return (
    <div className="ui-fields chat-visitor-profile">
      <div className="ui-field">
        <label className="chat-details-label" htmlFor={`company-${visitorId}`}>
          {t('companies.company')}
        </label>
        <select
          id={`company-${visitorId}`}
          className="select"
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value);
            void patch({ companyId: e.target.value || null });
          }}
        >
          <option value="">{t('companies.none')}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {companies.length === 0 && (
          <p className="ui-help">
            <Link href="/app/chat/companies">{t('companies.createFirst')}</Link>
          </p>
        )}
      </div>
      <div className="ui-field">
        <span className="chat-details-label">{t('companies.attributes')}</span>
        {attrs.length > 0 && (
          <ul className="chat-attr-list" role="list">
            {attrs.map(([k, v]) => (
              <li key={k}>
                <span className="chat-quiet">{k}</span> <span>{v}</span>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={t('companies.removeAttribute', { name: k })} onClick={() => saveAttrs(attrs.filter(([x]) => x !== k))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="chat-attr-add">
          <input className="input" maxLength={60} aria-label={t('companies.attributeName')} placeholder={t('companies.attributeName')} value={key} onChange={(e) => setKey(e.target.value)} />
          <input
            className="input"
            maxLength={500}
            aria-label={t('companies.attributeValue')}
            placeholder={t('companies.attributeValue')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" disabled={!key.trim() || !value.trim()} onClick={add}>
            {t('companies.addAttribute')}
          </button>
        </div>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}
