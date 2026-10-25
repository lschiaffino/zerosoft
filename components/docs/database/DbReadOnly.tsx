import type { DbProperty, DocsBlock } from '@/lib/docs-types';
import {
  activeView,
  cardHidesValue,
  cellValue,
  groupProperty,
  groupRows,
  normalizeDatabase,
  rowTitle,
  viewRows,
  visibleProperties,
  type DbGroup,
} from '@/lib/docs-database';
import DbValueView, { StatusGlyph } from './DbValueView';
import { computeDatabase, rowTitlesFor } from '@/lib/docs-db-compute';

/**
 * Base de datos de solo lectura: la vista activa tal como la dejó quien la
 * armó (filtro, orden, agrupado, propiedades ocultas). Tabla, board o
 * galería. Sin hooks: la usan el centro de ayuda (server), las páginas
 * compartidas en lectura, las versiones y el link público de Notes. Sin
 * `people` (público) las propiedades persona no se muestran.
 */
export default function DbReadOnly({
  block,
  people,
  locale,
  className = 'dbv-table',
}: {
  block: DocsBlock;
  people?: Record<string, string>;
  locale?: string;
  className?: string;
}) {
  // Vista vinculada: en lectura no se trae la otra base (quien lee puede no tener acceso a ella).
  if (block.linked) return null;
  // Fórmulas y relaciones dentro de la misma base se calculan; las de otras bases quedan vacías.
  const db = computeDatabase(normalizeDatabase(block), { people, locale });
  const view = activeView(db);
  const refs = { titles: rowTitlesFor(db, {}) };
  const ctx = { people, locale, rowTitles: refs.titles };
  const rows = viewRows(db, view, ctx);
  const props = visibleProperties(db, view).filter((p) => (p.type !== 'person' && p.type !== 'created_by' && p.type !== 'last_edited_by') || people).filter((p) => p.type !== 'button' && p.type !== 'files');
  const groupProp = groupProperty(db, view);
  const usableGroup = groupProp && (groupProp.type !== 'person' || people) ? groupProp : null;

  const groupName = (g: DbGroup, prop: DbProperty) => {
    if (prop.type === 'checkbox') return g.key === 'true' ? '✓' : '–';
    return g.key ? g.label : '—';
  };

  const table = (list: typeof rows, key: string) => (
    <table key={key} className="dbv-db-table">
      <thead>
        <tr>
          {props.map((p) => (
            <th key={p.id} scope="col">
              {p.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.id}>
            {props.map((p) => (
              <td key={p.id}>
                {p.type === 'title' ? rowTitle(db, r) : <DbValueView prop={p} row={r} people={people} locale={locale} refs={refs} />}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  let body;
  if (view.type === 'board' && usableGroup) {
    const cardProps = props.filter((p) => p.type !== 'title' && p.id !== usableGroup.id);
    body = (
      <div className="docs-db-board dbv-db-board">
        {groupRows(db, usableGroup, rows, ctx, true).map((g) => (
          <section key={g.key || 'none'} className="docs-db-bcol" aria-label={groupName(g, usableGroup)}>
            <header className="docs-db-bcol-head">
              {usableGroup.type === 'status' && g.option && <StatusGlyph group={g.option.group ?? 'todo'} />}
              <span className="docs-db-bcol-name">{groupName(g, usableGroup)}</span>
              <span className="docs-db-count">{g.rows.length}</span>
            </header>
            <div className="docs-db-bcol-cards">
              {g.rows.map((r) => (
                <div key={r.id} className="docs-db-bcard">
                  <span className="docs-db-bcard-title">{rowTitle(db, r)}</span>
                  {cardProps
                    .filter((p) => !cardHidesValue(p, cellValue(p, r)))
                    .map((p) => (
                      <div key={p.id} className="docs-db-bcard-prop">
                        <DbValueView prop={p} row={r} people={people} locale={locale} refs={refs} />
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  } else if (view.type === 'gallery') {
    const cardProps = props.filter((p) => p.type !== 'title');
    body = (
      <div className="docs-db-gallery">
        {rows.map((r) => (
          <div key={r.id} className="docs-db-card">
            <span className="docs-db-card-title">{rowTitle(db, r)}</span>
            {cardProps.map((p) => (
              <span key={p.id} className="docs-db-prop">
                <span className="docs-db-prop-label">{p.name}</span>
                <span className="docs-db-prop-value">
                  <DbValueView prop={p} row={r} people={people} locale={locale} refs={refs} />
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  } else if (usableGroup && view.type === 'table') {
    body = groupRows(db, usableGroup, rows, ctx, false).map((g) => (
      <div key={g.key || 'none'} className="dbv-db-group">
        <p className="dbv-db-group-name">
          {usableGroup.type === 'status' && g.option && <StatusGlyph group={g.option.group ?? 'todo'} />}
          {groupName(g, usableGroup)} <span className="docs-db-count">{g.rows.length}</span>
        </p>
        {table(g.rows, g.key)}
      </div>
    ));
  } else {
    body = table(rows, 'all');
  }

  return (
    <div className={`${className} dbv-db`} data-testid="docs-database-readonly">
      {db.title && <p className="dbv-db-title">{db.title}</p>}
      {body}
    </div>
  );
}
