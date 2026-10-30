'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CALC_OPS, CONDITION_OPS, type Condition, type FormDefinition, type LogicAction, type LogicRule, type Question } from '@/lib/forms/types';

type SetDef = (fn: (d: FormDefinition) => FormDefinition) => void;

const rid = () => `r${Math.random().toString(36).slice(2, 8)}`;

/** Operadores que tienen sentido para cada tipo de pregunta. */
function opsFor(q: Question | undefined, kind: 'q' | 'v' | 'h'): Condition['op'][] {
  if (kind === 'v') return ['is', 'is_not', 'gt', 'gte', 'lt', 'lte'];
  if (kind === 'h') return ['is', 'is_not', 'contains', 'not_contains', 'answered', 'not_answered'];
  switch (q?.type) {
    case 'multi_choice':
      return ['includes', 'not_includes', 'answered', 'not_answered'];
    case 'choice':
    case 'dropdown':
    case 'yes_no':
      return ['is', 'is_not', 'answered', 'not_answered'];
    case 'number':
    case 'rating':
    case 'opinion_scale':
    case 'date':
      return ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'answered', 'not_answered'];
    default:
      return CONDITION_OPS.filter((o) => !['includes', 'not_includes', 'gt', 'gte', 'lt', 'lte'].includes(o));
  }
}

/**
 * Lógica por pregunta: "Si … entonces saltar a / sumar al puntaje". Las
 * reglas se evalúan al dejar la pregunta, en orden; el primer salto gana.
 * Solo se puede saltar hacia adelante o a un final.
 */
export default function LogicPanel({ def, setDef }: { def: FormDefinition; setDef: SetDef }) {
  const t = useTranslations('forms.builder.logic');
  const tt = useTranslations('forms');
  const [qid, setQid] = useState(def.questions[0]?.id ?? '');
  const idx = def.questions.findIndex((q) => q.id === qid);
  const q = def.questions[idx];
  const rules = def.logic[qid] ?? [];
  const setRules = (fn: (r: LogicRule[]) => LogicRule[]) =>
    setDef((d) => {
      const next = fn(d.logic[qid] ?? []);
      const logic = { ...d.logic };
      if (next.length) logic[qid] = next;
      else delete logic[qid];
      return { ...d, logic };
    });
  const patchRule = (id: string, patch: Partial<LogicRule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const vars = ['score', ...def.variables.map((v) => v.name).filter((n) => n && n !== 'score')];
  const later = def.questions.slice(idx + 1);
  const upTo = def.questions.slice(0, idx + 1).filter((x) => x.type !== 'statement');

  if (!def.questions.length) return <p className="ui-help">{t('empty')}</p>;

  const leftOptions = [
    ...upTo.map((x) => ({ value: `q:${x.id}`, label: `${def.questions.indexOf(x) + 1}. ${x.title || tt(`types.${x.type}`)}` })),
    ...vars.map((v) => ({ value: `v:${v}`, label: `${t('variable')}: ${v}` })),
    ...def.hidden.map((h) => ({ value: `h:${h}`, label: `${t('hiddenField')}: ${h}` })),
  ];

  const valueInput = (c: Condition, onChange: (v: string) => void, label: string) => {
    if (c.op === 'answered' || c.op === 'not_answered') return null;
    const [kind, id] = c.left.split(':');
    const src = kind === 'q' ? def.questions.find((x) => x.id === id) : undefined;
    if (src && (src.type === 'choice' || src.type === 'dropdown' || src.type === 'multi_choice')) {
      return (
        <select className="select select-sm" aria-label={label} value={c.value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('pick')}</option>
          {(src.choices ?? []).map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.label}
            </option>
          ))}
        </select>
      );
    }
    if (src?.type === 'yes_no') {
      return (
        <select className="select select-sm" aria-label={label} value={c.value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('pick')}</option>
          <option value="yes">{tt('public.yes')}</option>
          <option value="no">{tt('public.no')}</option>
        </select>
      );
    }
    return <input className="input input-sm" aria-label={label} value={c.value} type={src?.type === 'date' ? 'date' : 'text'} onChange={(e) => onChange(e.target.value)} maxLength={300} />;
  };

  return (
    <div className="fm-logic">
      <div className="ui-field">
        <label className="label" htmlFor="fm-logic-q">
          {t('question')}
        </label>
        <select id="fm-logic-q" className="select" value={qid} onChange={(e) => setQid(e.target.value)}>
          {def.questions.map((x, i) => (
            <option key={x.id} value={x.id}>
              {i + 1}. {x.title || tt(`types.${x.type}`)}
              {def.logic[x.id]?.length ? ` (${def.logic[x.id].length})` : ''}
            </option>
          ))}
        </select>
        <p className="ui-help">{t('help')}</p>
      </div>

      {rules.map((r, ri) => (
        <fieldset key={r.id} className="fm-rule">
          <legend className="fm-rule-title">{t('rule', { n: ri + 1 })}</legend>
          {r.conditions.length > 1 && (
            <label className="fm-inline">
              <span>{t('match')}</span>
              <select className="select select-sm" value={r.match} onChange={(e) => patchRule(r.id, { match: e.target.value as 'all' | 'any' })}>
                <option value="all">{t('all')}</option>
                <option value="any">{t('any')}</option>
              </select>
            </label>
          )}
          {r.conditions.length === 0 && <p className="fm-rule-always">{t('always')}</p>}
          {r.conditions.map((c, ci) => {
            const [kind, id] = c.left.split(':') as ['q' | 'v' | 'h', string];
            const src = kind === 'q' ? def.questions.find((x) => x.id === id) : undefined;
            const setC = (patch: Partial<Condition>) => patchRule(r.id, { conditions: r.conditions.map((x, k) => (k === ci ? { ...x, ...patch } : x)) });
            return (
              <div key={ci} className="fm-cond">
                <span className="fm-cond-if">{ci === 0 ? t('if') : r.match === 'any' ? t('or') : t('and')}</span>
                <select className="select select-sm" aria-label={t('condLeft', { n: ci + 1 })} value={c.left} onChange={(e) => setC({ left: e.target.value, value: '', op: opsFor(def.questions.find((x) => `q:${x.id}` === e.target.value), e.target.value.split(':')[0] as 'q')[0] })}>
                  {leftOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select className="select select-sm" aria-label={t('condOp', { n: ci + 1 })} value={c.op} onChange={(e) => setC({ op: e.target.value as Condition['op'] })}>
                  {opsFor(src, kind).map((o) => (
                    <option key={o} value={o}>
                      {t(`ops.${o}`)}
                    </option>
                  ))}
                </select>
                {valueInput(c, (v) => setC({ value: v }), t('condValue', { n: ci + 1 }))}
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('removeCond', { n: ci + 1 })} onClick={() => patchRule(r.id, { conditions: r.conditions.filter((_, k) => k !== ci) })}>
                  ×
                </button>
              </div>
            );
          })}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => patchRule(r.id, { conditions: [...r.conditions, { left: `q:${qid}`, op: opsFor(q, 'q')[0], value: '' }] })} disabled={r.conditions.length >= 10}>
            {t('addCondition')}
          </button>

          {r.actions.map((a, ai) => {
            const setA = (next: LogicAction) => patchRule(r.id, { actions: r.actions.map((x, k) => (k === ai ? next : x)) });
            return (
              <div key={ai} className="fm-cond fm-action">
                <span className="fm-cond-if">{ai === 0 ? t('then') : t('and')}</span>
                <select
                  className="select select-sm"
                  aria-label={t('actionType', { n: ai + 1 })}
                  value={a.type}
                  onChange={(e) => setA(e.target.value === 'jump' ? { type: 'jump', to: later[0] ? `q:${later[0].id}` : `end:${def.endings[0].id}` } : { type: 'calc', variable: 'score', op: 'add', value: 1 })}
                >
                  <option value="jump">{t('jumpTo')}</option>
                  <option value="calc">{t('calc')}</option>
                </select>
                {a.type === 'jump' ? (
                  <select className="select select-sm" aria-label={t('jumpTarget', { n: ai + 1 })} value={a.to} onChange={(e) => setA({ type: 'jump', to: e.target.value })}>
                    {later.map((x) => (
                      <option key={x.id} value={`q:${x.id}`}>
                        {def.questions.indexOf(x) + 1}. {x.title || tt(`types.${x.type}`)}
                      </option>
                    ))}
                    {def.endings.map((e, ei) => (
                      <option key={e.id} value={`end:${e.id}`}>
                        {t('endingN', { n: ei + 1 })}: {e.title || '…'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <select className="select select-sm" aria-label={t('calcOp', { n: ai + 1 })} value={a.op} onChange={(e) => setA({ ...a, op: e.target.value as typeof a.op })}>
                      {CALC_OPS.map((o) => (
                        <option key={o} value={o}>
                          {t(`calcOps.${o}`)}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input input-sm fm-points"
                      aria-label={t('calcValue', { n: ai + 1 })}
                      type="number"
                      value={typeof a.value === 'number' ? a.value : 0}
                      onChange={(e) => setA({ ...a, value: Number(e.target.value) || 0 })}
                    />
                    <span className="fm-cond-if">{t('toVariable')}</span>
                    <select className="select select-sm" aria-label={t('calcVar', { n: ai + 1 })} value={a.variable} onChange={(e) => setA({ ...a, variable: e.target.value })}>
                      {vars.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('removeAction', { n: ai + 1 })} onClick={() => patchRule(r.id, { actions: r.actions.filter((_, k) => k !== ai) })} disabled={r.actions.length <= 1}>
                  ×
                </button>
              </div>
            );
          })}
          <div className="fm-rule-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => patchRule(r.id, { actions: [...r.actions, { type: 'calc', variable: 'score', op: 'add', value: 1 }] })} disabled={r.actions.length >= 10}>
              {t('addAction')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}>
              {t('removeRule')}
            </button>
          </div>
        </fieldset>
      ))}

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() =>
          setRules((rs) => [
            ...rs,
            { id: rid(), match: 'all', conditions: [{ left: `q:${qid}`, op: opsFor(q, 'q')[0], value: '' }], actions: [later[0] ? { type: 'jump', to: `q:${later[0].id}` } : { type: 'jump', to: `end:${def.endings[0].id}` }] },
          ])
        }
        disabled={rules.length >= 20}
      >
        {t('addRule')}
      </button>
    </div>
  );
}
