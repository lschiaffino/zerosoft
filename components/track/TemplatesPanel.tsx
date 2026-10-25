'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import type { TrackIssueTemplateRow, TrackStatusRow } from '@/lib/db';
import type { ProjectMember } from '@/lib/track-data';
import IssuePresetFields, { presetLabels, savedLabelList, type IssuePreset } from './IssuePresetFields';

interface TemplatesPanelProps {
  projectId: string;
  templates: TrackIssueTemplateRow[];
  statuses: TrackStatusRow[];
  members: ProjectMember[];
  onChanged: () => void | Promise<void>;
}

/** Plantillas de issue del proyecto (drawer de ajustes): crear, editar y borrar. */
export default function TemplatesPanel({ projectId, templates, statuses, members, onChanged }: TemplatesPanelProps) {
  const t = useTranslations('track');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saved = async () => {
    setEditing(null);
    await onChanged();
  };

  async function remove(id: string) {
    const res = await fetch(`/api/track/templates/${id}`, { method: 'DELETE' }).catch(() => null);
    setDeleting(null);
    if (!res?.ok) {
      setError(t('templates.error'));
      return;
    }
    await onChanged();
  }

  const form = (template: TrackIssueTemplateRow | null) => (
    <TemplateForm
      projectId={projectId}
      template={template}
      statuses={statuses}
      members={members}
      onCancel={() => setEditing(null)}
      onSaved={saved}
    />
  );

  return (
    <div className="track-templates" data-testid="track-templates">
      <div className="track-pane-head">
        <p className="ui-help">{t('templates.help')}</p>
        {editing !== 'new' && templates.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => setEditing('new')} data-testid="track-new-template">
            {t('templates.new')}
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {editing === 'new' && form(null)}
      {templates.length === 0 && editing !== 'new' ? (
        <EmptyState
          quiet
          title={t('templates.emptyTitle')}
          body={t('templates.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')} data-testid="track-new-template">
              {t('templates.new')}
            </button>
          }
        />
      ) : (
        <ul className="track-cycle-list">
          {templates.map((tpl) =>
            editing === tpl.id ? (
              <li key={tpl.id} className="track-cycle is-editing">
                {form(tpl)}
              </li>
            ) : (
              <li key={tpl.id} className="track-cycle" data-testid="track-template">
                <div className="track-cycle-head">
                  <span className="track-cycle-name">{tpl.name}</span>
                  {tpl.title && <span className="track-cycle-dates">{tpl.title}</span>}
                </div>
                {deleting === tpl.id ? (
                  <div className="track-cycle-confirm" role="group" aria-label={t('templates.delete')}>
                    <p>{t('templates.deleteConfirm')}</p>
                    <div className="track-inline-form-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>
                        {t('common.cancel')}
                      </button>
                      <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={() => void remove(tpl.id)}>
                        {t('templates.delete')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="track-cycle-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(tpl.id)}>
                      {t('templates.edit')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(tpl.id)}>
                      {t('templates.delete')}
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function TemplateForm({
  projectId,
  template,
  statuses,
  members,
  onCancel,
  onSaved,
}: {
  projectId: string;
  template: TrackIssueTemplateRow | null;
  statuses: TrackStatusRow[];
  members: ProjectMember[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('track');
  const [name, setName] = useState(template?.name ?? '');
  const [title, setTitle] = useState(template?.title ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [estimate, setEstimate] = useState(template?.estimate != null ? String(template.estimate) : '');
  const [preset, setPreset] = useState<IssuePreset>({
    statusId: template?.status_id ?? '',
    priority: template?.priority ?? '',
    assigneeId: template?.assignee_id ?? '',
    labels: presetLabels(template?.labels),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const prefix = template ? `tpl-${template.id}` : 'tpl-new';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(template ? `/api/track/templates/${template.id}` : `/api/track/projects/${projectId}/templates`, {
      method: template ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        title,
        description,
        statusId: preset.statusId || null,
        priority: preset.priority || null,
        assigneeId: preset.assigneeId || null,
        estimate: estimate.trim() ? Number(estimate) : null,
        labels: preset.labels,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onSaved();
    else setError(true);
  }

  return (
    <form
      className="track-inline-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      data-testid="track-template-form"
    >
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-name`}>
            {t('templates.name')}
          </label>
          <input
            id={`${prefix}-name`}
            className="input"
            value={name}
            placeholder={t('templates.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            autoFocus
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${prefix}-title`}>
            {t('templates.title')} <span className="ui-optional">{t('common.optional')}</span>
          </label>
          <input
            id={`${prefix}-title`}
            className="input"
            value={title}
            placeholder={t('templates.titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
          />
        </div>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor={`${prefix}-desc`}>
          {t('templates.description')} <span className="ui-optional">{t('common.optional')}</span>
        </label>
        <textarea
          id={`${prefix}-desc`}
          className="textarea"
          rows={4}
          value={description}
          maxLength={200000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <IssuePresetFields
        idPrefix={prefix}
        value={preset}
        onChange={setPreset}
        statuses={statuses}
        members={members}
        savedLabels={savedLabelList(template?.labels)}
        allowUnsetPriority
      />
      <div className="ui-field track-template-estimate">
        <label className="label" htmlFor={`${prefix}-estimate`}>
          {t('templates.estimate')} <span className="ui-optional">{t('common.optional')}</span>
        </label>
        <input
          id={`${prefix}-estimate`}
          className="input"
          type="number"
          min={0}
          max={1000}
          inputMode="numeric"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('templates.error')}
        </p>
      )}
      <div className="track-inline-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()} aria-busy={busy || undefined}>
          {template ? t('templates.save') : t('templates.create')}
        </button>
      </div>
    </form>
  );
}
