'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AgentKnowledgeFileDto, AgentQaDto, AgentSuggestionDto } from '@/lib/agents-knowledge';
import FormSection from '@/components/ui/FormSection';
import { parseDbUtc } from '@/lib/utils';
import { useConfirm } from './useConfirm';
import { api, errorText } from './agents-ui';

const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv';

/**
 * Conocimiento propio del agente que no pasa por el borrador: archivos,
 * pares de pregunta y respuesta (con carga por CSV) y preguntas sin respuesta
 * para convertir en un par.
 */
export default function AgentKnowledgeExtra({
  agentId,
  canEdit,
  initialFiles,
  initialQa,
}: {
  agentId: string;
  canEdit: boolean;
  initialFiles: AgentKnowledgeFileDto[];
  initialQa: AgentQaDto[];
}) {
  const t = useTranslations('agents');
  const [confirmNode, ask] = useConfirm();
  const format = useFormatter();
  const [files, setFiles] = useState(initialFiles);
  const [qa, setQa] = useState(initialQa);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const [qaForm, setQaForm] = useState<{ id: string | null; question: string; answer: string; variants: string } | null>(null);
  const [qaBusy, setQaBusy] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaNotice, setQaNotice] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AgentSuggestionDto[] | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<AgentSuggestionDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ suggestions?: AgentSuggestionDto[] }>(`/api/agents/${agentId}/suggestions`).then((res) => {
      if (cancelled) return;
      if (res.ok) setSuggestions(res.data.suggestions ?? []);
      else setSuggestError(errorText(t, res.data.error));
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, t]);

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    setFileError(null);
    for (const file of Array.from(list)) {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/agents/${agentId}/files`, { method: 'POST', body }).catch(() => null);
      const data = ((await res?.json().catch(() => null)) ?? {}) as { file?: AgentKnowledgeFileDto; error?: string };
      if (!res?.ok || !data.file) {
        setFileError(`${file.name}: ${errorText(t, data.error ?? (res ? 'generic' : 'network'))}`);
        break;
      }
      setFiles((f) => [...f, data.file!]);
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function removeFile(f: AgentKnowledgeFileDto) {
    if (!(await ask({ title: t('files.removeConfirm', { name: f.name }), confirmLabel: t('files.remove'), danger: true }))) return;
    const res = await api(`/api/agents/${agentId}/files/${f.id}`, { method: 'DELETE' });
    if (res.ok) setFiles((list) => list.filter((x) => x.id !== f.id));
    else setFileError(errorText(t, res.data.error));
  }

  function openQa(item?: AgentQaDto, question?: string) {
    setQaError(null);
    setQaNotice(null);
    setQaForm(
      item
        ? { id: item.id, question: item.question, answer: item.answer, variants: item.variants.join('\n') }
        : { id: null, question: question ?? '', answer: '', variants: '' },
    );
  }

  async function saveQa() {
    if (!qaForm || qaBusy) return;
    const body = {
      question: qaForm.question.trim(),
      answer: qaForm.answer.trim(),
      variants: qaForm.variants.split('\n').map((v) => v.trim()).filter(Boolean),
    };
    if (!body.question || !body.answer) {
      setQaError(t('qa.required'));
      return;
    }
    setQaBusy(true);
    const res = await api<{ qa?: AgentQaDto }>(qaForm.id ? `/api/agents/${agentId}/qa/${qaForm.id}` : `/api/agents/${agentId}/qa`, {
      method: qaForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    setQaBusy(false);
    if (!res.ok || !res.data.qa) {
      setQaError(errorText(t, res.data.error));
      return;
    }
    const saved = res.data.qa;
    setQa((list) => (qaForm.id ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved]));
    setQaForm(null);
    // Respondida desde una sugerencia: sale de la lista.
    if (answering) {
      const dismissed = await api<{ suggestions?: AgentSuggestionDto[] }>(`/api/agents/${agentId}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ dismiss: answering.runIds }),
      });
      if (dismissed.ok) setSuggestions(dismissed.data.suggestions ?? []);
      setAnswering(null);
    }
  }

  async function removeQa(item: AgentQaDto) {
    if (!(await ask({ title: t('qa.removeConfirm'), confirmLabel: t('qa.remove'), danger: true }))) return;
    const res = await api(`/api/agents/${agentId}/qa/${item.id}`, { method: 'DELETE' });
    if (res.ok) setQa((list) => list.filter((x) => x.id !== item.id));
    else setQaError(errorText(t, res.data.error));
  }

  async function importCsv(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    setQaBusy(true);
    setQaError(null);
    setQaNotice(null);
    const res = await api<{ added?: number; skipped?: number; qa?: AgentQaDto[] }>(`/api/agents/${agentId}/qa`, {
      method: 'POST',
      body: JSON.stringify({ csv: await file.text() }),
    });
    setQaBusy(false);
    if (csvInput.current) csvInput.current.value = '';
    if (!res.ok) {
      setQaError(errorText(t, res.data.error));
      return;
    }
    if (res.data.qa) setQa(res.data.qa);
    setQaNotice(t('qa.imported', { added: res.data.added ?? 0, skipped: res.data.skipped ?? 0 }));
  }

  async function dismiss(s: AgentSuggestionDto) {
    const res = await api<{ suggestions?: AgentSuggestionDto[] }>(`/api/agents/${agentId}/suggestions`, {
      method: 'POST',
      body: JSON.stringify({ dismiss: s.runIds }),
    });
    if (res.ok) setSuggestions(res.data.suggestions ?? []);
    else setSuggestError(errorText(t, res.data.error));
  }

  const size = (n: number) => (n >= 1_048_576 ? `${format.number(n / 1_048_576, { maximumFractionDigits: 1 })} MB` : `${format.number(Math.max(1, Math.round(n / 1024)))} KB`);

  const qaFormEl = qaForm && (
    <form
      className="ag-qa-form"
      onSubmit={(e) => {
        e.preventDefault();
        void saveQa();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setQaForm(null);
          setAnswering(null);
        }
      }}
    >
      <div className="ui-field">
        <label className="label" htmlFor="ag-qa-question">
          {t('qa.question')}
        </label>
        <input
          id="ag-qa-question"
          className="input"
          value={qaForm.question}
          maxLength={500}
          autoFocus={!qaForm.question}
          onChange={(e) => setQaForm({ ...qaForm, question: e.target.value })}
        />
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="ag-qa-variants">
          {t('qa.variants')}
        </label>
        <textarea
          id="ag-qa-variants"
          className="textarea"
          rows={2}
          value={qaForm.variants}
          placeholder={t('qa.variantsPlaceholder')}
          onChange={(e) => setQaForm({ ...qaForm, variants: e.target.value })}
        />
        <p className="ui-help">{t('qa.variantsHint')}</p>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="ag-qa-answer">
          {t('qa.answer')}
        </label>
        <textarea
          id="ag-qa-answer"
          className="textarea"
          rows={4}
          maxLength={4000}
          value={qaForm.answer}
          autoFocus={Boolean(qaForm.question)}
          onChange={(e) => setQaForm({ ...qaForm, answer: e.target.value })}
        />
      </div>
      {qaError && (
        <p className="ui-error" role="alert">
          {qaError}
        </p>
      )}
      <div className="ag-form-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setQaForm(null);
            setAnswering(null);
          }}
        >
          {t('qa.cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" aria-busy={qaBusy || undefined} disabled={qaBusy}>
          {t('qa.save')}
        </button>
      </div>
    </form>
  );

  return (
    <>
      {confirmNode}
      <FormSection
        title={t('files.title')}
        description={t('files.hint')}
        footer={
          canEdit ? (
            <>
              <p className="ui-section-note">{t('files.types')}</p>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                id="ag-file-input"
                onChange={(e) => void upload(e.target.files)}
              />
              <button type="button" className="btn btn-secondary btn-sm" aria-busy={uploading || undefined} disabled={uploading} onClick={() => fileInput.current?.click()}>
                {uploading ? t('files.uploading') : t('files.upload')}
              </button>
            </>
          ) : undefined
        }
      >
        {fileError && (
          <p className="ui-error" role="alert">
            {fileError}
          </p>
        )}
        {files.length === 0 ? (
          <p className="ui-help">{t('files.empty')}</p>
        ) : (
          <ul className="ag-rows" aria-label={t('files.title')}>
            {files.map((f) => (
              <li key={f.id} className="ag-url">
                <div className="ag-url-main">
                  <span className="ag-url-title">{f.name}</span>
                  <span className="ui-help">
                    {f.kind.toUpperCase()} · {size(f.size)} · {t('knowledge.fetched', { chars: f.chars })} ·{' '}
                    <time dateTime={f.createdAt}>{format.dateTime(parseDbUtc(f.createdAt), { dateStyle: 'medium' })}</time>
                  </span>
                </div>
                {canEdit && (
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`${t('files.remove')}: ${f.name}`} onClick={() => void removeFile(f)}>
                    {t('files.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection
        title={t('qa.title')}
        description={t('qa.hint')}
        footer={
          canEdit ? (
            <>
              <p className="ui-section-note">{qaNotice ?? t('qa.importHint')}</p>
              <input ref={csvInput} type="file" accept=".csv,text/csv" className="sr-only" id="ag-qa-csv" onChange={(e) => void importCsv(e.target.files)} />
              <button type="button" className="btn btn-ghost btn-sm" disabled={qaBusy} onClick={() => csvInput.current?.click()}>
                {t('qa.importCsv')}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={qaBusy || Boolean(qaForm)} onClick={() => openQa()}>
                {t('qa.add')}
              </button>
            </>
          ) : undefined
        }
      >
        {qaForm && !qaForm.id && !answering && qaFormEl}
        {qa.length === 0 && !qaForm ? (
          <p className="ui-help">{t('qa.empty')}</p>
        ) : (
          <ul className="ag-rows" aria-label={t('qa.title')}>
            {qa.map((item) => (
              <li key={item.id} className="ag-qa">
                {qaForm?.id === item.id ? (
                  qaFormEl
                ) : (
                  <>
                    <div className="ag-url-main">
                      <span className="ag-url-title">{item.question}</span>
                      <span className="ui-help ag-qa-answer">{item.answer}</span>
                      {item.variants.length > 0 && <span className="ui-help">{t('qa.variantsCount', { count: item.variants.length })}</span>}
                    </div>
                    {canEdit && (
                      <span className="ag-row-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openQa(item)}>
                          {t('qa.edit')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" aria-label={`${t('qa.remove')}: ${item.question}`} onClick={() => void removeQa(item)}>
                          {t('qa.remove')}
                        </button>
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {qaError && !qaForm && (
          <p className="ui-error" role="alert">
            {qaError}
          </p>
        )}
      </FormSection>

      <FormSection title={t('suggestions.title')} description={t('suggestions.hint')}>
        {suggestError ? (
          <p className="ui-error" role="alert">
            {suggestError}
          </p>
        ) : suggestions === null ? (
          <div className="ui-loading-stack" aria-busy="true">
            <span className="sr-only">{t('suggestions.loading')}</span>
            <span className="ui-skeleton ui-skeleton-row" />
          </div>
        ) : suggestions.length === 0 ? (
          <p className="ui-help">{t('suggestions.empty')}</p>
        ) : (
          <ul className="ag-rows" aria-label={t('suggestions.title')}>
            {suggestions.map((s) => (
              <li key={s.runIds[0]} className="ag-qa">
                {answering?.runIds[0] === s.runIds[0] && qaForm ? (
                  qaFormEl
                ) : (
                  <>
                    <div className="ag-url-main">
                      <span className="ag-url-title">{s.question}</span>
                      <span className="ui-help">
                        {t('suggestions.count', { count: s.count })} ·{' '}
                        <time dateTime={s.lastAt}>{format.dateTime(parseDbUtc(s.lastAt), { dateStyle: 'medium' })}</time>
                      </span>
                    </div>
                    {canEdit && (
                      <span className="ag-row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={Boolean(qaForm)}
                          onClick={() => {
                            setAnswering(s);
                            openQa(undefined, s.question);
                          }}
                        >
                          {t('suggestions.addAnswer')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dismiss(s)}>
                          {t('suggestions.dismiss')}
                        </button>
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </FormSection>
    </>
  );
}
