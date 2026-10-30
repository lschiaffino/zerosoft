'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { TemplateInfo } from '@/lib/forms/templates';

/** Nuevo formulario: en blanco o desde una plantilla, en el idioma elegido. */
export default function FormNew({ templates, locale }: { templates: TemplateInfo[]; locale: string }) {
  const t = useTranslations('forms');
  const router = useRouter();
  const [pick, setPick] = useState<string>('blank');
  const [name, setName] = useState('');
  const [lang, setLang] = useState(['en', 'es', 'pt'].includes(locale) ? locale : 'en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = [{ id: 'blank', logic: false }, ...templates];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await fetch('/api/forms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || t(`templates.${pick}.name`), template: pick === 'blank' ? null : pick, lang }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { form?: { id: string } } | null) : null;
    if (!data?.form) {
      setBusy(false);
      setError(t('errors.generic'));
      return;
    }
    router.push(`/app/forms/${data.form.id}`);
  }

  return (
    <div className="app-page ui-page fm-page">
      <PageHeader title={t('new.title')} description={t('new.desc')} back={{ href: '/app/forms', label: t('nav.forms') }} />
      <form onSubmit={create} className="fm-new">
        <fieldset className="fm-templates">
          <legend className="label">{t('new.pick')}</legend>
          {options.map((o) => (
            <label key={o.id} className={`fm-template${pick === o.id ? ' is-on' : ''}`}>
              <input type="radio" name="template" value={o.id} checked={pick === o.id} onChange={() => setPick(o.id)} />
              <span className="fm-template-name">{t(`templates.${o.id}.name`)}</span>
              <span className="fm-template-desc">{t(`templates.${o.id}.desc`)}</span>
              {o.logic && <span className="fm-template-tag">{t('new.withLogic')}</span>}
            </label>
          ))}
        </fieldset>
        <div className="ui-fields-2 fm-new-fields">
          <div className="ui-field">
            <label className="label" htmlFor="fm-new-name">
              {t('new.name')}
            </label>
            <input id="fm-new-name" name="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t(`templates.${pick}.name`)} maxLength={200} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="fm-new-lang">
              {t('new.lang')}
            </label>
            <select id="fm-new-lang" className="select" value={lang} onChange={(e) => setLang(e.target.value)}>
              {['en', 'es', 'pt'].map((l) => (
                <option key={l} value={l}>
                  {t(`langs.${l}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p className="fm-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common.creating') : t('new.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
