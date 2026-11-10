'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import QuickModal from '@/components/app/QuickModal';
import ProductGlyph from '@/components/brand/ProductGlyph';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import { EMPTY_RULE, type WorkspaceAppMode, type WorkspaceAppRule, type WorkspaceAppRules } from '@/lib/app-access';

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

const ON_MODES: readonly WorkspaceAppMode[] = ['all', 'some', 'admins'];
type PersonState = 'default' | 'allow' | 'deny';

/**
 * Ajustes › Workspace › Apps: una fila por app con un interruptor (prendida
 * para el workspace o apagada), el acceso (todos, equipos o personas, solo
 * admins) y las excepciones por persona (siempre puede, nunca puede). Cada
 * cambio se guarda solo (PUT /api/teams/apps) y vale para la app, sus páginas,
 * su API, el MCP y la app de escritorio. Las apps habilitadas de cada persona
 * (Miembros y permisos) siguen valiendo encima de esto.
 */
export default function AppsPanel({
  apps,
  initial,
  people,
  teams,
  canEdit,
}: {
  apps: ProductKey[];
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
  const [picking, setPicking] = useState<{ app: ProductKey; mode: WorkspaceAppMode; rule: WorkspaceAppRule; prev: WorkspaceAppRule } | null>(null);
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

  function open(app: ProductKey, mode: WorkspaceAppMode, prev: WorkspaceAppRule) {
    setPicking({
      app,
      mode,
      prev,
      rule: { mode, people: prev.mode === 'some' ? prev.people : [], teams: prev.mode === 'some' ? prev.teams : [], denied: prev.denied },
    });
  }

  function onMode(app: ProductKey, mode: WorkspaceAppMode) {
    const prev = rules[app] ?? EMPTY_RULE;
    if (mode === 'some') return open(app, mode, prev);
    void save(app, { mode, people: [], teams: [], denied: prev.denied }, prev);
  }

  function onSwitch(app: ProductKey, on: boolean) {
    const prev = rules[app] ?? EMPTY_RULE;
    void save(app, on ? { mode: 'all', people: [], teams: [], denied: prev.denied } : { mode: 'off', people: [], teams: [], denied: [] }, prev);
  }

  function summary(rule: WorkspaceAppRule): string {
    if (rule.mode === 'off') return t('summary.off');
    const base =
      rule.mode === 'admins'
        ? t('summary.admins')
        : rule.mode === 'some'
          ? t('summary.some', { people: rule.people.length, teams: rule.teams.length })
          : t('summary.all');
    return rule.denied.length ? `${base} ${t('summary.deniedCount', { count: rule.denied.length })}.` : base;
  }

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

  function personState(rule: WorkspaceAppRule, id: string): PersonState {
    return rule.denied.includes(id) ? 'deny' : rule.people.includes(id) ? 'allow' : 'default';
  }
  function setPerson(rule: WorkspaceAppRule, id: string, state: PersonState): WorkspaceAppRule {
    return { ...rule, people: toggle(rule.people, id, state === 'allow'), denied: toggle(rule.denied, id, state === 'deny') };
  }

  return (
    <>
      <FormSection title={t('title')} description={t('desc')}>
        {!canEdit && <p className="ui-help">{t('readOnly')}</p>}
        <ul className="ws-apps" data-testid="workspace-apps">
          {apps.map((app) => {
            const rule = rules[app] ?? EMPTY_RULE;
            const off = rule.mode === 'off';
            const name = PRODUCT_CONFIG[app].name;
            const busy = saving === app;
            return (
              <li key={app} className={`ws-apps-row card-${app}${off ? ' is-off' : ''}`} data-testid={`ws-app-${app}`} data-mode={rule.mode}>
                <span className="ws-apps-glyph">
                  <ProductGlyph product={app} size={16} />
                </span>
                <span className="ws-apps-text">
                  <span className="ws-apps-name">{name}</span>
                  <span className="ws-apps-desc">{tp(`${app}.desc`)}</span>
                  <span className="ws-apps-sum" aria-live="polite">
                    {summary(rule)}
                    {!off && canEdit && (
                      <>
                        {' · '}
                        <button type="button" className="ws-apps-edit" onClick={() => open(app, rule.mode, rule)} data-testid={`ws-app-edit-${app}`}>
                          {rule.mode === 'some' ? t('choose') : t('exceptions')}
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
                  <label className="ui-check ws-apps-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={!off}
                      disabled={!canEdit || busy}
                      aria-label={t('enabledFor', { name })}
                      onChange={(e) => onSwitch(app, e.target.checked)}
                      data-testid={`ws-app-switch-${app}`}
                    />
                    <span>{t('enabled')}</span>
                  </label>
                  <label className="sr-only" htmlFor={`ws-app-mode-${app}`}>
                    {t('accessFor', { name })}
                  </label>
                  <select
                    id={`ws-app-mode-${app}`}
                    className="select"
                    value={off ? 'all' : rule.mode}
                    disabled={!canEdit || busy || off}
                    aria-busy={busy || undefined}
                    onChange={(e) => onMode(app, e.target.value as WorkspaceAppMode)}
                    data-testid={`ws-app-mode-${app}`}
                  >
                    {ON_MODES.map((m) => (
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
          {t('offNote')} {t('compose')}
        </p>
      </FormSection>

      <QuickModal
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={picking ? t('pickTitle', { name: PRODUCT_CONFIG[picking.app].name }) : ''}
        onSubmit={() => {
          if (!picking) return;
          const p = picking;
          void save(p.app, { ...p.rule, mode: p.mode }, p.prev).then((ok) => ok && setPicking(null));
        }}
        submitLabel={t('pickSave')}
        cancelLabel={t('cancel')}
        busy={saving !== null}
        error={picking && status?.app === picking.app && status.kind === 'error' ? t('error') : null}
        width={520}
      >
        {picking && (
          <div className="ws-apps-pick" data-testid="ws-apps-pick">
            <p className="ui-help">{picking.mode === 'some' ? t('pickHelp') : picking.mode === 'admins' ? t('pickHelpAdmins') : t('pickHelpAll')}</p>
            {picking.mode === 'some' && teams.length > 0 && (
              <fieldset className="st-fieldset">
                <legend className="label">{t('teams')}</legend>
                {teams.map((g) => (
                  <label key={g.id} className="ui-check">
                    <input
                      type="checkbox"
                      checked={picking.rule.teams.includes(g.id)}
                      onChange={(e) => setPicking({ ...picking, rule: { ...picking.rule, teams: toggle(picking.rule.teams, g.id, e.target.checked) } })}
                    />
                    <span>
                      {g.name} <span className="st-muted">{t('teamCount', { count: g.memberIds.length })}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <fieldset className="st-fieldset">
              <legend className="label">{t('pickPeople')}</legend>
              {members.length === 0 ? (
                <p className="ui-help">{t('noMembers')}</p>
              ) : (
                members.map((p) => (
                  <div key={p.userId} className="ws-apps-personrow">
                    <span className="ws-apps-person">
                      {p.name || p.email} {p.name && <span className="st-muted">{p.email}</span>}
                    </span>
                    <select
                      className="select"
                      aria-label={p.name || p.email}
                      value={personState(picking.rule, p.userId)}
                      onChange={(e) => setPicking({ ...picking, rule: setPerson(picking.rule, p.userId, e.target.value as PersonState) })}
                      data-testid={`ws-person-${p.userId}`}
                    >
                      <option value="default">{t('person.default')}</option>
                      {picking.mode === 'some' && <option value="allow">{t('person.allow')}</option>}
                      <option value="deny">{t('person.deny')}</option>
                    </select>
                  </div>
                ))
              )}
            </fieldset>
          </div>
        )}
      </QuickModal>
    </>
  );
}
