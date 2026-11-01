'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { cleanEmails, MAX_RECAP_RECIPIENTS } from '@/lib/rec-schema';
import type { RecVideoDto } from '@/lib/rec';

/**
 * Sacar el video a otras apps: una página de Docs o un issue de Track con el
 * resumen, los capítulos y la transcripción (lo que esta persona puede ver), y el
 * resumen por mail (solo quien lo administra).
 */
export default function RecActions({ video }: { video: RecVideoDto }) {
  const t = useTranslations('rec.export');
  const tc = useTranslations('rec.common');
  const locale = useLocale();
  const [targets, setTargets] = useState<{ docs: boolean; projects: Array<{ id: string; name: string }>; widens?: boolean } | null>(null);
  const [confirming, setConfirming] = useState<'doc' | 'issue' | null>(null);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ href: string; label: string } | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [emails, setEmails] = useState('');
  const [recapMsg, setRecapMsg] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    let alive = true;
    void fetch(`/api/rec/videos/${video.id}/export`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { docs: boolean; projects: Array<{ id: string; name: string }>; widens?: boolean } | null) => {
        if (!alive) return;
        setTargets(d ?? { docs: false, projects: [] });
        if (d?.projects[0]) setProjectId(d.projects[0].id);
      })
      .catch(() => alive && setTargets({ docs: false, projects: [] }));
    return () => {
      alive = false;
    };
  }, [video.id]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (recapOpen && !d.open) d.showModal();
    if (!recapOpen && d.open) d.close();
  }, [recapOpen]);

  const message = async (res: Response | null) => {
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic';
    return tc.has(`errors.${code}`) ? tc(`errors.${code}`) : tc('errors.generic');
  };

  /** Si el video es más cerrado que el destino, primero se confirma. */
  function ask(target: 'doc' | 'issue') {
    if (targets?.widens) setConfirming(target);
    else void send(target);
  }

  async function send(target: 'doc' | 'issue') {
    setConfirming(null);
    setBusy(true);
    setError(null);
    setCreated(null);
    const res = await fetch(`/api/rec/videos/${video.id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, projectId: target === 'issue' ? projectId : undefined, locale, confirmWiden: !!targets?.widens }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(await message(res));
    const { href } = (await res.json()) as { href: string };
    setCreated({ href, label: target === 'doc' ? t('openDoc') : t('openIssue') });
  }

  const list = cleanEmails(emails);

  async function sendRecap() {
    setBusy(true);
    setRecapMsg(null);
    const res = await fetch(`/api/rec/videos/${video.id}/recap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emails: list, locale }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setRecapMsg(await message(res));
    const d = (await res.json()) as { sent: number; duplicate: boolean };
    setRecapMsg(d.duplicate ? t('recapDuplicate') : t('recapSent', { n: d.sent }));
  }

  if (!targets) return <div className="ui-skeleton-text" aria-busy="true" />;
  const none = !targets.docs && targets.projects.length === 0 && !video.canManage;
  if (none) return null;

  return (
    <div className="rec-export" data-testid="rec-actions">
      <h2 className="rec-h">{t('title')}</h2>
      <p className="ui-help">{t('help')}</p>
      <div className="rec-actions-row">
        {targets.docs && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => ask('doc')} data-testid="rec-export-doc">
            {t('createDoc')}
          </button>
        )}
        {targets.projects.length > 0 && (
          <>
            <label className="sr-only" htmlFor={`${id}-p`}>
              {t('project')}
            </label>
            <select id={`${id}-p`} className="input rec-actions-select" value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="rec-export-project">
              {targets.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => ask('issue')} data-testid="rec-export-issue">
              {t('createIssue')}
            </button>
          </>
        )}
        {video.canManage && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setRecapMsg(null);
              setRecapOpen(true);
            }}
            data-testid="rec-recap"
          >
            {t('recap')}
          </button>
        )}
      </div>
      {created && (
        <p role="status" className="ui-help" data-testid="rec-export-done">
          {t('created')}{' '}
          <Link href={created.href} data-testid="rec-export-link">
            {created.label}
          </Link>
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={t('widenTitle')}
        body={confirming === 'doc' ? t('widenDoc') : t('widenIssue')}
        confirmLabel={t('widenGo')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onConfirm={() => confirming && void send(confirming)}
        onCancel={() => setConfirming(null)}
      />
      <dialog
        ref={dialog}
        className="ui-modal"
        aria-labelledby={`${id}-t`}
        onCancel={(e) => {
          e.preventDefault();
          setRecapOpen(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setRecapOpen(false);
        }}
      >
        {recapOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (list.length && list.length <= MAX_RECAP_RECIPIENTS) void sendRecap();
            }}
          >
            <div className="ui-modal-head">
              <h2 className="ui-modal-title" id={`${id}-t`}>
                {t('recapTitle')}
              </h2>
            </div>
            <div className="ui-modal-body">
              <p className="ui-help">{t('recapHelp', { max: MAX_RECAP_RECIPIENTS })}</p>
              {video.privacy !== 'link' && <p className="ui-help">{t('recapPrivate')}</p>}
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-e`}>
                  {t('recapTo')}
                </label>
                <textarea id={`${id}-e`} className="textarea" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} autoFocus data-testid="rec-recap-emails" />
              </div>
              {recapMsg && (
                <p className="ui-help" role="status" data-testid="rec-recap-msg">
                  {recapMsg}
                </p>
              )}
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-sm" onClick={() => setRecapOpen(false)}>
                {tc('cancel')}
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !list.length || list.length > MAX_RECAP_RECIPIENTS} data-testid="rec-recap-send">
                {t('recapSend', { n: list.length })}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
