'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { TrackProjectRow } from '@/lib/schema/types';
import { normalizeTeamKey } from '@/lib/track-team-key';
import { teamPath } from '@/lib/track-routes';
import TrackIcon from './TrackIcon';
import WorkspaceInviteForm from './WorkspaceInviteForm';
import { LabelsSettings } from './TrackSettingsClient';
import { TeamAutomation } from './planning/AutomationSettings';
import { ESTIMATE_SCALES, estimateOptions, isEstimateScale, type EstimateScale } from '@/lib/track-estimates';
import { TEAM_AREAS, adminOnlyCapabilities, type TeamCapabilities, type TeamPermissions } from '@/lib/track-team-areas';
import { GithubExtras, TeamSlackChannels } from './TrackIntegrationsSettings';

/** Pestañas que arma la página del team (ProjectPageClient). */
export type ProjectSettingsTab = 'cycles' | 'statuses' | 'milestones' | 'templates' | 'recurring' | 'triage';
/** Todas, como los ajustes de un team en Linear: las propias del drawer van primero. */
type DrawerTab = 'general' | 'members' | 'labels' | 'estimates' | ProjectSettingsTab | 'integrations';

const TABS: DrawerTab[] = ['general', 'members', 'labels', 'estimates', 'statuses', 'triage', 'cycles', 'templates', 'recurring', 'milestones', 'integrations'];

interface ProjectSettingsDrawerProps {
  projectName: string;
  /** Si no llega, se toma del team de la página (data-track-project-id). */
  projectId?: string;
  /** Dueño del team o admin del workspace: lo que es solo de dueños (lib/track-team-roles). */
  isAdmin?: boolean;
  /** Admin del workspace: invitar gente y el acceso de todo el workspace. */
  workspaceAdmin?: boolean;
  /** Qué áreas del team puede tocar quien mira; sin esto, todas menos lo de dueños. */
  teamCan?: TeamCapabilities;
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
function GeneralPanel({ projectId, isAdmin, canEdit }: { projectId: string; isAdmin: boolean; canEdit: boolean }) {
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
      setError(code === 'slug_taken' ? t('errors.slug_taken') : r.status === 403 ? t('teamRoles.ownersOnly') : t('errors.generic'));
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
          disabled={!canEdit}
          data-testid="track-team-name-edit"
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
          disabled={!canEdit}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (project.icon ?? '')) void save({ icon: v });
          }}
        />
        <p className="ui-help">{t('projects.form.iconHelp')}</p>
      </div>
      {!canEdit ? (
        <p className="ui-help" data-testid="track-team-general-locked">
          {t('teamRoles.ownersOnly')}
        </p>
      ) : null}
    </div>
  );
}

type TeamAccessView = {
  personal: boolean;
  me: string;
  visibility: 'workspace' | 'private';
  permissions: TeamPermissions;
  can: TeamCapabilities;
  members: Array<{ id: string; name: string | null; email: string; teamRole: 'owner' | 'member'; workspaceAdmin: boolean; guest: boolean }>;
  candidates: Array<{ id: string; name: string | null; email: string }>;
};

/**
 * Members: quién ve y trabaja en el team, con su rol (dueño o miembro, como
 * en Linear). Los dueños dan o sacan el rol, deciden si el team es privado y
 * qué áreas de los ajustes maneja cualquier miembro (lib/track-team-roles).
 */
function MembersPanel({ projectId, workspaceAdmin }: { projectId: string; workspaceAdmin: boolean }) {
  const t = useTranslations('track');
  const router = useRouter();
  const [view, setView] = useState<TeamAccessView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [addId, setAddId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    void send<TeamAccessView>(`/api/track/projects/${projectId}/access`).then((r) => {
      if (r.ok) setView(r.data);
      else setLoadFailed(true);
    });
  }, [projectId]);
  useEffect(() => load(), [load]);

  const act = async (body: Record<string, unknown>) => {
    setError(null);
    setNotice(null);
    const r = await send<TeamAccessView & { left?: boolean; error?: string }>(`/api/track/projects/${projectId}/access`, 'POST', body);
    if (!r.ok) {
      setError(r.status === 403 ? t('teamRoles.ownersOnly') : r.data.error === 'guest_cannot_be_owner' ? t('teamRoles.guestCannotOwn') : t('access.error'));
      load();
      return;
    }
    if (r.data.left) {
      // Se fue de un team privado: ya no lo ve.
      router.push('/app/track');
      return;
    }
    setView(r.data);
    setNotice(t('teamSettings.saved'));
    // Los permisos cambian lo que se puede tocar en las otras pestañas.
    router.refresh();
  };

  if (loadFailed) {
    return (
      <p className="ui-error" role="alert">
        {t('errors.generic')}
      </p>
    );
  }
  if (!view) return <p className="ui-help">{t('common.loading')}</p>;
  const { can, members, candidates } = view;
  const isPrivate = view.visibility === 'private';
  const selected = candidates.some((c) => c.id === addId) ? addId : (candidates[0]?.id ?? '');
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (selected) void act({ action: 'addMember', userId: selected });
  };

  return (
    <div className="track-team-roles" data-testid="track-team-members">
      {error ? (
        <p className="ui-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="ui-help" role="status">
          {notice}
        </p>
      ) : null}
      <p className="ui-help">
        {t('teamSettings.membersHelp', { count: members.length })} {t('teamRoles.help')}
      </p>
      <ul className="track-team-members" role="list">
        {members.map((m) => {
          const label = m.name || m.email;
          return (
            <li key={m.id} className="track-team-member" data-testid="track-team-member" data-user-id={m.id} data-team-role={m.teamRole}>
              <span className="track-avatar">{label[0]?.toUpperCase()}</span>
              <span className="track-team-member-who">
                <span className="track-team-member-name">{label}</span>
                {m.name && <span className="track-team-member-email">{m.email}</span>}
              </span>
              <span className="track-team-member-role">
                {can.owner && !m.guest && !view.personal ? (
                  <select
                    className="select track-team-role-select"
                    aria-label={t('teamRoles.roleOf', { name: label })}
                    value={m.teamRole}
                    onChange={(e) => void act({ action: 'setRole', userId: m.id, role: e.target.value })}
                    data-testid="track-team-role-select"
                  >
                    <option value="owner">{t('teamRoles.owner')}</option>
                    <option value="member">{t('teamRoles.member')}</option>
                  </select>
                ) : (
                  <span className="track-team-member-role-text" data-testid="track-team-role">
                    {m.guest ? t('teamRoles.guest') : m.teamRole === 'owner' ? t('teamRoles.owner') : m.workspaceAdmin ? t('teamRoles.admin') : t('teamRoles.member')}
                  </span>
                )}
                {isPrivate && (m.id === view.me || can.owner) && !view.personal ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void act({ action: 'removeMember', userId: m.id })}
                    aria-label={m.id === view.me ? t('teamRoles.leave') : t('teamRoles.removeFrom', { name: label })}
                    data-testid="track-team-member-remove"
                  >
                    {m.id === view.me ? t('teamRoles.leave') : t('teamRoles.remove')}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {!isPrivate ? <p className="ui-help">{t('access.everyoneIn')}</p> : null}
      {candidates.length > 0 ? (
        <form className="track-int-row" onSubmit={(e) => void add(e)} data-testid="track-team-add">
          <select className="select" aria-label={t('access.addMember')} value={selected} onChange={(e) => setAddId(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.email}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-sm">
            {t('access.addMember')}
          </button>
        </form>
      ) : null}
      {!view.personal ? (
        <fieldset className="track-x-fieldset track-team-perms" data-testid="track-team-permissions">
          <legend className="tp-card-title">{t('teamRoles.permissionsTitle')}</legend>
          <label className="ui-check">
            <input
              type="checkbox"
              role="switch"
              checked={isPrivate}
              disabled={!can.owner}
              onChange={(e) => void act({ action: 'visibility', visibility: e.target.checked ? 'private' : 'workspace' })}
              data-testid="track-team-private"
            />
            <span>{t('teamRoles.private')}</span>
          </label>
          {TEAM_AREAS.map((area) => (
            <div className="ui-field track-team-perm" key={area}>
              <label className="label" htmlFor={`tp-perm-${area}-${projectId}`}>
                {t(`teamRoles.areas.${area}`)}
              </label>
              <select
                id={`tp-perm-${area}-${projectId}`}
                className="select"
                value={view.permissions[area]}
                disabled={!can.owner}
                onChange={(e) => void act({ action: 'permissions', permissions: { [area]: e.target.value } })}
                data-testid={`track-team-perm-${area}`}
              >
                <option value="members">{t('teamRoles.anyMember')}</option>
                <option value="owners">{t('teamRoles.ownersOnlyOption')}</option>
              </select>
            </div>
          ))}
          {!can.owner ? <p className="ui-help">{t('teamRoles.ownersOnly')}</p> : null}
        </fieldset>
      ) : null}
      {workspaceAdmin ? (
        <div className="track-team-invite">
          <h4 className="ui-label">{t('access.inviteTitle')}</h4>
          <WorkspaceInviteForm onInvited={load} />
        </div>
      ) : null}
      {workspaceAdmin ? (
        <Link href="/app/track/settings?tab=access" className="btn btn-sm">
          {t('teamSettings.manageAccess')}
        </Link>
      ) : null}
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
      setError(r.status === 403 ? t('teamRoles.ownersOnly') : t('errors.generic'));
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
      setError(r.status === 403 ? t('teamRoles.ownersOnly') : t('errors.generic'));
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

function IntegrationsPanel({ projectId, isAdmin }: { projectId: string | null; isAdmin: boolean }) {
  const t = useTranslations('track');
  return (
    <div className="track-team-integrations">
      {/* Las reglas de GitHub y los avisos de Slack de este team: los cambian sus dueños. */}
      {projectId ? <GithubExtras isAdmin={isAdmin} projectId={projectId} /> : null}
      {projectId ? <TeamSlackChannels projectId={projectId} canEdit={isAdmin} /> : null}
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
export default function ProjectSettingsDrawer({
  projectName,
  projectId: idProp,
  isAdmin = true,
  workspaceAdmin = isAdmin,
  teamCan,
  initialTab = 'general',
  onClose,
  panels,
}: ProjectSettingsDrawerProps) {
  const can: TeamCapabilities = teamCan ?? adminOnlyCapabilities(isAdmin);
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
        return <GeneralPanel projectId={projectId!} isAdmin={can.owner} canEdit={can.settings} />;
      case 'members':
        return <MembersPanel projectId={projectId!} workspaceAdmin={workspaceAdmin} />;
      case 'labels':
        return <LabelsSettings isAdmin={workspaceAdmin} teamOwner={can.labels} canCreate={can.labels} projectId={projectId!} />;
      case 'estimates':
        return projectId ? <EstimatesPanel projectId={projectId} isAdmin={can.owner} /> : null;
      case 'integrations':
        return <IntegrationsPanel projectId={projectId} isAdmin={can.owner} />;
      case 'statuses':
        return (
          <>
            {panels.statuses}
            {projectId && (
              <>
                <SubIssueAutomation projectId={projectId} isAdmin={can.owner} />
                <h3 className="tp-card-title">{t('teamSettings.housekeeping')}</h3>
                <TeamAutomation projectId={projectId} isAdmin={can.owner} />
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
