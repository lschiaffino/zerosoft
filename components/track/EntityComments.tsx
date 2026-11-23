'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { TrackIssueActivityWithAuthor, ProjectMember } from '@/lib/track-data';
import type { CommentReaction } from '@/lib/track-ux';
import IssueActivityTimeline from './IssueActivityTimeline';
import { buildTrackUiLabels } from './ui-labels';

interface Thread {
  rows: TrackIssueActivityWithAuthor[];
  reactions: CommentReaction[];
  me: string;
  members: Array<{ id: string; name: string | null; email: string }>;
}

/**
 * Hilo de comentarios de un project o una iniciativa (como Linear), con el
 * mismo componente que los issues: @menciones, respuestas, resolver,
 * reacciones, y editar o borrar los propios. Lo ve quien ve el project o la
 * iniciativa (lib/track-entity-comments-http.ts).
 */
export default function EntityComments({ type, id }: { type: 'plan' | 'initiative'; id: string }) {
  const t = useTranslations('track');
  const locale = useLocale();
  const apiBase = `/api/track/${type === 'plan' ? 'plans' : 'initiatives'}/${id}`;
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${apiBase}/comments`).catch(() => null);
    if (!res?.ok) {
      setError(true);
      return;
    }
    setError(false);
    setThread((await res.json()) as Thread);
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const labels = useMemo(
    () => ({
      title: t('entityComments.title'),
      created: t.raw('activity.created') as string,
      statusChange: t.raw('activity.statusChange') as string,
      assigneeChange: t.raw('activity.assigneeChange') as string,
      priorityChange: t.raw('activity.priorityChange') as string,
      cycleChange: t.raw('activity.cycleChange') as string,
      dueDateChange: t.raw('activity.dueDateChange') as string,
      estimateChange: t.raw('activity.estimateChange') as string,
      titleChange: t.raw('activity.titleChange') as string,
      descriptionChange: t.raw('activity.descriptionChange') as string,
      relationAdded: t.raw('activity.relationAdded') as string,
      relationRemoved: t.raw('activity.relationRemoved') as string,
      attachmentAdded: t.raw('activity.attachmentAdded') as string,
      subtaskAdded: t.raw('activity.subtaskAdded') as string,
      closed: t.raw('activity.closed') as string,
      reopened: t.raw('activity.reopened') as string,
      commented: t.raw('activity.commented') as string,
      from: t.raw('activity.from') as string,
      to: t.raw('activity.to') as string,
      unassigned: t.raw('activity.unassigned') as string,
      addComment: t('entityComments.placeholder'),
      submitComment: t('activity.submitComment'),
      empty: t('entityComments.empty'),
      editComment: t('activity.editComment'),
      deleteComment: t('activity.deleteComment'),
      deleteCommentConfirm: t('activity.deleteCommentConfirm'),
      saveComment: t('common.save'),
      cancelEdit: t('common.cancel'),
      edited: t('activity.edited'),
    }),
    [t],
  );
  const markdown = useMemo(() => buildTrackUiLabels(t as unknown as Parameters<typeof buildTrackUiLabels>[0]).markdown, [t]);
  const members: ProjectMember[] = useMemo(() => (thread?.members ?? []).map((m) => ({ ...m, role: 'member' })), [thread]);

  return (
    <section className="tp-card track-entity-comments" id="comments" aria-labelledby={`tp-comments-${id}`} data-testid="track-entity-comments">
      <h3 className="tp-card-title" id={`tp-comments-${id}`}>
        {labels.title}
      </h3>
      {error && !thread ? (
        <p className="ui-error" role="alert">
          {t('entityComments.loadError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        </p>
      ) : !thread ? (
        <div className="ui-loading-stack" aria-busy="true">
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      ) : (
        <IssueActivityTimeline
          issueId={id}
          apiBase={apiBase}
          locale={locale}
          userId={thread.me}
          activities={thread.rows}
          reactions={thread.reactions}
          onReactions={(reactions) => setThread((th) => (th ? { ...th, reactions } : th))}
          members={members}
          labels={labels}
          markdownLabels={markdown}
          onChange={() => void load()}
        />
      )}
    </section>
  );
}
