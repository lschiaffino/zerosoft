'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { renderPlaybookMarkdown } from '@/lib/crm-playbook-markdown';
import {
  ENUM_PROPERTIES,
  PLAYBOOK_ENTITIES,
  PLAYBOOK_PROPERTIES,
  QUESTION_TYPES,
  customKind,
  kindFits,
  standardKind,
  type Playbook,
  type PlaybookEntity,
  type PlaybookQuestion,
  type QuestionType,
} from '@/lib/crm-playbooks-schema';

export interface PlaybookRunView {
  id: string;
  when: string;
  recordName: string;
  recordHref: string | null;
  actor: string;
}

interface PlaybookEditorProps {
  playbook: Playbook;
  customFields: Record<PlaybookEntity, Array<{ name: string; label: string; type: string; options: string[] }>>;
  canEdit: boolean;
  runs: PlaybookRunView[];
}

function newId(): string {
  return `q${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Editor de un playbook: nombre, dónde se ofrece, guion en Markdown (con
 * vista previa) y preguntas que pueden guardar su respuesta en una propiedad.
 * Cmd/Ctrl+S guarda.
 */
export default function PlaybookEditor({ playbook, customFields, canEdit, runs }: PlaybookEditorProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [name, setName] = useState(playbook.name);
  const [body, setBody] = useState(playbook.body);
  const [entities, setEntities] = useState<PlaybookEntity[]>(playbook.entities);
  const [questions, setQuestions] = useState<PlaybookQuestion[]>(playbook.questions);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveRef = useRef<() => void>(() => {});
  const preview = useMemo(() => (mode === 'preview' ? renderPlaybookMarkdown(body) : ''), [mode, body]);

  function touch<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setDirty(true);
      setNotice(null);
    };
  }

  const propLabel = (entity: PlaybookEntity, key: string): string => t(`playbooks.props.${entity}.${key}`);

  function customField(target: string) {
    const m = /^(contact|company|deal):custom\.(.+)$/.exec(target);
    return m ? customFields[m[1] as PlaybookEntity].find((f) => f.name === m[2]) : undefined;
  }

  /** ¿La respuesta de una pregunta de tipo `type` entra en la propiedad `target`? */
  function targetFits(target: string, type: QuestionType): boolean {
    if (target.includes(':custom.')) {
      const field = customField(target);
      const kind = field ? customKind(field.type) : 'text';
      return kind !== null && kindFits(kind, type);
    }
    return kindFits(standardKind(target), type);
  }

  function updateQuestion(i: number, patch: Partial<PlaybookQuestion>) {
    setQuestions((qs) =>
      qs.map((q, k) => {
        if (k !== i) return q;
        const next = { ...q, ...patch };
        // Cambiar el tipo a uno que la propiedad no acepta la suelta.
        if (patch.type !== undefined && next.property && !targetFits(next.property, next.type)) next.property = '';
        // Una propiedad propia de tipo lista trae sus opciones si la pregunta no tenía.
        if (patch.property !== undefined && next.type === 'select' && next.options.length === 0) {
          const field = customField(next.property);
          if (field?.type === 'select') next.options = [...field.options];
        }
        return next;
      }),
    );
    setDirty(true);
    setNotice(null);
  }

  function moveQuestion(i: number, dir: -1 | 1) {
    setQuestions((qs) => {
      const j = i + dir;
      if (j < 0 || j >= qs.length) return qs;
      const next = [...qs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }

  async function save() {
    if (!canEdit || busy) return;
    if (!name.trim()) {
      setError(t('playbooks.nameRequired'));
      return;
    }
    if (questions.some((q) => !q.label.trim())) {
      setError(t('playbooks.questionRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/playbooks/${playbook.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        body,
        entities,
        questions: questions.map((q) => ({
          ...q,
          label: q.label.trim(),
          options: q.type === 'select' && !ENUM_PROPERTIES[q.property] ? q.options.map((o) => o.trim()).filter(Boolean) : [],
        })),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('playbooks.saveError'));
      return;
    }
    setDirty(false);
    setNotice(t('playbooks.saved'));
    router.refresh();
  }
  saveRef.current = () => void save();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/crm/playbooks/${playbook.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setConfirmDelete(false);
      setError(t('playbooks.deleteError'));
      return;
    }
    router.push('/app/crm/playbooks');
    router.refresh();
  }

  const disabled = !canEdit;

  return (
    <div className="pb-editor">
      {!canEdit && <p className="muted">{t('common.adminOnly')}</p>}
      <label className="field">
        <span className="prop-label">{t('playbooks.name')}</span>
        <input
          className="input"
          value={name}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => touch(setName)(e.target.value)}
          data-testid="playbook-name"
        />
      </label>

      <fieldset className="pb-entities">
        <legend className="prop-label">{t('playbooks.availableIn')}</legend>
        {PLAYBOOK_ENTITIES.map((en) => (
          <label key={en} className="ui-check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={entities.includes(en)}
              onChange={(e) => {
                const next = e.target.checked ? [...entities, en] : entities.filter((x) => x !== en);
                if (next.length) touch(setEntities)(next);
              }}
            />{' '}
            {t(`playbooks.entity.${en}`)}
          </label>
        ))}
      </fieldset>

      <section className="pb-body">
        <div className="pb-body-head">
          <span className="prop-label">{t('playbooks.script')}</span>
          <div className="btn-group" role="group" aria-label={t('playbooks.script')}>
            {(['write', 'preview'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} className="btn btn-secondary btn-sm" onClick={() => setMode(m)}>
                {t(`playbooks.mode.${m}`)}
              </button>
            ))}
          </div>
        </div>
        {mode === 'write' ? (
          <textarea
            className="textarea pb-textarea"
            rows={12}
            value={body}
            maxLength={20000}
            disabled={disabled}
            onChange={(e) => touch(setBody)(e.target.value)}
            placeholder={t('playbooks.scriptPlaceholder')}
            aria-label={t('playbooks.script')}
            data-testid="playbook-body"
          />
        ) : preview ? (
          <div className="pb-markdown pb-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        ) : (
          <p className="muted pb-preview">{t('playbooks.emptyPreview')}</p>
        )}
        <p className="muted pb-help">{t('playbooks.markdownHelp')}</p>
      </section>

      <section className="pb-qs" aria-labelledby="pb-qs-title">
        <h2 id="pb-qs-title" className="assoc-title">
          {t('playbooks.questions')} <span className="num muted">{questions.length}</span>
        </h2>
        {questions.length === 0 && <p className="muted">{t('playbooks.noQuestions')}</p>}
        <ol className="pb-q-list">
          {questions.map((q, i) => {
            return (
              <li key={q.id} className="pb-q" data-testid="playbook-question">
                <div className="pb-q-row">
                  <input
                    className="input pb-q-text"
                    value={q.label}
                    maxLength={300}
                    disabled={disabled}
                    placeholder={t('playbooks.questionPlaceholder')}
                    aria-label={t('playbooks.questionLabel', { n: i + 1 })}
                    onChange={(e) => updateQuestion(i, { label: e.target.value })}
                  />
                  <select
                    className="filter-select"
                    value={q.type}
                    disabled={disabled}
                    aria-label={t('playbooks.questionType')}
                    onChange={(e) => updateQuestion(i, { type: e.target.value as QuestionType })}
                  >
                    {QUESTION_TYPES.map((qt) => (
                      <option key={qt} value={qt}>
                        {t(`playbooks.type.${qt}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="pb-q-row">
                  <select
                    className="filter-select pb-q-prop"
                    value={q.property}
                    disabled={disabled}
                    aria-label={t('playbooks.savesTo')}
                    onChange={(e) => updateQuestion(i, { property: e.target.value })}
                  >
                    <option value="">{t('playbooks.timelineOnly')}</option>
                    {entities.map((en) => (
                      <optgroup key={en} label={t(`playbooks.entity.${en}`)}>
                        {PLAYBOOK_PROPERTIES[en]
                          .filter((k) => targetFits(`${en}:${k}`, q.type) || q.property === `${en}:${k}`)
                          .map((k) => (
                            <option key={k} value={`${en}:${k}`}>
                              {propLabel(en, k)}
                            </option>
                          ))}
                        {customFields[en]
                          .filter((f) => targetFits(`${en}:custom.${f.name}`, q.type) || q.property === `${en}:custom.${f.name}`)
                          .map((f) => (
                            <option key={f.name} value={`${en}:custom.${f.name}`}>
                              {f.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <span className="pb-q-tools">
                    <button type="button" className="icon-btn" disabled={disabled || i === 0} onClick={() => moveQuestion(i, -1)} aria-label={t('playbooks.moveUp')}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={disabled || i === questions.length - 1}
                      onClick={() => moveQuestion(i, 1)}
                      aria-label={t('playbooks.moveDown')}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      disabled={disabled}
                      onClick={() => {
                        setQuestions((qs) => qs.filter((_, k) => k !== i));
                        setDirty(true);
                      }}
                      aria-label={t('playbooks.removeQuestion')}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {q.type === 'select' && !ENUM_PROPERTIES[q.property] && (
                  <input
                    className="input"
                    value={q.options.join(', ')}
                    disabled={disabled}
                    placeholder={t('playbooks.optionsPlaceholder')}
                    aria-label={t('playbooks.options')}
                    onChange={(e) => updateQuestion(i, { options: e.target.value.split(',').map((o) => o.trimStart()).slice(0, 30) })}
                  />
                )}
              </li>
            );
          })}
        </ol>
        {canEdit && (
          <button
            type="button"
            className="btn btn-small"
            disabled={questions.length >= 40}
            onClick={() => {
              setQuestions((qs) => [...qs, { id: newId(), label: '', type: 'text', options: [], property: '' }]);
              setDirty(true);
            }}
            data-testid="playbook-add-question"
          >
            {t('playbooks.addQuestion')}
          </button>
        )}
      </section>

      {error && <p className="form-error">{error}</p>}
      {canEdit && (
        <div className="form-actions pb-actions">
          <button type="button" className="btn btn-solid btn-small" onClick={() => void save()} disabled={busy || !dirty} data-testid="playbook-save-def">
            {busy ? t('common.saving') : t('common.save')}
          </button>
          {notice && (
            <span className="muted" role="status">
              {notice}
            </span>
          )}
          <button type="button" className="btn btn-ghost btn-small pb-delete" onClick={() => setConfirmDelete(true)} data-testid="playbook-delete">
            {t('playbooks.delete')}
          </button>
        </div>
      )}

      <section className="pb-runs" aria-labelledby="pb-runs-title">
        <h2 id="pb-runs-title" className="assoc-title">
          {t('playbooks.recentUses')}
        </h2>
        {runs.length === 0 ? (
          <p className="muted">{t('playbooks.noUses')}</p>
        ) : (
          <ul className="record-summary-list">
            {runs.map((r) => (
              <li key={r.id}>
                {r.recordHref ? <Link href={r.recordHref}>{r.recordName}</Link> : <span>{r.recordName}</span>}
                <span className="muted">
                  {r.when}
                  {r.actor ? ` · ${r.actor}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title={t('playbooks.deleteTitle', { name: playbook.name })}
        body={t('playbooks.deleteBody')}
        confirmLabel={t('playbooks.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
