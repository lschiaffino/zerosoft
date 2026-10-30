'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { api, useErrorText } from './ui';

type Source = 'upload' | 'docs' | 'template';

/** Sobre nuevo: subir un PDF, una página de Docs o una plantilla. Desde el CRM llega con el registro vinculado. */
export default function NewEnvelope({
  templates,
  crm,
  docsAvailable,
  maxMb,
}: {
  templates: Array<{ id: string; name: string; ready: boolean }>;
  crm: { ref: string; label: string; recipient: string | null } | null;
  docsAvailable: boolean;
  maxMb: number;
}) {
  const t = useTranslations('sign');
  const router = useRouter();
  const locale = useLocale();
  const errorText = useErrorText();
  const [source, setSource] = useState<Source>('upload');
  const [title, setTitle] = useState(crm?.label ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [docsQ, setDocsQ] = useState('');
  const [docs, setDocs] = useState<Array<{ id: string; title: string }>>([]);
  const [docId, setDocId] = useState('');

  useEffect(() => {
    if (source !== 'docs' || !docsAvailable) return;
    const h = window.setTimeout(async () => {
      const r = await api<{ pages: Array<{ id: string; title: string }> }>(`/api/sign/docs?q=${encodeURIComponent(docsQ)}`);
      if (r.ok) setDocs(r.data.pages);
    }, 200);
    return () => window.clearTimeout(h);
  }, [docsQ, source, docsAvailable]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (source === 'upload') {
        if (!file) return setError(t('new.pickFile'));
        if (file.size > maxMb * 1024 * 1024) return setError(errorText('pdf_too_large'));
        const fd = new FormData();
        fd.set('file', file);
        fd.set('title', title.trim() || file.name.replace(/\.pdf$/i, ''));
        fd.set('locale', locale);
        if (crm) fd.set('crm', crm.ref);
        const r = await api<{ envelope: { id: string } }>('/api/sign/envelopes', { method: 'POST', body: fd });
        if (!r.ok) return setError(errorText(r.data.error));
        router.push(`/app/sign/envelopes/${r.data.envelope.id}`);
        return;
      }
      if (source === 'docs') {
        if (!docId) return setError(t('new.pickPage'));
        const page = docs.find((d) => d.id === docId);
        const r = await api<{ envelope: { id: string } }>('/api/sign/envelopes', { method: 'POST', json: { title: title.trim() || page?.title || 'Untitled', locale, ...(crm ? { crm: crm.ref } : {}) } });
        if (!r.ok) return setError(errorText(r.data.error));
        const id = r.data.envelope.id;
        const d = await api(`/api/sign/envelopes/${id}/document`, { method: 'POST', json: { docsPageId: docId } });
        if (!d.ok) {
          await api(`/api/sign/envelopes/${id}`, { method: 'DELETE' });
          return setError(errorText(d.data.error));
        }
        router.push(`/app/sign/envelopes/${id}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page ui-page sg-page sg-narrow">
      <PageHeader back={{ href: '/app/sign', label: t('nav.envelopes') }} title={t('new.title')} description={crm ? t('new.fromCrm', { label: crm.label }) : t('new.desc')} />
      <div className="ui-tabs" role="tablist" aria-label={t('new.source')}>
        {(['upload', 'docs', 'template'] as Source[]).map((s) => (
          <button key={s} type="button" role="tab" className="ui-tab" aria-selected={source === s} onClick={() => setSource(s)}>
            {t(`new.sources.${s}`)}
          </button>
        ))}
      </div>

      {source === 'template' ? (
        templates.length === 0 ? (
          <div className="ui-section">
            <p className="ui-help">{t('new.noTemplates')}</p>
            <Link className="btn btn-outline" href="/app/sign/templates">
              {t('nav.templates')}
            </Link>
          </div>
        ) : (
          <ul className="sg-pick-list">
            {templates.map((tp) => (
              <li key={tp.id}>
                <Link href={`/app/sign/templates/${tp.id}?use=1`} className="sg-pick">
                  <span className="sg-rowtitle">{tp.name}</span>
                  <span className="sg-rowmeta">{tp.ready ? t('new.useTemplate') : t('new.templateNoDoc')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <form className="ui-fields sg-form" onSubmit={submit}>
          <label className="ui-field">
            <span className="label">{t('new.envelopeTitle')}</span>
            <input className="input" name="title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('new.titlePlaceholder')} />
          </label>
          {source === 'upload' ? (
            <label className="ui-field">
              <span className="label">{t('new.file')}</span>
              <input className="input" type="file" name="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <span className="ui-help">{t('new.fileHint', { mb: maxMb })}</span>
            </label>
          ) : docsAvailable ? (
            <div className="ui-field">
              <label className="label" htmlFor="sg-docs-q">
                {t('new.docsPage')}
              </label>
              <input id="sg-docs-q" className="input" type="search" value={docsQ} onChange={(e) => setDocsQ(e.target.value)} placeholder={t('new.docsSearch')} />
              <div className="sg-radio-list" role="radiogroup" aria-label={t('new.docsPage')}>
                {docs.length === 0 && <p className="ui-help">{t('new.docsEmpty')}</p>}
                {docs.map((d) => (
                  <label key={d.id} className="ui-check">
                    <input type="radio" name="docsPage" value={d.id} checked={docId === d.id} onChange={() => setDocId(d.id)} />
                    <span>{d.title || t('new.untitled')}</span>
                  </label>
                ))}
              </div>
              <span className="ui-help">{t('new.docsHint')}</span>
            </div>
          ) : (
            <p className="ui-help">{t('new.docsUnavailable')}</p>
          )}
          {crm?.recipient && <p className="ui-help">{t('new.crmRecipient', { name: crm.recipient })}</p>}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="sg-row">
            <button type="submit" className="btn btn-primary" disabled={busy || (source === 'docs' && !docsAvailable)}>
              {busy ? t('common.working') : t('new.continue')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
