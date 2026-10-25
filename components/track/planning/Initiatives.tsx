'use client';

import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { MarkdownView } from '@/components/track/MarkdownView';
import type { InitiativeSummary } from '@/lib/track-initiatives';
import type { PlanSummary } from '@/lib/track-plans';
import { INITIATIVE_STATUSES, type InitiativeStatus } from '@/lib/track-planning-schema';
import { api, fmtDay, HealthDot, LoadingRows, Modal, PlanStatusIcon, ProgressBar, personName, type Person } from './shared';
import { NewPlanModal, type PlansMeta } from './PlansList';
import { projectPath } from '@/lib/track-routes';

/** Initiatives: lista con salud, plans activos (color por salud), responsable, fecha y progreso. */
export function InitiativesList() {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [rows, setRows] = useState<InitiativeSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const wantsNew = sp.get('new') === '1';
  useEffect(() => {
    if (wantsNew) setCreating(true);
  }, [wantsNew]);
  const [members, setMembers] = useState<Person[]>([]);

  const load = useCallback(async () => {
    const [res, meta] = await Promise.all([
      api<{ rows: InitiativeSummary[] }>('/api/track/initiatives'),
      api<{ members: Person[] }>('/api/track/plans?meta=only'),
    ]);
    setFailed(!res.ok);
    setRows(res.ok ? res.data.rows : []);
    if (meta.ok) setMembers(meta.data.members);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="tp-toolbar">
        <button type="button" className="btn btn-sm btn-primary tp-toolbar-end" onClick={() => setCreating(true)} data-testid="tp-new-initiative">
          {t('initiatives.new')}
        </button>
      </div>
      {rows === null ? (
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
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('initiatives.emptyTitle')}
          body={t('initiatives.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              {t('initiatives.new')}
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table tp-table" data-testid="tp-initiatives">
            <caption className="sr-only">{t('initiatives.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('initiatives.columns.name')}</th>
                <th scope="col">{t('initiatives.columns.health')}</th>
                <th scope="col">{t('initiatives.columns.activePlans')}</th>
                <th scope="col">{t('initiatives.columns.owner')}</th>
                <th scope="col">{t('initiatives.columns.target')}</th>
                <th scope="col">{t('initiatives.columns.progress')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/app/track/initiatives/${r.id}`} className="cell-link">
                      {r.parent_id && <span className="tp-sub-mark">↳ </span>}
                      {r.icon && <span className="tp-row-icon">{r.icon}</span>}
                      {r.name}
                    </Link>
                  </td>
                  <td data-label={t('initiatives.columns.health')}>
                    <HealthDot health={r.health} label={t(`health.${r.health}`)} />
                  </td>
                  <td data-label={t('initiatives.columns.activePlans')}>
                    <span className="tp-dots">
                      {r.plans
                        .filter((p) => p.status === 'in_progress')
                        .map((p) => (
                          <span key={p.id} className={`tp-dot tp-health-${p.health}`} title={`${p.name} · ${t(`health.${p.health}`)}`} />
                        ))}
                      <span className="ui-help">{t('initiatives.planCount', { count: r.plans.length })}</span>
                    </span>
                  </td>
                  <td data-label={t('initiatives.columns.owner')}>{r.lead_name ?? t('common.noLead')}</td>
                  <td data-label={t('initiatives.columns.target')}>{fmtDay(r.target_date, locale)}</td>
                  <td data-label={t('initiatives.columns.progress')}>
                    <ProgressBar percent={r.percent} label={t('plan.progress')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewInitiativeModal
        open={creating}
        members={members}
        parents={rows ?? []}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          router.push(`/app/track/initiatives/${id}`);
        }}
      />
    </>
  );
}

function NewInitiativeModal({
  open,
  members,
  parents,
  onClose,
  onCreated,
}: {
  open: boolean;
  members: Person[];
  parents: InitiativeSummary[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('trackPlanning');
  const [name, setName] = useState('');
  const [lead, setLead] = useState('');
  const [target, setTarget] = useState('');
  const [parent, setParent] = useState('');
  const [status, setStatus] = useState<InitiativeStatus>('planned');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setLead('');
      setTarget('');
      setParent('');
      setStatus('planned');
      setError(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await api<{ id: string }>('/api/track/initiatives', 'POST', {
      name: name.trim(),
      leadId: lead || null,
      targetDate: target || null,
      parentId: parent || null,
      status,
    });
    if (!res.ok) return setError(t('common.saveError'));
    onCreated(res.data.id);
  };
  return (
    <Modal
      open={open}
      title={t('initiatives.new')}
      onClose={onClose}
      testId="tp-new-initiative-modal"
      footer={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="tp-new-initiative-form" className="btn btn-sm btn-primary" disabled={!name.trim()}>
            {t('initiatives.create')}
          </button>
        </>
      }
    >
      <form id="tp-new-initiative-form" className="ui-fields" onSubmit={submit}>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="tp-ini-name">
            {t('initiatives.nameLabel')}
          </label>
          <input id="tp-ini-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus required placeholder={t('initiatives.namePlaceholder')} />
        </div>
        <div className="tp-form-grid">
          <div className="ui-field">
            <label className="label" htmlFor="tp-ini-status">
              {t('plan.status')}
            </label>
            <select id="tp-ini-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as InitiativeStatus)}>
              {INITIATIVE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`initiativeStatus.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="tp-ini-lead">
              {t('initiatives.owner')}
            </label>
            <select id="tp-ini-lead" className="select" value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">{t('common.noLead')}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {personName(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="tp-ini-target">
              {t('plan.targetDate')}
            </label>
            <input id="tp-ini-target" type="date" className="input" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="tp-ini-parent">
              {t('initiatives.parent')}
            </label>
            <select id="tp-ini-parent" className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{t('initiatives.noParent')}</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Página de una initiative: propiedades, descripción, plans (sumar, sacar, crear) y sub-initiatives. */
export function InitiativePage({ initiativeId }: { initiativeId: string }) {
  const t = useTranslations('trackPlanning');
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<{ initiative: InitiativeSummary; children: InitiativeSummary[] } | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [all, setAll] = useState<InitiativeSummary[]>([]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [meta, setMeta] = useState<PlansMeta | null>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pick, setPick] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, list, pl] = await Promise.all([
      api<{ initiative: InitiativeSummary; children: InitiativeSummary[] }>(`/api/track/initiatives/${initiativeId}`),
      api<{ rows: InitiativeSummary[] }>('/api/track/initiatives'),
      api<{ rows: PlanSummary[] } & PlansMeta>('/api/track/plans?meta=1'),
    ]);
    if (res.status === 404) return setState('missing');
    if (!res.ok) return setState('error');
    setData(res.data);
    setName(res.data.initiative.name);
    if (list.ok) setAll(list.data.rows);
    if (pl.ok) {
      setPlans(pl.data.rows);
      setMeta({ members: pl.data.members, teams: pl.data.teams, initiatives: pl.data.initiatives, me: pl.data.me });
    }
    setState('ok');
  }, [initiativeId]);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    const res = await api(`/api/track/initiatives/${initiativeId}`, 'PATCH', body);
    if (!res.ok) {
      setError(t('common.saveError'));
      return false;
    }
    setError(null);
    await load();
    return true;
  };

  if (state === 'loading') return <LoadingRows rows={5} />;
  if (state === 'missing') return <EmptyState title={t('initiatives.notFound')} action={{ label: t('initiatives.back'), href: '/app/track/initiatives' }} />;
  if (state === 'error' || !data)
    return (
      <EmptyState
        title={t('common.loadError')}
        action={
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            {t('common.retry')}
          </button>
        }
      />
    );
  const ini = data.initiative;
  const own = plans.filter((p) => ini.plan_ids.includes(p.id));
  const fromChildren = ini.plans.filter((p) => !ini.plan_ids.includes(p.id));
  const candidates = plans.filter((p) => !ini.plan_ids.includes(p.id));
  const enter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      setName(ini.name);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="tp-plan" data-testid="tp-initiative-page">
      <div className="tp-plan-main">
        <nav className="tp-crumbs" aria-label={t('initiatives.title')}>
          <Link href="/app/track/initiatives">{t('initiatives.title')}</Link>
          {ini.parent_id && (
            <>
              <span aria-hidden="true">›</span>
              <Link href={`/app/track/initiatives/${ini.parent_id}`}>{ini.parent_name}</Link>
            </>
          )}
          <span aria-hidden="true">›</span>
          <span>{ini.name}</span>
        </nav>
        <input
          className="tp-title-input"
          aria-label={t('initiatives.nameLabel')}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() && name.trim() !== ini.name ? void patch({ name: name.trim() }) : setName(ini.name))}
          onKeyDown={enter}
          data-testid="tp-initiative-name"
        />
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <section className="tp-card">
          <div className="tp-card-head">
            <h3 className="tp-card-title">{t('plan.progress')}</h3>
            <HealthDot health={ini.health} label={t(`health.${ini.health}`)} />
          </div>
          <ProgressBar percent={ini.percent} label={t('plan.progress')} />
        </section>
        <section className="tp-card">
          <div className="tp-card-head">
            <h3 className="tp-card-title">{t('plan.description')}</h3>
            {!editing && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setDraft(ini.description);
                  setEditing(true);
                }}
              >
                {t('common.edit')}
              </button>
            )}
          </div>
          {editing ? (
            <form
              className="tp-desc-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await patch({ description: draft })) setEditing(false);
              }}
            >
              <textarea
                className="textarea"
                aria-label={t('plan.description')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                autoFocus
                onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
              />
              <div className="tp-form-actions">
                <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-sm btn-primary">
                  {t('common.save')}
                </button>
              </div>
            </form>
          ) : ini.description ? (
            <MarkdownView source={ini.description} />
          ) : (
            <p className="ui-help">{t('initiatives.descriptionEmpty')}</p>
          )}
        </section>

        <section className="tp-card" aria-labelledby="tp-ini-plans">
          <div className="tp-card-head">
            <h3 id="tp-ini-plans" className="tp-card-title">
              {t('initiatives.plans')}
            </h3>
            <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
              {t('plans.new')}
            </button>
          </div>
          {own.length === 0 && fromChildren.length === 0 ? (
            <p className="ui-help">{t('initiatives.noPlans')}</p>
          ) : (
            <ul className="tp-rows" role="list" data-testid="tp-initiative-plans">
              {[...own, ...fromChildren].map((p) => (
                <li key={p.id} className="tp-row">
                  <Link href={projectPath(p.id)} className="tp-row-link">
                    <span className="tp-row-icon" aria-hidden="true">
                      {p.icon || <PlanStatusIcon status={p.status} />}
                    </span>
                    <span className="tp-row-name">{p.name}</span>
                    {!ini.plan_ids.includes(p.id) && <span className="tp-row-summary">{t('initiatives.viaChild')}</span>}
                  </Link>
                  <span className="tp-row-cell tp-row-health">
                    <HealthDot health={p.health} label={t(`health.${p.health}`)} />
                  </span>
                  <span className="tp-row-cell tp-row-date">{fmtDay(p.target_date, locale)}</span>
                  <span className="tp-row-cell tp-row-progress">
                    <ProgressBar percent={p.progress.percent} />
                  </span>
                  {ini.plan_ids.includes(p.id) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost btn-icon"
                      aria-label={t('initiatives.removePlan', { name: p.name })}
                      onClick={() => void patch({ planIds: ini.plan_ids.filter((x) => x !== p.id) })}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 0 && (
            <form
              className="tp-inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!pick) return;
                if (await patch({ planIds: [...ini.plan_ids, pick] })) setPick('');
              }}
            >
              <select className="select" aria-label={t('initiatives.addPlan')} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="tp-ini-add-plan">
                <option value="">{t('initiatives.addPlan')}</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-sm" disabled={!pick}>
                {t('common.add')}
              </button>
            </form>
          )}
        </section>

        {data.children.length > 0 && (
          <section className="tp-card">
            <h3 className="tp-card-title">{t('initiatives.subInitiatives')}</h3>
            <ul className="tp-rows" role="list">
              {data.children.map((c) => (
                <li key={c.id} className="tp-row">
                  <Link href={`/app/track/initiatives/${c.id}`} className="tp-row-link">
                    <span className="tp-row-name">{c.name}</span>
                  </Link>
                  <span className="tp-row-cell tp-row-health">
                    <HealthDot health={c.health} label={t(`health.${c.health}`)} />
                  </span>
                  <span className="tp-row-cell tp-row-progress">
                    <ProgressBar percent={c.percent} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="tp-plan-side" aria-label={t('plan.properties')}>
        <dl className="tp-props">
          <dt>
            <label htmlFor="tp-ini-p-status">{t('plan.status')}</label>
          </dt>
          <dd>
            <select id="tp-ini-p-status" className="select" value={ini.status} onChange={(e) => void patch({ status: e.target.value })}>
              {INITIATIVE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`initiativeStatus.${s}`)}
                </option>
              ))}
            </select>
          </dd>
          <dt>
            <label htmlFor="tp-ini-p-lead">{t('initiatives.owner')}</label>
          </dt>
          <dd>
            <select id="tp-ini-p-lead" className="select" value={ini.lead_id ?? ''} onChange={(e) => void patch({ leadId: e.target.value || null })}>
              <option value="">{t('common.noLead')}</option>
              {meta?.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {personName(m)}
                </option>
              ))}
            </select>
          </dd>
          <dt>
            <label htmlFor="tp-ini-p-target">{t('plan.targetDate')}</label>
          </dt>
          <dd>
            <input id="tp-ini-p-target" type="date" className="input" value={ini.target_date ?? ''} onChange={(e) => void patch({ targetDate: e.target.value || null })} />
          </dd>
          <dt>
            <label htmlFor="tp-ini-p-parent">{t('initiatives.parent')}</label>
          </dt>
          <dd>
            <select id="tp-ini-p-parent" className="select" value={ini.parent_id ?? ''} onChange={(e) => void patch({ parentId: e.target.value || null })}>
              <option value="">{t('initiatives.noParent')}</option>
              {all
                .filter((x) => x.id !== ini.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </dd>
        </dl>
        <button type="button" className="btn btn-sm btn-ghost tp-danger-link" onClick={() => setConfirm(true)} data-testid="tp-initiative-delete">
          {t('initiatives.delete')}
        </button>
      </aside>

      <NewPlanModal
        open={creating}
        meta={meta}
        initiativeId={ini.id}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          await load();
        }}
      />
      <ConfirmDialog
        open={confirm}
        title={t('initiatives.deleteTitle', { name: ini.name })}
        body={t('initiatives.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={async () => {
          await api(`/api/track/initiatives/${ini.id}`, 'DELETE');
          setConfirm(false);
          router.push('/app/track/initiatives');
        }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
