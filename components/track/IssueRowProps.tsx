'use client';

import LocalText from '@/components/ui/LocalText';
import { useTranslations } from 'next-intl';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { durationParts, parseStoredDate } from '@/lib/track-status-time';
import { formatDate } from '@/lib/utils';
import TrackIcon from './TrackIcon';

/** Propiedades compactas de una fila o tarjeta (Display properties de Linear que no tienen columna propia). */
export const ROW_PROPS = ['milestone', 'estimate', 'links', 'status_time', 'updated'] as const;
export type RowProp = (typeof ROW_PROPS)[number];

/** "3d", "5h", "2w": cuánto tiempo, en una sola unidad (lib/track-status-time). */
export function useShortDuration() {
  const t = useTranslations('track.statusTime');
  return (ms: number) => {
    const { value, unit } = durationParts(ms);
    return t(`short.${unit}`, { n: value });
  };
}

/**
 * Milestone, estimación, links, time in status y última edición: ícono y
 * texto chico, alineados a la derecha, sin cápsulas (como Linear). Una
 * propiedad vacía no ocupa lugar.
 */
export default function IssueRowProps({
  issue,
  show,
  locale,
  className = 'track-row-props',
}: {
  issue: TrackIssueWithStatus;
  show: (p: RowProp) => boolean;
  locale: string;
  className?: string;
}) {
  const t = useTranslations('track.statusTime');
  const short = useShortDuration();
  const milestone = issue.plan_id ? issue.plan_milestone_name : (issue.milestone_name ?? issue.plan_milestone_name);
  const links = issue.link_count ?? 0;
  const since = parseStoredDate(issue.status_changed_at ?? issue.created_at);
  const items: Array<{ key: RowProp; icon: Parameters<typeof TrackIcon>[0]['name']; text: string; title: string; local?: boolean }> = [];
  if (show('milestone') && milestone) items.push({ key: 'milestone', icon: 'milestone', text: milestone, title: milestone });
  if (show('estimate') && issue.estimate != null)
    items.push({ key: 'estimate', icon: 'estimate', text: String(issue.estimate), title: t('estimate', { count: issue.estimate }) });
  if (show('links') && links > 0) items.push({ key: 'links', icon: 'link', text: String(links), title: t('links', { count: links }) });
  if (show('status_time') && Number.isFinite(since)) {
    const text = short(Date.now() - since);
    items.push({
      key: 'status_time',
      icon: 'clock',
      text,
      title: t('inStatusFor', { status: issue.status_name ?? '–', time: text }),
      local: true,
    });
  }
  if (show('updated')) {
    const text = formatDate(issue.updated_at, locale);
    items.push({ key: 'updated', icon: 'refresh', text, title: t('updatedOn', { date: text }), local: true });
  }
  if (items.length === 0) return null;
  return (
    <span className={className}>
      {items.map((it) => (
        <span key={it.key} className={`track-row-prop is-${it.key}`} title={it.title} data-testid={`track-row-prop-${it.key}`} suppressHydrationWarning>
          <TrackIcon name={it.icon} size={12} />
          {it.local ? <LocalText className="sr-only">{it.title}</LocalText> : <span className="sr-only">{it.title}</span>}
          <span className="track-row-prop-text" aria-hidden>
            {it.local ? <LocalText>{it.text}</LocalText> : it.text}
          </span>
        </span>
      ))}
    </span>
  );
}
