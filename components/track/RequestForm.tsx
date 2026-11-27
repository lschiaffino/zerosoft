'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { Link } from '@/i18n/navigation';
import { validateFormAnswers, type FormAnswerError, type TrackFormAnswers, type TrackFormField } from '@/lib/track-forms';
import { MarkdownView } from './MarkdownView';

interface Props {
  templateId: string;
  name: string;
  instructions: string;
  titlePrefix: string;
  fields: TrackFormField[];
  team: { name: string; key: string; triage: boolean };
}

type Sent = { id: string; identifier: string; triage: boolean };

/**
 * Formulario de pedidos de un team: título, los campos de la plantilla y
 * detalles libres. Al enviar crea el issue (en triage si el team lo tiene) y
 * deja mandar otro.
 */
export default function RequestForm({ templateId, name, instructions, titlePrefix, fields, team }: Props) {
  const t = useTranslations('track');
  const [title, setTitle] = useState(titlePrefix);
  const [answers, setAnswers] = useState<TrackFormAnswers>({});
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<FormAnswerError[]>([]);
  const [titleMissing, setTitleMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const errorOf = (id: string) => errors.find((e) => e.fieldId === id);
  const setAnswer = (id: string, v: string | boolean) => {
    setAnswers((cur) => ({ ...cur, [id]: v }));
    if (errorOf(id)) setErrors((cur) => cur.filter((e) => e.fieldId !== id));
  };

  function focusFirstError(fieldErrors: FormAnswerError[], noTitle: boolean) {
    if (noTitle) {
      titleRef.current?.focus();
      return;
    }
    const first = fieldErrors[0];
    if (first) formRef.current?.querySelector<HTMLElement>(`[data-field-id="${first.fieldId}"]`)?.focus();
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const noTitle = !title.trim();
    const checked = validateFormAnswers(fields, answers);
    const fieldErrors = checked.ok ? [] : checked.errors;
    setTitleMissing(noTitle);
    setErrors(fieldErrors);
    if (noTitle || fieldErrors.length) {
      focusFirstError(fieldErrors, noTitle);
      return;
    }
    setBusy(true);
    setFailed(false);
    const res = await fetch(`/api/track/templates/${templateId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), answers, details }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      setSent((await res.json()) as Sent);
      return;
    }
    const body = res ? ((await res.json().catch(() => null)) as { fields?: FormAnswerError[] } | null) : null;
    if (body?.fields?.length) {
      setErrors(body.fields);
      focusFirstError(body.fields, false);
    } else setFailed(true);
  }

  function again() {
    setSent(null);
    setTitle(titlePrefix);
    setAnswers({});
    setDetails('');
    setErrors([]);
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  const header = <PageHeader title={name} description={t(team.triage ? 'forms.pageDescTriage' : 'forms.pageDesc', { team: team.name })} back={{ href: '/app/track/forms', label: t('forms.indexTitle') }} />;

  if (sent) {
    return (
      <>
        {header}
        <section className="track-request-sent" role="status" data-testid="track-request-sent">
          <p className="track-request-sent-title">{t('forms.sentTitle', { id: sent.identifier })}</p>
          <p className="ui-help">{t(sent.triage ? 'forms.sentTriage' : 'forms.sentList', { team: team.name })}</p>
          <div className="track-inline-form-actions">
            <button type="button" className="btn btn-sm" onClick={again} data-testid="track-request-again">
              {t('forms.sendAnother')}
            </button>
            <Link className="btn btn-primary btn-sm" href={`/app/track/issue/${encodeURIComponent(sent.identifier)}`} data-testid="track-request-open">
              {t('forms.openIssue')}
            </Link>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {header}
      <form
        ref={formRef}
        className="track-request-form"
        onSubmit={submit}
        noValidate
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        data-testid="track-request-form"
      >
        {instructions.trim() && (
          <div className="track-request-instructions">
            <MarkdownView source={instructions} />
          </div>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="track-request-title">
            {t('forms.titleLabel')}
            <span className="track-request-required" aria-hidden="true"> *</span>
          </label>
          <input
            ref={titleRef}
            id="track-request-title"
            className="input"
            value={title}
            maxLength={500}
            autoFocus
            required
            aria-invalid={titleMissing || undefined}
            aria-describedby={titleMissing ? 'track-request-title-error' : undefined}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleMissing && e.target.value.trim()) setTitleMissing(false);
            }}
            data-testid="track-request-title"
          />
          {titleMissing && (
            <p className="ui-error" id="track-request-title-error">
              {t('forms.errors.required')}
            </p>
          )}
        </div>
        {fields.map((f) => {
          const id = `track-request-${f.id}`;
          const err = errorOf(f.id);
          const described = [f.help ? `${id}-help` : '', err ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
          const help = f.help ? (
            <p className="ui-help" id={`${id}-help`}>
              {f.help}
            </p>
          ) : null;
          const errorLine = err ? (
            <p className="ui-error" id={`${id}-error`}>
              {t(`forms.errors.${err.code}`)}
            </p>
          ) : null;
          if (f.type === 'checkbox') {
            return (
              <div key={f.id} className="ui-field" data-testid="track-request-field">
                <label className="ui-check">
                  <input
                    type="checkbox"
                    data-field-id={f.id}
                    checked={answers[f.id] === true}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={described}
                    onChange={(e) => setAnswer(f.id, e.target.checked)}
                  />
                  <span>
                    {f.label}
                    {f.required && <span className="track-request-required" aria-hidden="true"> *</span>}
                  </span>
                </label>
                {help}
                {errorLine}
              </div>
            );
          }
          const common = {
            id,
            'data-field-id': f.id,
            'aria-invalid': err ? true : undefined,
            'aria-describedby': described,
            'aria-required': f.required || undefined,
          } as const;
          return (
            <div key={f.id} className="ui-field" data-testid="track-request-field">
              <label className="label" htmlFor={id}>
                {f.label}
                {f.required ? <span className="track-request-required" aria-hidden="true"> *</span> : <span className="ui-optional"> {t('common.optional')}</span>}
              </label>
              {f.type === 'textarea' ? (
                <textarea {...common} className="textarea" rows={4} value={(answers[f.id] as string) ?? ''} onChange={(e) => setAnswer(f.id, e.target.value)} />
              ) : f.type === 'select' ? (
                <select {...common} className="select" value={(answers[f.id] as string) ?? ''} onChange={(e) => setAnswer(f.id, e.target.value)}>
                  <option value="">{t('forms.choose')}</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input {...common} className="input" value={(answers[f.id] as string) ?? ''} maxLength={10_000} onChange={(e) => setAnswer(f.id, e.target.value)} />
              )}
              {help}
              {errorLine}
            </div>
          );
        })}
        <div className="ui-field">
          <label className="label" htmlFor="track-request-details">
            {t('forms.details')} <span className="ui-optional">{t('common.optional')}</span>
          </label>
          <textarea id="track-request-details" className="textarea" rows={4} value={details} maxLength={20_000} onChange={(e) => setDetails(e.target.value)} />
        </div>
        {failed && (
          <p className="ui-error" role="alert">
            {t('forms.sendError')}
          </p>
        )}
        <div className="track-inline-form-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined} data-testid="track-request-submit">
            {t('forms.submit')}
          </button>
        </div>
      </form>
    </>
  );
}
