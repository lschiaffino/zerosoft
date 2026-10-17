import { useTranslations } from 'next-intl';
import { MkCheck } from './MkIcons';

const NOTEBOOKS = ['nb1', 'nb2', 'nb3'] as const;
const NOTES = ['n1', 'n2', 'n3'] as const;
const CHECKS = [
  { k: 'c1', done: false },
  { k: 'c2', done: true },
  { k: 'c3', done: false },
] as const;

/** Vista de Notes: libretas, la lista de notas y una nota abierta con checklist. */
export default function NotesMockup() {
  const t = useTranslations('pages.mockups.notes');

  return (
    <div className="mk mk-notes">
      <aside className="mk-side">
        <nav className="mk-nav" aria-hidden="true">
          <span className="active">{t('all')}</span>
          {NOTEBOOKS.map((nb) => (
            <span key={nb}>{t(nb)}</span>
          ))}
        </nav>
      </aside>

      <div className="mk-notes-list">
        <span className="mk-filter">{t('search')}</span>
        {NOTES.map((n, i) => (
          <div className={`mk-notes-row${i === 1 ? ' active' : ''}`} key={n}>
            <span className="mk-chat-name">{t(`${n}title`)}</span>
            <span className="mk-chat-snippet">{t(`${n}snippet`)}</span>
          </div>
        ))}
      </div>

      <div className="mk-main">
        <p className="mk-notes-meta">{t('meta')}</p>
        <h4 className="mk-notes-title">{t('n2title')}</h4>
        <p className="mk-notes-p">{t('body')}</p>
        <ul className="mk-notes-checks">
          {CHECKS.map((c) => (
            <li key={c.k} className={c.done ? 'done' : undefined}>
              <MkCheck done={c.done} />
              {t(c.k)}
            </li>
          ))}
        </ul>
        <p className="mk-notes-tag mk-mono">#{t('tag')}</p>
      </div>
    </div>
  );
}
