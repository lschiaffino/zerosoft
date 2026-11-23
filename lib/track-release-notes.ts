/**
 * Track — notas de un release generadas con los títulos de sus issues (lib/track-releases).
 * Puro: lo usan el servidor y la página del release.
 */
import type { TrackIssueWithStatus } from './track-data';

function labelNames(raw: string): string {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map((l: { name?: unknown }) => (typeof l?.name === 'string' ? l.name : '')).join(' ') : '';
  } catch {
    return '';
  }
}

const FIX_RE = /\b(bug|fix|defect|error|crash|regression)\b/i;
const FEATURE_RE = /\b(feature|feat|new|enhancement)\b/i;

export interface NotesLabels {
  features: string;
  improvements: string;
  fixes: string;
  empty: string;
}

/**
 * Notas del release a partir de los títulos de sus issues terminados (o de
 * todos si no hay terminados todavía), agrupados por tipo según sus labels:
 * Bug/Fix → Arreglos, Feature → Novedades, el resto → Mejoras. Markdown.
 */
export function generateReleaseNotes(
  release: { name: string; version: string },
  issues: Array<Pick<TrackIssueWithStatus, 'identifier' | 'title' | 'labels' | 'status_category'>>,
  labels: NotesLabels,
): string {
  const kept = issues.filter((i) => i.status_category !== 'cancelled');
  const done = kept.filter((i) => i.status_category === 'done');
  const list = done.length ? done : kept;
  const buckets: Record<'features' | 'improvements' | 'fixes', string[]> = { features: [], improvements: [], fixes: [] };
  for (const i of list) {
    const names = labelNames(i.labels);
    const kind = FIX_RE.test(names) ? 'fixes' : FEATURE_RE.test(names) ? 'features' : 'improvements';
    const title = i.title.replace(/\s+/g, ' ').trim();
    buckets[kind].push(`- ${title} (${i.identifier})`);
  }
  const head = `# ${[release.name, release.version].filter(Boolean).join(' ')}`;
  const parts = (['features', 'improvements', 'fixes'] as const)
    .filter((k) => buckets[k].length)
    .map((k) => `## ${labels[k]}\n\n${buckets[k].join('\n')}`);
  return [head, parts.length ? parts.join('\n\n') : labels.empty].join('\n\n');
}

