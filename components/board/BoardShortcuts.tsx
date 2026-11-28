'use client';

import { useTranslations } from 'next-intl';
import { usePopover } from '@/components/notes/usePopover';
import { BOARD_SHORTCUTS } from '@/lib/board-shortcuts';

/** Hoja con los atajos propios de Board (sticky, minimapa, presentar). */
export default function BoardShortcuts({ className = '' }: { className?: string }) {
  const t = useTranslations('board.shortcuts');
  const pop = usePopover();
  return (
    <div className={`board-share-wrap board-tool-wrap ${className}`.trim()} ref={pop.wrapRef}>
      <button
        ref={pop.buttonRef}
        type="button"
        className={`btn btn-sm${pop.open ? ' is-on' : ''}`}
        onClick={pop.toggle}
        aria-expanded={pop.open}
        aria-haspopup="dialog"
        aria-label={t('button')}
        title={t('button')}
        data-testid="board-shortcuts"
      >
        <span aria-hidden="true">?</span>
      </button>
      {pop.open && (
        <div className="board-pop board-shortcuts-pop" role="dialog" aria-label={t('title')} data-testid="board-shortcuts-sheet">
          <p className="board-pop-title">{t('title')}</p>
          {BOARD_SHORTCUTS.map((g) => (
            <section key={g.id} className="board-pop-section" data-testid={`board-shortcuts-${g.id}`}>
              <h3 className="board-pop-label">{t(`groups.${g.id}`)}</h3>
              <dl className="board-shortcuts-list">
                {g.items.map((it) => (
                  <div key={it.id} className="board-shortcuts-row" data-testid={`board-shortcut-${it.id}`}>
                    <dt>{t(`items.${it.id}`)}</dt>
                    <dd>
                      {it.keys.map((combo, i) => (
                        <span key={i} className="board-shortcuts-combo">
                          {combo.map((k) => (
                            <kbd key={k}>{k}</kbd>
                          ))}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="board-pop-hint">{t('more')}</p>
        </div>
      )}
    </div>
  );
}
