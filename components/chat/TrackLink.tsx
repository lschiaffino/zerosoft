'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ChatIcon from './icons';

interface LinkedIssue {
  requestId: string;
  issueId: string;
  identifier: string;
  title: string;
  statusName: string | null;
  statusCategory: string | null;
}

/**
 * Issues de Track de la conversación (como los tracker tickets de Intercom):
 * crear uno con el hilo como contexto o vincular uno existente por su ID.
 * Varias conversaciones pueden apuntar al mismo issue; en Track cada una
 * queda como pedido de cliente.
 */
export default function TrackLink({ conversationId, defaultTitle }: { conversationId: string; defaultTitle: string }) {
  const t = useTranslations('chat');
  const [issues, setIssues] = useState<LinkedIssue[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'create' | 'link'>('idle');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState(defaultTitle);
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/chat/conversations/${conversationId}/track`)
      .then((r) => (r.ok ? (r.json() as Promise<{ issues: LinkedIssue[] }>) : { issues: [] }))
      .then((d) => alive && setIssues(d.issues))
      .catch(() => alive && setIssues([]));
    return () => {
      alive = false;
    };
  }, [conversationId]);

  useEffect(() => {
    if (mode !== 'create' || projects) return;
    fetch('/api/track/projects?pageSize=100')
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: Array<{ id: string; name: string }> }>) : { rows: [] }))
      .then((d) => {
        setProjects(d.rows.map((p) => ({ id: p.id, name: p.name })));
        setProjectId((cur) => cur || d.rows[0]?.id || '');
      })
      .catch(() => setProjects([]));
  }, [mode, projects]);

  const errorText = (code?: string) =>
    code === 'already_linked'
      ? t('track.alreadyLinked')
      : code === 'issue_not_found'
        ? t('track.notFound')
        : code === 'invalid_identifier'
          ? t('track.invalidId')
          : code === 'project_not_found'
            ? t('track.noProject')
            : t('errors.generic');

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'link' ? { identifier } : { projectId, title }),
      });
      const data = (await res.json().catch(() => ({}))) as { issues?: LinkedIssue[]; error?: string };
      if (!res.ok || !data.issues) {
        setError(errorText(data.error));
        return;
      }
      setIssues(data.issues);
      setMode('idle');
      setIdentifier('');
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(requestId: string) {
    const res = await fetch(`/api/chat/conversations/${conversationId}/track?requestId=${encodeURIComponent(requestId)}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setIssues(((await res.json()) as { issues: LinkedIssue[] }).issues);
  }

  return (
    <section className="chat-details-section" aria-labelledby="chat-details-track">
      <h3 id="chat-details-track" className="chat-details-label">
        {t('track.title')}
      </h3>
      {issues === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-label={t('common.loading')} />
      ) : issues.length === 0 ? (
        <p className="chat-quiet">{t('track.none')}</p>
      ) : (
        <ul className="chat-track-list">
          {issues.map((i) => (
            <li key={i.requestId}>
              <Link href={`/app/track/issues/${i.issueId}`} className="chat-track-issue">
                <span className="data">{i.identifier}</span> {i.title}
              </Link>
              {i.statusName && <span className="chat-track-status" data-category={i.statusCategory ?? undefined}>{i.statusName}</span>}
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => void unlink(i.requestId)} aria-label={t('track.unlink', { id: i.identifier })}>
                <ChatIcon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {mode === 'idle' ? (
        <div className="chat-track-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode('create')}>
            {t('track.create')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('link')}>
            {t('track.link')}
          </button>
        </div>
      ) : (
        <form
          className="chat-track-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMode('idle');
          }}
        >
          {mode === 'create' ? (
            <>
              <label className="label" htmlFor="chat-track-project">
                {t('track.project')}
              </label>
              {projects && projects.length === 0 ? (
                <p className="chat-quiet">{t('track.noProjects')}</p>
              ) : (
                <select id="chat-track-project" className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {(projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <label className="label" htmlFor="chat-track-title">
                {t('track.issueTitle')}
              </label>
              <input id="chat-track-title" className="input" autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </>
          ) : (
            <>
              <label className="label" htmlFor="chat-track-id">
                {t('track.identifier')}
              </label>
              <input id="chat-track-id" className="input data" autoFocus placeholder="WEB-12" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            </>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="chat-track-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('idle')}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy || (mode === 'create' ? !projectId || !title.trim() : !identifier.trim())}
              aria-busy={busy || undefined}
            >
              {mode === 'create' ? t('track.createSubmit') : t('track.linkSubmit')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
