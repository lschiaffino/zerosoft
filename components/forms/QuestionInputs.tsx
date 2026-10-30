'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AnswerValue, FileAnswer, Question } from '@/lib/forms/types';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface Props {
  q: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue | undefined) => void;
  slug: string;
  preview: boolean;
  describedBy?: string;
  invalid: boolean;
  autoFocus: boolean;
  onUploadError: (code: string) => void;
  onEnter: () => void;
}

/** Un control por tipo de pregunta, con etiquetas reales y teclado. */
export function QuestionInput(p: Props) {
  const { q, value, onChange } = p;
  const t = useTranslations('forms.public');
  const common = {
    'aria-describedby': p.describedBy,
    'aria-invalid': p.invalid || undefined,
    'aria-required': q.required || undefined,
    'aria-labelledby': `fr-q-${q.id}-t`,
  };
  const af = p.autoFocus ? { 'data-autofocus': true } : {};
  switch (q.type) {
    case 'statement':
      return null;
    case 'short_text':
    case 'email':
    case 'phone':
    case 'url':
    case 'number':
      return (
        <input
          className="fr-input"
          type={q.type === 'short_text' ? 'text' : q.type === 'phone' ? 'tel' : q.type === 'number' ? 'text' : q.type}
          inputMode={q.type === 'number' ? 'decimal' : q.type === 'phone' ? 'tel' : undefined}
          autoComplete={q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : q.ref === 'name' ? 'name' : 'off'}
          value={value === undefined ? '' : String(value)}
          placeholder={q.placeholder || t(`placeholder.${q.type}`)}
          onChange={(e) => onChange(e.target.value)}
          maxLength={q.type === 'short_text' ? Math.min(q.max ?? 1000, 1000) : 2000}
          {...common}
          {...af}
        />
      );
    case 'long_text':
      return (
        <textarea
          className="fr-input fr-textarea"
          rows={3}
          value={typeof value === 'string' ? value : ''}
          placeholder={q.placeholder || t('placeholder.long_text')}
          onChange={(e) => onChange(e.target.value)}
          maxLength={Math.min(q.max ?? 10000, 10000)}
          {...common}
          {...af}
        />
      );
    case 'date':
      return <input className="fr-input fr-date" type="date" value={typeof value === 'string' ? value : ''} min={q.minDate} max={q.maxDate} onChange={(e) => onChange(e.target.value)} {...common} {...af} />;
    case 'dropdown':
      return (
        <select className="fr-input fr-select" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} {...common} {...af}>
          <option value="">{t('choose')}</option>
          {(q.choices ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      );
    case 'choice':
    case 'multi_choice': {
      const multi = q.type === 'multi_choice';
      const picked = multi ? ((value as string[] | undefined) ?? []) : [];
      return (
        <div className="fr-choices" role={multi ? 'group' : 'radiogroup'} {...common}>
          {multi && <p className="fr-sub">{q.max ? t('chooseUpTo', { n: q.max }) : t('chooseMany')}</p>}
          {(q.choices ?? []).map((c, i) => {
            const on = multi ? picked.includes(c.id) : value === c.id;
            return (
              <label key={c.id} className={`fr-choice${on ? ' is-on' : ''}`}>
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={`fr-${q.id}`}
                  value={c.id}
                  checked={on}
                  onChange={() => onChange(multi ? (on ? picked.filter((x) => x !== c.id) : [...picked, c.id]) : c.id)}
                  {...(i === 0 && p.autoFocus ? { 'data-autofocus': true } : {})}
                />
                <span className="fr-key" aria-hidden="true">
                  {LETTERS[i]}
                </span>
                <span className="fr-choice-label">{c.label}</span>
              </label>
            );
          })}
        </div>
      );
    }
    case 'yes_no':
      return (
        <div className="fr-choices fr-choices-row" role="radiogroup" {...common}>
          {[true, false].map((v, i) => (
            <label key={String(v)} className={`fr-choice${value === v ? ' is-on' : ''}`}>
              <input type="radio" name={`fr-${q.id}`} checked={value === v} onChange={() => onChange(v)} {...(i === 0 && p.autoFocus ? { 'data-autofocus': true } : {})} />
              <span className="fr-key" aria-hidden="true">
                {v ? t('yesKey') : 'N'}
              </span>
              <span className="fr-choice-label">{v ? t('yes') : t('no')}</span>
            </label>
          ))}
        </div>
      );
    case 'rating':
    case 'opinion_scale': {
      const lo = q.type === 'rating' ? 1 : q.nps ? 0 : (q.start ?? 1);
      const steps = q.type === 'opinion_scale' && q.nps ? 11 : (q.steps ?? 5);
      const nums = Array.from({ length: steps }, (_, i) => lo + i);
      return (
        <div className="fr-scale-wrap">
          <div className={`fr-scale${q.type === 'rating' ? ' fr-rating' : ''}`} role="radiogroup" {...common}>
            {nums.map((n, i) => (
              <label key={n} className={`fr-scale-item${value === n ? ' is-on' : ''}${q.type === 'rating' && typeof value === 'number' && n <= value ? ' is-filled' : ''}`}>
                <input type="radio" name={`fr-${q.id}`} checked={value === n} onChange={() => onChange(n)} aria-label={String(n)} {...(i === 0 && p.autoFocus ? { 'data-autofocus': true } : {})} />
                <span aria-hidden="true">{q.type === 'rating' ? '★' : n}</span>
              </label>
            ))}
          </div>
          {(q.leftLabel || q.rightLabel) && (
            <div className="fr-scale-labels" aria-hidden="true">
              <span>{q.leftLabel}</span>
              <span>{q.rightLabel}</span>
            </div>
          )}
        </div>
      );
    }
    case 'ranking':
      return <Ranking {...p} />;
    case 'matrix':
      return (
        <div className="fr-matrix-wrap">
          <table className="fr-matrix" {...common}>
            <thead>
              <tr>
                <td />
                {(q.columns ?? []).map((c) => (
                  <th key={c.id} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(q.rows ?? []).map((r, ri) => {
                const cur = (value as Record<string, string> | undefined) ?? {};
                return (
                  <tr key={r.id}>
                    <th scope="row" id={`fr-${q.id}-${r.id}`}>
                      {r.label}
                    </th>
                    {(q.columns ?? []).map((c, ci) => (
                      <td key={c.id}>
                        <input
                          type="radio"
                          name={`fr-${q.id}-${r.id}`}
                          checked={cur[r.id] === c.id}
                          onChange={() => onChange({ ...cur, [r.id]: c.id })}
                          aria-label={`${r.label}: ${c.label}`}
                          {...(ri === 0 && ci === 0 && p.autoFocus ? { 'data-autofocus': true } : {})}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    case 'file_upload':
      return <FileInput {...p} />;
    case 'signature':
      return <Signature {...p} />;
    default:
      return null;
  }
}

function Ranking({ q, value, onChange, autoFocus }: Props) {
  const t = useTranslations('forms.public');
  const order = Array.isArray(value) ? (value as string[]) : (q.choices ?? []).map((c) => c.id);
  const label = (id: string) => q.choices?.find((c) => c.id === id)?.label ?? id;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <ol className="fr-ranking" aria-labelledby={`fr-q-${q.id}-t`}>
      {order.map((id, i) => (
        <li key={id}>
          <span className="fr-rank-n" aria-hidden="true">
            {i + 1}
          </span>
          <span className="fr-rank-label">{label(id)}</span>
          <button type="button" className="fr-icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('moveUp', { item: label(id) })} {...(i === 0 && autoFocus ? {} : {})}>
            ↑
          </button>
          <button type="button" className="fr-icon-btn" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={t('moveDown', { item: label(id) })} {...(i === 0 && autoFocus ? { 'data-autofocus': true } : {})}>
            ↓
          </button>
        </li>
      ))}
    </ol>
  );
}

function FileInput({ q, value, onChange, slug, preview, describedBy, invalid, autoFocus, onUploadError }: Props) {
  const t = useTranslations('forms.public');
  const [busy, setBusy] = useState(false);
  const file = value as FileAnswer | undefined;
  async function upload(f: File) {
    if (preview) {
      onChange({ fileId: 'fmf_preview0000', name: f.name, size: f.size });
      return;
    }
    if (f.size > (q.maxMb ?? 10) * 1024 * 1024) {
      onUploadError('file_size');
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set('slug', slug);
    fd.set('question', q.id);
    fd.set('file', f);
    const res = await fetch('/api/forms/public/upload', { method: 'POST', body: fd }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { file?: FileAnswer; error?: string } | null) : null;
    setBusy(false);
    if (data?.file) {
      onChange(data.file);
      // El input de archivo desaparece: el foco pasa al botón de seguir (Enter avanza).
      setTimeout(() => document.querySelector<HTMLElement>(`[data-q="${q.id}"] .fr-actions .fr-btn, [data-q="${q.id}"] .fr-link`)?.focus(), 0);
    } else onUploadError(data?.error ?? 'upload');
  }
  return (
    <div className="fr-file">
      {file?.fileId ? (
        <p className="fr-file-name">
          <span>{file.name}</span>
          <button type="button" className="fr-link" onClick={() => onChange(undefined)}>
            {t('removeFile')}
          </button>
        </p>
      ) : (
        <label className="fr-file-drop">
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-labelledby={`fr-q-${q.id}-t`}
            {...(autoFocus ? { 'data-autofocus': true } : {})}
          />
          <span>{busy ? t('uploading') : t('chooseFile', { mb: q.maxMb ?? 10 })}</span>
        </label>
      )}
    </div>
  );
}

/** Firma simple: se dibuja con el mouse o el dedo, o se escribe el nombre (teclado). */
function Signature({ q, value, onChange, autoFocus }: Props) {
  const t = useTranslations('forms.public');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (!value) ctx.clearRect(0, 0, c.width, c.height);
  }, [value]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const commit = () => {
    const c = canvas.current;
    if (c) onChange(c.toDataURL('image/png'));
  };
  const typeName = (name: string) => {
    setTyped(name);
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!name.trim()) {
      onChange(undefined);
      return;
    }
    ctx.fillStyle = '#111';
    ctx.font = 'italic 44px Georgia, serif';
    ctx.fillText(name.slice(0, 40), 16, c.height / 2 + 14);
    commit();
  };
  return (
    <div className="fr-sign">
      <canvas
        ref={canvas}
        width={600}
        height={160}
        className="fr-sign-pad"
        aria-label={t('signHere')}
        role="img"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = e.currentTarget.getContext('2d')!;
          const pt = point(e);
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const pt = point(e);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          commit();
        }}
      />
      <div className="fr-sign-row">
        <label className="fr-sign-typed">
          <span>{t('signTyped')}</span>
          <input className="fr-input" type="text" value={typed} onChange={(e) => typeName(e.target.value)} maxLength={40} aria-describedby={`fr-q-${q.id}-t`} {...(autoFocus ? { 'data-autofocus': true } : {})} />
        </label>
        <button type="button" className="fr-link" onClick={() => typeName('')}>
          {t('clear')}
        </button>
      </div>
    </div>
  );
}
