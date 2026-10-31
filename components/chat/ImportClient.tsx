'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/** Sube el JSON exportado de la API de Intercom o Crisp a un widget. */
export default function ImportClient({ widgets, canManage }: { widgets: Array<{ id: string; name: string }>; canManage: boolean }) {
  const t = useTranslations('chat');
  const [widgetId, setWidgetId] = useState(widgets[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit() {
    if (!file || !widgetId || busy) return;
    if (file.size > 4 * 1024 * 1024) {
      setResult({ tone: 'error', text: t('importer.file_too_large') });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set('widgetId', widgetId);
      form.set('file', file);
      const res = await fetch('/api/chat/import', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; imported?: number; skipped?: number; failed?: number; messages?: number };
      if (!res.ok) {
        const known = ['invalid_file', 'nothing_to_import', 'file_too_large'];
        setResult({ tone: 'error', text: known.includes(data.error ?? '') ? t(`importer.${data.error}`) : t('errors.generic') });
        return;
      }
      setResult({ tone: 'ok', text: `${t('importer.done', { imported: data.imported ?? 0, skipped: data.skipped ?? 0, messages: data.messages ?? 0 })}${data.failed ? ` ${t('importer.failed', { count: data.failed })}` : ''} ${t('importer.noCampaigns')}` });
    } catch {
      setResult({ tone: 'error', text: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return <p className="ui-help">{t('importer.adminOnly')}</p>;
  if (widgets.length === 0) return <p className="ui-help">{t('importer.noWidgets')}</p>;

  return (
    <section className="chat-pane" aria-label={t('importer.title')}>
      <div className="ui-fields">
        <div className="ui-field">
          <label className="label" htmlFor="import-widget">
            {t('importer.widget')}
          </label>
          <select id="import-widget" className="select" value={widgetId} onChange={(e) => setWidgetId(e.target.value)}>
            {widgets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="import-file">
            {t('importer.file')}
          </label>
          <input id="import-file" className="input" type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="ui-help">{t('importer.fileHelp')}</p>
        </div>
        <div>
          <button type="button" className="btn btn-primary" disabled={!file || busy} aria-busy={busy || undefined} onClick={() => void submit()}>
            {t('importer.submit')}
          </button>
        </div>
        <p className={result?.tone === 'error' ? 'ui-error' : 'ui-help chat-ok'} role="status" aria-live="polite">
          {result?.text ?? ''}
        </p>
      </div>
    </section>
  );
}
