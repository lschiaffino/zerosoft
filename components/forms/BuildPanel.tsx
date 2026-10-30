'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CHOICE_TYPES, QUESTION_TYPES, type Choice, type Ending, type FormDefinition, type Question, type QuestionType } from '@/lib/forms/types';

type SetDef = (fn: (d: FormDefinition) => FormDefinition) => void;

const rid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;

function uniqueRef(def: FormDefinition, base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').slice(0, 30) || 'q';
  let ref = clean;
  let n = 2;
  while (def.questions.some((q) => q.ref === ref)) ref = `${clean}_${n++}`;
  return ref;
}

function blankQuestion(def: FormDefinition, type: QuestionType, label: (k: string) => string): Question {
  const q: Question = { id: rid('q_'), ref: uniqueRef(def, type), type, title: '', description: '', required: false };
  if (CHOICE_TYPES.includes(type)) q.choices = [1, 2, 3].map((i) => ({ id: rid('c'), label: `${label('option')} ${i}` }));
  if (type === 'matrix') {
    q.rows = [1, 2].map((i) => ({ id: rid('r'), label: `${label('row')} ${i}` }));
    q.columns = [1, 2, 3].map((i) => ({ id: rid('k'), label: `${label('column')} ${i}` }));
  }
  if (type === 'rating') q.steps = 5;
  if (type === 'opinion_scale') {
    q.steps = 10;
    q.start = 1;
  }
  if (type === 'file_upload') q.maxMb = 5;
  return q;
}

/** Preguntas, pantalla de bienvenida, finales, campos ocultos, variables y consentimiento. */
export default function BuildPanel({ def, setDef }: { def: FormDefinition; setDef: SetDef }) {
  const t = useTranslations('forms.builder');
  const tt = useTranslations('forms');
  const [selected, setSelected] = useState<string>(def.questions[0]?.id ?? 'welcome');
  const [addType, setAddType] = useState<QuestionType>('short_text');
  const q = def.questions.find((x) => x.id === selected);
  const ending = def.endings.find((e) => `end:${e.id}` === selected);

  const patchQ = (id: string, patch: Partial<Question>) => setDef((d) => ({ ...d, questions: d.questions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const move = (id: string, dir: -1 | 1) =>
    setDef((d) => {
      const i = d.questions.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.questions.length) return d;
      const qs = [...d.questions];
      [qs[i], qs[j]] = [qs[j], qs[i]];
      // Un salto hacia atrás no vale: las reglas que quedarían apuntando atrás se sacan.
      const idx = new Map(qs.map((x, k) => [x.id, k]));
      const logic: FormDefinition['logic'] = {};
      for (const [qid, rules] of Object.entries(d.logic)) {
        logic[qid] = rules
          .map((r) => ({ ...r, actions: r.actions.filter((a) => a.type !== 'jump' || a.to.startsWith('end:') || (idx.get(a.to.slice(2)) ?? -1) > (idx.get(qid) ?? 0)) }))
          .filter((r) => r.actions.length);
      }
      return { ...d, questions: qs, logic };
    });
  const remove = (id: string) => {
    setDef((d) => {
      const logic: FormDefinition['logic'] = {};
      for (const [qid, rules] of Object.entries(d.logic)) {
        if (qid === id) continue;
        logic[qid] = rules
          .map((r) => ({ ...r, conditions: r.conditions.filter((c) => c.left !== `q:${id}`), actions: r.actions.filter((a) => (a.type === 'jump' ? a.to !== `q:${id}` : a.value !== `q:${id}`)) }))
          .filter((r) => r.actions.length);
      }
      return { ...d, questions: d.questions.filter((x) => x.id !== id), logic };
    });
    setSelected('welcome');
  };
  const add = () => {
    const nq = blankQuestion(def, addType, (k) => t(`default.${k}`));
    setDef((d) => ({ ...d, questions: [...d.questions, nq] }));
    setSelected(nq.id);
  };
  const duplicate = (src: Question) => {
    const copy: Question = { ...src, id: rid('q_'), ref: uniqueRef(def, src.ref), choices: src.choices?.map((c) => ({ ...c })), rows: src.rows?.map((c) => ({ ...c })), columns: src.columns?.map((c) => ({ ...c })) };
    setDef((d) => {
      const i = d.questions.findIndex((x) => x.id === src.id);
      const qs = [...d.questions];
      qs.splice(i + 1, 0, copy);
      return { ...d, questions: qs };
    });
    setSelected(copy.id);
  };
  const patchEnding = (id: string, patch: Partial<Ending>) => setDef((d) => ({ ...d, endings: d.endings.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  return (
    <div className="fm-build">
      <aside className="fm-outline" aria-label={t('outline')}>
        <button type="button" className={`fm-outline-item${selected === 'welcome' ? ' is-on' : ''}`} onClick={() => setSelected('welcome')} aria-current={selected === 'welcome' || undefined}>
          {t('welcome')}
        </button>
        <ol className="fm-outline-list">
          {def.questions.map((x, i) => (
            <li key={x.id}>
              <button type="button" className={`fm-outline-item${selected === x.id ? ' is-on' : ''}`} onClick={() => setSelected(x.id)} aria-current={selected === x.id || undefined}>
                <span className="fm-outline-n">{i + 1}</span>
                <span className="fm-outline-t">{x.title || tt(`types.${x.type}`)}</span>
                {def.logic[x.id]?.length ? <span className="fm-outline-logic" title={t('hasLogic')}>⤳</span> : null}
              </button>
            </li>
          ))}
        </ol>
        <div className="fm-add">
          <label className="sr-only" htmlFor="fm-add-type">
            {t('questionType')}
          </label>
          <select id="fm-add-type" className="select select-sm" value={addType} onChange={(e) => setAddType(e.target.value as QuestionType)}>
            {QUESTION_TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {tt(`types.${ty}`)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={add}>
            {t('addQuestion')}
          </button>
        </div>
        <p className="fm-outline-h">{t('endings')}</p>
        <ul className="fm-outline-list">
          {def.endings.map((e) => (
            <li key={e.id}>
              <button type="button" className={`fm-outline-item${selected === `end:${e.id}` ? ' is-on' : ''}`} onClick={() => setSelected(`end:${e.id}`)} aria-current={selected === `end:${e.id}` || undefined}>
                <span className="fm-outline-t">{e.title || t('ending')}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const id = rid('end_');
            setDef((d) => ({ ...d, endings: [...d.endings, { id, title: '', description: '' }] }));
            setSelected(`end:${id}`);
          }}
          disabled={def.endings.length >= 20}
        >
          {t('addEnding')}
        </button>
        <button type="button" className={`fm-outline-item${selected === 'more' ? ' is-on' : ''}`} onClick={() => setSelected('more')} aria-current={selected === 'more' || undefined}>
          {t('more')}
        </button>
      </aside>

      <section className="fm-editor" aria-label={t('editor')}>
        {selected === 'welcome' && (
          <div className="ui-fields">
            <h2 className="fm-h2">{t('welcome')}</h2>
            <label className="ui-check">
              <input type="checkbox" checked={def.welcome.enabled} onChange={(e) => setDef((d) => ({ ...d, welcome: { ...d.welcome, enabled: e.target.checked } }))} />
              <span>{t('welcomeOn')}</span>
            </label>
            <Field label={t('title')} id="fm-w-title">
              <input id="fm-w-title" className="input" value={def.welcome.title} onChange={(e) => setDef((d) => ({ ...d, welcome: { ...d.welcome, title: e.target.value } }))} maxLength={500} />
            </Field>
            <Field label={t('description')} id="fm-w-desc">
              <textarea id="fm-w-desc" className="textarea" value={def.welcome.description} onChange={(e) => setDef((d) => ({ ...d, welcome: { ...d.welcome, description: e.target.value } }))} maxLength={2000} />
            </Field>
            <Field label={t('button')} id="fm-w-btn">
              <input id="fm-w-btn" className="input" value={def.welcome.button} onChange={(e) => setDef((d) => ({ ...d, welcome: { ...d.welcome, button: e.target.value } }))} maxLength={60} />
            </Field>
            {!def.questions.length && <p className="ui-help">{t('noQuestionsHelp')}</p>}
          </div>
        )}

        {q && (
          <QuestionEditor
            key={q.id}
            q={q}
            index={def.questions.indexOf(q)}
            total={def.questions.length}
            onPatch={(p) => patchQ(q.id, p)}
            onMove={(d) => move(q.id, d)}
            onRemove={() => remove(q.id)}
            onDuplicate={() => duplicate(q)}
            refTaken={(r) => def.questions.some((x) => x.ref === r && x.id !== q.id)}
          />
        )}

        {ending && (
          <div className="ui-fields">
            <h2 className="fm-h2">{t('ending')}</h2>
            <Field label={t('title')} id="fm-e-title" help={t('pipingHelp')}>
              <input id="fm-e-title" className="input" value={ending.title} onChange={(e) => patchEnding(ending.id, { title: e.target.value })} maxLength={500} />
            </Field>
            <Field label={t('description')} id="fm-e-desc">
              <textarea id="fm-e-desc" className="textarea" value={ending.description} onChange={(e) => patchEnding(ending.id, { description: e.target.value })} maxLength={2000} />
            </Field>
            <Field label={t('redirectUrl')} id="fm-e-url" help={t('redirectHelp')}>
              <input id="fm-e-url" className="input" type="url" placeholder="https://" value={ending.redirectUrl ?? ''} onChange={(e) => patchEnding(ending.id, { redirectUrl: e.target.value })} maxLength={2000} />
            </Field>
            <div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                disabled={def.endings.length <= 1}
                onClick={() => {
                  setDef((d) => {
                    const logic: FormDefinition['logic'] = {};
                    for (const [qid, rules] of Object.entries(d.logic)) logic[qid] = rules.map((r) => ({ ...r, actions: r.actions.filter((a) => a.type !== 'jump' || a.to !== `end:${ending.id}`) })).filter((r) => r.actions.length);
                    return { ...d, endings: d.endings.filter((e) => e.id !== ending.id), logic };
                  });
                  setSelected('welcome');
                }}
              >
                {t('removeEnding')}
              </button>
            </div>
          </div>
        )}

        {selected === 'more' && <MoreSettings def={def} setDef={setDef} />}
      </section>
    </div>
  );
}

export function Field({ label, id, help, children }: { label: string; id: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="ui-field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {help && <p className="ui-help">{help}</p>}
    </div>
  );
}

function ChoiceList({ items, onChange, label, withPoints, idPrefix }: { items: Choice[]; onChange: (c: Choice[]) => void; label: string; withPoints?: boolean; idPrefix: string }) {
  const t = useTranslations('forms.builder');
  return (
    <fieldset className="fm-choices-edit">
      <legend className="label">{label}</legend>
      {items.map((c, i) => (
        <div key={c.id} className="fm-choice-row">
          <span className="fm-choice-key" aria-hidden="true">
            {String.fromCharCode(65 + i)}
          </span>
          <input className="input" aria-label={`${label} ${i + 1}`} value={c.label} maxLength={300} onChange={(e) => onChange(items.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))} />
          {withPoints && (
            <input
              className="input fm-points"
              type="number"
              aria-label={t('points', { n: i + 1 })}
              title={t('pointsHelp')}
              value={c.points ?? ''}
              placeholder="0"
              onChange={(e) => onChange(items.map((x) => (x.id === c.id ? { ...x, points: e.target.value === '' ? undefined : Number(e.target.value) } : x)))}
            />
          )}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('removeOption', { n: i + 1 })} onClick={() => onChange(items.filter((x) => x.id !== c.id))} disabled={items.length <= 1}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([...items, { id: `${idPrefix}${Math.random().toString(36).slice(2, 8)}`, label: '' }])} disabled={items.length >= 100}>
        {t('addOption')}
      </button>
    </fieldset>
  );
}

function num(v: string): number | undefined {
  return v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);
}

function QuestionEditor({ q, index, total, onPatch, onMove, onRemove, onDuplicate, refTaken }: { q: Question; index: number; total: number; onPatch: (p: Partial<Question>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onDuplicate: () => void; refTaken: (r: string) => boolean }) {
  const t = useTranslations('forms.builder');
  const tt = useTranslations('forms');
  const [ref, setRef] = useState(q.ref);
  const refOk = /^[a-z][a-z0-9_]{0,39}$/.test(ref) && !refTaken(ref);
  const textual = ['short_text', 'long_text'].includes(q.type);
  return (
    <div className="ui-fields">
      <div className="fm-q-head">
        <h2 className="fm-h2">
          {t('questionN', { n: index + 1 })} · {tt(`types.${q.type}`)}
        </h2>
        <div className="fm-q-tools">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t('moveUp')}>
            ↑
          </button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onMove(1)} disabled={index === total - 1} aria-label={t('moveDown')}>
            ↓
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDuplicate}>
            {t('duplicate')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={onRemove}>
            {t('remove')}
          </button>
        </div>
      </div>
      <Field label={t('questionTitle')} id={`fm-q-title-${q.id}`} help={t('pipingHelp')}>
        <textarea id={`fm-q-title-${q.id}`} className="textarea fm-q-title-input" rows={2} value={q.title} onChange={(e) => onPatch({ title: e.target.value })} maxLength={500} />
      </Field>
      <Field label={t('description')} id={`fm-q-desc-${q.id}`}>
        <textarea id={`fm-q-desc-${q.id}`} className="textarea" rows={2} value={q.description} onChange={(e) => onPatch({ description: e.target.value })} maxLength={2000} />
      </Field>
      <div className="ui-fields-2">
        {q.type !== 'statement' && (
          <label className="ui-check">
            <input type="checkbox" checked={q.required} onChange={(e) => onPatch({ required: e.target.checked })} />
            <span>{t('required')}</span>
          </label>
        )}
        <Field label={t('ref')} id={`fm-q-ref-${q.id}`} help={refOk ? t('refHelp', { ref: `{{${ref}}}` }) : t('refInvalid')}>
          <input
            id={`fm-q-ref-${q.id}`}
            className="input mono"
            value={ref}
            aria-invalid={!refOk || undefined}
            onChange={(e) => {
              const v = e.target.value.toLowerCase().slice(0, 40);
              setRef(v);
              if (/^[a-z][a-z0-9_]{0,39}$/.test(v) && !refTaken(v)) onPatch({ ref: v });
            }}
          />
        </Field>
      </div>
      {['short_text', 'long_text', 'email', 'phone', 'number', 'url'].includes(q.type) && (
        <Field label={t('placeholder')} id={`fm-q-ph-${q.id}`}>
          <input id={`fm-q-ph-${q.id}`} className="input" value={q.placeholder ?? ''} onChange={(e) => onPatch({ placeholder: e.target.value })} maxLength={200} />
        </Field>
      )}
      {(textual || q.type === 'number' || q.type === 'multi_choice') && (
        <div className="ui-fields-2">
          <Field label={textual ? t('minLength') : q.type === 'number' ? t('minValue') : t('minChoices')} id={`fm-q-min-${q.id}`}>
            <input id={`fm-q-min-${q.id}`} className="input" type="number" value={q.min ?? ''} onChange={(e) => onPatch({ min: num(e.target.value) })} />
          </Field>
          <Field label={textual ? t('maxLength') : q.type === 'number' ? t('maxValue') : t('maxChoices')} id={`fm-q-max-${q.id}`}>
            <input id={`fm-q-max-${q.id}`} className="input" type="number" value={q.max ?? ''} onChange={(e) => onPatch({ max: num(e.target.value) })} />
          </Field>
        </div>
      )}
      {q.type === 'date' && (
        <div className="ui-fields-2">
          <Field label={t('minDate')} id={`fm-q-mind-${q.id}`}>
            <input id={`fm-q-mind-${q.id}`} className="input" type="date" value={q.minDate ?? ''} onChange={(e) => onPatch({ minDate: e.target.value || undefined })} />
          </Field>
          <Field label={t('maxDate')} id={`fm-q-maxd-${q.id}`}>
            <input id={`fm-q-maxd-${q.id}`} className="input" type="date" value={q.maxDate ?? ''} onChange={(e) => onPatch({ maxDate: e.target.value || undefined })} />
          </Field>
        </div>
      )}
      {CHOICE_TYPES.includes(q.type) && <ChoiceList items={q.choices ?? []} onChange={(c) => onPatch({ choices: c })} label={t('options')} withPoints={q.type === 'choice' || q.type === 'multi_choice'} idPrefix="c" />}
      {q.type === 'matrix' && (
        <div className="ui-fields-2">
          <ChoiceList items={q.rows ?? []} onChange={(c) => onPatch({ rows: c })} label={t('rows')} idPrefix="r" />
          <ChoiceList items={q.columns ?? []} onChange={(c) => onPatch({ columns: c })} label={t('columns')} idPrefix="k" />
        </div>
      )}
      {q.type === 'rating' && (
        <Field label={t('steps')} id={`fm-q-steps-${q.id}`}>
          <select id={`fm-q-steps-${q.id}`} className="select" value={q.steps ?? 5} onChange={(e) => onPatch({ steps: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      )}
      {q.type === 'opinion_scale' && (
        <>
          <label className="ui-check">
            <input type="checkbox" checked={Boolean(q.nps)} onChange={(e) => onPatch(e.target.checked ? { nps: true, steps: 11, start: 0 } : { nps: false, steps: 10, start: 1 })} />
            <span>{t('nps')}</span>
          </label>
          {!q.nps && (
            <div className="ui-fields-2">
              <Field label={t('steps')} id={`fm-q-steps-${q.id}`}>
                <select id={`fm-q-steps-${q.id}`} className="select" value={q.steps ?? 10} onChange={(e) => onPatch({ steps: Number(e.target.value) })}>
                  {[5, 7, 10, 11].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('startAt')} id={`fm-q-start-${q.id}`}>
                <select id={`fm-q-start-${q.id}`} className="select" value={q.start ?? 1} onChange={(e) => onPatch({ start: Number(e.target.value) as 0 | 1 })}>
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                </select>
              </Field>
            </div>
          )}
          <div className="ui-fields-2">
            <Field label={t('leftLabel')} id={`fm-q-l-${q.id}`}>
              <input id={`fm-q-l-${q.id}`} className="input" value={q.leftLabel ?? ''} onChange={(e) => onPatch({ leftLabel: e.target.value })} maxLength={80} />
            </Field>
            <Field label={t('rightLabel')} id={`fm-q-r-${q.id}`}>
              <input id={`fm-q-r-${q.id}`} className="input" value={q.rightLabel ?? ''} onChange={(e) => onPatch({ rightLabel: e.target.value })} maxLength={80} />
            </Field>
          </div>
        </>
      )}
      {q.type === 'file_upload' && (
        <Field label={t('maxMb')} id={`fm-q-mb-${q.id}`} help={t('fileHelp')}>
          <input id={`fm-q-mb-${q.id}`} className="input" type="number" min={1} max={10} value={q.maxMb ?? 5} onChange={(e) => onPatch({ maxMb: Math.max(1, Math.min(10, Number(e.target.value) || 5)) })} />
        </Field>
      )}
      {q.type === 'statement' && (
        <Field label={t('button')} id={`fm-q-btn-${q.id}`}>
          <input id={`fm-q-btn-${q.id}`} className="input" value={q.button ?? ''} onChange={(e) => onPatch({ button: e.target.value })} maxLength={60} />
        </Field>
      )}
    </div>
  );
}

function MoreSettings({ def, setDef }: { def: FormDefinition; setDef: SetDef }) {
  const t = useTranslations('forms.builder');
  const [hidden, setHidden] = useState(def.hidden.join(', '));
  return (
    <div className="ui-fields">
      <h2 className="fm-h2">{t('more')}</h2>
      <Field label={t('hidden')} id="fm-hidden" help={t('hiddenHelp')}>
        <input
          id="fm-hidden"
          className="input mono"
          value={hidden}
          onChange={(e) => {
            setHidden(e.target.value);
            const names = [...new Set(e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9_]{1,40}$/.test(s)))].slice(0, 20);
            setDef((d) => ({ ...d, hidden: names }));
          }}
        />
      </Field>
      <fieldset className="fm-vars">
        <legend className="label">{t('variables')}</legend>
        <p className="ui-help">{t('variablesHelp')}</p>
        {def.variables.map((v, i) => (
          <div key={i} className="fm-choice-row">
            <input
              className="input mono"
              aria-label={t('variableName', { n: i + 1 })}
              value={v.name}
              onChange={(e) => {
                const name = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
                setDef((d) => ({ ...d, variables: d.variables.map((x, k) => (k === i ? { ...x, name } : x)) }));
              }}
            />
            <input className="input fm-points" type="number" aria-label={t('variableInitial', { n: i + 1 })} value={v.initial} onChange={(e) => setDef((d) => ({ ...d, variables: d.variables.map((x, k) => (k === i ? { ...x, initial: Number(e.target.value) || 0 } : x)) }))} />
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('removeVariable', { n: i + 1 })} onClick={() => setDef((d) => ({ ...d, variables: d.variables.filter((_, k) => k !== i) }))}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDef((d) => ({ ...d, variables: [...d.variables, { name: `var${d.variables.length + 1}`, initial: 0 }] }))} disabled={def.variables.length >= 10}>
          {t('addVariable')}
        </button>
      </fieldset>
      <h3 className="fm-h3">{t('consent')}</h3>
      <label className="ui-check">
        <input type="checkbox" checked={def.consent.enabled} onChange={(e) => setDef((d) => ({ ...d, consent: { ...d.consent, enabled: e.target.checked } }))} />
        <span>{t('consentOn')}</span>
      </label>
      {def.consent.enabled && (
        <>
          <Field label={t('consentText')} id="fm-consent">
            <textarea id="fm-consent" className="textarea" value={def.consent.text} onChange={(e) => setDef((d) => ({ ...d, consent: { ...d.consent, text: e.target.value } }))} maxLength={1000} />
          </Field>
          <label className="ui-check">
            <input type="checkbox" checked={def.consent.required} onChange={(e) => setDef((d) => ({ ...d, consent: { ...d.consent, required: e.target.checked } }))} />
            <span>{t('consentRequired')}</span>
          </label>
        </>
      )}
    </div>
  );
}
