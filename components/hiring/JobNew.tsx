'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { JobTemplate } from '@/lib/hiring/builtin';
import { api, useErrorText } from './ui';

/** Puesto nuevo: en blanco, desde una plantilla integrada o una guardada del workspace. */
export default function JobNew({ builtin, saved }: { builtin: JobTemplate[]; saved: Array<{ id: string; name: string }> }) {
  const t = useTranslations('hiring');
  const locale = useLocale();
  const router = useRouter();
  const errText = useErrorText();
  const [template, setTemplate] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (key: string) => {
    setTemplate(key);
    const tpl = builtin.find((b) => b.key === key);
    if (tpl && !title.trim()) setTitle(tpl.title);
    const own = saved.find((s) => s.id === key);
    if (own && !title.trim()) setTitle(own.name);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const res = await api<{ job: { id: string } }>('/api/hiring/jobs', { method: 'POST', json: { title: title.trim(), ...(template ? { template } : {}) }, headers: { 'x-locale': locale } });
    setBusy(false);
    if (!res.ok) return setError(errText(res.data.error));
    router.push(`/app/hiring/jobs/${res.data.job.id}/edit`);
  };

  return (
    <div className="app-page ui-page hr-page hr-narrow">
      <PageHeader title={t('jobs.new')} description={t('jobNew.desc')} back={{ href: '/app/hiring/jobs', label: t('nav.jobs') }} />
      <form onSubmit={submit} className="ui-fields">
        <fieldset className="hr-templates">
          <legend className="label">{t('jobNew.template')}</legend>
          <label className={`hr-template${template === '' ? ' is-on' : ''}`}>
            <input type="radio" name="template" value="" checked={template === ''} onChange={() => pick('')} />
            <span className="hr-template-name">{t('jobNew.blank')}</span>
            <span className="hr-template-meta">{t('jobNew.blankDesc')}</span>
          </label>
          {builtin.map((b) => (
            <label key={b.key} className={`hr-template${template === b.key ? ' is-on' : ''}`}>
              <input type="radio" name="template" value={b.key} checked={template === b.key} onChange={() => pick(b.key)} />
              <span className="hr-template-name">{b.title}</span>
              <span className="hr-template-meta">
                {b.department} · {t('jobNew.questions', { count: b.questions.length })}
              </span>
            </label>
          ))}
          {saved.map((s) => (
            <label key={s.id} className={`hr-template${template === s.id ? ' is-on' : ''}`}>
              <input type="radio" name="template" value={s.id} checked={template === s.id} onChange={() => pick(s.id)} />
              <span className="hr-template-name">{s.name}</span>
              <span className="hr-template-meta">{t('jobNew.saved')}</span>
            </label>
          ))}
        </fieldset>
        <label className="ui-field">
          <span className="label">{t('job.title')}</span>
          <input className="input" name="title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {error && (
          <p className="ui-help hr-error" role="alert">
            {error}
          </p>
        )}
        <div className="hr-actions-row">
          <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
            {t('jobNew.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
