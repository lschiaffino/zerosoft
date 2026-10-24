'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { CallView } from '@/lib/crm-voice';

/**
 * Detalle de una llamada desde el navegador en el timeline: grabación (por el
 * server, con la visibilidad del CRM), transcripción por quién habla y el
 * estado del resumen con IA (el resumen en sí va al cuerpo de la actividad).
 */
export default function CallDetails({ voice }: { voice: CallView }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(voice.summaryStatus);

  async function summarize() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/crm/voice/calls/${voice.id}/summarize`, { method: 'POST' }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string; call?: CallView } | null;
    setBusy(false);
    setStatus(data?.call?.summaryStatus ?? data?.error ?? 'failed');
    if (res?.ok) router.refresh();
  }

  const hasTranscript = voice.transcript.length > 0;
  const statusKey = `voice.summaryStatus.${status}`;
  const showStatus = status !== 'done' && status !== 'none' && t.has(statusKey);

  return (
    <div className="tl-call">
      {voice.hasRecording && (
        <div className="tl-call-recording">
          <span className="tl-call-label">{t('voice.recording')}</span>
          <audio controls preload="none" src={`/api/crm/voice/calls/${voice.id}/recording`}>
            <track kind="captions" />
          </audio>
        </div>
      )}
      {voice.transcriptStatus === 'active' && <p className="muted">{t('voice.transcribing')}</p>}
      {voice.transcriptStatus === 'failed' && <p className="muted">{t('voice.transcriptFailed')}</p>}
      {hasTranscript && (
        <details className="tl-call-transcript">
          <summary>{t('voice.transcript', { count: voice.transcript.length })}</summary>
          <ol>
            {voice.transcript.map((line, i) => (
              <li key={i} data-speaker={line.speaker}>
                <span className="tl-call-speaker">{line.speaker === 'agent' ? t('voice.speakerAgent') : t('voice.speakerContact')}</span>{' '}
                {line.text}
              </li>
            ))}
          </ol>
        </details>
      )}
      {hasTranscript && status !== 'done' && (
        <div className="tl-call-summary">
          {showStatus && (
            <p className={status === 'running' ? 'muted' : 'form-error'} role={status === 'running' ? 'status' : 'alert'}>
              {t(statusKey)}
            </p>
          )}
          {status !== 'running' && (
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={summarize}>
              {busy ? t('voice.summarizing') : t('voice.summarize')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
