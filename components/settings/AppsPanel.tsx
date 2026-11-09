'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import QuickModal from '@/components/app/QuickModal';
import ProductGlyph from '@/components/brand/ProductGlyph';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import { WORKSPACE_APP_MODES, type WorkspaceAppMode, type WorkspaceAppRule, type WorkspaceAppRules } from '@/lib/app-access';

interface Person {
  userId: string;
  name: string | null;
  email: string;
  role: string;
}

interface Team {
  id: string;
  name: string;
  memberIds: string[];
}

const ALL: WorkspaceAppRule = { mode: 'all', people: [], teams: [] };

/**
 * Ajustes › Apps del workspace: una fila por app de equipo con un select
 * (Todos, Solo algunos, Solo admins, Apagada). "Solo algunos" abre la elección
 * de personas y equipos. Cada cambio se guarda solo (PUT /api/teams/apps) y
 * vale para la app, sus APIs y el MCP. Las apps habilitadas de cada persona
 * (Miembros y permisos) siguen valiendo encima de esto.
 */
export default function AppsPanel({
  apps,
  personalApps,
  initial,
  people,
  teams,
  canEdit,
}: {
  apps: ProductKey[];
  personalApps: ProductKey[];
  initial: WorkspaceAppRules;
  people: Person[];
  teams: Team[];
  canEdit: boolean;
}) {
  const t = useTranslations('settings.appsPanel');
  const tp = useTranslations('common.products');
  const [rules, setRules] = useState<WorkspaceAppRules>(initial);
  const [saving, setSaving] = useState<ProductKey | null>(null);
  const [status, setStatus] = useState<{ app: ProductKey; kind: 'saved' | 'error' } | null>(null);
  const [picking, setPicking] = useState<{ app: ProductKey; people: string[]; teams: string[]; prev: WorkspaceAppRule } | null>(null);
  const members = useMemo(() => people.filter((p) => p.role === 'member'), [people]);

  async function save(app: ProductKey, rule: WorkspaceAppRule, prev: WorkspaceAppRule): Promise<boolean> {
    setSaving(app);
    setStatus(null);
    setRules((r) => ({ ...r, [app]: rule }));
    const res = await fetch('/api/teams/apps', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app, ...rule }),
    }).catch(() => null);
    setSaving(null);
    if (!res?.ok) {
      setRules((r) => ({ ...r, [app]: prev }));
      setStatus({ app, kind: 'error' });
      return false;
    }
    const data = (await res.json().catch(() => null)) as { rules?: WorkspaceAppRules } | null;
    if (data?.rules) setRules(data.rules);
    setStatus({ app, kind: 'saved' });
    return true;
  }

  function onMode(app: ProductKey, mode: WorkspaceAppMode) {
    const prev = rules[app] ?? ALL;
    if (mode === 'some') {
      setPicking({ app, people: prev.mode === 'some' ? prev.people : [], teams: prev.mode === 'some' ? prev.teams : [], prev });
      return;
    }
    void save(app, { mode, people: [], teams: [] }, prev);
  }

  function summary(rule: WorkspaceAppRule): string {
    if (rule.mode === 'off') return t('summary.off');
    if (rule.mode === 'admins') return t('summary.admins');
    if (rule.mode === 'some') return t('summary.some', { people: rule.people.length, teams: rule.teams.length });
    return t('summary.all');
  }

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

  return (
    <>
      <FormSection title={t('title')} description={t('desc')}>
        {!canEdit && <p className="ui-help">{t('readOnly')}</p>}
        <ul className="ws-apps" data-testid="workspace-apps">
          {apps.map((app) => {
            const rule = rules[app] ?? ALL;
            const name = PRODUCT_CONFIG[app].name;
            return (
              <li key={app} className={`ws-apps-row card-${app}${rule.mode === 'off' ? ' is-off' : ''}`} data-testid={`ws-app-${app}`}>
                <span className="ws-apps-glyph">
                  <ProductGlyph product={app} size={16} />
                </span>
                <span className="ws-apps-text">
                  <span className="ws-apps-name">{name}</span>
                  <span className="ws-apps-desc">{tp(`${app}.desc`)}</span>
                  <span className="ws-apps-sum" aria-live="polite">
                    {summary(rule)}
                    {rule.mode === 'some' && canEdit && (
                      <>
                        {' · '}
                        <button type="button" className="ws-apps-edit" onClick={() => onMode(app, 'some')}>
                          {t('edit')}
                        </button>
                      </>
                    )}
                    {status?.app === app && (
                      <span className={status.kind === 'error' ? 'ui-error ws-apps-status' : 'st-muted ws-apps-status'} role={status.kind === 'error' ? 'alert' : undefined}>
                        {status.kind === 'error' ? t('error') : t('saved')}
                      </span>
                    )}
                  </span>
                </span>
                <span className="ws-apps-control">
                  <label className="sr-only" htmlFor={`ws-app-mode-${app}`}>
                    {t('accessFor', { name })}
                  </label>
                  <select
                    id={`ws-app-mode-${app}`}
                    className="select"
                    value={rule.mode}
                    disabled={!canEdit || saving === app}
                    aria-busy={saving === app || undefined}
                    onChange={(e) => onMode(app, e.target.value as WorkspaceAppMode)}
                    data-testid={`ws-app-mode-${app}`}
                  >
                    {WORKSPACE_APP_MODES.map((m) => (
                      <option key={m} value={m}>
                        {t(`modes.${m}`)}
                      </option>
                    ))}
                  </select>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="ui-help ws-apps-foot">
          {t('personal', { apps: personalApps.map((a) => PRODUCT_CONFIG[a].name).join(', ') })} {t('compose')}
        </p>
      </FormSection>

      <QuickModal
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={picking ? t('pickTitle', { name: PRODUCT_CONFIG[picking.app].name }) : ''}
        onSubmit={() => {
          if (!picking) return;
          const p = picking;
          void save(p.app, { mode: 'some', people: p.people, teams: p.teams }, p.prev).then((ok) => ok && setPicking(null));
        }}
        submitLabel={t('pickSave')}
        cancelLabel={t('cancel')}
        busy={saving !== null}
        error={picking && status?.app === picking.app && status.kind === 'error' ? t('error') : null}
        width={520}
      >
        {picking && (
          <div className="ws-apps-pick" data-testid="ws-apps-pick">
            <p className="ui-help">{t('pickHelp')}</p>
            {teams.length > 0 && (
              <fieldset className="st-fieldset">
                <legend className="label">{t('teams')}</legend>
                {teams.map((g) => (
                  <label key={g.id} className="ui-check">
                    <input
                      type="checkbox"
                      checked={picking.teams.includes(g.id)}
                      onChange={(e) => setPicking({ ...picking, teams: toggle(picking.teams, g.id, e.target.checked) })}
                    />
                    <span>
                      {g.name} <span className="st-muted">{t('teamCount', { count: g.memberIds.length })}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <fieldset className="st-fieldset">
              <legend className="label">{t('people')}</legend>
              {members.length === 0 ? (
                <p className="ui-help">{t('noMembers')}</p>
              ) : (
                members.map((p) => (
                  <label key={p.userId} className="ui-check">
                    <input
                      type="checkbox"
                      checked={picking.people.includes(p.userId)}
                      onChange={(e) => setPicking({ ...picking, people: toggle(picking.people, p.userId, e.target.checked) })}
                    />
                    <span className="ws-apps-person">
                      {p.name || p.email} {p.name && <span className="st-muted">{p.email}</span>}
                    </span>
                  </label>
                ))
              )}
            </fieldset>
          </div>
        )}
      </QuickModal>
    </>
  );
}
