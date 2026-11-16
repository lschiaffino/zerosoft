'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ClientDto, ProjectDto } from '@/lib/time/core';
import { formatMinutes, type ReportRow, type ReportTotals } from '@/lib/time/types';
import ProjectForm from './ProjectForm';
import { BudgetBar } from './BudgetBar';
import { api, useErrorText, useMoney, useToast } from './ui';

function Breakdown({ title, rows, testId }: { title: string; rows: ReportRow[]; testId: string }) {
  const t = useTranslations('time');
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  return (
    <section className="tm-card" aria-label={title} data-testid={testId}>
      <h2 className="tm-card-title">{title}</h2>
      <table className="table tm-table tm-table-compact">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label || t('reports.noClient')}</th>
              <td className="tm-num num">{formatMinutes(r.minutes)}</td>
              <td className="tm-num tm-muted num">{total ? `${Math.round((r.minutes / total) * 100)}%` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Un proyecto: totales, presupuesto, horas por tarea y por persona; editar, archivar y borrar. */
export default function ProjectDetail({
  project: initial,
  clients,
  admin,
  currency,
  totals,
  byTask,
  byPerson,
}: {
  project: ProjectDto;
  clients: ClientDto[];
  admin: boolean;
  currency: string;
  totals: ReportTotals;
  byTask: ReportRow[];
  byPerson: ReportRow[];
}) {
  const t = useTranslations('time');
  const router = useRouter();
  const money = useMoney(currency);
  const errorText = useErrorText();
  const [toast, push] = useToast();
  const [project, setProject] = useState(initial);
  const [clientList, setClientList] = useState(clients);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const setArchived = async (archived: boolean) => {
    setBusy(true);
    const r = await api<{ project: ProjectDto }>(`/api/time/projects/${project.id}`, { method: 'PATCH', json: { archived } });
    setBusy(false);
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    setProject(r.data.project);
    push(archived ? t('projects.archivedToast') : t('projects.restoredToast'));
    router.refresh();
  };

  const remove = async () => {
    setBusy(true);
    const r = await api(`/api/time/projects/${project.id}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!r.ok) {
      setConfirm(false);
      return push(errorText(r.data.error), 'bad');
    }
    router.push('/app/time/projects');
    router.refresh();
  };

  const meta = [project.clientName, project.code, project.billable ? (project.rateCents ? t('projects.rateValue', { rate: money(project.rateCents) }) : null) : t('projects.nonBillable')]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="app-page ui-page tm-page">
      <PageHeader
        back={{ href: '/app/time/projects', label: t('projects.back') }}
        title={
          <span className="tm-title" data-testid="time-project-title">
            {project.name}
            {project.archived && <span className="badge badge-outline">{t('projects.archivedBadge')}</span>}
          </span>
        }
        description={meta || undefined}
        actions={
          admin ? (
            <div className="tm-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)} data-testid="time-project-edit">
                {t('common.edit')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void setArchived(!project.archived)} disabled={busy} data-testid="time-project-archive">
                {project.archived ? t('common.restore') : t('common.archive')}
              </button>
              <button type="button" className="btn btn-ghost tm-danger" onClick={() => setConfirm(true)} disabled={busy} data-testid="time-project-delete">
                {t('common.delete')}
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="tm-stats">
        <div className="tm-stat">
          <span className="tm-stat-label">{t('projects.totalHours')}</span>
          <strong className="tm-stat-value num" data-testid="time-project-hours">
            {formatMinutes(totals.minutes)}
          </strong>
        </div>
        <div className="tm-stat">
          <span className="tm-stat-label">{t('projects.billableHours')}</span>
          <strong className="tm-stat-value num">{formatMinutes(totals.billableMinutes)}</strong>
        </div>
        <div className="tm-stat">
          <span className="tm-stat-label">{t('projects.amount')}</span>
          <strong className="tm-stat-value num">{money(totals.amountCents)}</strong>
        </div>
        {project.budgetMinutes ? (
          <div className="tm-stat">
            <span className="tm-stat-label">{t('projects.budgetLeft')}</span>
            <strong className="tm-stat-value num">{formatMinutes(Math.max(0, project.budgetMinutes - project.spentMinutes))}</strong>
            <BudgetBar used={project.spentMinutes} budget={project.budgetMinutes} />
          </div>
        ) : null}
      </div>

      {totals.minutes === 0 ? (
        <EmptyState compact body={t('projects.noTime')} />
      ) : (
        <div className="tm-grid">
          <Breakdown title={t('projects.byTask')} rows={byTask} testId="time-project-by-task" />
          {byPerson.length > 0 && <Breakdown title={t('projects.byPerson')} rows={byPerson} testId="time-project-by-person" />}
        </div>
      )}
      <p className="tm-footlink">
        <Link href={`/app/time/reports?projectId=${project.id}`}>{t('projects.openReport')}</Link>
      </p>

      {editing && (
        <ProjectForm
          open
          project={project}
          clients={clientList}
          currency={currency}
          onClose={() => setEditing(false)}
          onSaved={(p, c) => {
            setProject(p);
            if (c) setClientList((cur) => [...cur, c]);
            setEditing(false);
            push(t('projects.savedToast'));
            router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={confirm}
        title={t('projects.deleteTitle')}
        body={t('projects.deleteBody', {
          hours: formatMinutes(project.spentMinutes),
        })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
      {toast}
    </div>
  );
}
