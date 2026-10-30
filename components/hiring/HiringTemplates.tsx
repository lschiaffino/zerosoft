'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { TemplateDto } from '@/lib/hiring/comms';
import { HrDialog, api, useErrorText, useToast } from './ui';
import { VARIABLES } from './variables';

const KINDS = ['ack', 'rejection', 'interview', 'offer', 'offer_letter', 'custom'] as const;
type Draft = { id?: string; kind: (typeof KINDS)[number]; name: string; subject: string; body: string };

/** Plantillas de email y de carta de oferta (las de puestos se guardan desde el editor del puesto). */
export default function HiringTemplates({ initial }: { initial: TemplateDto[] }) {
  const t = useTranslations('hiring');
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    const res = draft.id
      ? await api<{ template: TemplateDto }>(`/api/hiring/templates/${draft.id}`, { method: 'PATCH', json: { name: draft.name, subject: draft.subject, body: draft.body } })
      : await api<{ template: TemplateDto }>('/api/hiring/templates', { method: 'POST', json: draft });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    const tpl = res.data.template;
    setItems((xs) => (draft.id ? xs.map((x) => (x.id === tpl.id ? tpl : x)) : [...xs, tpl]));
    setDraft(null);
    push(t('common.saved'));
  };

  const remove = async (id: string) => {
    const res = await api(`/api/hiring/templates/${id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setItems((xs) => xs.filter((x) => x.id !== id));
  };

  return (
    <div className="app-page ui-page hr-page">
      <PageHeader
        title={t('nav.templates')}
        description={t('templates.desc')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setDraft({ kind: 'rejection', name: '', subject: '', body: '' })}>
            {t('templates.new')}
          </button>
        }
      />
      {items.length === 0 ? (
        <EmptyState product="hiring" title={t('templates.emptyTitle')} body={t('templates.emptyBody')} action={<button type="button" className="btn btn-primary" onClick={() => setDraft({ kind: 'rejection', name: '', subject: '', body: '' })}>{t('templates.new')}</button>} />
      ) : (
        <div className="table-wrap">
          <table className="table hr-table">
            <thead>
              <tr>
                <th scope="col">{t('templates.name')}</th>
                <th scope="col">{t('templates.kind')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id}>
                  <th scope="row">
                    <button type="button" className="hr-linkbtn" onClick={() => setDraft({ id: x.id, kind: x.kind as Draft['kind'], name: x.name, subject: x.subject, body: x.body })}>
                      {x.name}
                    </button>
                  </th>
                  <td>{t(`templates.kinds.${x.kind}`)}</td>
                  <td className="num">
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={t('templates.deleteName', { name: x.name })} onClick={() => void remove(x.id)}>
                      {t('common.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ui-help hr-ai-note">{t('templates.defaultsNote')}</p>
      <HrDialog open={draft !== null} title={draft?.id ? t('templates.edit') : t('templates.new')} onClose={() => setDraft(null)} wide>
        {draft && (
          <form onSubmit={save}>
            <div className="ui-modal-body ui-fields">
              <div className="ui-fields-2">
                <label className="ui-field">
                  <span className="label">{t('templates.name')}</span>
                  <input className="input" required maxLength={120} autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="ui-field">
                  <span className="label">{t('templates.kind')}</span>
                  <select className="select" disabled={Boolean(draft.id)} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`templates.kinds.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {draft.kind !== 'offer_letter' && (
                <label className="ui-field">
                  <span className="label">{t('templates.subject')}</span>
                  <input className="input" maxLength={300} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                </label>
              )}
              <label className="ui-field">
                <span className="label">{t('templates.body')}</span>
                <textarea className="textarea" rows={12} maxLength={20000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                <span className="ui-help">
                  {t('templates.variablesHelp')} {VARIABLES.map((v) => `{{${v}}}`).join(', ')}
                </span>
              </label>
            </div>
            <div className="ui-modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {t('common.save')}
              </button>
            </div>
          </form>
        )}
      </HrDialog>
      {toast}
    </div>
  );
}
