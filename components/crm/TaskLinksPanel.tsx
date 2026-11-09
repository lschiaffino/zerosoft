'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { TaskLink } from '@/lib/tasks-shared';

/**
 * De dónde viene y a qué está atada la tarea fuera del CRM (chat de WhatsApp,
 * conversación de Chat, página de Docs, issue de Track) y, si usa Track,
 * pasarla a un issue.
 */
export default function TaskLinksPanel({
  taskId,
  links,
  projects,
}: {
  taskId: string;
  links: TaskLink[];
  /** Proyectos de Track que la persona ve; null si no usa Track. */
  projects: Array<{ id: string; name: string }> | null;
}) {
  const t = useTranslations('crm.tasks.links');
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects?.[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasIssue = links.some((l) => l.kind === 'track_issue');
  // El mensaje y su chat se muestran juntos: el chat con el texto del mensaje.
  const message = links.find((l) => l.kind === 'lines_message');
  const rows = links.filter((l) => !(l.kind === 'lines_chat' && message && !message.missing && message.href === l.href));

  async function toTrack() {
    if (!projectId || busy) return;
    setBusy(true);
    setError('');
    const res = await fetch(`/api/crm/tasks/${taskId}/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('error'));
      return;
    }
    router.refresh();
  }

  return (
    <div className="association-panel" data-testid="task-links">
      <div className="assoc-head">
        <h2 className="assoc-title">{t('title')}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="assoc-empty">{t('empty')}</p>
      ) : (
        <ul className="assoc-list">
          {rows.map((l) => (
            <li className="assoc-row" key={`${l.kind}:${l.refId}`}>
              <span className="assoc-main">
                <span className="assoc-meta">{t(`app.${l.app}`)}</span>
                {l.href ? (
                  <Link href={l.href} className="assoc-name">
                    {l.label || t(`app.${l.app}`)}
                  </Link>
                ) : (
                  <span className="assoc-name muted">{l.missing ? t('missing') : t('hidden')}</span>
                )}
                {l.detail && <span className="assoc-meta task-link-detail">{l.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {projects && !hasIssue && (
        <div className="task-to-track">
          {projects.length === 0 ? (
            <p className="assoc-empty">{t('noProjects')}</p>
          ) : (
            <>
              <div className="assoc-add-row">
                <label className="sr-only" htmlFor={`task-track-${taskId}`}>
                  {t('project')}
                </label>
                <select
                  id={`task-track-${taskId}`}
                  className="select assoc-add"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={busy}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-sm" onClick={() => void toTrack()} disabled={busy || !projectId} aria-busy={busy || undefined}>
                  {busy ? t('creating') : t('toTrack')}
                </button>
              </div>
              <p className="assoc-empty">{t('toTrackHelp')}</p>
            </>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
