'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import RichEditor, { type MentionMember, type RichEditorHandle } from './RichEditor';

const WIDTH = 360;
const MARGIN = 16;

/**
 * Composer de un comentario en línea (texto elegido de la descripción), como
 * Linear: flota debajo de la selección con la cita arriba; ⌘↵ comenta, Esc o
 * un clic afuera lo cierran. En el teléfono ocupa el ancho de la pantalla.
 */
export default function InlineCommentComposer({
  issueId,
  quote,
  at,
  members,
  onClose,
  onPosted,
}: {
  issueId: string;
  quote: string;
  /** Debajo de la selección (coordenadas de la ventana). */
  at: { top: number; left: number };
  members: MentionMember[];
  onClose: () => void;
  onPosted: (commentId: string) => void;
}) {
  const tt = useTranslations('track.ux.thread');
  const ti = useTranslations('track.ux.inline');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const editor = useRef<RichEditorHandle>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>({ top: at.top, left: at.left, width: WIDTH });
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const bodyRef = useRef(body);
  bodyRef.current = body;

  // Dentro de la pantalla, arriba de la selección si abajo no entra. En el teléfono va abajo,
  // de lado a lado (styles: .track-inline-composer.is-sheet).
  useLayoutEffect(() => {
    if (window.matchMedia('(max-width: 599px)').matches) {
      setPos(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(WIDTH, vw - MARGIN * 2);
    const left = Math.max(MARGIN, Math.min(at.left, vw - width - MARGIN));
    const h = box.current?.offsetHeight ?? 180;
    const top = at.top + h > vh - MARGIN ? Math.max(MARGIN, at.top - h - 48) : at.top;
    setPos({ top, left, width });
  }, [at.top, at.left]);

  // Teléfono: el teclado en pantalla achica el visualViewport; la hoja sube con él.
  useEffect(() => {
    const vv = window.visualViewport;
    if (pos || !vv) return;
    const on = () => box.current?.style.setProperty('--kb-inset', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, [pos]);

  useEffect(() => {
    editor.current?.focus();
    // Un clic afuera cierra solo si no hay nada escrito (no se pierde un borrador).
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && box.current?.contains(t)) return;
      if ((t as HTMLElement | null)?.closest?.('.track-md-menu, [role="listbox"]')) return;
      if (bodyRef.current.trim()) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  async function submit() {
    const text = body.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/track/issues/${issueId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text, anchor: quote }),
    }).catch(() => null);
    busyRef.current = false;
    setBusy(false);
    if (!res?.ok) {
      setError(tt('postError'));
      return;
    }
    const data = (await res.json()) as { id: string };
    onPosted(data.id);
  }

  return (
    <div
      ref={box}
      className={`track-inline-composer${pos ? '' : ' is-sheet'}`}
      role="dialog"
      aria-modal="false"
      aria-label={ti('title')}
      aria-describedby="track-inline-quote"
      style={pos ? { top: pos.top, left: pos.left, width: pos.width } : undefined}
      data-testid="track-inline-composer"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <blockquote className="track-comment-quote" id="track-inline-quote" data-testid="track-inline-quote">
        {quote}
      </blockquote>
      <RichEditor
        ref={editor}
        value={body}
        onChange={setBody}
        ariaLabel={ti('placeholder')}
        placeholder={ti('placeholder')}
        members={members}
        onSubmit={() => void submit()}
        onEscape={onClose}
        compact
        testId="track-inline-editor"
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="track-inline-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {ti('cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!body.trim() || busy}
          aria-busy={busy || undefined}
          onClick={() => void submit()}
          data-testid="track-inline-submit"
        >
          {ti('submit')}
        </button>
      </div>
    </div>
  );
}
