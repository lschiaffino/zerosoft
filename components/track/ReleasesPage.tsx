'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LocalText from '@/components/ui/LocalText';
import { formatDate } from '@/lib/utils';
import type { TrackReleaseWithProgress } from '@/lib/track-releases';
import { Popover } from './InlineEditors';
import { ProgressRing } from './ProgressRing';
import TrackIcon from './TrackIcon';
import { pushNotice } from './trackUndo';
import { TRACK_RELEASES_CHANGED } from './trackEvents';
import { releaseLabel, releasesChanged } from './useReleases';

type Status = TrackReleaseWithProgress['status'];
const STATUS_ORDER: Status[] = ['in_progress', 'planned', 'released'];

/** Glifo del estado del release: anillo vacío, a medio llenar o lleno (sin cápsulas). */
export function ReleaseStatusGlyph({ status }: { status: Status }) {
  return <span className={`track-release-glyph is-${status}`} aria-hidden />;
}

export function releasePercent(r: Pick<TrackReleaseWithProgress, 'total' | 'done' | 'cancelled'>): number {
  const scope = Number(r.total) - Number(r.cancelled);
  return scope > 0 ? Math.round((Number(r.done) / scope) * 100) : 0;
}

interface Team {
  id: string;
  name: string;
  key: string;
}

/**
 * Lista de releases como la de Linear: por estado (en curso, planeados,
 * publicados), con team, fecha, avance y cantidad de issues. Crear, renombrar
 * y borrar sin recargar; ?new=1 abre el alta (⌘K › New release).
 */
export default function ReleasesPage({
  locale,
  initialReleases,
  teams,
  openNew,
  defaultTeam,
  title,
  canDelete = false,
}: {
  locale: string;
  initialReleases: TrackReleaseWithProgress[];
  teams: Team[];
  openNew: boolean;
  defaultTeam?: string;
  title: string;
  /** Borrar es de admins, como cycles y milestones. */
  canDelete?: boolean;
}) {
  const t = useTranslations('track.releases');
  const router = useRouter();
  const [rows, setRows] = useState(initialReleases);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(openNew && teams.length > 0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TrackReleaseWithProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch('/api/track/releases').catch(() => null);
    if (!res?.ok) {
      setError(t('loadError'));
      return;
    }
    setError(null);
    setRows(((await res.json()) as { rows: TrackReleaseWithProgress[] }).rows);
  }, [t]);

  // Cambios desde otra pestaña de la app (la página de un release, ⌘K): la lista se pone al día.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener(TRACK_RELEASES_CHANGED, on);
    return () => window.removeEventListener(TRACK_RELEASES_CHANGED, on);
  }, [reload]);

  // ?new=1 (⌘K › New release) abre el alta, también estando ya en esta página, y se consume:
  // recargar no la vuelve a abrir.
  const searchParams = useSearchParams();
  const wantsNew = searchParams.get('new') === '1';
  useEffect(() => {
    if (!wantsNew) return;
    if (teams.length > 0) setCreating(true);
    router.replace('/app/track/releases', { scroll: false });
  }, [wantsNew, teams.length, router]);

  const rename = async (r: TrackReleaseWithProgress, name: string) => {
    setRenaming(null);
    const clean = name.trim();
    if (!clean || clean === r.name) return;
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, name: clean } : x)));
    const res = await fetch(`/api/track/releases/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: clean }),
    }).catch(() => null);
    if (!res?.ok) {
      setRows((list) => list.map((x) => (x.id === r.id ? { ...x, name: r.name } : x)));
      setError(t('error'));
      return;
    }
    releasesChanged();
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await fetch(`/api/track/releases/${deleting.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('error'));
      return;
    }
    setRows((list) => list.filter((x) => x.id !== deleting.id));
    setDeleting(null);
    pushNotice(t('deleted'));
    releasesChanged();
  };

  const sections = STATUS_ORDER.map((status) => ({ status, items: rows.filter((r) => r.status === status) })).filter((s) => s.items.length);

  return (
    <div className="app-page track-page ui-page track-releases-page" data-testid="track-releases">
      <PageHeader
        title={title}
        actions={
          teams.length > 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="track-release-new">
              {t('new')}
            </button>
          ) : undefined
        }
      />
      {error && (
        <p className="ui-error" role="alert" data-testid="track-releases-error">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState
          product="track"
          title={t('empty')}
          body={t('emptyHint')}
          action={
            teams.length > 0 ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                {t('new')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="track-releases-list" data-testid="track-releases-list">
          {sections.map((section) => (
            <section key={section.status} className="track-releases-section" aria-labelledby={`track-releases-${section.status}`}>
              <h2 className="track-releases-section-title" id={`track-releases-${section.status}`}>
                <ReleaseStatusGlyph status={section.status} />
                <span>{t(`statuses.${section.status}`)}</span>
                <span className="track-mytasks-count">{section.items.length}</span>
              </h2>
              <ul className="track-releases-rows" role="list">
                {section.items.map((r) => {
                  const pct = releasePercent(r);
                  const date = r.status === 'released' && r.released_at ? r.released_at : r.target_date;
                  return (
                    <li key={r.id} className="track-release-row" data-testid="track-release-row" data-release-id={r.id}>
                      {renaming === r.id ? (
                        <RenameInput
                          initial={r.name}
                          label={t('rename')}
                          onDone={(name) => void rename(r, name)}
                          onCancel={() => setRenaming(null)}
                        />
                      ) : (
                        <Link href={`/app/track/releases/${r.id}`} className="track-release-row-link" data-testid="track-release-link">
                          <span className="track-release-row-name">{r.name}</span>
                          {r.version && <span className="track-release-row-version data">{r.version}</span>}
                        </Link>
                      )}
                      <span className="track-release-row-team">{r.team_name}</span>
                      <span className="track-release-row-date" suppressHydrationWarning>
                        {date ? (
                          <LocalText>{r.status === 'released' ? t('released', { date: formatDate(date, locale) }) : formatDate(date, locale)}</LocalText>
                        ) : (
                          <span className="track-release-row-muted">{t('noDate')}</span>
                        )}
                      </span>
                      <span className="track-release-row-progress" title={`${pct}%`}>
                        <ProgressRing done={Number(r.done)} total={Math.max(Number(r.total) - Number(r.cancelled), 0)} size={14} />
                        <span className="data">{pct}%</span>
                      </span>
                      <span className="track-release-row-count data">{t('issueCount', { count: Number(r.total) })}</span>
                      <Popover ariaLabel={t('moreOf', { name: releaseLabel(r) })} className="btn btn-ghost btn-icon track-release-row-more" trigger={<TrackIcon name="more" size={14} />}>
                        {(close) => (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              className="track-menu-item"
                              data-autofocus=""
                              data-testid="track-release-rename"
                              onClick={() => {
                                close();
                                setRenaming(r.id);
                              }}
                            >
                              <span className="track-menu-label">{t('rename')}</span>
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                role="menuitem"
                                className="track-menu-item is-danger"
                                data-testid="track-release-delete"
                                onClick={() => {
                                  close();
                                  setDeleting(r);
                                }}
                              >
                                <span className="track-menu-label">{t('delete')}</span>
                              </button>
                            )}
                          </>
                        )}
                      </Popover>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {creating && (
        <NewReleaseDialog
          teams={teams}
          defaultTeam={teams.find((x) => x.id === defaultTeam || x.key === defaultTeam?.toUpperCase())?.id ?? teams[0]?.id}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            pushNotice(t('created'));
            releasesChanged();
            void reload();
            router.push(`/app/track/releases/${id}`);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('deleteTitle')}
        body={deleting ? t('deleteConfirm', { name: releaseLabel(deleting) }) : ''}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/** Nombre en el lugar: Enter guarda, Esc cancela, salir del campo guarda. */
export function RenameInput({ initial, label, onDone, onCancel }: { initial: string; label: string; onDone: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  return (
    <input
      className="input track-release-rename-input"
      aria-label={label}
      value={value}
      maxLength={200}
      autoFocus
      data-testid="track-release-rename-input"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          done.current = true;
          onDone(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!done.current) onDone(value);
      }}
    />
  );
}

/** Alta de un release: nombre, versión, team, fecha objetivo y estado. */
function NewReleaseDialog({
  teams,
  defaultTeam,
  onClose,
  onCreated,
}: {
  teams: Team[];
  defaultTeam?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('track.releases');
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [team, setTeam] = useState(defaultTeam ?? '');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<Status>('planned');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="ui-modal track-release-dialog"
      aria-labelledby={`${id}-title`}
      data-testid="track-release-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clic en el fondo (fuera de la caja): cierra, como los otros diálogos.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !team || submitting) return;
          setSubmitting(true);
          setError(false);
          const res = await fetch('/api/track/releases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: team, name: name.trim(), version: version.trim(), targetDate: date || null, status }),
          }).catch(() => null);
          if (!res?.ok) {
            setError(true);
            setSubmitting(false);
            return;
          }
          onCreated(((await res.json()) as { id: string }).id);
        }}
      >
        <div className="ui-modal-head">
          <h2 className="ui-modal-title" id={`${id}-title`}>
            {t('new')}
          </h2>
        </div>
        <div className="ui-modal-body track-release-form">
          <div className="ui-field">
            <label className="label" htmlFor={`${id}-name`}>
              {t('name')}
            </label>
            <input
              id={`${id}-name`}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              maxLength={200}
              autoFocus
              data-testid="track-release-name"
            />
          </div>
          <div className="track-release-form-row">
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-version`}>
                {t('version')}
              </label>
              <input
                id={`${id}-version`}
                className="input"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder={t('versionPlaceholder')}
                maxLength={60}
                data-testid="track-release-version"
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-date`}>
                {t('targetDate')}
              </label>
              <input id={`${id}-date`} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="track-release-date" />
            </div>
          </div>
          <div className="track-release-form-row">
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-team`}>
                {t('team')}
              </label>
              <select id={`${id}-team`} className="input" value={team} onChange={(e) => setTeam(e.target.value)} data-testid="track-release-team">
                {teams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${id}-status`}>
                {t('status')}
              </label>
              <select id={`${id}-status`} className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)} data-testid="track-release-status">
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {t(`statuses.${s}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <p className="ui-error" role="alert">
              {t('error')}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !team} aria-busy={submitting || undefined} data-testid="track-release-create">
            {t('create')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
