'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { renderPlaybookMarkdown } from '@/lib/crm-playbook-markdown';
import { ENUM_PROPERTIES, type Playbook, type PlaybookEntity, type PlaybookQuestion } from '@/lib/crm-playbooks-schema';
import { isDefaultOutcome } from '@/lib/crm-calls';

export interface PlaybookCallDraft {
  outcome?: string;
  durationMin?: number;
  note?: string;
  channel?: '' | 'whatsapp';
}

interface PlaybookRunnerProps {
  playbook: Playbook;
  entity: PlaybookEntity;
  entityId: string;
  /** Valores actuales del registro por propiedad ('jobTitle', 'custom.budget'…) para precargar. */
  values?: Record<string, string>;
  /** Abierto desde el registro de una llamada: se guarda como llamada con estos datos. */
  call?: PlaybookCallDraft;
  onClose: () => void;
  onSaved?: () => void;
}

/** Resultados de llamada configurados (mismo endpoint que PhoneTouch). */
async function loadCallOutcomes(): Promise<string[]> {
  const res = await fetch('/api/crm/settings').catch(() => null);
  const data = (await res?.json().catch(() => null)) as { callOutcomes?: string[] } | null;
  return data?.callOutcomes ?? [];
}

/**
 * Usar un playbook en un registro: el guion arriba y las preguntas abajo. Al
 * guardar, las respuestas mapeadas actualizan el registro y el uso queda en
 * el timeline como nota o llamada. Drawer nativo (foco atrapado, Esc cierra).
 */
export default function PlaybookRunner({ playbook, entity, entityId, values = {}, call, onClose, onSaved }: PlaybookRunnerProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const questions = playbook.questions;
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const q of questions) {
      if (!q.property.startsWith(`${entity}:`)) continue;
      const v = values[q.property.slice(entity.length + 1)];
      if (v) init[q.id] = v;
    }
    return init;
  });
  const [logAs, setLogAs] = useState<'note' | 'call'>(call ? 'call' : 'note');
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [outcome, setOutcome] = useState(call?.outcome ?? '');
  const [minutes, setMinutes] = useState(call?.durationMin !== undefined ? String(call.durationMin) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const html = useMemo(() => renderPlaybookMarkdown(playbook.body), [playbook.body]);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (logAs === 'call' && outcomes.length === 0) void loadCallOutcomes().then(setOutcomes);
  }, [logAs, outcomes.length]);

  const enumLabel = (q: PlaybookQuestion, v: string): string => {
    if (q.property.endsWith(':lifecycleStage')) return t(`enums.lifecycle.${v}`);
    if (q.property.endsWith(':leadStatus')) return t(`enums.leadStatus.${v}`);
    if (q.property.endsWith(':priority')) return t(`enums.priority.${v}`);
    return v;
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/playbooks/${playbook.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entity,
        entityId,
        answers,
        logAs,
        ...(logAs === 'call'
          ? {
              call: {
                outcome: outcome || undefined,
                durationMin: minutes ? Math.max(0, Math.round(Number(minutes) || 0)) : undefined,
                channel: call?.channel ?? '',
                note: call?.note || undefined,
              },
            }
          : {}),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('playbooks.runError'));
      return;
    }
    onSaved?.();
    dialogRef.current?.close();
    router.refresh();
  }

  function input(q: PlaybookQuestion) {
    const value = answers[q.id] ?? '';
    const set = (v: string) => setAnswers((a) => ({ ...a, [q.id]: v }));
    const id = `${titleId}-${q.id}`;
    const enumValues = ENUM_PROPERTIES[q.property];
    if (enumValues || q.type === 'select') {
      const opts = enumValues ? [...enumValues] : q.options;
      return (
        <select id={id} className="select" value={value} onChange={(e) => set(e.target.value)}>
          <option value="">{t('playbooks.noAnswer')}</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {enumValues ? enumLabel(q, o) : o}
            </option>
          ))}
        </select>
      );
    }
    if (q.type === 'longtext') {
      return <textarea id={id} className="textarea" rows={3} maxLength={5000} value={value} onChange={(e) => set(e.target.value)} />;
    }
    return (
      <input
        id={id}
        className="input"
        type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text'}
        value={value}
        maxLength={5000}
        onChange={(e) => set(e.target.value)}
      />
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="ui-drawer pb-drawer"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
      data-testid="playbook-runner"
    >
      <div className="ui-drawer-head">
        <h2 id={titleId} className="ui-drawer-title">
          {playbook.name}
        </h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => dialogRef.current?.close()} aria-label={t('record.close')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <form className="ui-drawer-body pb-run" onSubmit={save}>
        {html ? (
          <section className="pb-script" aria-label={t('playbooks.script')}>
            <div className="pb-markdown" dangerouslySetInnerHTML={{ __html: html }} />
          </section>
        ) : null}
        {questions.length > 0 && (
          <fieldset className="pb-questions">
            <legend className="prop-label">{t('playbooks.questions')}</legend>
            {questions.map((q) => (
              <div key={q.id} className="field">
                <label htmlFor={`${titleId}-${q.id}`} className="pb-q-label">
                  {q.label}
                </label>
                {input(q)}
                {q.property.startsWith(`${entity}:`) && <span className="muted pb-q-hint">{t('playbooks.savesToProperty')}</span>}
              </div>
            ))}
          </fieldset>
        )}
        <fieldset className="pb-logas">
          <legend className="prop-label">{t('playbooks.logAs')}</legend>
          <label className="ui-check">
            <input type="radio" name={`${titleId}-logas`} checked={logAs === 'note'} onChange={() => setLogAs('note')} /> {t('playbooks.logNote')}
          </label>
          <label className="ui-check">
            <input type="radio" name={`${titleId}-logas`} checked={logAs === 'call'} onChange={() => setLogAs('call')} /> {t('playbooks.logCall')}
          </label>
        </fieldset>
        {logAs === 'call' && (
          <div className="pb-call">
            <label className="field">
              <span className="prop-label">{t('calls.outcome')}</span>
              <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="">{t('playbooks.noAnswer')}</option>
                {outcomes.map((o) => (
                  <option key={o} value={o}>
                    {isDefaultOutcome(o) ? t(`calls.outcomes.${o}`) : o}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="prop-label">{t('calls.minutes')}</span>
              <input className="input" type="number" min={0} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </label>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-solid btn-small" disabled={busy} data-testid="playbook-save">
            {busy ? t('common.saving') : t('playbooks.saveRun')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => dialogRef.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
