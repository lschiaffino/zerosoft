'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';

/**
 * Barra de edición táctil (celular y tablet), como la de la app de Notion:
 * arriba del teclado mientras se escribe en un bloque. Cada botón hace lo
 * mismo que su atajo de teclado (el editor no tiene otra lógica que la del
 * teclado): "+" abre el menú de bloques (/), @ menciona, [[ linkea una
 * página, negrita/itálica/subrayado y link, anidar y desanidar, deshacer y
 * rehacer, y ocultar el teclado.
 */
type Action =
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: string; mod?: boolean; shift?: boolean }
  | { kind: 'blur' };

const ACTIONS: Array<{ id: string; label: string; action: Action; sep?: boolean }> = [
  { id: 'insert', label: '+', action: { kind: 'text', text: '/' } },
  { id: 'mention', label: '@', action: { kind: 'text', text: '@' } },
  { id: 'link-page', label: '[[', action: { kind: 'text', text: '[[' } },
  { id: 'bold', label: 'B', action: { kind: 'key', key: 'b', mod: true }, sep: true },
  { id: 'italic', label: 'I', action: { kind: 'key', key: 'i', mod: true } },
  { id: 'underline', label: 'U', action: { kind: 'key', key: 'u', mod: true } },
  { id: 'link', label: '', action: { kind: 'key', key: 'k', mod: true } },
  { id: 'indent', label: '→', action: { kind: 'key', key: 'Tab' }, sep: true },
  { id: 'outdent', label: '←', action: { kind: 'key', key: 'Tab', shift: true } },
  { id: 'undo', label: '↺', action: { kind: 'key', key: 'z', mod: true }, sep: true },
  { id: 'redo', label: '↻', action: { kind: 'key', key: 'z', mod: true, shift: true } },
  { id: 'done', label: '⌄', action: { kind: 'blur' }, sep: true },
];

const QUERY = '(max-width: 720px), (pointer: coarse)';

function editableTarget(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !el.isContentEditable || !el.closest('.docs-editor')) return null;
  return el;
}

export default function DocsTouchBar({ enabled }: { enabled: boolean }) {
  const t = useTranslations('docs.touchbar');
  const [touch, setTouch] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const mq = window.matchMedia(QUERY);
    const sync = () => setTouch(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    const onFocus = () => setActive(Boolean(editableTarget()));
    // focusout llega antes de que el foco pase al bloque siguiente: se mira en el próximo frame.
    const onBlur = () => requestAnimationFrame(() => setActive(Boolean(editableTarget())));
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => {
      mq.removeEventListener('change', sync);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
    };
  }, [enabled]);

  // Arriba del teclado: el alto que tapa el teclado sale del visualViewport.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv || !active) return;
    const place = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--docs-kb', `${Math.round(kb)}px`);
    };
    place();
    vv.addEventListener('resize', place);
    vv.addEventListener('scroll', place);
    return () => {
      vv.removeEventListener('resize', place);
      vv.removeEventListener('scroll', place);
      document.documentElement.style.removeProperty('--docs-kb');
    };
  }, [active]);

  if (!enabled || !touch || !active) return null;

  const run = (a: Action) => {
    const el = editableTarget();
    if (!el) return;
    if (a.kind === 'blur') {
      el.blur();
      return;
    }
    if (a.kind === 'text') {
      // Como tipearlo: dispara el input del editor (menú /, @ y [[).
      document.execCommand('insertText', false, a.text);
      return;
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: a.key, ctrlKey: Boolean(a.mod), shiftKey: Boolean(a.shift), bubbles: true, cancelable: true }));
  };

  return (
    <div className="docs-touchbar" role="toolbar" aria-label={t('label')} data-testid="docs-touchbar">
      {ACTIONS.map((a) => (
        <span key={a.id} style={{ display: 'contents' }}>
          {a.sep && <span className="docs-touchbar-sep" aria-hidden="true" />}
          <button
            type="button"
            aria-label={t(a.id)}
            title={t(a.id)}
            data-action={a.id}
            // Sin robar el foco (ni la selección) del bloque.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(a.action)}
            style={a.id === 'bold' ? { fontWeight: 700 } : a.id === 'italic' ? { fontStyle: 'italic' } : a.id === 'underline' ? { textDecoration: 'underline' } : undefined}
          >
            {a.id === 'link' ? <Icon name="links" size={16} /> : a.label}
          </button>
        </span>
      ))}
    </div>
  );
}
