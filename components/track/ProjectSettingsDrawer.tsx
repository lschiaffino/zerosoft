'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { TrackProjectRow } from '@/lib/schema/types';
import { normalizeTeamKey } from '@/lib/track-team-key';
import { teamPath } from '@/lib/track-routes';
import TrackIcon from './TrackIcon';
import { LabelsSettings } from './TrackSettingsClient';
import { TeamAutomation } from './planning/AutomationSettings';
import { ESTIMATE_SCALES, estimateOptions, isEstimateScale, type EstimateScale } from '@/lib/track-estimates';

/** Pestañas que arma la página del team (ProjectPageClient). */
export type ProjectSettingsTab = 'cycles' | 'statuses' | 'milestones' | 'templates' | 'recurring' | 'triage';
/** Todas, como los ajustes de un team en Linear: las propias del drawer van primero. */
type DrawerTab = 'general' | 'members' | 'labels' | 'estimates' | ProjectSettingsTab | 'integrations';

const TABS: DrawerTab[] = ['general', 'members', 'labels', 'estimates', 'statuses', 'triage', 'cycles', 'templates', 'recurring', 'milestones', 'integrations'];

interface ProjectSettingsDrawerProps {
  projectName: string;
  /** Si no llega, se toma del team de la página (data-track-project-id). */
  projectId?: string;
  isAdmin?: boolean;
  initialTab?: DrawerTab;
  onClose: () => void;
  /** Contenido de cada pestaña de la página (se monta solo la activa). */
  panels: Record<ProjectSettingsTab, ReactNode>;
}

async function send<T>(url: string, method = 'GET', body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  const data = (res ? await res.json().catch(() => ({})) : {}) as T;
  return { ok: Boolean(res?.ok), status: res?.status ?? 0, data };
}

/** General: nombre, identificador (prefijo de los IDs) e ícono. */
function GeneralPanel({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const t = useTranslations('track');
  const router = useRouter();
  const [project, setProject] = useState<TrackProjectRow | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void send<TrackProjectRow>(`/api/track/projects/${projectId}`).then((r) => {
      if (r.ok) {
        setProject(r.data);
        setKey(r.data.slug.toUpperCase());
      }
    });
  }, [projectId]);

  const save = async (body: Record<string, unknown>) => {
    setError(null);
    setNotice(null);
    const r = await send<TrackProjectRow & { error?: string }>(`/api/track/projects/${projectId}`, 'PATCH', body);
    if (!r.ok) {
      const code = r.data.error;
      setError(code === 'slug_taken' ? t('errors.slug_taken') : r.status === 403 ? t('teamSettings.adminOnly') : t('errors.generic'));
      if (project) setKey(project.slug.toUpperCase());
      return;
    }
    setProject(r.data);
    setNotice(t('teamSettings.saved'));
    if (body.slug) {
      // Los IDs del team cambiaron (los viejos siguen andando): a la URL nueva.
      router.replace(teamPath(r.data));
      router.refresh();
    }
  };

  if (!project) return <p className="ui-help">{t('common.loading')}</p>;
  return (
    <div className="track-team-general" data-testid="track-team-general">
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ui-help" role="status">
          {notice}
        </p>
      )}
      <div className="ui-field">
        <label className="label" htmlFor="tg-name">
          {t('projects.form.name')}
        </label>
        <input
          id="tg-name"
          className="input"
          defaultValue={project.name}
          maxLength={200}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== project.name) void save({ name: v });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="tg-key">
          {t('projects.form.identifier')}
        </label>
        <input
          id="tg-key"
          className="input data track-key-input"
          value={key}
          disabled={!isAdmin}
          maxLength={5}
          onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 5))}
          onBlur={() => {
            const next = normalizeTeamKey(key);
            if (!next) {
              setKey(project.slug.toUpperCase());
              return;
            }
            if (next !== project.slug) void save({ slug: next });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-describedby="tg-key-help"
          data-testid="track-team-key-edit"
        />
        <p className="ui-help" id="tg-key-help">
          {t('teamSettings.identifierHelp', { example: `${key || 'MOB'}-12` })}
        </p>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="tg-icon">
          {t('projects.form.icon')}
        </label>
        <input
          id="tg-icon"
          className="input track-icon-input"
          defaultValue={project.icon ?? ''}
          maxLength={8}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (project.icon ?? '')) void save({ icon: v });
          }}
        />
        <p className="ui-help">{t('projects.form.iconHelp')}</p>
      </div>
    </div>
  );
}

/** Members: quién ve y trabaja en el team (el acceso se maneja en Ajustes › Acceso). */
function MembersPanel({ projectId }: { projectId: string }) {
  const t = useTranslations('track');
  const [rows, setRows] = useState<Array<{ id: string; name: string | null; email: string }> | null>(null);
  useEffect(() => {
    void send<{ rows: Array<{ id: string; name: string | null; email: string }> }>(`/api/track/projects/${projectId}/members`).then((r) =>
      setRows(r.ok ? r.data.rows : []),
    );
  }, [projectId]);
  if (!rows) return <p className="ui-help">{t('common.loading')}</p>;
  return (
    <div data-testid="track-team-members">
      <p className="ui-help">{t('teamSettings.membersHelp', { count: rows.length })}</p>
      <ul className="track-team-members" role="list">
        {rows.map((m) => (
          <li key={m.id} className="track-team-member">
            <span className="track-avatar">{(m.name || m.email)[0]?.toUpperCase()}</span>
            <span className="track-team-member-name">{m.name || m.email}</span>
            {m.name && <span className="track-team-member-email">{m.email}</span>}
          </li>
        ))}
      </ul>
      <Link href="/app/track/settings?tab=access" className="btn btn-sm">
        {t('teamSettings.manageAccess')}
      </Link>
    </div>
  );
}

/** Workflow: auto-cerrar padre y sub-issues (como Linear). */
function SubIssueAutomation({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const t = useTranslations('track');
  const [project, setProject] = useState<TrackProjectRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void send<TrackProjectRow>(`/api/track/projects/${projectId}`).then((r) => r.ok && setProject(r.data));
  }, [projectId]);
  // Optimista: el cuadrado se tilda al instante (y vuelve si el servidor rechaza).
  const toggle = async (field: 'autoCloseParent' | 'autoCloseChildren', value: boolean) => {
    setError(null);
    const column = field === 'autoCloseParent' ? 'auto_close_parent' : 'auto_close_children';
    const prev = project;
    setProject((p) => (p ? { ...p, [column]: value ? 1 : 0 } : p));
    const r = await send<TrackProjectRow>(`/api/track/projects/${projectId}`, 'PATCH', { [field]: value });
    if (r.ok) setProject(r.data);
    else {
      setProject(prev);
      setError(r.status === 403 ? t('teamSettings.adminOnly') : t('errors.generic'));
    }
  };
  if (!project) return null;
  return (
    <fieldset className="track-team-autoclose" data-testid="track-team-autoclose">
      <legend className="tp-card-title">{t('teamSettings.subIssues')}</legend>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <label className="ui-check track-autoclose-row">
        <input
          type="checkbox"
          checked={Boolean(project.auto_close_parent)}
          disabled={!isAdmin}
          onChange={(e) => void toggle('autoCloseParent', e.target.checked)}
          data-testid="track-auto-close-parent"
        />
        <span>{t('teamSettings.autoCloseParent')}</span>
      </label>
      <label className="ui-check track-autoclose-row">
        <input
          type="checkbox"
          checked={Boolean(project.auto_close_children)}
          disabled={!isAdmin}
          onChange={(e) => void toggle('autoCloseChildren', e.target.checked)}
          data-testid="track-auto-close-children"
        />
        <span>{t('teamSettings.autoCloseChildren')}</span>
      </label>
    </fieldset>
  );
}

/** Estimates: la escala del team (como Linear); ⇧E ofrece esos valores. */
function EstimatesPanel({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const t = useTranslations('track');
  const [scale, setScale] = useState<EstimateScale | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void send<TrackProjectRow>(`/api/track/projects/${projectId}`).then((r) => {
      if (r.ok) setScale(isEstimateScale(r.data.estimate_scale) ? r.data.estimate_scale : 'fibonacci');
    });
  }, [projectId]);
  const pick = async (next: EstimateScale) => {
    if (!isAdmin || next === scale) return;
    setError(null);
    const prev = scale;
    setScale(next);
    const r = await send<TrackProjectRow>(`/api/track/projects/${projectId}`, 'PATCH', { estimateScale: next });
    if (!r.ok) {
      setScale(prev);
      setError(r.status === 403 ? t('teamSettings.adminOnly') : t('errors.generic'));
    }
  };
  if (!scale) return <p className="ui-help">{t('common.loading')}</p>;
  return (
    <div data-testid="track-team-estimates">
      <p className="ui-help">{t('teamSettings.estimatesHelp')}</p>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="track-estimate-scales" role="radiogroup" aria-label={t('projectSettings.tabs.estimates')}>
        {ESTIMATE_SCALES.map((s) => {
          const opts = estimateOptions(s);
          return (
            <label key={s} className={`track-estimate-scale${scale === s ? ' is-on' : ''}`}>
              <input
                type="radio"
                name={`est-${projectId}`}
                checked={scale === s}
                disabled={!isAdmin}
                onChange={() => void pick(s)}
                data-testid={`track-estimate-scale-${s}`}
              />
              <span className="track-estimate-scale-name">{t(`teamSettings.scales.${s}`)}</span>
              <span className="track-estimate-scale-values data">{opts.length ? opts.map((o) => o.label).join(', ') : '–'}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function IntegrationsPanel() {
  const t = useTranslations('track');
  return (
    <div className="track-team-integrations">
      <p className="ui-help">{t('teamSettings.integrationsHelp')}</p>
      <ul className="track-team-links" role="list">
        <li>
          <Link href="/app/track/settings?tab=github">{t('github.title')}</Link>
        </li>
        <li>
          <Link href="/app/track/settings?tab=integrations">{t('integrations.tab')}</Link>
        </li>
        <li>
          <Link href="/app/track/settings?tab=api">{t('apiSettings.tab')}</Link>
        </li>
      </ul>
    </div>
  );
}

/**
 * Ajustes del team en un drawer (<dialog> modal: foco atrapado, Esc cierra y
 * el foco vuelve al botón que lo abrió), ordenados como en Linear: General,
 * Members, Labels, Workflow (estados, auto-cierre y auto-archivo), Triage,
 * Cycles, Templates, Recurring, Milestones e Integrations.
 */
export default function ProjectSettingsDrawer({ projectName, projectId: idProp, isAdmin = true, initialTab = 'general', onClose, panels }: ProjectSettingsDrawerProps) {
  const t = useTranslations('track');
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [projectId, setProjectId] = useState<string | null>(idProp ?? null);
  const id = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (idProp) setProjectId(idProp);
    else setProjectId(document.querySelector<HTMLElement>('[data-track-project-id]')?.dataset.trackProjectId ?? null);
  }, [idProp]);

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus?.();
    };
  }, []);

  const onTabKey = useCallback((e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (index + delta + TABS.length) % TABS.length;
    setTab(TABS[next]);
    tabRefs.current[TABS[next]]?.focus();
  }, []);

  const body = (() => {
    if (!projectId && (tab === 'general' || tab === 'members' || tab === 'labels' || tab === 'estimates')) return null;
    switch (tab) {
      case 'general':
        return <GeneralPanel projectId={projectId!} isAdmin={isAdmin} />;
      case 'members':
        return <MembersPanel projectId={projectId!} />;
      case 'labels':
        return <LabelsSettings isAdmin={isAdmin} projectId={projectId!} />;
      case 'estimates':
        return projectId ? <EstimatesPanel projectId={projectId} isAdmin={isAdmin} /> : null;
      case 'integrations':
        return <IntegrationsPanel />;
      case 'statuses':
        return (
          <>
            {panels.statuses}
            {projectId && (
              <>
                <SubIssueAutomation projectId={projectId} isAdmin={isAdmin} />
                <h3 className="tp-card-title">{t('teamSettings.housekeeping')}</h3>
                <TeamAutomation projectId={projectId} isAdmin={isAdmin} />
              </>
            )}
          </>
        );
      default:
        return panels[tab];
    }
  })();

  return (
    <dialog
      ref={ref}
      className="ui-drawer track-drawer track-team-settings"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // Clic en el telón (fuera del panel) cierra.
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="track-project-drawer"
    >
      <div className="ui-drawer-head">
        <div className="track-drawer-heading">
          <h2 className="ui-drawer-title" id={`${id}-title`}>
            {t('projectSettings.title')}
          </h2>
          <p className="track-drawer-sub">{projectName}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onClose}
          aria-label={t('projectSettings.close')}
          data-testid="track-project-drawer-close"
        >
          <TrackIcon name="close" size={16} />
        </button>
      </div>
      <div className="track-team-settings-body">
        <div className="track-team-settings-nav" role="tablist" aria-orientation="vertical" aria-label={t('projectSettings.title')}>
          {TABS.map((key, i) => (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`${id}-panel`}
              tabIndex={tab === key ? 0 : -1}
              className="track-team-settings-tab"
              onClick={() => setTab(key)}
              onKeyDown={(e) => onTabKey(e, i)}
              data-testid={`track-settings-tab-${key}`}
            >
              {t(`projectSettings.tabs.${key}`)}
            </button>
          ))}
        </div>
        <div className="ui-drawer-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
          {body}
        </div>
      </div>
    </dialog>
  );
}
