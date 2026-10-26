'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { VoiceEnhanced } from '@/lib/voice-types';
import { voiceErrorKey } from './voice-ui';

interface ProjectOption {
  id: string;
  name: string;
}

/**
 * Nota mejorada: resumen, secciones de la plantilla (lo que escribiste en
 * tinta, lo que salió de la transcripción en gris, como Granola), decisiones
 * y próximos pasos, que se mandan a Track o al CRM.
 */
export default function EnhancedNotes({
  sessionId,
  enhanced,
  hasContact,
}: {
  sessionId: string;
  enhanced: VoiceEnhanced;
  hasContact: boolean;
}) {
  const t = useTranslations('voice.notes');
  const tErr = useTranslations('voice.errors');
  const locale = useLocale();
  const [picked, setPicked] = useState<Set<number>>(() => new Set(enhanced.actionItems.map((_, i) => i)));
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState<'track' | 'crm' | null>(null);
  // Lo ya creado con estos próximos pasos (se guarda con la nota: no se crea dos veces).
  const [sent, setSent] = useState<NonNullable<VoiceEnhanced['sent']>>(enhanced.sent ?? {});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPicked(new Set(enhanced.actionItems.map((_, i) => i)));
    setSent(enhanced.sent ?? {});
  }, [enhanced]);

  useEffect(() => {
    if (!enhanced.actionItems.length) return;
    let alive = true;
    void fetch('/api/track/projects?pageSize=100')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { rows: ProjectOption[] };
        if (!alive) return;
        setProjects(data.rows.map((p) => ({ id: p.id, name: p.name })));
        setProjectId((cur) => cur || data.rows[0]?.id || '');
      })
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [enhanced.actionItems.length]);

  async function send(target: 'track' | 'crm') {
    const items = enhanced.actionItems.filter((_, i) => picked.has(i)).map((a) => (a.owner ? `${a.text} (${a.owner})` : a.text));
    if (!items.length) return;
    setBusy(target);
    setError(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, items, projectId: target === 'track' ? projectId : undefined, locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { created?: Array<{ id: string; label: string }>; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !data?.created) {
      setError(data?.error ?? 'network');
      return;
    }
    setSent((prev) => ({ ...prev, [target]: data.created }));
  }

  return (
    <div className="vc-enhanced" data-testid="voice-enhanced">
      {enhanced.summary && (
        <section>
          <h3 className="vc-h3">{t('summary')}</h3>
          <p>{enhanced.summary}</p>
        </section>
      )}
      {enhanced.sections
        .filter((s) => s.points.length)
        .map((s, i) => (
          <section key={i}>
            <h3 className="vc-h3">{s.heading}</h3>
            <ul className="vc-points">
              {s.points.map((p, j) => (
                <li key={j} className={p.source === 'mine' ? 'is-mine' : 'is-ai'} title={p.source === 'mine' ? t('fromMine') : t('fromTranscript')}>
                  {p.text}
                  <span className="sr-only"> ({p.source === 'mine' ? t('fromMine') : t('fromTranscript')})</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {enhanced.decisions.length > 0 && (
        <section>
          <h3 className="vc-h3">{t('decisions')}</h3>
          <ul className="vc-points">
            {enhanced.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="vc-h3">{t('actionItems')}</h3>
        {enhanced.actionItems.length === 0 ? (
          <p className="vc-muted">{t('noActionItems')}</p>
        ) : (
          <>
            <ul className="vc-actions-list">
              {enhanced.actionItems.map((a, i) => (
                <li key={i}>
                  <label className="ui-check">
                    <input
                      type="checkbox"
                      checked={picked.has(i)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                    />
                    <span>
                      {a.text}
                      {(a.owner || a.due) && <span className="vc-muted"> · {[a.owner, a.due].filter(Boolean).join(', ')}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="vc-send-row">
              {projects && projects.length > 0 && (
                <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t('trackProject')}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null || !picked.size || !projectId || !!sent.track?.length}
                aria-busy={busy === 'track' || undefined}
                onClick={() => void send('track')}
              >
                {t('sendTrack')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null || !picked.size || !!sent.crm?.length}
                aria-busy={busy === 'crm' || undefined}
                onClick={() => void send('crm')}
                title={hasContact ? t('sendCrmContact') : undefined}
              >
                {t('sendCrm')}
              </button>
            </div>
            {projects && projects.length === 0 && <p className="vc-muted">{t('noProjects')}</p>}
          </>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {tErr(voiceErrorKey(error))}
          </p>
        )}
        {!!sent.track?.length && (
          <p className="vc-ok" role="status">
            {t('sentTrack', { count: sent.track.length })}{' '}
            {sent.track.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ', '}
                <Link href={`/app/track/issues/${c.id}`}>{c.label}</Link>
              </span>
            ))}
          </p>
        )}
        {!!sent.crm?.length && (
          <p className="vc-ok" role="status">
            {t('sentCrm', { count: sent.crm.length })} <Link href="/app/crm/tasks">{t('openTasks')}</Link>
          </p>
        )}
      </section>
    </div>
  );
}
