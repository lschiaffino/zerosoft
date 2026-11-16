'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { ClientDto, ProjectDto } from '@/lib/time/core';
import { api, minutesToHoursInput, parseMoney, TimeDialog, useErrorText } from './ui';

const NEW_CLIENT = '__new__';

/** Crear o editar un proyecto: nombre, código, cliente (o uno nuevo), facturable, tarifa y presupuesto. */
export default function ProjectForm({
  open,
  project,
  clients,
  currency,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: ProjectDto | null;
  clients: ClientDto[];
  currency: string;
  onClose: () => void;
  onSaved: (project: ProjectDto, newClient: ClientDto | null) => void;
}) {
  const t = useTranslations('time');
  const errorText = useErrorText();
  const [name, setName] = useState(project?.name ?? '');
  const [code, setCode] = useState(project?.code ?? '');
  const [clientId, setClientId] = useState(project?.clientId ?? '');
  const [clientName, setClientName] = useState('');
  const [billable, setBillable] = useState(project?.billable ?? true);
  const [rate, setRate] = useState(project?.rateCents != null ? (project.rateCents / 100).toFixed(2) : '');
  const [budget, setBudget] = useState(minutesToHoursInput(project?.budgetMinutes ?? null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const rateCents = parseMoney(rate);
    const budgetHours = budget.trim() ? Number(budget.trim().replace(',', '.')) : null;
    if (Number.isNaN(rateCents) || (budgetHours !== null && (!Number.isFinite(budgetHours) || budgetHours <= 0))) {
      setError(errorText('invalid_input'));
      return;
    }
    setBusy(true);
    setError('');
    let newClient: ClientDto | null = null;
    let cid: string | null = clientId || null;
    if (clientId === NEW_CLIENT) {
      const c = await api<{ item: ClientDto }>('/api/time/clients', {
        method: 'POST',
        json: { name: clientName },
      });
      if (!c.ok) {
        setBusy(false);
        setError(errorText(c.data.error));
        return;
      }
      newClient = c.data.item;
      cid = newClient.id;
      setClientId(cid);
      setClientName('');
    }
    const body = {
      name,
      code,
      clientId: cid,
      billable,
      rateCents,
      budgetMinutes: budgetHours === null ? null : Math.round(budgetHours * 60),
    };
    const r = project
      ? await api<{ project: ProjectDto }>(`/api/time/projects/${project.id}`, {
          method: 'PATCH',
          json: body,
        })
      : await api<{ project: ProjectDto }>('/api/time/projects', {
          method: 'POST',
          json: body,
        });
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.data.error));
      return;
    }
    onSaved(r.data.project, newClient);
  };

  const activeClients = clients.filter((c) => !c.archived || c.id === project?.clientId);

  return (
    <TimeDialog open={open} title={project ? t('projects.editTitle') : t('projects.new')} onClose={onClose} testId="time-project-dialog">
      <form onSubmit={submit}>
        <div className="ui-modal-body ui-fields">
          <label className="ui-field">
            <span className="label">{t('projects.name')}</span>
            <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus name="name" />
          </label>
          <div className="tm-field-row">
            <label className="ui-field">
              <span className="label">{t('projects.client')}</span>
              <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} name="client">
                <option value="">{t('common.none')}</option>
                {activeClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW_CLIENT}>{t('projects.newClient')}</option>
              </select>
            </label>
            <label className="ui-field tm-field-code">
              <span className="label">{t('projects.code')}</span>
              <input className="input" maxLength={24} value={code} onChange={(e) => setCode(e.target.value)} name="code" />
            </label>
          </div>
          {clientId === NEW_CLIENT && (
            <label className="ui-field">
              <span className="label">{t('projects.newClientName')}</span>
              <input className="input" required maxLength={120} value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus name="clientName" />
            </label>
          )}
          <label className="ui-check">
            <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} name="billable" />
            <span>
              {t('projects.billable')}
              <span className="ui-help tm-block">{t('projects.billableHint')}</span>
            </span>
          </label>
          <div className="tm-field-row">
            <label className="ui-field">
              <span className="label">{t('projects.rate')}</span>
              <input className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!billable} name="rate" placeholder="0.00" />
              <span className="ui-help">{t('projects.rateHint', { currency })}</span>
            </label>
            <label className="ui-field">
              <span className="label">{t('projects.budget')}</span>
              <input className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} name="budget" />
              <span className="ui-help">{t('projects.budgetHint')}</span>
            </label>
          </div>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || (clientId === NEW_CLIENT && !clientName.trim())} data-testid="time-project-submit">
            {project ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>
    </TimeDialog>
  );
}
