'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import type { TrackStatusRow } from '@/lib/db';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { defaultIssueStatus } from '@/lib/track-tasks';
import { formatWhenShort, SNOOZE_PRESETS, snoozeAt, type SnoozePreset } from '@/lib/track-snooze';
import { Popover } from './InlineEditors';
import SlaChip from './triage/SlaChip';
import TriageSuggestions from './triage/TriageSuggestions';
import IssueFromTextDialog from './triage/IssueFromTextDialog';
import { call } from './triage/api';

type QueueIssue = TrackIssueWithStatus & { snoozed_until?: string | null };

interface TriagePanelProps {
  projectId: string;
  issues: QueueIssue[];
  statuses: TrackStatusRow[];
  locale: string;
  onResolved: () => void;
}

async function resolve(issueId: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await call(`/api/track/issues/${issueId}/triage`, { method: 'POST', json: body });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export interface TriageActionsHandle {
  accept: () => void;
  decline: () => void;
  duplicate: () => void;
  snooze: () => void;
}

/**
 * Aceptar / rechazar / duplicado / snooze de un issue en triage, con
 * comentario opcional (como Linear). Se usa en la cola y en el banner del
 * detalle. `handleRef` deja que la cola dispare las acciones con 1, 2, 3 y H.
 */
export function TriageActions({
  issue,
  statuses,
  onResolved,
  handleRef,
  locale,
}: {
  issue: Pick<TrackIssueWithStatus, 'id'> & { snoozed_until?: string | null };
  statuses: TrackStatusRow[];
  onResolved: () => void;
  handleRef?: (h: TriageActionsHandle | null) => void;
  locale?: string;
}) {
  const t = useTranslations('track');
  const tt = useTranslations('trackTriage');
  const defaultStatus = defaultIssueStatus(statuses);
  const [statusId, setStatusId] = useState(defaultStatus?.id ?? '');
  const [dupOpen, setDupOpen] = useState(false);
  const [dupOf, setDupOf] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dupRef = useRef<HTMLInputElement>(null);
  const snoozeRef = useRef<HTMLSpanElement>(null);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      const res = await resolve(issue.id, comment.trim() ? { ...body, comment: comment.trim() } : body);
      setBusy(false);
      if (res.ok) onResolved();
      else if (body.action === 'duplicate' && res.error === 'invalid_duplicate') setError(t('triage.duplicateNotFound'));
      else if (res.error === 'not_in_triage') {
        // Otra persona lo resolvió antes: avisar y recargar la cola.
        setError(t('triage.alreadyResolved'));
        onResolved();
      } else setError(t('triage.error'));
    },
    [comment, issue.id, onResolved, t],
  );

  const snooze = async (until: string | null) => {
    setBusy(true);
    setError(null);
    const res = await call(`/api/track/issues/${issue.id}/snooze`, { method: 'POST', json: { until } });
    setBusy(false);
    if (res.ok) onResolved();
    else setError(tt('queue.snoozeError'));
  };

  const markDuplicate = async () => {
    const ident = dupOf.trim().toUpperCase();
    if (!ident) return;
    // El servidor busca el identifier exacto en todo el workspace.
    await act({ action: 'duplicate', duplicateOfIdentifier: ident });
  };

  useEffect(() => {
    if (!handleRef) return;
    handleRef({
      accept: () => void act({ action: 'accept', statusId: statusId || undefined }),
      decline: () => void act({ action: 'decline' }),
      duplicate: () => {
        setDupOpen(true);
        setTimeout(() => dupRef.current?.focus(), 0);
      },
      snooze: () => snoozeRef.current?.querySelector('button')?.click(),
    });
    return () => handleRef(null);
  }, [act, handleRef, statusId]);

  return (
    <>
      <div className="track-triage-actions">
        <label className="track-triage-accept-in" htmlFor={`accept-${issue.id}`}>
          {t('triage.acceptAs')}
        </label>
        <select
          id={`accept-${issue.id}`}
          className="select"
          value={statusId}
          onChange={(e) => setStatusId(e.target.value)}
          disabled={busy}
        >
          {statuses
            .filter((s) => s.category !== 'cancelled')
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={() => void act({ action: 'accept', statusId: statusId || undefined })}
          data-testid="track-triage-accept"
          aria-keyshortcuts="1"
          title={`${t('triage.accept')} (1)`}
        >
          {t('triage.accept')}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => void act({ action: 'decline' })}
          data-testid="track-triage-decline"
          aria-keyshortcuts="2"
          title={`${t('triage.decline')} (2)`}
        >
          {t('triage.decline')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => setDupOpen((v) => !v)}
          aria-expanded={dupOpen}
          aria-keyshortcuts="3"
          title={`${t('triage.duplicate')} (3)`}
          data-testid="track-triage-duplicate"
        >
          {t('triage.duplicate')}
        </button>
        <span ref={snoozeRef}>
          <Popover
            ariaLabel={tt('queue.snooze')}
            className="btn btn-ghost btn-sm"
            disabled={busy}
            width={200}
            trigger={<span title={`${tt('queue.snooze')} (H)`}>{issue.snoozed_until ? tt('queue.snoozedShort') : tt('queue.snooze')}</span>}
          >
            {(close) => (
              <>
                {SNOOZE_PRESETS.map((p: SnoozePreset) => {
                  const when = snoozeAt(p, new Date());
                  return (
                    <button
                      key={p}
                      type="button"
                      role="menuitem"
                      className="track-menu-item"
                      data-testid={`track-triage-snooze-${p}`}
                      onClick={() => {
                        close();
                        void snooze(when.toISOString());
                      }}
                    >
                      <span className="track-menu-label">{tt(`queue.snoozePresets.${p}`)}</span>
                      <span className="track-menu-meta">{formatWhenShort(when.toISOString(), locale ?? 'en')}</span>
                    </button>
                  );
                })}
                {issue.snoozed_until && (
                  <button
                    type="button"
                    role="menuitem"
                    className="track-menu-item"
                    onClick={() => {
                      close();
                      void snooze(null);
                    }}
                  >
                    <span className="track-menu-label">{tt('queue.unsnooze')}</span>
                  </button>
                )}
              </>
            )}
          </Popover>
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setCommentOpen((v) => !v)}
          aria-expanded={commentOpen}
          data-testid="track-triage-comment-toggle"
        >
          {tt('queue.addComment')}
        </button>
      </div>
      {commentOpen && (
        <div className="track-triage-dup">
          <label className="sr-only" htmlFor={`comment-${issue.id}`}>
            {tt('queue.comment')}
          </label>
          <input
            className="input"
            id={`comment-${issue.id}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={tt('queue.commentPlaceholder')}
            maxLength={2000}
            data-testid="track-triage-comment"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setCommentOpen(false);
              }
            }}
          />
        </div>
      )}
      {dupOpen && (
        <form
          className="track-triage-dup"
          onSubmit={(e) => {
            e.preventDefault();
            void markDuplicate();
          }}
        >
          <label className="sr-only" htmlFor={`dup-${issue.id}`}>
            {t('triage.duplicateOf')}
          </label>
          <input
            ref={dupRef}
            className="input data"
            id={`dup-${issue.id}`}
            value={dupOf}
            onChange={(e) => setDupOf(e.target.value)}
            placeholder={t('triage.duplicatePlaceholder')}
            maxLength={80}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDupOpen(false);
              }
            }}
          />
          <button type="submit" className="btn btn-sm" disabled={busy || !dupOf.trim()}>
            {t('triage.duplicateOf')}
          </button>
        </form>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function TriageRow({
  issue,
  statuses,
  locale,
  onResolved,
  active,
  onFocusRow,
  registerHandle,
}: {
  issue: QueueIssue;
  statuses: TrackStatusRow[];
  locale: string;
  onResolved: () => void;
  active: boolean;
  onFocusRow: () => void;
  registerHandle: (h: TriageActionsHandle | null) => void;
}) {
  const t = useTranslations('track');
  const tt = useTranslations('trackTriage');
  const source = issue.source && issue.source !== 'app' ? issue.source : 'api';
  const customers = issue.customer_count ?? 0;

  return (
    <li
      className={`track-triage-item${active ? ' is-active' : ''}`}
      data-testid="track-triage-item"
      data-issue-id={issue.id}
      tabIndex={active ? 0 : -1}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusRow();
      }}
      onMouseDown={onFocusRow}
      aria-current={active || undefined}
    >
      <div className="track-triage-main">
        <Link href={`/app/track/issues/${issue.id}`} className="track-triage-title" tabIndex={-1}>
          <span className="track-identifier">{issue.identifier}</span> {issue.title || t('issues.untitled')}
        </Link>
        <span className="track-triage-meta">
          {t('triage.from', { source: t(`triage.sources.${source}`) })} · {relDate(issue.created_at, locale)}
          {customers > 0 && <> · {tt('queue.customers', { count: customers })}</>}
          {issue.snoozed_until && <> · {tt('queue.snoozedUntil', { date: formatWhenShort(issue.snoozed_until, locale) })}</>}
        </span>
        {issue.sla_due_at && (
          <span className="track-triage-sla">
            <SlaChip dueAt={issue.sla_due_at} riskAt={issue.sla_risk_at} />
          </span>
        )}
      </div>
      <TriageActions
        issue={issue}
        statuses={statuses}
        onResolved={onResolved}
        locale={locale}
        handleRef={active ? registerHandle : undefined}
      />
      {active && <TriageSuggestions issueId={issue.id} onApplied={onResolved} />}
    </li>
  );
}

/** Aviso en el detalle de un issue que sigue en triage, con las mismas acciones y las sugerencias de IA. */
export function TriageBanner({
  issue,
  statuses,
  onResolved,
}: {
  issue: Pick<TrackIssueWithStatus, 'id'>;
  statuses: TrackStatusRow[];
  onResolved: () => void;
}) {
  const t = useTranslations('track');
  return (
    <div className="track-triage-item track-triage-banner" role="status" data-testid="track-triage-banner">
      <div className="track-triage-main">
        <span>{t('triage.banner')}</span>
      </div>
      <TriageActions issue={issue} statuses={statuses} onResolved={onResolved} />
      <TriageSuggestions issueId={issue.id} onApplied={onResolved} />
    </div>
  );
}

interface OwnerInfo {
  currentOwnerId: string | null;
  nextHandoffAt: string | null;
  ownerAction: string;
}

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n) return false;
  return n.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName);
}

/**
 * Cola de triage del proyecto, manejable con teclado como Linear: J/K (o
 * flechas) para moverse, 1 aceptar, 2 rechazar, 3 duplicado, H snooze, Enter
 * abre el issue. Arriba: responsable de turno, pospuestos y "crear desde texto".
 */
export default function TriagePanel(props: TriagePanelProps) {
  const t = useTranslations('track');
  const tt = useTranslations('trackTriage');
  const router = useRouter();
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [snoozed, setSnoozed] = useState<QueueIssue[]>([]);
  const [snoozedCount, setSnoozedCount] = useState(0);
  const [owner, setOwner] = useState<{ name: string; until: string | null } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fromTextOpen, setFromTextOpen] = useState(false);
  const handle = useRef<TriageActionsHandle | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const loadMeta = useCallback(async () => {
    const [q, settings, members] = await Promise.all([
      call<{ rows: QueueIssue[]; snoozedCount: number }>(`/api/track/projects/${props.projectId}/triage?snoozed=1`),
      call<OwnerInfo>(`/api/track/projects/${props.projectId}/triage-settings`),
      call<{ rows: Array<{ id: string; name: string | null; email: string }> }>(`/api/track/projects/${props.projectId}/members`),
    ]);
    if (q.ok) {
      setSnoozed(q.data.rows);
      setSnoozedCount(q.data.rows.length);
    }
    if (settings.ok && members.ok && settings.data.currentOwnerId && settings.data.ownerAction !== 'off') {
      const m = members.data.rows.find((r) => r.id === settings.data.currentOwnerId);
      setOwner(m ? { name: m.name || m.email, until: settings.data.nextHandoffAt } : null);
    } else setOwner(null);
  }, [props.projectId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta, props.issues]);

  const rows = showSnoozed ? snoozed : props.issues;
  const current = rows.find((r) => r.id === activeId) ?? rows[0] ?? null;

  const refresh = useCallback(() => {
    props.onResolved();
    void loadMeta();
  }, [loadMeta, props]);

  const focusRow = (id: string) => {
    setActiveId(id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-issue-id="${id}"]`)?.focus());
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !current) return;
    const idx = rows.findIndex((r) => r.id === current.id);
    const k = e.key.toLowerCase();
    if (k === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = rows[Math.min(rows.length - 1, idx + 1)];
      if (next) focusRow(next.id);
    } else if (k === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = rows[Math.max(0, idx - 1)];
      if (prev) focusRow(prev.id);
    } else if (e.key === '1') {
      e.preventDefault();
      handle.current?.accept();
    } else if (e.key === '2') {
      e.preventDefault();
      handle.current?.decline();
    } else if (e.key === '3') {
      e.preventDefault();
      handle.current?.duplicate();
    } else if (k === 'h') {
      e.preventDefault();
      handle.current?.snooze();
    } else if (e.key === 'Enter' && e.target === e.currentTarget.querySelector(`[data-issue-id="${current.id}"]`)) {
      e.preventDefault();
      router.push(`/app/track/issues/${current.id}`);
    }
  };

  return (
    <div className="track-triage" data-testid="track-triage">
      <div className="track-triage-head">
        <span className="track-triage-owner" data-testid="track-triage-owner">
          {owner
            ? owner.until
              ? tt('queue.ownerUntil', { name: owner.name, date: formatWhenShort(owner.until, props.locale) })
              : tt('queue.owner', { name: owner.name })
            : tt('queue.noOwner')}
        </span>
        <span className="track-triage-head-actions">
          {(snoozedCount > 0 || showSnoozed) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-pressed={showSnoozed}
              onClick={() => setShowSnoozed((v) => !v)}
              data-testid="track-triage-show-snoozed"
            >
              {showSnoozed ? tt('queue.backToQueue') : tt('queue.snoozed', { count: snoozedCount })}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setFromTextOpen(true)} data-testid="track-triage-from-text">
            {tt('ai.fromText')}
          </button>
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState quiet title={showSnoozed ? tt('queue.noSnoozed') : t('triage.empty')} body={showSnoozed ? undefined : t('triage.emptyBody')} />
      ) : (
        <>
          <p className="ui-help track-triage-keys" aria-hidden="true">
            {tt('queue.shortcuts')}
          </p>
          <ul
            ref={listRef}
            className="track-triage-list"
            data-testid="track-triage-list"
            onKeyDown={onKeyDown}
            aria-label={t('triage.title')}
            aria-keyshortcuts="J K 1 2 3 H"
          >
            {rows.map((issue) => (
              <TriageRow
                key={issue.id}
                issue={issue}
                statuses={props.statuses}
                locale={props.locale}
                onResolved={refresh}
                active={current?.id === issue.id}
                onFocusRow={() => setActiveId(issue.id)}
                registerHandle={(h) => {
                  handle.current = h;
                }}
              />
            ))}
          </ul>
        </>
      )}
      <IssueFromTextDialog
        open={fromTextOpen}
        projectId={props.projectId}
        onClose={() => setFromTextOpen(false)}
        onCreated={(id) => {
          setFromTextOpen(false);
          router.push(`/app/track/issues/${id}`);
        }}
      />
    </div>
  );
}
