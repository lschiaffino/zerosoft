'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import PdfPages, { type PageSize } from './PdfPages';
import { PARTY_COLORS } from './ui';

export type FieldKind = 'signature' | 'initials' | 'date' | 'name' | 'email' | 'text' | 'checkbox' | 'dropdown';
export const KINDS: FieldKind[] = ['signature', 'initials', 'date', 'name', 'email', 'text', 'checkbox', 'dropdown'];
const AUTO: FieldKind[] = ['date', 'name', 'email'];

/** Tamaño por defecto de cada tipo, en fracciones de la página. */
const SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.26, h: 0.06 },
  initials: { w: 0.1, h: 0.05 },
  date: { w: 0.18, h: 0.03 },
  name: { w: 0.26, h: 0.03 },
  email: { w: 0.28, h: 0.03 },
  text: { w: 0.26, h: 0.03 },
  checkbox: { w: 0.035, h: 0.025 },
  dropdown: { w: 0.22, h: 0.03 },
};

export interface Party {
  id: string;
  name: string;
}

export interface PlacedField {
  key: string;
  partyId: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label: string;
  options: string[];
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
let seq = 0;
export const newKey = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Editor de campos sobre el PDF (sobres y plantillas): elegir para quién y
 * qué tipo, hacer clic en la página para ponerlo, arrastrar para moverlo y
 * la esquina para cambiar el tamaño. Con teclado: Tab llega a cada campo,
 * flechas lo mueven (Shift, más rápido), Supr lo borra, Esc lo suelta.
 */
export default function FieldPlacer({
  src,
  pages,
  parties,
  fields,
  onChange,
}: {
  src: string;
  pages: PageSize[];
  parties: Party[];
  fields: PlacedField[];
  onChange: (fields: PlacedField[]) => void;
}) {
  const t = useTranslations('sign.fields');
  const [party, setParty] = useState(parties[0]?.id ?? '');
  const [tool, setTool] = useState<FieldKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ key: string; mode: 'move' | 'resize'; startX: number; startY: number; orig: PlacedField; pw: number; ph: number } | null>(null);

  useEffect(() => {
    if (!parties.some((p) => p.id === party)) setParty(parties[0]?.id ?? '');
  }, [parties, party]);

  const colorOf = useCallback((partyId: string) => PARTY_COLORS[Math.max(0, parties.findIndex((p) => p.id === partyId)) % PARTY_COLORS.length], [parties]);
  const update = (key: string, patch: Partial<PlacedField>) => onChange(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const remove = (key: string) => {
    onChange(fields.filter((f) => f.key !== key));
    setSelected(null);
  };
  const sel = fields.find((f) => f.key === selected) ?? null;

  const place = (page: number, px: number, py: number) => {
    if (!tool) {
      setSelected(null);
      return;
    }
    if (!party) return;
    const s = SIZE[tool];
    const f: PlacedField = {
      key: newKey(),
      partyId: party,
      kind: tool,
      page,
      x: clamp(px - s.w / 2, 0, 1 - s.w),
      y: clamp(py - s.h / 2, 0, 1 - s.h),
      w: s.w,
      h: s.h,
      required: true,
      label: '',
      options: tool === 'dropdown' ? [t('defaultOption', { n: 1 }), t('defaultOption', { n: 2 })] : [],
    };
    onChange([...fields, f]);
    setSelected(f.key);
    setTool(null);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, f: PlacedField, mode: 'move' | 'resize') => {
    e.stopPropagation();
    const pageEl = (e.currentTarget as HTMLElement).closest('.sg-page-overlay') as HTMLElement | null;
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    drag.current = { key: f.key, mode, startX: e.clientX, startY: e.clientY, orig: f, pw: r.width, ph: r.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(f.key);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.pw;
    const dy = (e.clientY - d.startY) / d.ph;
    if (d.mode === 'move') update(d.key, { x: clamp(d.orig.x + dx, 0, 1 - d.orig.w), y: clamp(d.orig.y + dy, 0, 1 - d.orig.h) });
    else update(d.key, { w: clamp(d.orig.w + dx, 0.02, 1 - d.orig.x), h: clamp(d.orig.h + dy, 0.012, 1 - d.orig.y) });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKey = (e: KeyboardEvent<HTMLElement>, f: PlacedField) => {
    const step = e.shiftKey ? 0.02 : 0.004;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (move[e.key]) {
      e.preventDefault();
      const [dx, dy] = move[e.key];
      update(f.key, { x: clamp(f.x + dx, 0, 1 - f.w), y: clamp(f.y + dy, 0, 1 - f.h) });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(f.key);
    } else if (e.key === 'Escape') {
      setSelected(null);
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(f.key);
    }
  };

  if (!parties.length) return <p className="ui-help">{t('noParties')}</p>;

  return (
    <div className="sg-placer">
      <div className="sg-placer-tools" role="toolbar" aria-label={t('toolbar')}>
        <label className="ui-field sg-party-pick">
          <span className="label">{t('for')}</span>
          <select className="select" value={party} onChange={(e) => setParty(e.target.value)}>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="sg-kinds">
          {KINDS.map((k) => (
            <button key={k} type="button" className={`btn btn-sm ${tool === k ? 'btn-primary' : 'btn-outline'}`} aria-pressed={tool === k} onClick={() => setTool(tool === k ? null : k)}>
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>
        <p className="ui-help sg-placer-hint" aria-live="polite">
          {tool ? t('placeHint', { kind: t(`kind.${tool}`) }) : t('pickHint')}
        </p>
      </div>

      <div className="sg-placer-body">
        <div className={`sg-placer-doc${tool ? ' is-placing' : ''}`}>
          <PdfPages
            src={src}
            pages={pages}
            label={t('document')}
            onPageClick={place}
            overlay={(page) =>
              fields
                .filter((f) => f.page === page)
                .map((f) => {
                  const who = parties.find((p) => p.id === f.partyId)?.name ?? '';
                  return (
                    <div
                      key={f.key}
                      role="button"
                      tabIndex={0}
                      aria-label={t('fieldLabel', { kind: t(`kind.${f.kind}`), who })}
                      aria-pressed={selected === f.key}
                      className={`sg-field-box${selected === f.key ? ' is-selected' : ''}`}
                      data-kind={f.kind}
                      style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, ['--party' as string]: colorOf(f.partyId) }}
                      onPointerDown={(e) => onPointerDown(e, f, 'move')}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={() => setSelected(f.key)}
                      onKeyDown={(e) => onKey(e, f)}
                    >
                      <span className="sg-field-text">
                        {t(`kind.${f.kind}`)}
                        {f.required ? '' : ` · ${t('optionalShort')}`}
                      </span>
                      <span className="sg-field-resize" aria-hidden onPointerDown={(e) => onPointerDown(e, f, 'resize')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
                    </div>
                  );
                })
            }
          />
        </div>

        <aside className="sg-placer-side" aria-label={t('selected')}>
          {sel ? (
            <div className="ui-fields">
              <h3 className="sg-side-title">{t(`kind.${sel.kind}`)}</h3>
              <label className="ui-field">
                <span className="label">{t('for')}</span>
                <select className="select" value={sel.partyId} onChange={(e) => update(sel.key, { partyId: e.target.value })}>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {!AUTO.includes(sel.kind) && (
                <label className="ui-check">
                  <input type="checkbox" checked={sel.required} onChange={(e) => update(sel.key, { required: e.target.checked })} />
                  <span>{t('required')}</span>
                </label>
              )}
              {AUTO.includes(sel.kind) && <p className="ui-help">{t('autoHint')}</p>}
              {(sel.kind === 'text' || sel.kind === 'checkbox' || sel.kind === 'dropdown') && (
                <label className="ui-field">
                  <span className="label">{t('label')}</span>
                  <input className="input" maxLength={80} value={sel.label} onChange={(e) => update(sel.key, { label: e.target.value })} />
                </label>
              )}
              {sel.kind === 'dropdown' && (
                <label className="ui-field">
                  <span className="label">{t('options')}</span>
                  <textarea
                    className="textarea"
                    rows={4}
                    value={sel.options.join('\n')}
                    onChange={(e) => update(sel.key, { options: e.target.value.split('\n').map((x) => x.slice(0, 100)).slice(0, 50) })}
                  />
                  <span className="ui-help">{t('optionsHint')}</span>
                </label>
              )}
              <p className="ui-help">{t('page', { page: sel.page })}</p>
              <div className="sg-row">
                <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(sel.key)}>
                  {t('remove')}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(null)}>
                  {t('done')}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="ui-help">{t('sideEmpty')}</p>
              <ul className="sg-legend">
                {parties.map((p) => (
                  <li key={p.id} style={{ ['--party' as string]: colorOf(p.id) }}>
                    <span className="sg-legend-swatch" aria-hidden />
                    {p.name} · {t('count', { n: fields.filter((f) => f.partyId === p.id).length })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
