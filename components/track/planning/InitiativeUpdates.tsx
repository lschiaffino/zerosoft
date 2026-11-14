'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { MarkdownView } from '@/components/track/MarkdownView';
import RichEditor from '@/components/track/RichEditor';
import type { InitiativeUpdate } from '@/lib/track-initiative-updates';
import { PLAN_HEALTH, type PlanHealth } from '@/lib/track-planning-schema';
import { api, fmtWhen, HealthDot, initialsOf, LoadingRows } from './shared';

/**
 * Updates de una initiative (como en Linear): salud y texto. El último update
 * fija la salud de la initiative. Solo el autor edita el suyo; lo borra el
 * autor o un admin.
 */
export default function InitiativeUpdates({
  initiativeId,
  lastHealth,
  onPosted,
}: {
  initiativeId: string;
  /** Salud del último update: el composer arranca con esa. */
  lastHealth: PlanHealth | null;
  onPosted: () => Promise<void>;
}) {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const [rows, setRows] = useState<InitiativeUpdate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [me, setMe] = useState('');
  const [admin, setAdmin] = useState(false);
  const [health, setHealth] = useState<PlanHealth>(lastHealth ?? 'on_track');
  const [body, setBody] = useState('');
  // El editor se rearma vacío después de publicar.
  const [composerKey, setComposerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const formId = `tp-ini-compose-${initiativeId}`;

  const load = useCallback(async () => {
    const res = await api<{ rows: InitiativeUpdate[]; me: string; admin?: boolean }>(`/api/track/initiatives/${initiativeId}/updates`);
    setFailed(!res.ok);
    setRows(res.ok ? res.data.rows : []);
    if (res.ok) {
      setMe(res.data.me);
      setAdmin(Boolean(res.data.admin));
    }
  }, [initiativeId]);
  useEffect(() => {
    void load();
  }, [load]);

  const post = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!body.trim()) {
      setError(t('initiativeUpdates.bodyRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api(`/api/track/initiatives/${initiativeId}/updates`, 'POST', { health, body });
    setBusy(false);
    if (!res.ok) return setError(t('common.saveError'));
    setBody('');
    setComposerKey((k) => k + 1);
    await load();
    await onPosted();
  };

  return (
    <section className="tp-card tp-ini-updates" id="updates" aria-labelledby="tp-ini-updates-h" data-testid="tp-initiative-updates">
      <div className="tp-card-head">
        <h3 id="tp-ini-updates-h" className="tp-card-title">
          {t('initiativeUpdates.title')}
        </h3>
      </div>
      <form id={formId} className="tp-composer tp-ini-composer" onSubmit={post} aria-label={t('updates.composerTitle')}>
        <fieldset className="tp-health-pick">
          <legend className="label">{t('plan.health')}</legend>
          {PLAN_HEALTH.map((h) => (
            <label key={h} className={`tp-health-opt tp-health-${h}${health === h ? ' on' : ''}`}>
              <input type="radio" name={`ini-health-${initiativeId}`} value={h} checked={health === h} onChange={() => setHealth(h)} />
              <span className="tp-health-dot" aria-hidden="true" />
              {t(`health.${h}`)}
            </label>
          ))}
        </fieldset>
        <RichEditor
          key={composerKey}
          value={body}
          onChange={(v) => {
            setBody(v);
            if (error) setError(null);
          }}
          ariaLabel={t('updates.bodyLabel')}
          placeholder={t('initiativeUpdates.placeholder')}
          onSubmit={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}
          testId="tp-ini-update-body"
          className="tp-update-editor"
        />
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="tp-form-actions">
          <span className="ui-help">{t('initiativeUpdates.notifyHelp')}</span>
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy} aria-busy={busy} data-testid="tp-ini-update-post">
            {t('updates.post')}
          </button>
        </div>
      </form>

      {rows === null ? (
        <LoadingRows rows={2} />
      ) : failed ? (
        <EmptyState
          quiet
          title={t('common.loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <p className="ui-help tp-ini-updates-empty">{t('initiativeUpdates.empty')}</p>
      ) : (
        <ol className="tp-feed" data-testid="tp-ini-updates-feed">
          {rows.map((u) => {
            const name = u.user_name || u.user_email;
            const mine = u.user_id === me;
            return (
              <li key={u.id} className="tp-update tp-ini-update" data-testid="tp-ini-update">
                <div className="tp-update-head">
                  <HealthDot health={u.health} label={t(`health.${u.health}`)} />
                  <span className="tp-update-author">
                    <span className="track-avatar" aria-hidden>
                      {initialsOf(name)}
                    </span>
                    {name}
                  </span>
                  <time className="ui-help">
                    <LocalText>{fmtWhen(u.created_at, locale)}</LocalText>
                    {u.updated_at ? ` · ${t('updates.edited')}` : ''}
                  </time>
                  {(mine || admin) && (
                    <span className="tp-update-actions">
                      {mine && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => setEditing(u.id)}
                          aria-label={t('initiativeUpdates.editLabel', { name })}
                        >
                          {t('common.edit')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setDeleting(u.id)}
                        aria-label={t('initiativeUpdates.deleteLabel', { name })}
                      >
                        {t('common.delete')}
                      </button>
                    </span>
                  )}
                </div>
                {editing === u.id ? (
                  <EditUpdate
                    update={u}
                    onDone={async (changed) => {
                      setEditing(null);
                      if (!changed) return;
                      await load();
                      await onPosted();
                    }}
                  />
                ) : (
                  u.body && <MarkdownView source={u.body} className="tp-update-body" />
                )}
              </li>
            );
          })}
        </ol>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('updates.deleteTitle')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={async () => {
          if (deleting) await api(`/api/track/initiative-updates/${deleting}`, 'DELETE');
          setDeleting(null);
          await load();
          await onPosted();
        }}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

function EditUpdate({ update, onDone }: { update: InitiativeUpdate; onDone: (changed: boolean) => Promise<void> }) {
  const t = useTranslations('trackPlanning');
  const [health, setHealth] = useState<PlanHealth>(update.health);
  const [body, setBody] = useState(update.body);
  const [error, setError] = useState(false);
  const formId = `tp-ini-edit-${update.id}`;
  return (
    <form
      id={formId}
      className="tp-desc-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await api(`/api/track/initiative-updates/${update.id}`, 'PATCH', { health, body });
        if (!res.ok) return setError(true);
        await onDone(true);
      }}
    >
      <fieldset className="tp-health-pick">
        <legend className="label">{t('plan.health')}</legend>
        {PLAN_HEALTH.map((h) => (
          <label key={h} className={`tp-health-opt tp-health-${h}${health === h ? ' on' : ''}`}>
            <input type="radio" name={`edit-health-${update.id}`} value={h} checked={health === h} onChange={() => setHealth(h)} />
            <span className="tp-health-dot" aria-hidden="true" />
            {t(`health.${h}`)}
          </label>
        ))}
      </fieldset>
      <RichEditor
        value={body}
        onChange={setBody}
        ariaLabel={t('updates.bodyLabel')}
        autoFocus
        onEscape={() => void onDone(false)}
        onSubmit={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}
        className="tp-update-editor"
      />
      {error && (
        <p className="ui-error" role="alert">
          {t('common.saveError')}
        </p>
      )}
      <div className="tp-form-actions">
        <button type="button" className="btn btn-sm" onClick={() => void onDone(false)}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-sm btn-primary">
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}
