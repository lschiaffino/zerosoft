'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { VoiceEnhanced, VoiceEnhancedPoint } from '@/lib/voice-types';

type Point = VoiceEnhancedPoint & { id: string };
interface Section {
  id: string;
  heading: string;
  points: Point[];
}
interface Doc {
  summary: string;
  sections: Section[];
}

let seq = 0;
const nid = () => `p${++seq}`;

function toDoc(e: VoiceEnhanced): Doc {
  return {
    summary: e.summary,
    sections: e.sections.map((s) => ({ id: nid(), heading: s.heading, points: s.points.map((p) => ({ ...p, level: p.level ?? 0, id: nid() })) })),
  };
}

export function fromDoc(doc: Doc): Pick<VoiceEnhanced, 'summary' | 'sections'> {
  return {
    summary: doc.summary.trim(),
    sections: doc.sections.map((s) => ({
      heading: s.heading.trim(),
      points: s.points.filter((p) => p.text.trim()).map((p) => ({ text: p.text.trim(), source: p.source, ...(p.level ? { level: 1 as const } : {}) })),
    })),
  };
}

/** Lo editable de una nota, para saber si lo que llega es otra nota o la misma. */
function signature(e: Pick<VoiceEnhanced, 'summary' | 'sections'>): string {
  return JSON.stringify([e.summary.trim(), e.sections.map((s) => [s.heading.trim(), s.points.map((p) => [p.text.trim(), p.source, p.level ? 1 : 0])])]);
}

/** Texto editable en el lugar (sin formato): no se pisa mientras tiene el foco. */
function Editable({
  tag: Tag,
  value,
  onChange,
  onKeyDown,
  className,
  label,
  placeholder,
  focus,
}: {
  tag: 'p' | 'h3' | 'span';
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  className?: string;
  label: string;
  placeholder?: string;
  /** Pedido de foco (cambia `n` en cada pedido). */
  focus?: { at: 'end' | 'start'; n: number } | null;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !focus) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(focus.at === 'start');
    sel.removeAllRanges();
    sel.addRange(range);
  }, [focus]);
  const Any = Tag as 'p';
  return (
    <Any
      ref={ref as React.Ref<HTMLParagraphElement>}
      className={`vc-edit ${className ?? ''}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-multiline={Tag === 'p' || undefined}
      data-placeholder={placeholder}
      data-voice-context="note"
      spellCheck
      onInput={(e) => onChange((e.currentTarget.textContent ?? '').replace(/\n/g, ' '))}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * Notas mejoradas como documento (Granola): el resumen, los títulos y cada
 * viñeta se editan en el lugar. Enter suma una viñeta, Tab la mete adentro
 * (Mayús+Tab la saca), Borrar en una vacía la quita. Lo que escribís queda en
 * tinta; lo que puso la IA, en gris hasta que lo cambiás. Se guarda solo.
 */
export default function NotesEditor({
  enhanced,
  onSave,
}: {
  enhanced: VoiceEnhanced;
  onSave: (next: Pick<VoiceEnhanced, 'summary' | 'sections'>) => void;
}) {
  const t = useTranslations('voice.notes');
  const [doc, setDoc] = useState<Doc>(() => toDoc(enhanced));
  const [focus, setFocus] = useState<{ id: string; at: 'end' | 'start'; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(doc);
  const dirty = useRef(false);

  // Una nota nueva (regenerada) reemplaza el documento. No al montar (ya se armó con ella) ni
  // cuando llega la misma nota otra vez (un refresco de la reunión): rehacerlo cambia los ids de
  // las viñetas y se pierde el foco y lo que se está escribiendo.
  const seen = useRef(signature(enhanced));
  useEffect(() => {
    const sig = signature(enhanced);
    if (sig === seen.current) return;
    seen.current = sig;
    if (sig === signature(fromDoc(latest.current))) return;
    const next = toDoc(enhanced);
    // `latest` es de donde salen las ediciones: tiene que ser el documento que se muestra.
    latest.current = next;
    dirty.current = false;
    setDoc(next);
  }, [enhanced]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current) {
      dirty.current = false;
      onSave(fromDoc(latest.current));
    }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function change(next: Doc) {
    latest.current = next;
    dirty.current = true;
    setDoc(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  }

  const updatePoints = (sid: string, fn: (pts: Point[]) => Point[]) =>
    change({ ...latest.current, sections: latest.current.sections.map((s) => (s.id === sid ? { ...s, points: fn(s.points) } : s)) });

  function onPointKey(e: KeyboardEvent<HTMLElement>, s: Section, i: number) {
    const p = s.points[i];
    const text = e.currentTarget.textContent ?? '';
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const id = nid();
      updatePoints(s.id, (pts) => [...pts.slice(0, i + 1), { id, text: '', source: 'mine', level: p.level ?? 0 }, ...pts.slice(i + 1)]);
      setFocus({ id, at: 'start', n: Date.now() });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const level = e.shiftKey ? 0 : i > 0 ? 1 : 0;
      updatePoints(s.id, (pts) => pts.map((x, j) => (j === i ? { ...x, level } : x)));
      setFocus({ id: p.id, at: 'end', n: Date.now() });
    } else if (e.key === 'Backspace' && !text && s.points.length > 1) {
      e.preventDefault();
      const prev = s.points[i - 1] ?? s.points[i + 1];
      updatePoints(s.id, (pts) => pts.filter((x) => x.id !== p.id));
      if (prev) setFocus({ id: prev.id, at: 'end', n: Date.now() });
    }
  }

  return (
    <div className="vc-notes-doc" onBlur={flush}>
      {(doc.summary || doc.sections.length === 0) && (
        <section>
          <h3 className="vc-h3">{t('summary')}</h3>
          <Editable tag="p" className="vc-summary" value={doc.summary} label={t('summary')} placeholder={t('summaryPlaceholder')} onChange={(v) => change({ ...latest.current, summary: v })} />
        </section>
      )}
      {doc.sections.map((s) => (
        <section key={s.id}>
          <Editable
            tag="h3"
            className="vc-h3"
            value={s.heading}
            label={t('heading')}
            onChange={(v) => change({ ...latest.current, sections: latest.current.sections.map((x) => (x.id === s.id ? { ...x, heading: v } : x)) })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const first = s.points[0];
                if (first) setFocus({ id: first.id, at: 'start', n: Date.now() });
              }
            }}
          />
          <ul className="vc-points">
            {s.points.map((p, i) => (
              <li key={p.id} className={`${p.source === 'mine' ? 'is-mine' : 'is-ai'}${p.level ? ' is-sub' : ''}`}>
                <Editable
                  tag="span"
                  value={p.text}
                  label={p.source === 'mine' ? t('pointMine') : t('pointAi')}
                  focus={focus?.id === p.id ? focus : null}
                  onChange={(v) => updatePoints(s.id, (pts) => pts.map((x) => (x.id === p.id ? { ...x, text: v, source: 'mine' } : x)))}
                  onKeyDown={(e) => onPointKey(e, s, i)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
