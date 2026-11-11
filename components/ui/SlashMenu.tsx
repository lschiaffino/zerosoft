'use client';

import type { ReactNode } from 'react';
import type { SlashItem, SlashOption, SlashView } from '@/lib/slash-commands';
import '@/styles/slash-menu.css';

export interface SlashMenuLabels {
  /** Nombre de la lista para lectores de pantalla. */
  label: string;
  actions: string;
  inserts: string;
  ai: string;
  /** Un comando con argumento sin opciones que coincidan. */
  empty: string;
  /** Las teclas, al pie (no se muestra en el teléfono). */
  foot: string;
  /** "3 resultados", para lectores de pantalla. */
  count: (n: number) => string;
  /** Marca de una opción que ya está puesta. */
  checked: string;
}

/**
 * La lista de comandos de un composer: se abre encima del campo (en el
 * teléfono, a todo el ancho y con filas altas). El foco no sale del campo: la
 * fila marcada se anuncia con aria-activedescendant. Lo maneja useSlashMenu.
 */
export default function SlashMenu({
  id,
  view,
  index,
  labels,
  onHover,
  onPick,
}: {
  id: string;
  view: SlashView;
  index: number;
  labels: SlashMenuLabels;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
}) {
  const row = (i: number, key: string, name: string, body: ReactNode) => (
    <div
      key={key}
      id={`${id}-o${i}`}
      role="option"
      aria-selected={i === index}
      aria-label={name}
      className={`slash-item${i === index ? ' is-active' : ''}`}
      data-testid="slash-item"
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => i !== index && onHover(i)}
      onClick={() => onPick(i)}
    >
      {body}
    </div>
  );

  let content: ReactNode;
  if (view.mode === 'args') {
    content = (
      <>
        <p className="slash-head" role="presentation">
          <strong>/{view.command.name}</strong>
          <span>{view.command.description}</span>
        </p>
        {view.options.length === 0 ? (
          <p className="slash-empty" role="presentation">
            {view.command.emptyText ?? labels.empty}
          </p>
        ) : (
          view.options.map((o, i) => row(i, o.id, optionName(o, labels), <OptionRow o={o} checked={labels.checked} />))
        )}
      </>
    );
  } else {
    const groups: Array<{ section: SlashItem['section']; rows: Array<{ it: SlashItem; i: number }> }> = [];
    view.items.forEach((it, i) => {
      const last = groups.at(-1);
      if (last && last.section === it.section) last.rows.push({ it, i });
      else groups.push({ section: it.section, rows: [{ it, i }] });
    });
    content = groups.map((g) => (
      <div key={g.section} role="group" aria-label={labels[g.section]} className="slash-group">
        <p className="slash-section" role="presentation">
          {labels[g.section]}
        </p>
        {g.rows.map(({ it, i }) =>
          it.kind === 'command'
            ? row(
                i,
                `c-${it.command.id}`,
                `/${it.command.name}, ${it.command.description}`,
                <>
                  <span className="slash-icon" aria-hidden="true">
                    {(it.command.icon as ReactNode) ?? <span className="slash-glyph">/</span>}
                  </span>
                  <span className="slash-main">
                    <strong>/{it.command.name}</strong>
                    <span className="slash-desc">{it.command.description}</span>
                  </span>
                  {it.command.shortcut && (
                    <span className="kbd slash-kbd" aria-hidden="true">
                      {it.command.shortcut}
                    </span>
                  )}
                </>,
              )
            : row(
                i,
                `i-${it.insert.id}`,
                `${it.insert.shortcut ? `/${it.insert.shortcut}, ` : ''}${it.insert.title || it.insert.body.slice(0, 80)}`,
                <>
                  <span className="slash-icon" aria-hidden="true">
                    <span className="slash-glyph">↵</span>
                  </span>
                  <span className="slash-main">
                    <strong>{it.insert.shortcut ? `/${it.insert.shortcut}` : it.insert.title}</strong>
                    <span className="slash-desc">{it.insert.title && it.insert.shortcut ? `${it.insert.title} · ${it.insert.body.slice(0, 80)}` : it.insert.body.slice(0, 100)}</span>
                  </span>
                </>,
              ),
        )}
      </div>
    ));
  }

  const n = view.mode === 'args' ? view.options.length : view.items.length;
  return (
    <div className="slash-anchor">
      <div className={`slash-menu is-${view.mode}`} data-testid="slash-menu" data-slash-menu>
        <div id={id} role="listbox" aria-label={view.mode === 'args' ? `/${view.command.name}` : labels.label} className="slash-list">
          {content}
        </div>
        <p className="slash-foot" aria-hidden="true">
          {labels.foot}
        </p>
        <span className="sr-only" role="status">
          {n === 0 && view.mode === 'args' ? (view.command.emptyText ?? labels.empty) : labels.count(n)}
        </span>
      </div>
    </div>
  );
}

function optionName(o: SlashOption, labels: SlashMenuLabels): string {
  return `${o.label}${o.hint ? `, ${o.hint}` : ''}${o.checked ? `, ${labels.checked}` : ''}`;
}

function OptionRow({ o, checked }: { o: SlashOption; checked: string }) {
  return (
    <>
      <span className="slash-icon" aria-hidden="true">
        {o.color ? (
          <span className={`slash-dot gr-label-${o.color}`}>
            <i />
          </span>
        ) : o.checked ? (
          <span className="slash-glyph">✓</span>
        ) : null}
      </span>
      <span className="slash-main">
        <strong>{o.label}</strong>
        {o.hint && <span className="slash-desc">{o.hint}</span>}
      </span>
      {o.checked && o.color && (
        <span className="slash-check" title={checked} aria-hidden="true">
          ✓
        </span>
      )}
    </>
  );
}

/** Ícono de "Comandos" para el menú "+" de un composer: la barra "/" en un recuadro. Decorativo. */
export function SlashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M14 7.5l-4 9" />
    </svg>
  );
}
