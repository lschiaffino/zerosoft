'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { Link, useRouter } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import type { TrackStatusRow } from '@/lib/db';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { defaultIssueStatus } from '@/lib/track-tasks';
import { safeHexColor } from '@/lib/track-color';
import { formatWhenShort, SNOOZE_PRESETS, snoozeAt, type SnoozePreset } from '@/lib/track-snooze';
import { PriorityIcon, StatusDot } from './InlineEditors';
import KeyPicker, { type KeyPickerHandle, type KeyPickerOption } from './KeyPicker';
import SlaChip from './triage/SlaChip';
import TriageSuggestions from './triage/TriageSuggestions';
import IssueFromTextDialog from './triage/IssueFromTextDialog';
import { call } from './triage/api';
import { TRACK_VIEWS_CHANGED } from './TrackBranch';
import { isTypingTarget, issueHref } from './trackCommands';

const MarkdownView = dynamic(() => import('./MarkdownView').then((m) => m.MarkdownView));

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

function descriptionText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((b: { text?: string }) => b.text ?? '').join('\n') : raw;
  } catch {
    return raw;
  }
}

function parseLabels(raw: string): Array<{ id: string; name: string; color: string }> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface TriageActionsHandle {
  accept: () => void;
  decline: () => void;
  duplicate: () => void;
  snooze: () => void;
}

/**
 * Barra de acciones de triage como la de Linear: Accept (1, con el estado de
 * entrada a elegir), Decline (2), Duplicate (3, picker con los duplicados
 * sugeridos arriba) y Snooze (H). Comentario opcional. Se usa en la cola y en
 * el aviso del detalle del issue.
 */
export function TriageActions({
  issue,
  statuses,
  onResolved,
  handleRef,
  locale,
}: {
  issue: Pick<TrackIssueWithStatus, 'id' | 'project_id'> & { snoozed_until?: string | null };
  statuses: TrackStatusRow[];
  onResolved: () => void;
  handleRef?: (h: TriageActionsHandle | null) => void;
  locale?: string;
}) {
  const t = useTranslations('track');
  const tt = useTranslations('trackTriage');
  const defaultStatus = defaultIssueStatus(statuses);
  const [statusId, setStatusId] = useState(defaultStatus?.id ?? '');
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState<KeyPickerOption[]>([]);
  const [found, setFound] = useState<KeyPickerOption[]>([]);
  const dupRef = useRef<KeyPickerHandle>(null);
  const snoozeRef = useRef<KeyPickerHandle>(null);
  const searchSeq = useRef(0);

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

  const snooze = useCallback(
    async (until: string | null) => {
      setBusy(true);
      setError(null);
      const res = await call(`/api/track/issues/${issue.id}/snooze`, { method: 'POST', json: { until } });
      setBusy(false);
      if (res.ok) onResolved();
      else setError(tt('queue.snoozeError'));
    },
    [issue.id, onResolved, tt],
  );

  // Duplicados sugeridos (títulos parecidos) al abrir el picker.
  const loadSuggested = useCallback(async () => {
    const res = await call<{ rows: Array<{ id: string; identifier: string; title: string }> }>(`/api/track/issues/${issue.id}/duplicates`);
    setSuggested(
      res.ok
        ? res.data.rows.map((r) => ({ value: r.id, label: r.title || r.identifier, meta: r.identifier, keywords: r.identifier, group: tt('queue.suggested') }))
        : [],
    );
  }, [issue.id, tt]);

  const search = useCallback(
    (q: string) => {
      const seq = ++searchSeq.current;
      const query = q.trim();
      if (!query) {
        // Sin tipear: los issues recientes del team abajo de los sugeridos (como Linear), no un menú vacío.
        void call<{ rows: TrackIssueWithStatus[] }>(`/api/track/projects/${issue.project_id}/issues?pageSize=12`).then((res) => {
          if (seq !== searchSeq.current) return;
          setFound(
            res.ok
              ? res.data.rows
                  .filter((r) => r.id !== issue.id && !r.triage)
                  .map((r) => ({ value: r.id, label: r.title || r.identifier, meta: r.identifier, keywords: r.identifier, group: tt('queue.recent') }))
              : [],
          );
        });
        return;
      }
      window.setTimeout(async () => {
        if (seq !== searchSeq.current) return;
        const res = await call<{ rows: TrackIssueWithStatus[] }>(`/api/track/issues?pageSize=12&q=${encodeURIComponent(query)}`);
        if (seq !== searchSeq.current) return;
        setFound(
          res.ok
            ? res.data.rows
                .filter((r) => r.id !== issue.id)
                .map((r) => ({ value: r.id, label: r.title || r.identifier, meta: r.identifier, keywords: r.identifier, group: tt('queue.allIssues') }))
            : [],
        );
      }, 150);
    },
    [issue.id, issue.project_id, tt],
  );

  const dupOptions = useMemo(() => {
    const seen = new Set(suggested.map((s) => s.value));
    return [...suggested, ...found.filter((f) => !seen.has(f.value))];
  }, [suggested, found]);

  const openDuplicate = useCallback(() => {
    void loadSuggested();
    search('');
    dupRef.current?.open();
  }, [loadSuggested, search]);

  useEffect(() => {
    if (!handleRef) return;
    handleRef({
      accept: () => void act({ action: 'accept', statusId: statusId || undefined }),
      decline: () => void act({ action: 'decline' }),
      duplicate: openDuplicate,
      snooze: () => snoozeRef.current?.open(),
    });
    return () => handleRef(null);
  }, [act, handleRef, statusId, openDuplicate]);

  const acceptStatus = statuses.find((s) => s.id === statusId) ?? defaultStatus;
  const now = new Date();
  const snoozeOptions: KeyPickerOption[] = [
    ...SNOOZE_PRESETS.map((p: SnoozePreset) => ({
      value: p,
      label: tt(`queue.snoozePresets.${p}`),
      meta: formatWhenShort(snoozeAt(p, now).toISOString(), locale ?? 'en'),
    })),
    ...(issue.snoozed_until ? [{ value: 'none', label: tt('queue.unsnooze') }] : []),
  ];

  return (
    <>
      <div className="track-triage-actions" role="toolbar" aria-label={t('triage.title')}>
        <span className="track-triage-accept-group">
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
            <kbd className="track-triage-kbd">1</kbd>
          </button>
          <KeyPicker
            ariaLabel={t('triage.acceptAs')}
            className="track-triage-into"
            testId="track-triage-accept-as"
            disabled={busy}
            value={statusId}
            options={statuses
              .filter((s) => s.category !== 'cancelled')
              .map((s) => ({ value: s.id, label: s.name, icon: <StatusDot color={s.color} category={s.category} /> }))}
            onSelect={setStatusId}
            trigger={
              <>
                <StatusDot color={acceptStatus?.color ?? null} category={acceptStatus?.category ?? null} />
                <span className="track-inline-text">{acceptStatus?.name ?? '–'}</span>
              </>
            }
          />
        </span>
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
          <kbd className="track-triage-kbd">2</kbd>
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={openDuplicate}
          aria-keyshortcuts="3"
          title={`${t('triage.duplicate')} (3)`}
          data-testid="track-triage-duplicate"
          id={`track-triage-dup-${issue.id}`}
        >
          {t('triage.duplicate')}
          <kbd className="track-triage-kbd">3</kbd>
        </button>
        <KeyPicker
          ref={dupRef}
          ariaLabel={t('triage.duplicateOf')}
          placeholder={tt('queue.duplicateSearch')}
          testId="track-triage-dup-picker"
          anchor={() => document.getElementById(`track-triage-dup-${issue.id}`)}
          width={340}
          options={dupOptions}
          onQueryChange={search}
          emptyLabel={tt('queue.duplicateEmpty')}
          onSelect={(id) => void act({ action: 'duplicate', duplicateOfId: id })}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => snoozeRef.current?.open()}
          aria-keyshortcuts="H"
          title={`${tt('queue.snooze')} (H)`}
          data-testid="track-triage-snooze"
          id={`track-triage-snooze-${issue.id}`}
        >
          {issue.snoozed_until ? tt('queue.snoozedShort') : tt('queue.snooze')}
          <kbd className="track-triage-kbd">H</kbd>
        </button>
        <KeyPicker
          ref={snoozeRef}
          ariaLabel={tt('queue.snooze')}
          testId="track-triage-snooze-picker"
          anchor={() => document.getElementById(`track-triage-snooze-${issue.id}`)}
          width={280}
          options={snoozeOptions}
          onSelect={(v) => void snooze(v === 'none' ? null : snoozeAt(v as SnoozePreset, new Date()).toISOString())}
        />
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
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setCommentOpen(false);
              }
            }}
          />
        </div>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Aviso en el detalle de un issue que sigue en triage, con las mismas acciones y las sugerencias de IA. */
export function TriageBanner({
  issue,
  statuses,
  onResolved,
}: {
  issue: Pick<TrackIssueWithStatus, 'id' | 'project_id'>;
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

const isTyping = isTypingTarget;

function overlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"], dialog[open], .cmdk, [role="menu"]'));
}

/** Detalle del issue en triage (columna derecha): título, propiedades, descripción y la barra de acciones. */
function TriageDetail({
  issue,
  statuses,
  locale,
  onResolved,
  registerHandle,
}: {
  issue: QueueIssue;
  statuses: TrackStatusRow[];
  locale: string;
  onResolved: () => void;
  registerHandle: (h: TriageActionsHandle | null) => void;
}) {
  const t = useTranslations('track');
  const tt = useTranslations('trackTriage');
  const source = issue.source && issue.source !== 'app' ? issue.source : 'api';
  const customers = issue.customer_count ?? 0;
  const labels = parseLabels(issue.labels);
  const desc = descriptionText(issue.description).trim();
  const priorityLabel = issue.priority === 'none' ? t('priorities.none') : t(`priorities.${issue.priority}`);
  return (
    <section className="track-triage-detail" aria-label={issue.identifier} data-testid="track-triage-detail">
      <TriageActions issue={issue} statuses={statuses} onResolved={onResolved} locale={locale} handleRef={registerHandle} />
      <div className="track-triage-detail-body">
        <p className="track-triage-detail-id">
          <span className="track-identifier">{issue.identifier}</span>
          <span className="track-triage-meta">
            {t('triage.from', { source: t(`triage.sources.${source}`) })} · {relDate(issue.created_at, locale)}
            {customers > 0 && <> · {tt('queue.customers', { count: customers })}</>}
            {issue.snoozed_until && <> · {tt('queue.snoozedUntil', { date: formatWhenShort(issue.snoozed_until, locale) })}</>}
          </span>
        </p>
        <h2 className="track-triage-detail-title">{issue.title || t('issues.untitled')}</h2>
        <div className="track-triage-props">
          <span className="track-triage-prop">
            <PriorityIcon priority={issue.priority} />
            {priorityLabel}
          </span>
          <span className="track-triage-prop">
            {issue.assignee_id ? (
              <span className="track-avatar">{(issue.assignee_name || issue.assignee_email || '?')[0]?.toUpperCase()}</span>
            ) : (
              <span className="track-avatar track-avatar-empty" aria-hidden />
            )}
            {issue.assignee_id ? issue.assignee_name || issue.assignee_email : t('issues.noAssignee')}
          </span>
          {labels.map((l) => (
            <span key={l.id} className="track-triage-prop">
              <span className="track-label-dot" style={{ background: safeHexColor(l.color, '#767676') }} aria-hidden />
              {l.name}
            </span>
          ))}
          {issue.sla_due_at && <SlaChip dueAt={issue.sla_due_at} riskAt={issue.sla_risk_at} />}
        </div>
        {desc ? (
          <MarkdownView source={desc} className="track-triage-desc" />
        ) : (
          <p className="track-triage-desc is-empty">{tt('queue.noDescription')}</p>
        )}
        <TriageSuggestions issueId={issue.id} onApplied={onResolved} />
        <Link href={issueHref(issue)} className="track-triage-open">
          {tt('queue.openIssue')}
        </Link>
      </div>
    </section>
  );
}

/**
 * Cola de triage del team como Linear: la lista a la izquierda y el issue
 * elegido a la derecha con su barra de acciones. J/K (o flechas) se mueven
 * y dan foco a la fila, 1 acepta, 2 rechaza, 3 duplicado, H pospone y Enter
 * abre el issue, sin clickear antes.
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
    // El siguiente de la cola queda elegido (como Linear después de aceptar).
    const idx = current ? rows.findIndex((r) => r.id === current.id) : -1;
    const next = idx >= 0 ? (rows[idx + 1] ?? rows[idx - 1] ?? null) : null;
    setActiveId(next?.id ?? null);
    props.onResolved();
    void loadMeta();
    // El contador de triage del sidebar se actualiza.
    window.dispatchEvent(new Event(TRACK_VIEWS_CHANGED));
  }, [loadMeta, props, rows, current]);

  const focusRow = useCallback((id: string) => {
    setActiveId(id);
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-issue-id="${id}"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  // Atajos de la cola en la ventana: andan sin haber clickeado antes una fila.
  const stateRef = useRef({ rows, current, focusRow, router });
  stateRef.current = { rows, current, focusRow, router };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || overlayOpen()) return;
      const { rows: list, current: cur, focusRow: focus, router: r } = stateRef.current;
      if (!cur) return;
      const idx = list.findIndex((x) => x.id === cur.id);
      const k = e.key.toLowerCase();
      if ((k === 'j' || e.key === 'ArrowDown') && !e.shiftKey) {
        e.preventDefault();
        const next = list[Math.min(list.length - 1, idx + 1)];
        if (next) focus(next.id);
      } else if ((k === 'k' || e.key === 'ArrowUp') && !e.shiftKey) {
        e.preventDefault();
        const prev = list[Math.max(0, idx - 1)];
        if (prev) focus(prev.id);
      } else if (e.key === '1' && !e.shiftKey) {
        e.preventDefault();
        handle.current?.accept();
      } else if (e.key === '2' && !e.shiftKey) {
        e.preventDefault();
        handle.current?.decline();
      } else if (e.key === '3' && !e.shiftKey) {
        e.preventDefault();
        handle.current?.duplicate();
      } else if (k === 'h' && !e.shiftKey) {
        e.preventDefault();
        handle.current?.snooze();
      } else if (e.key === 'Enter') {
        const target = e.target as HTMLElement | null;
        const onRow = target?.dataset?.issueId === cur.id || target === document.body || target === document.documentElement;
        if (!onRow) return;
        e.preventDefault();
        r.push(issueHref(cur));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const registerHandle = useCallback((h: TriageActionsHandle | null) => {
    handle.current = h;
  }, []);

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
        <div className="track-triage-split">
          <div className="track-triage-side">
            <ul
              ref={listRef}
              className="track-triage-list"
              data-testid="track-triage-list"
              aria-label={t('triage.title')}
              aria-keyshortcuts="J K 1 2 3 H"
            >
              {rows.map((issue) => {
                const active = current?.id === issue.id;
                return (
                  <li
                    key={issue.id}
                    className={`track-triage-item${active ? ' is-active' : ''}`}
                    data-testid="track-triage-item"
                    data-issue-id={issue.id}
                    tabIndex={active ? 0 : -1}
                    onFocus={(e) => {
                      if (e.target === e.currentTarget) setActiveId(issue.id);
                    }}
                    onMouseDown={() => setActiveId(issue.id)}
                    aria-current={active || undefined}
                  >
                    <span className="track-triage-row-top">
                      <span className="track-identifier">{issue.identifier}</span>
                      <span className="track-triage-row-when">{relDate(issue.created_at, props.locale)}</span>
                    </span>
                    <span className="track-triage-row-title">{issue.title || t('issues.untitled')}</span>
                    <span className="track-triage-row-meta">
                      {t('triage.from', { source: t(`triage.sources.${issue.source && issue.source !== 'app' ? issue.source : 'api'}`) })}
                      {issue.sla_due_at && <SlaChip dueAt={issue.sla_due_at} riskAt={issue.sla_risk_at} compact />}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="ui-help track-triage-keys" aria-hidden="true">
              {tt('queue.shortcuts')}
            </p>
          </div>
          {current && (
            <TriageDetail
              key={current.id}
              issue={current}
              statuses={props.statuses}
              locale={props.locale}
              onResolved={refresh}
              registerHandle={registerHandle}
            />
          )}
        </div>
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
