'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { HrDialog, api, useErrorText } from './ui';

/** Acciones en lote sobre las postulaciones elegidas: mover de etapa, rechazar (con email de plantilla) o etiquetar. */
export default function BulkBar({
  selected,
  stages,
  templates = [],
  onDone,
  push,
}: {
  selected: string[];
  /** Etapas para mover (solo con un puesto elegido). */
  stages: Array<{ id: string; name: string }> | null;
  templates?: Array<{ id: string; name: string }>;
  onDone: () => void;
  push: (msg: string, tone?: 'ok' | 'bad') => void;
}) {
  const t = useTranslations('hiring');
  const errText = useErrorText();
  const [stage, setStage] = useState('');
  const [tag, setTag] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  if (!selected.length) return null;

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    const res = await api<{ done: number; failed: number }>('/api/hiring/applications/bulk', { method: 'POST', json: { ids: selected, ...body } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    push(t('bulk.done', { done: res.data.done, failed: res.data.failed }), res.data.failed ? 'bad' : 'ok');
    onDone();
  };

  const reject = async (e: FormEvent) => {
    e.preventDefault();
    setRejectOpen(false);
    await run({ action: 'reject', reason, sendEmail, templateId: templateId || null });
  };

  return (
    <div className="hr-bulk" role="region" aria-label={t('bulk.title')}>
      <span className="hr-bulk-count">{t('bulk.selected', { count: selected.length })}</span>
      {stages && (
        <form
          className="hr-bulk-group"
          onSubmit={(e) => {
            e.preventDefault();
            if (stage) void run({ action: 'move', stageId: stage });
          }}
        >
          <select className="select" aria-label={t('bulk.moveTo')} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">{t('bulk.moveTo')}</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!stage || busy}>
            {t('bulk.move')}
          </button>
        </form>
      )}
      <form
        className="hr-bulk-group"
        onSubmit={(e) => {
          e.preventDefault();
          if (tag.trim()) void run({ action: 'tag', tag: tag.trim() });
        }}
      >
        <input className="input" aria-label={t('bulk.tag')} placeholder={t('bulk.tag')} maxLength={40} value={tag} onChange={(e) => setTag(e.target.value)} />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={!tag.trim() || busy}>
          {t('bulk.addTag')}
        </button>
      </form>
      <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => setRejectOpen(true)}>
        {t('bulk.reject')}
      </button>
      <HrDialog open={rejectOpen} title={t('reject.title', { count: selected.length })} onClose={() => setRejectOpen(false)}>
        <form onSubmit={reject}>
          <div className="ui-modal-body ui-fields">
            <label className="ui-field">
              <span className="label">{t('reject.reason')}</span>
              <input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="ui-check">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              {t('reject.sendEmail')}
            </label>
            {sendEmail && (
              <label className="ui-field">
                <span className="label">{t('reject.template')}</span>
                <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">{t('reject.defaultTemplate')}</option>
                  {templates.map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {tp.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setRejectOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-danger">
              {t('bulk.reject')}
            </button>
          </div>
        </form>
      </HrDialog>
    </div>
  );
}
