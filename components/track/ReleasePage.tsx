'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import LocalText from '@/components/ui/LocalText';
import { formatDate } from '@/lib/utils';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import type { TrackReleaseWithProgress } from '@/lib/track-releases';
import { generateReleaseNotes } from '@/lib/track-release-notes';
import { Popover } from './InlineEditors';
import { StatusDot } from './glyphs';
import { MarkdownView } from './MarkdownView';
import TrackIcon from './TrackIcon';
import { issueHref } from './trackCommands';
import { pushNotice, pushUndo } from './trackUndo';
import { useTrackLive } from './useTrackLive';
import { releaseLabel, releasesChanged } from './useReleases';
import { ReleaseStatusGlyph, RenameInput, releasePercent } from './ReleasesPage';

type Status = TrackReleaseWithProgress['status'];
const STATUSES: Status[] = ['planned', 'in_progress', 'released'];
const CATEGORY_ORDER = ['in_progress', 'todo', 'backlog', 'done', 'cancelled'];

/**
 * Un release como en Linear: nombre, versión, estado y fecha editables en el
 * lugar, avance (terminados sobre lo que no se canceló), sus issues agrupados
 * por estado (sumar desde acá, sacar con la cruz), y las notas generadas con
 * los títulos (editables, copiar, volver a generar).
 */
export default function ReleasePage({
  locale,
  initialRelease,
  initialIssues,
  canDelete = false,
}: {
  locale: string;
  initialRelease: TrackReleaseWithProgress;
  initialIssues: TrackIssueWithStatus[];
  /** Borrar es de admins, como cycles y milestones. */
  canDelete?: boolean;
}) {
  const t = useTranslations('track.releases');
  const router = useRouter();
  const [release, setRelease] = useState(initialRelease);
  const [issues, setIssues] = useState(initialIssues);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  // Al sacar un issue, el foco no se pierde: va a la fila siguiente (o al botón de sumar).
  const focusAfterRemove = () => {
    const active = document.activeElement as HTMLElement | null;
    const row = active?.closest('[data-testid="track-release-issue"]');
    const next = (row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null;
    window.requestAnimationFrame(() => (next?.querySelector<HTMLElement>('a') ?? addRef.current)?.focus());
  };

  const reload = useCallback(async () => {
    const res = await fetch(`/api/track/releases/${initialRelease.id}`).catch(() => null);
    if (!res?.ok) {
      if (res?.status === 404) router.push('/app/track/releases');
      else setError(t('loadError'));
      return;
    }
    const data = (await res.json()) as { release: TrackReleaseWithProgress; issues: TrackIssueWithStatus[] };
    setRelease(data.release);
    setIssues(data.issues);
    setError(null);
  }, [initialRelease.id, router, t]);
  // Cambios de otros (un issue que se cierra, un PR que se mergea): la página se pone al día.
  useTrackLive({ projectId: initialRelease.project_id }, () => void reload());

  const patch = async (body: Record<string, unknown>, optimistic?: Partial<TrackReleaseWithProgress>) => {
    const before = release;
    if (optimistic) setRelease((r) => ({ ...r, ...optimistic }));
    const res = await fetch(`/api/track/releases/${release.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      setRelease(before);
      setError(t('error'));
      return false;
    }
    const next = (await res.json().catch(() => null)) as TrackReleaseWithProgress | null;
    if (next) setRelease(next);
    setError(null);
    if (body.name !== undefined || body.version !== undefined || body.status !== undefined) releasesChanged();
    return true;
  };

  const generated = useMemo(
    () =>
      generateReleaseNotes(release, issues, {
        features: t('notesFeatures'),
        improvements: t('notesImprovements'),
        fixes: t('notesFixes'),
        empty: t('notesEmpty'),
      }),
    [release, issues, t],
  );
  const notes = release.notes ?? generated;

  const removeIssue = async (issue: TrackIssueWithStatus, opts: { undo?: boolean } = {}) => {
    setIssues((list) => list.filter((i) => i.id !== issue.id));
    // ⌘Z se registra en el momento (no al volver la respuesta), como el resto de Track.
    if (opts.undo !== false) pushUndo(t('removed', { id: issue.identifier }), () => void addIssues([issue.id], { undo: false }));
    focusAfterRemove();
    const res = await fetch(`/api/track/releases/${release.id}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueIds: [issue.id], remove: true }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t('error'));
      void reload();
      return;
    }
    void reload();
  };

  const addIssues = async (ids: string[], opts: { undo?: boolean } = {}) => {
    const res = await fetch(`/api/track/releases/${release.id}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueIds: ids }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t('error'));
      return;
    }
    const out = (await res.json()) as { updated: string[] };
    await reload();
    if (opts.undo !== false && out.updated.length) {
      pushNotice(t('added', { count: out.updated.length }));
    }
  };

  const groups = useMemo(() => {
    const by = new Map<string, TrackIssueWithStatus[]>();
    for (const i of issues) {
      const key = i.status_id ?? '';
      by.set(key, [...(by.get(key) ?? []), i]);
    }
    return [...by.values()].sort((a, b) => {
      const ra = CATEGORY_ORDER.indexOf(a[0].status_category ?? '');
      const rb = CATEGORY_ORDER.indexOf(b[0].status_category ?? '');
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    });
  }, [issues]);

  const pct = releasePercent(release);
  const scope = Math.max(Number(release.total) - Number(release.cancelled), 0);

  return (
    <div className="app-page track-page ui-page track-release-page" data-testid="track-release-page" data-track-project-id={release.project_id}>
      <nav className="track-breadcrumb" aria-label={t('back')}>
        <Link href="/app/track/releases">{t('back')}</Link>
        <span className="track-breadcrumb-sep" aria-hidden>
          ›
        </span>
        <span className="track-breadcrumb-current" aria-current="page">
          {releaseLabel(release)}
        </span>
      </nav>

      <header className="track-release-head">
        <span className="track-release-head-icon" aria-hidden>
          <TrackIcon name="release" size={18} />
        </span>
        {renaming ? (
          <RenameInput
            initial={release.name}
            label={t('rename')}
            onDone={(name) => {
              setRenaming(false);
              if (name.trim() && name.trim() !== release.name) void patch({ name: name.trim() }, { name: name.trim() });
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <h1 className="track-release-title">
            <button type="button" className="track-release-title-btn" onClick={() => setRenaming(true)} title={t('rename')} data-testid="track-release-title">
              {release.name}
            </button>
          </h1>
        )}
        <Popover ariaLabel={t('more')} className="btn btn-ghost btn-icon track-release-more" trigger={<TrackIcon name="more" size={16} />} width={280}>
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                className="track-menu-item"
                data-autofocus=""
                onClick={() => {
                  close();
                  setRenaming(true);
                }}
              >
                <span className="track-menu-label">{t('rename')}</span>
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={Boolean(release.auto_github)}
                className="track-menu-item"
                data-testid="track-release-auto-github"
                onClick={() => {
                  close();
                  void patch({ autoGithub: !release.auto_github }, { auto_github: release.auto_github ? 0 : 1 });
                }}
              >
                <span className="track-menu-label">{t('autoGithub')}</span>
                {Boolean(release.auto_github) && <TrackIcon name="check" size={14} />}
              </button>
              {canDelete && (
                <>
                  <div className="track-menu-sep" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="track-menu-item is-danger"
                    data-testid="track-release-delete"
                    onClick={() => {
                      close();
                      setDeleting(true);
                    }}
                  >
                    <span className="track-menu-label">{t('delete')}</span>
                  </button>
                </>
              )}
            </>
          )}
        </Popover>
      </header>

      <dl className="track-release-props">
        <div className="track-release-prop">
          <dt>{t('status')}</dt>
          <dd>
            <Popover
              ariaLabel={t('status')}
              className="track-release-chip"
              trigger={
                <>
                  <ReleaseStatusGlyph status={release.status} />
                  <span data-testid="track-release-status-value">{t(`statuses.${release.status}`)}</span>
                </>
              }
            >
              {(close) =>
                STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={release.status === s}
                    className="track-menu-item"
                    data-testid={`track-release-status-${s}`}
                    onClick={() => {
                      close();
                      void patch({ status: s }, { status: s });
                    }}
                  >
                    <ReleaseStatusGlyph status={s} />
                    <span className="track-menu-label">{t(`statuses.${s}`)}</span>
                  </button>
                ))
              }
            </Popover>
          </dd>
        </div>
        <div className="track-release-prop">
          <dt>
            <label htmlFor="track-release-version">{t('version')}</label>
          </dt>
          <dd>
            <InlineField
              id="track-release-version"
              value={release.version}
              placeholder={t('versionPlaceholder')}
              maxLength={60}
              onSave={(v) => void patch({ version: v }, { version: v })}
            />
          </dd>
        </div>
        <div className="track-release-prop">
          <dt>
            <label htmlFor="track-release-date">{t('targetDate')}</label>
          </dt>
          <dd>
            <DateField value={release.target_date ?? ''} onSave={(v) => void patch({ targetDate: v || null }, { target_date: v || null })} />
          </dd>
        </div>
        <div className="track-release-prop">
          <dt>{t('team')}</dt>
          <dd className="track-release-team">{release.team_name}</dd>
        </div>
        {release.status === 'released' && release.released_at && (
          <div className="track-release-prop">
            <dt>{t('statuses.released')}</dt>
            <dd suppressHydrationWarning>
              <LocalText>{formatDate(release.released_at, locale)}</LocalText>
            </dd>
          </div>
        )}
      </dl>

      <section className="track-release-progress" aria-label={t('progress')} data-testid="track-release-progress">
        <div className="track-release-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('progress')}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="track-release-progress-text data">
          {pct}% · {Number(release.done)}/{scope}
        </span>
      </section>

      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <div className="track-release-grid">
        <section className="track-release-issues" aria-labelledby="track-release-issues-title">
          <div className="track-release-section-head">
            <h2 id="track-release-issues-title">
              {t('issues')} <span className="track-mytasks-count">{issues.length}</span>
            </h2>
            <button
              type="button"
              ref={addRef}
              className="btn btn-sm"
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
              data-testid="track-release-add"
            >
              <TrackIcon name="plus" size={13} />
              {t('addIssues')}
            </button>
          </div>
          {adding && (
            <IssuePicker
              projectId={release.project_id}
              exclude={new Set(issues.map((i) => i.id))}
              hint={t('addIssuesHint', { team: release.team_name })}
              onPick={(id) => void addIssues([id])}
              toggle={addRef}
              onClose={() => {
                setAdding(false);
                addRef.current?.focus();
              }}
            />
          )}
          {issues.length === 0 ? (
            <EmptyState compact body={t('issuesEmpty')} />
          ) : (
            groups.map((list) => (
              <div key={list[0].status_id ?? 'none'} className="track-release-group" data-testid="track-release-group">
                <h3 className="track-release-group-title">
                  <StatusDot color={list[0].status_color} category={list[0].status_category} />
                  <span>{list[0].status_name}</span>
                  <span className="track-mytasks-count">{list.length}</span>
                </h3>
                <ul className="track-release-issue-list" role="list">
                  {list.map((i) => (
                    <li key={i.id} className="track-release-issue" data-testid="track-release-issue" data-issue-key={i.id}>
                      <Link href={issueHref(i)} className="track-release-issue-link">
                        <span className="track-identifier">{i.identifier}</span>
                        <span className="track-release-issue-title">{i.title}</span>
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm track-release-issue-remove"
                        aria-label={t('removeIssue', { id: i.identifier })}
                        title={t('removeIssue', { id: i.identifier })}
                        data-testid="track-release-issue-remove"
                        onClick={() => void removeIssue(i)}
                      >
                        <TrackIcon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section className="track-release-notes" aria-labelledby="track-release-notes-title" data-testid="track-release-notes">
          <div className="track-release-section-head">
            <h2 id="track-release-notes-title">{t('notes')}</h2>
            <span className="track-release-notes-kind">{release.notes === null ? t('notesGenerated') : t('notesEdited')}</span>
          </div>
          {editingNotes ? (
            <form
              className="track-release-notes-form"
              onSubmit={(e) => {
                e.preventDefault();
                setEditingNotes(false);
                // Sin cambios, siguen siendo las generadas (se actualizan con los issues).
                const next = notesDraft.trim() === generated.trim() ? null : notesDraft;
                if (next !== release.notes) void patch({ notes: next }, { notes: next });
              }}
            >
              <textarea
                className="input track-release-notes-input"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                aria-label={t('notes')}
                rows={14}
                autoFocus
                data-testid="track-release-notes-input"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingNotes(false);
                  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="track-release-notes-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingNotes(false)}>
                  {t('cancel')}
                </button>
                <button type="submit" className="btn btn-primary btn-sm" data-testid="track-release-notes-save">
                  {t('save')}
                </button>
              </div>
            </form>
          ) : (
            <>
              <MarkdownView source={notes} className="track-release-notes-view" />
              <div className="track-release-notes-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="track-release-notes-edit"
                  onClick={() => {
                    setNotesDraft(notes);
                    setEditingNotes(true);
                  }}
                >
                  {t('editNotes')}
                </button>
                {release.notes !== null && (
                  <button type="button" className="btn btn-ghost btn-sm" data-testid="track-release-notes-reset" onClick={() => void patch({ notes: null }, { notes: null })}>
                    {t('resetNotes')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(notes).catch(() => undefined);
                    pushNotice(t('copied'));
                  }}
                >
                  {t('copyNotes')}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={deleting}
        title={t('deleteTitle')}
        body={t('deleteConfirm', { name: releaseLabel(release) })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          const res = await fetch(`/api/track/releases/${release.id}`, { method: 'DELETE' }).catch(() => null);
          setBusy(false);
          if (!res?.ok) {
            setError(t('error'));
            return;
          }
          setDeleting(false);
          pushNotice(t('deleted'));
          releasesChanged();
          router.push('/app/track/releases');
        }}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}

/** Fecha que guarda al salir o con Enter (no en cada tecla: tipear el año manda fechas a medias). */
function DateField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value && (draft === '' || /^\d{4}-\d{2}-\d{2}$/.test(draft))) onSave(draft);
  };
  return (
    <input
      id="track-release-date"
      type="date"
      className="input track-release-date"
      value={draft}
      data-testid="track-release-date-input"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value);
        }
      }}
    />
  );
}

/** Campo que guarda al salir o con Enter (Esc deshace lo tipeado). */
function InlineField({ id, value, placeholder, maxLength, onSave }: { id: string; value: string; placeholder: string; maxLength: number; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      className="input track-release-inline"
      value={draft}
      placeholder={placeholder}
      maxLength={maxLength}
      data-testid={id}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() !== value) onSave(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value);
        }
      }}
    />
  );
}

/** Buscar issues del team del release para sumarlos (Enter suma el primero, Esc cierra). */
function IssuePicker({
  projectId,
  exclude,
  hint,
  onPick,
  onClose,
  toggle,
}: {
  projectId: string;
  exclude: Set<string>;
  hint: string;
  onPick: (id: string) => void;
  onClose: () => void;
  /** El botón que abre y cierra el buscador: un clic ahí no cuenta como "afuera". */
  toggle: RefObject<HTMLButtonElement | null>;
}) {
  const [q, setQ] = useState('');
  // Las filas son de una búsqueda: Enter solo suma si ya llegaron las del texto actual.
  const [result, setResult] = useState<{ q: string; rows: TrackIssueWithStatus[] }>({ q: '\u0000', rows: [] });
  const rows = result.rows;
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      const sp = new URLSearchParams({ projectId, pageSize: '12' });
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/track/issues?${sp.toString()}`).catch(() => null);
      if (!alive || !res?.ok) return;
      setResult({ q, rows: ((await res.json()) as { rows: TrackIssueWithStatus[] }).rows });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q, projectId]);
  // Clic afuera cierra, como los menús.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (boxRef.current?.contains(target) || toggle.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, toggle]);
  const visible = rows.filter((r) => !exclude.has(r.id));
  return (
    <div className="track-release-picker" ref={boxRef} data-testid="track-release-picker">
      <input
        className="input"
        value={q}
        autoFocus
        placeholder={hint}
        aria-label={hint}
        onChange={(e) => setQ(e.target.value)}
        data-testid="track-release-picker-input"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Enter' && visible[0] && result.q === q) {
            e.preventDefault();
            onPick(visible[0].id);
          }
        }}
      />
      <ul className="track-release-picker-list" role="listbox" aria-label={hint}>
        {visible.map((r) => (
          <li key={r.id} role="option" aria-selected={false}>
            <button type="button" className="track-release-picker-item" onClick={() => onPick(r.id)} data-testid="track-release-picker-item">
              <StatusDot color={r.status_color} category={r.status_category} />
              <span className="track-identifier">{r.identifier}</span>
              <span className="track-release-issue-title">{r.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
