'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { ClientDto, ProjectDto } from '@/lib/time/core';
import { formatMinutes } from '@/lib/time/types';
import ProjectForm from './ProjectForm';
import { BudgetBar } from './BudgetBar';

/** Proyectos del workspace: activos o archivados, búsqueda, crear (quien administra). */
export default function ProjectsList({ projects, clients, admin, currency, openNew }: { projects: ProjectDto[]; clients: ClientDto[]; admin: boolean; currency: string; openNew: boolean }) {
  const t = useTranslations('time');
  const router = useRouter();
  const [items, setItems] = useState(projects);
  const [clientList, setClientList] = useState(clients);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => setItems(projects), [projects]);
  useEffect(() => {
    if (openNew && admin) setOpen(true);
  }, [openNew, admin]);

  const counts = {
    active: items.filter((p) => !p.archived).length,
    archived: items.filter((p) => p.archived).length,
  };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => (view === 'archived') === p.archived && (!q || `${p.name} ${p.code} ${p.clientName ?? ''}`.toLowerCase().includes(q)));
  }, [items, view, query]);

  const newButton = admin ? (
    <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="time-project-new">
      {t('projects.new')}
    </button>
  ) : null;

  return (
    <div className="app-page ui-page tm-page">
      <PageHeader title={t('nav.projects')} description={t('projects.desc')} actions={newButton} />
      {items.length === 0 ? (
        <EmptyState
          product="time"
          title={t('projects.emptyTitle')}
          body={admin ? t('projects.emptyBody') : t('projects.emptyMember')}
          action={
            admin ? (
              <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
                {t('projects.new')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="tm-toolbar">
            <div className="ui-tabs tm-tabs" role="tablist" aria-label={t('nav.projects')}>
              {(['active', 'archived'] as const).map((v) => (
                <button key={v} type="button" role="tab" className="ui-tab" aria-selected={view === v} onClick={() => setView(v)} data-testid={`time-projects-${v}`}>
                  {t(`projects.${v}`)}
                  <span className="tm-count num">{counts[v]}</span>
                </button>
              ))}
            </div>
            <div role="search" className="tm-search">
              <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('projects.search')} aria-label={t('projects.search')} />
            </div>
          </div>
          {shown.length === 0 ? (
            <EmptyState compact body={query ? t('projects.noMatch') : view === 'archived' ? t('projects.noArchived') : t('projects.noMatch')} />
          ) : (
            <div className="table-wrap">
              <table className="table tm-table" data-testid="time-projects-table">
                <thead>
                  <tr>
                    <th scope="col">{t('projects.colName')}</th>
                    <th scope="col" className="tm-hide-sm">
                      {t('projects.colClient')}
                    </th>
                    <th scope="col" className="tm-num">
                      {t('projects.colHours')}
                    </th>
                    <th scope="col" className="tm-hide-sm">
                      {t('projects.colBudget')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} data-testid="time-project-row">
                      <th scope="row">
                        <Link href={`/app/time/projects/${p.id}`} className="tm-rowlink">
                          <span className="tm-rowtitle">
                            {p.code ? <span className="tm-code">{p.code}</span> : null}
                            {p.name}
                          </span>
                          <span className="tm-rowmeta tm-show-sm">{p.clientName ?? t('sheet.noClient')}</span>
                          {!p.billable && <span className="tm-rowmeta">{t('projects.nonBillable')}</span>}
                        </Link>
                      </th>
                      <td className="tm-hide-sm">{p.clientName ?? <span className="tm-muted">{t('sheet.noClient')}</span>}</td>
                      <td className="tm-num num">{formatMinutes(p.spentMinutes)}</td>
                      <td className="tm-hide-sm">{p.budgetMinutes ? <BudgetBar used={p.spentMinutes} budget={p.budgetMinutes} /> : <span className="tm-muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {open && (
        <ProjectForm
          open
          project={null}
          clients={clientList}
          currency={currency}
          onClose={() => setOpen(false)}
          onSaved={(p, c) => {
            setItems((cur) => [...cur, p]);
            if (c) setClientList((cur) => [...cur, c]);
            setOpen(false);
            router.push(`/app/time/projects/${p.id}`);
          }}
        />
      )}
    </div>
  );
}
