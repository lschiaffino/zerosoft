'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { WebhookDeliveryDto } from '@/lib/webhooks';
import { parseDbUtc } from '@/lib/utils';

/**
 * Log de entregas de un webhook (modal): evento, estado, código, intentos y
 * próxima prueba; cada fila se abre para ver el cuerpo enviado y la
 * respuesta, y se puede reenviar.
 */
export default function WebhookDeliveries({
  webhook,
  onClose,
}: {
  webhook: { id: string; url: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations('settings.webhooks');
  const locale = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<WebhookDeliveryDto[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setError(false);
    const res = await fetch(`/api/webhooks/${id}/deliveries`).catch(() => null);
    if (res?.ok) setRows(((await res.json()) as { rows: WebhookDeliveryDto[] }).rows);
    else setError(true);
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (webhook) {
      setRows(null);
      setOpen(null);
      if (!d.open) d.showModal();
      void load(webhook.id);
    } else if (d.open) d.close();
  }, [webhook, load]);

  async function resend(id: string) {
    if (!webhook) return;
    setBusy(id);
    const res = await fetch(`/api/webhooks/deliveries/${id}/resend`, { method: 'POST' }).catch(() => null);
    if (!res?.ok) setError(true);
    await load(webhook.id);
    setBusy(null);
  }

  const fmt = (iso: string | null) => {
    if (!iso) return '';
    const d = parseDbUtc(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(d);
  };

  return (
    <dialog
      ref={ref}
      className="ui-modal ui-modal-wide"
      aria-labelledby="st-deliveries-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id="st-deliveries-title">
          {t('log.title')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.close()}>
          {t('log.close')}
        </button>
      </div>
      <div className="ui-modal-body st-deliveries">
        {webhook && <p className="data st-muted st-url">{webhook.url}</p>}
        {error && (
          <p className="ui-error" role="alert">
            {t('errors.action')}
          </p>
        )}
        {rows === null && !error && <p className="ui-help">{t('log.loading')}</p>}
        {rows?.length === 0 && <p className="ui-help">{t('log.empty')}</p>}
        {rows && rows.length > 0 && (
          <ul className="st-delivery-list" data-testid="webhook-deliveries">
            {rows.map((d) => {
              const tone = d.status === 'delivered' ? 'badge-ok' : d.status === 'failed' ? 'badge-bad' : 'badge-warn';
              const expanded = open === d.id;
              return (
                <li key={d.id} className="st-delivery-item">
                  <div className="st-delivery-row">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm st-delivery-toggle"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : d.id)}
                    >
                      <span className="data">{d.event}</span>
                    </button>
                    <span className={`badge ${tone}`}>{t(`delivery.${d.status}`)}</span>
                    <span className="data st-muted">{d.responseCode ?? d.error ?? ''}</span>
                    <span className="st-muted">{t('log.attempts', { count: d.attempts })}</span>
                    <span className="data st-muted">{fmt(d.createdAt)}</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => resend(d.id)}
                      disabled={busy !== null || (d as { payloadHidden?: boolean }).payloadHidden === true}
                      title={(d as { payloadHidden?: boolean }).payloadHidden ? t('resendNotOwner') : undefined}
                      aria-busy={busy === d.id || undefined}
                    >
                      {t('log.resend')}
                    </button>
                  </div>
                  {expanded && (
                    <div className="st-delivery-detail">
                      {d.status === 'pending' && d.nextAttemptAt && (
                        <p className="ui-help">{t('log.nextAttempt', { at: fmt(d.nextAttemptAt) })}</p>
                      )}
                      {d.durationMs != null && <p className="ui-help">{t('log.duration', { ms: d.durationMs })}</p>}
                      <p className="label">{t('log.request')}</p>
                      {(d as { payloadHidden?: boolean }).payloadHidden ? (
                        <p className="ui-help">{t('payloadHidden')}</p>
                      ) : (
                        <pre className="data st-pre">{d.payload}</pre>
                      )}
                      <p className="label">{t('log.response')}</p>
                      <pre className="data st-pre">{d.responseBody || t('log.noBody')}</pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </dialog>
  );
}
