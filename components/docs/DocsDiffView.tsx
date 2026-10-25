'use client';

import { Fragment, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { DocsBlock } from '@/lib/docs-types';
import { diffBlocks, diffStats, type BlockDiff } from '@/lib/docs-diff';

/**
 * Qué cambió entre dos versiones, bloque por bloque: agregado (verde),
 * quitado (tachado) y cambiado (palabras agregadas y quitadas marcadas).
 * Los tramos sin cambios se pliegan en una línea.
 */
export default function DocsDiffView({ before, after }: { before: DocsBlock[]; after: DocsBlock[] }) {
  const t = useTranslations('docs.versions');
  const diff = useMemo(() => diffBlocks(before, after), [before, after]);
  const stats = diffStats(diff);
  const groups = useMemo(() => {
    // Bloques sin cambios contiguos: un solo separador "N sin cambios".
    const out: Array<{ kind: 'run'; count: number; key: string } | { kind: 'diff'; d: BlockDiff; key: string }> = [];
    let run = 0;
    diff.forEach((d, i) => {
      if (d.kind === 'same') {
        run++;
        return;
      }
      if (run) out.push({ kind: 'run', count: run, key: `r${i}` });
      run = 0;
      out.push({ kind: 'diff', d, key: `${d.kind}:${d.block.id}:${i}` });
    });
    if (run) out.push({ kind: 'run', count: run, key: 'rend' });
    return out;
  }, [diff]);

  const total = stats.added + stats.removed + stats.changed;
  return (
    <div className="docs-diff" data-testid="docs-diff">
      <p className="docs-diff-stats" role="status">
        {total === 0 ? (
          t('noChanges')
        ) : (
          <>
            <span className="docs-diff-stat is-added">{t('statAdded', { count: stats.added })}</span>
            <span className="docs-diff-stat is-removed">{t('statRemoved', { count: stats.removed })}</span>
            <span className="docs-diff-stat is-changed">{t('statChanged', { count: stats.changed })}</span>
          </>
        )}
      </p>
      <ol className="docs-diff-list">
        {groups.map((g) =>
          g.kind === 'run' ? (
            <li key={g.key} className="docs-diff-run">
              {t('unchanged', { count: g.count })}
            </li>
          ) : (
            <li key={g.key} className={`docs-diff-block is-${g.d.kind}`} data-kind={g.d.kind}>
              <span className="docs-diff-tag">{t(`kind.${g.d.kind}`)}</span>
              <p className="docs-diff-text">
                {g.d.segments.map((s, i) => (
                  <Fragment key={i}>
                    {s.op === 'ins' ? <ins>{s.text}</ins> : s.op === 'del' ? <del>{s.text}</del> : <span>{s.text}</span>}
                  </Fragment>
                ))}
                {g.d.segments.every((s) => !s.text) && <span className="docs-diff-empty">{t(`blockType`, { type: g.d.block.type })}</span>}
              </p>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
