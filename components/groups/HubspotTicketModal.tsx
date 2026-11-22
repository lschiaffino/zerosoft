'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { HubspotTicketPipeline, HubspotTicketRef } from '@/lib/groups-hubspot-tickets';
import { Modal, api, useErrorText } from './ui';

const PRIORITIES = ['', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
/** Prioridad de Lines → la de HubSpot. */
const FROM_LINES: Record<string, string> = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH', urgent: 'URGENT' };

/**
 * "Crear ticket en HubSpot" desde un chat o un ticket de Lines: asunto,
 * descripción, prioridad, pipeline y etapa. El ticket queda asociado a la
 * empresa, el contacto y el negocio vinculados al chat.
 */
export default function HubspotTicketModal({
  open,
  chatId,
  ticket,
  defaultSubject = '',
  onClose,
  onCreated,
}: {
  open: boolean;
  chatId: string;
  /** Un ticket de Lines: se usa su título, su mensaje y su prioridad, y queda vinculado. */
  ticket?: { id: string; title: string; body?: string; priority?: string } | null;
  defaultSubject?: string;
  onClose: () => void;
  onCreated: (ref: HubspotTicketRef & { created: boolean }) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [pipelines, setPipelines] = useState<HubspotTicketPipeline[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSubject(ticket?.title ?? defaultSubject);
    setContent(ticket?.body ?? '');
    setPriority(ticket?.priority ? (FROM_LINES[ticket.priority] ?? '') : '');
    setError('');
    setLoadError('');
    setPipelines(null);
    let live = true;
    void api<{ pipelines: HubspotTicketPipeline[] }>(`/api/groups/hubspot/tickets?chat=${encodeURIComponent(chatId)}`).then((res) => {
      if (!live) return;
      if (!res.data) return setLoadError(errText(res.error));
      setPipelines(res.data.pipelines);
      const first = res.data.pipelines[0];
      setPipeline(first?.id ?? '');
      setStage(first?.stages.find((s) => !s.closed)?.id ?? first?.stages[0]?.id ?? '');
    });
    return () => {
      live = false;
    };
  }, [open, chatId, ticket, defaultSubject, errText]);

  const current = pipelines?.find((p) => p.id === pipeline);

  async function submit() {
    if (!subject.trim() || !pipelines?.length) return;
    setBusy(true);
    setError('');
    const res = await api<HubspotTicketRef & { created: boolean }>('/api/groups/hubspot/tickets', {
      body: { chatId, subject, content, priority, pipeline, stage, ...(ticket ? { ticketId: ticket.id } : {}) },
    });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    onCreated(res.data);
  }

  return (
    <Modal
      open={open}
      title={t('hubspot.ticket.title')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!subject.trim() || !pipelines?.length || busy} aria-busy={busy || undefined} data-testid="hs-ticket-submit">
            {t('hubspot.ticket.create')}
          </button>
        </>
      }
    >
      <div className="ui-fields" data-testid="hs-ticket-form">
        <p className="ui-help">{t('hubspot.ticket.help')}</p>
        <label className="ui-field">
          <span className="label">{t('hubspot.ticket.subject')}</span>
          <input className="input" value={subject} maxLength={250} required onChange={(e) => setSubject(e.target.value)} data-testid="hs-ticket-subject" />
        </label>
        <label className="ui-field">
          <span className="label">{t('hubspot.ticket.content')}</span>
          <textarea className="input" rows={4} value={content} maxLength={10_000} onChange={(e) => setContent(e.target.value)} />
        </label>
        <label className="ui-field">
          <span className="label">{t('hubspot.ticket.priority')}</span>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p ? t(`priority.${p.toLowerCase()}`) : t('hubspot.ticket.noPriority')}
              </option>
            ))}
          </select>
        </label>
        {loadError ? (
          <p className="ui-error" role="alert">
            {loadError}
          </p>
        ) : !pipelines ? (
          <p className="ui-help" role="status">
            {t('common.loading')}
          </p>
        ) : pipelines.length === 0 ? (
          <p className="ui-error" role="alert">
            {errText('hubspot_no_ticket_pipeline')}
          </p>
        ) : (
          <>
            {pipelines.length > 1 && (
              <label className="ui-field">
                <span className="label">{t('hubspot.ticket.pipeline')}</span>
                <select
                  className="select"
                  value={pipeline}
                  onChange={(e) => {
                    const next = pipelines.find((p) => p.id === e.target.value);
                    setPipeline(e.target.value);
                    setStage(next?.stages.find((s) => !s.closed)?.id ?? next?.stages[0]?.id ?? '');
                  }}
                >
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="ui-field">
              <span className="label">{t('hubspot.ticket.stage')}</span>
              <select className="select" value={stage} onChange={(e) => setStage(e.target.value)} data-testid="hs-ticket-stage">
                {(current?.stages ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
