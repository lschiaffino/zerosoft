'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import type { PlanTemplateSummary } from '@/lib/track-plan-templates';
import { api, LoadingRows, Modal } from './shared';

/** Los templates del workspace (para el selector del project nuevo y Ajustes). */
export function usePlanTemplates(enabled = true) {
  const [rows, setRows] = useState<PlanTemplateSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const res = await api<{ rows: PlanTemplateSummary[] }>('/api/track/plan-templates');
    setFailed(!res.ok);
    setRows(res.ok ? res.data.rows : []);
  }, []);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  return { rows, failed, reload: load };
}

/** "Save as template" desde el menú de un project. */
export function SaveTemplateDialog({
  open,
  planId,
  planName,
  onClose,
  onSaved,
}: {
  open: boolean;
  planId: string;
  planName: string;
  onClose: () => void;
  onSaved: (t: PlanTemplateSummary) => void;
}) {
  const t = useTranslations('trackPlanning');
  const [name, setName] = useState(planName);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(planName);
      setDescription('');
      setError(null);
    }
  }, [open, planName]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const res = await api<PlanTemplateSummary>('/api/track/plan-templates', 'POST', { planId, name: name.trim(), description: description.trim() || undefined });
    setBusy(false);
    if (!res.ok) return setError(t('common.saveError'));
    onSaved(res.data);
  };

  return (
    <Modal
      open={open}
      title={t('templates.saveTitle')}
      onClose={onClose}
      testId="tp-save-template"
      footer={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="tp-save-template-form" className="btn btn-sm btn-primary" disabled={!name.trim() || busy} aria-busy={busy}>
            {t('templates.save')}
          </button>
        </>
      }
    >
      <form
        id="tp-save-template-form"
        className="ui-fields"
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <p className="ui-help">{t('templates.saveHelp')}</p>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-field">
          <label className="label" htmlFor="tp-template-name">
            {t('templates.name')}
          </label>
          <input id="tp-template-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="tp-template-description">
            {t('templates.description')}
          </label>
          <input
            id="tp-template-description"
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder={t('templates.descriptionPlaceholder')}
          />
        </div>
      </form>
    </Modal>
  );
}

/** Ajustes de Track › Project templates: lista, renombrar y borrar. */
export function PlanTemplatesSettings({ isAdmin, me }: { isAdmin: boolean; me: string }) {
  const t = useTranslations('trackPlanning');
  const { rows, failed, reload } = usePlanTemplates();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<PlanTemplateSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rename = async (id: string) => {
    const name = draft.trim();
    setEditing(null);
    if (!name) return;
    const res = await api(`/api/track/plan-templates/${id}`, 'PATCH', { name });
    if (!res.ok) setError(t('common.saveError'));
    await reload();
  };

  return (
    <div data-testid="tp-templates-settings">
    <FormSection title={t('templates.settingsTitle')} description={t('templates.settingsHelp')}>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {rows === null ? (
        <LoadingRows rows={3} />
      ) : failed ? (
        <EmptyState
          quiet
          title={t('common.loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void reload()}>
              {t('common.retry')}
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState quiet title={t('templates.emptyTitle')} body={t('templates.emptyBody')} action={{ label: t('templates.goToProjects'), href: '/app/track/projects' }} />
      ) : (
        <ul className="tp-template-list" role="list">
          {rows.map((r) => {
            const canEdit = isAdmin || r.created_by === me;
            return (
              <li key={r.id} className="tp-template-row" data-testid="tp-template-row">
                <div className="tp-template-main">
                  {editing === r.id ? (
                    <input
                      className="input"
                      value={draft}
                      aria-label={t('templates.name')}
                      maxLength={120}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => void rename(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void rename(r.id);
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="tp-template-name">{r.name}</span>
                  )}
                  <span className="ui-help">
                    {t('templates.contents', { milestones: r.milestones, issues: r.issues })}
                    {r.description ? ` · ${r.description}` : ''}
                  </span>
                </div>
                {canEdit && editing !== r.id && (
                  <span className="tp-template-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setDraft(r.name);
                        setEditing(r.id);
                      }}
                      aria-label={t('templates.renameLabel', { name: r.name })}
                    >
                      {t('templates.rename')}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDeleting(r)} aria-label={t('templates.deleteLabel', { name: r.name })}>
                      {t('common.delete')}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('templates.deleteTitle', { name: deleting?.name ?? '' })}
        body={t('templates.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={async () => {
          if (deleting) await api(`/api/track/plan-templates/${deleting.id}`, 'DELETE');
          setDeleting(null);
          await reload();
        }}
        onCancel={() => setDeleting(null)}
      />
    </FormSection>
    </div>
  );
}
