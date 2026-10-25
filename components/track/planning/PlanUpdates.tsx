'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { MarkdownView } from '@/components/track/MarkdownView';
import RichEditor from '@/components/track/RichEditor';
import KeyPicker from '@/components/track/KeyPicker';
import type { PlanSummary, PlanEvent } from '@/lib/track-plans';
import type { PlanUpdate, PlanUpdateComment } from '@/lib/track-plan-updates';
import { PLAN_HEALTH, type PlanHealth } from '@/lib/track-planning-schema';
import { api, fmtDay, fmtWhen, HealthDot, LoadingRows, personName } from './shared';
import type { PlansMeta } from './PlansList';

type Item = { kind: 'update'; at: string; update: PlanUpdate } | { kind: 'event'; at: string; event: PlanEvent };

/** Updates del plan: escribir (salud + texto), historial con cambios del plan, comentarios. */
export default function PlanUpdates({
  plan,
  meta,
  composeOpen,
  onPosted,
}: {
  plan: PlanSummary;
  meta: PlansMeta | null;
  composeOpen: boolean;
  onPosted: () => Promise<void>;
}) {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const [updates, setUpdates] = useState<PlanUpdate[] | null>(null);
  const [events, setEvents] = useState<PlanEvent[]>([]);
  const [me, setMe] = useState('');
  const [failed, setFailed] = useState(false);
  const [health, setHealth] = useState<PlanHealth>((plan.last_update_health as PlanHealth) ?? 'on_track');
  const [body, setBody] = useState('');
  // El editor se rearma vacío después de publicar.
  const [composerKey, setComposerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ rows: PlanUpdate[]; events: PlanEvent[]; me: string }>(`/api/track/plans/${plan.id}/updates`);
    setFailed(!res.ok);
    setUpdates(res.ok ? res.data.rows : []);
    setEvents(res.ok ? res.data.events : []);
    if (res.ok) setMe(res.data.me);
  }, [plan.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const post = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await api(`/api/track/plans/${plan.id}/updates`, 'POST', { health, body });
    setBusy(false);
    if (!res.ok) return setError(t('common.saveError'));
    setBody('');
    setComposerKey((k) => k + 1);
    await load();
    await onPosted();
  };

  const items: Item[] = [
    ...(updates ?? []).map((u) => ({ kind: 'update' as const, at: u.created_at, update: u })),
    ...events.map((e) => ({ kind: 'event' as const, at: e.created_at, event: e })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const memberName = (id: unknown) => personName(meta?.members.find((m) => m.id === id)) || t('common.noLead');
  const eventText = (e: PlanEvent) => {
    let m: Record<string, unknown> = {};
    try {
      m = JSON.parse(e.meta) as Record<string, unknown>;
    } catch {
      m = {};
    }
    const actor = e.user_name || e.user_email || t('common.someone');
    const day = (v: unknown) => (typeof v === 'string' && v ? fmtDay(v, locale, true) : t('common.noDate'));
    switch (e.type) {
      case 'created':
        return t('updates.events.created', { actor });
      case 'renamed':
        return t('updates.events.renamed', { actor, to: String(m.to ?? '') });
      case 'status':
        return t('updates.events.status', { actor, to: t(`status.${String(m.to)}`) });
      case 'lead':
        return t('updates.events.lead', { actor, to: m.to ? memberName(m.to) : t('common.noLead') });
      case 'start_date':
        return t('updates.events.startDate', { actor, from: day(m.from), to: day(m.to) });
      case 'target_date':
        return t('updates.events.targetDate', { actor, from: day(m.from), to: day(m.to) });
      case 'members':
        return t('updates.events.members', { actor, names: (Array.isArray(m.added) ? m.added : []).map(memberName).join(', ') });
      case 'milestone_added':
        return t('updates.events.milestone', { actor, name: String(m.name ?? '') });
      default:
        return actor;
    }
  };

  return (
    <div className="tp-updates">
      <form id="tp-compose-form" className="tp-card tp-composer" onSubmit={post} aria-labelledby="tp-compose-h">
        <h3 id="tp-compose-h" className="tp-card-title">
          {t('updates.composerTitle')}
        </h3>
        <fieldset className="tp-health-pick">
          <legend className="label">{t('plan.health')}</legend>
          {PLAN_HEALTH.map((h) => (
            <label key={h} className={`tp-health-opt tp-health-${h}${health === h ? ' on' : ''}`}>
              <input type="radio" name="health" value={h} checked={health === h} onChange={() => setHealth(h)} />
              <span className="tp-health-dot" aria-hidden="true" />
              {t(`health.${h}`)}
            </label>
          ))}
        </fieldset>
        <RichEditor
          key={composerKey}
          value={body}
          onChange={setBody}
          ariaLabel={t('updates.bodyLabel')}
          placeholder={t('updates.bodyPlaceholder')}
          autoFocus={composeOpen}
          onSubmit={() => (document.getElementById('tp-compose-form') as HTMLFormElement | null)?.requestSubmit()}
          testId="tp-update-body"
          className="tp-update-editor"
        />
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="tp-form-actions">
          <span className="ui-help">{t('updates.notifyHelp')}</span>
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy} aria-busy={busy} data-testid="tp-update-post">
            {t('updates.post')}
          </button>
        </div>
      </form>

      {updates === null ? (
        <LoadingRows />
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
      ) : (
        <>
          {updates.length === 0 && <EmptyState quiet title={t('updates.empty')} body={t('updates.emptyBody')} />}
          <ol className="tp-feed" data-testid="tp-updates-feed">
            {items.map((it) =>
              it.kind === 'event' ? (
                <li key={`e-${it.event.id}`} className="tp-feed-event">
                  <span>{eventText(it.event)}</span>
                  <time className="ui-help">{fmtWhen(it.at, locale)}</time>
                </li>
              ) : (
                <li key={`u-${it.update.id}`} className="tp-card tp-update" data-testid="tp-update">
                  <div className="tp-update-head">
                    <HealthDot health={it.update.health} label={t(`health.${it.update.health}`)} />
                    <span className="tp-update-author">{it.update.user_name || it.update.user_email}</span>
                    <time className="ui-help">
                      {fmtWhen(it.update.created_at, locale)}
                      {it.update.updated_at ? ` · ${t('updates.edited')}` : ''}
                    </time>
                    {it.update.user_id === me && (
                      <span className="tp-update-actions">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(it.update.id)}>
                          {t('common.edit')}
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDeleting(it.update.id)}>
                          {t('common.delete')}
                        </button>
                      </span>
                    )}
                  </div>
                  {editing === it.update.id ? (
                    <EditUpdate
                      update={it.update}
                      onDone={async () => {
                        setEditing(null);
                        await load();
                        await onPosted();
                      }}
                    />
                  ) : (
                    it.update.body && <MarkdownView source={it.update.body} className="tp-update-body" />
                  )}
                  {it.update.progress !== null && (
                    <p className="ui-help tp-update-progress">
                      {(() => {
                        const m = parseMeta(it.update.meta);
                        const prev = typeof m.previousProgress === 'number' ? m.previousProgress : null;
                        return prev !== null && Math.abs(prev - (it.update.progress ?? 0)) > 2
                          ? t('updates.progressChange', { from: prev, to: it.update.progress ?? 0 })
                          : t('updates.progressNow', { value: it.update.progress ?? 0 });
                      })()}
                    </p>
                  )}
                  <Comments updateId={it.update.id} count={Number(it.update.comment_count)} />
                </li>
              ),
            )}
          </ol>
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('updates.deleteTitle')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={async () => {
          if (deleting) await api(`/api/track/plan-updates/${deleting}`, 'DELETE');
          setDeleting(null);
          await load();
          await onPosted();
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function EditUpdate({ update, onDone }: { update: PlanUpdate; onDone: () => Promise<void> }) {
  const t = useTranslations('trackPlanning');
  const [health, setHealth] = useState<PlanHealth>(update.health);
  const [body, setBody] = useState(update.body);
  return (
    <form
      className="tp-desc-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await api(`/api/track/plan-updates/${update.id}`, 'PATCH', { health, body });
        await onDone();
      }}
    >
      <KeyPicker
        ariaLabel={t('plan.health')}
        className="tp-chip"
        value={health}
        options={PLAN_HEALTH.map((h) => ({ value: h, label: t(`health.${h}`), icon: <HealthDot health={h} label="" /> }))}
        onSelect={(v) => setHealth(v as PlanHealth)}
        trigger={<HealthDot health={health} label={t(`health.${health}`)} />}
      />
      <RichEditor
        value={body}
        onChange={setBody}
        ariaLabel={t('updates.bodyLabel')}
        autoFocus
        onEscape={() => void onDone()}
        className="tp-update-editor"
      />
      <div className="tp-form-actions">
        <button type="button" className="btn btn-sm" onClick={() => void onDone()}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-sm btn-primary">
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

function Comments({ updateId, count }: { updateId: string; count: number }) {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PlanUpdateComment[] | null>(null);
  const [me, setMe] = useState('');
  const [body, setBody] = useState('');
  const [n, setN] = useState(count);

  const load = useCallback(async () => {
    const res = await api<{ rows: PlanUpdateComment[]; me: string }>(`/api/track/plan-updates/${updateId}/comments`);
    if (res.ok) {
      setRows(res.data.rows);
      setMe(res.data.me);
      setN(res.data.rows.length);
    }
  }, [updateId]);

  useEffect(() => {
    if (open && rows === null) void load();
  }, [open, rows, load]);

  return (
    <div className="tp-comments">
      <button type="button" className="btn btn-sm btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {n ? t('updates.comments', { count: n }) : t('updates.reply')}
      </button>
      {open && (
        <div className="tp-comments-body">
          {rows?.map((c) => (
            <div key={c.id} className="tp-comment">
              <span className="tp-update-author">{c.user_name || c.user_email}</span>
              <time className="ui-help">{fmtWhen(c.created_at, locale)}</time>
              {c.user_id === me && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    await api(`/api/track/plan-updates/${updateId}/comments?commentId=${c.id}`, 'DELETE');
                    await load();
                  }}
                >
                  {t('common.delete')}
                </button>
              )}
              <p className="tp-comment-body">{c.body}</p>
            </div>
          ))}
          <form
            className="tp-inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!body.trim()) return;
              const res = await api(`/api/track/plan-updates/${updateId}/comments`, 'POST', { body });
              if (res.ok) {
                setBody('');
                await load();
              }
            }}
          >
            <input className="input" aria-label={t('updates.replyPlaceholder')} placeholder={t('updates.replyPlaceholder')} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
            <button type="submit" className="btn btn-sm" disabled={!body.trim()}>
              {t('updates.reply')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
