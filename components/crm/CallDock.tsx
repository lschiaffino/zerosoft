'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { formatPhoneDisplay, isDefaultOutcome } from '@/lib/crm-calls';
import CrmIcon from './CrmIcon';
import { CALL_EVENT, setVoiceAvailable, type BrowserCallRequest } from './voiceStore';

/**
 * Llamadas desde el navegador (Twilio Voice JS SDK). Montado una vez en el
 * layout del CRM: pide el token, avisa a los botones de teléfono que se
 * puede llamar, atiende los pedidos de llamada y las entrantes del número
 * del workspace. Después de cortar ofrece guardar resultado y nota; la
 * actividad, la grabación, la transcripción y el resumen los registra el
 * server (lib/crm-voice.ts).
 *
 * Con CRM_VOICE_FAKE el server devuelve fake: true y se usa un dispositivo
 * simulado que reporta los mismos pasos a /api/crm/voice/fake.
 */

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@twilio/voice-sdk@2.18.5/dist/twilio.min.js';
const SDK_SRI = 'sha384-LUG7DmzDPWNKRYoqyGpV4d/IByMLiya/oUhMSc/4/6hi0wbzO/8PffM4lzeFEYS8';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

interface TwilioCall {
  on(event: string, cb: (...args: unknown[]) => void): void;
  mute(v: boolean): void;
  disconnect(): void;
  accept(): void;
  reject(): void;
  sendDigits(d: string): void;
  parameters: Record<string, string>;
}
interface TwilioDevice {
  connect(opts: { params: Record<string, string> }): Promise<TwilioCall>;
  register(): Promise<void>;
  updateToken(token: string): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  destroy(): void;
}
type TwilioNS = { Device: new (token: string, opts?: Record<string, unknown>) => TwilioDevice };

interface TokenInfo {
  identity: string;
  fake: boolean;
  token: string | null;
  inbound: boolean;
}

interface CallInfo {
  id: string;
  status: string;
  durationSec: number | null;
  hasRecording: boolean;
  transcript: Array<{ speaker: string; text: string }>;
  transcriptStatus: string;
  summary: string;
  summaryStatus: string;
}

type Phase = 'idle' | 'preparing' | 'ringing' | 'live' | 'ended' | 'error' | 'incoming';

let sdkPromise: Promise<TwilioNS> | null = null;
function loadSdk(): Promise<TwilioNS> {
  const w = window as unknown as { Twilio?: TwilioNS };
  if (w.Twilio?.Device) return Promise.resolve(w.Twilio);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.integrity = SDK_SRI;
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.onload = () => (w.Twilio?.Device ? resolve(w.Twilio) : reject(new Error('sdk')));
      s.onerror = () => {
        sdkPromise = null;
        reject(new Error('sdk'));
      };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CallDock() {
  const t = useTranslations('crm');
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [req, setReq] = useState<BrowserCallRequest | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [info, setInfo] = useState<CallInfo | null>(null);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [incomingFrom, setIncomingFrom] = useState('');

  const tokenRef = useRef<TokenInfo | null>(null);
  const deviceRef = useRef<TwilioDevice | null>(null);
  const callRef = useRef<TwilioCall | null>(null);
  const startedAt = useRef<number | null>(null);
  const callIdRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const primaryRef = useRef<HTMLButtonElement>(null);
  phaseRef.current = phase;
  callIdRef.current = callId;

  const fetchToken = useCallback(async (): Promise<TokenInfo | null> => {
    const res = await fetch('/api/crm/voice/token', { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json().catch(() => null)) as (TokenInfo & { available?: boolean }) | null;
    return data && data.available !== false ? data : null;
  }, []);

  const getDevice = useCallback(async (): Promise<TwilioDevice> => {
    if (deviceRef.current) return deviceRef.current;
    const tok = tokenRef.current ?? (await fetchToken());
    if (!tok?.token) throw new Error('token');
    const Twilio = await loadSdk();
    const device = new Twilio.Device(tok.token, { codecPreferences: ['opus', 'pcmu'], closeProtection: true });
    device.on('tokenWillExpire', () => {
      void fetchToken().then((next) => {
        if (next?.token) {
          tokenRef.current = next;
          device.updateToken(next.token);
        }
      });
    });
    device.on('incoming', (c) => {
      const call = c as TwilioCall;
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'ended') {
        call.reject();
        return;
      }
      callRef.current = call;
      setReq(null);
      setCallId(null);
      setIncomingFrom(call.parameters.From ?? '');
      setPhase('incoming');
      call.on('cancel', () => setPhase('idle'));
      call.on('disconnect', () => {
        setPhase('idle');
        router.refresh();
      });
    });
    deviceRef.current = device;
    return device;
  }, [fetchToken, router]);

  // Disponibilidad: el token dice si el workspace tiene llamadas configuradas.
  useEffect(() => {
    let alive = true;
    void fetchToken().then(async (tok) => {
      if (!alive) return;
      tokenRef.current = tok;
      setVoiceAvailable(Boolean(tok));
      // Entrantes: el navegador se registra para que suene el número del workspace.
      if (tok && tok.inbound && !tok.fake) {
        const device = await getDevice().catch(() => null);
        await device?.register().catch(() => null);
      }
    });
    return () => {
      alive = false;
      setVoiceAvailable(false);
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, [fetchToken, getDevice]);

  // Cronómetro de la llamada.
  useEffect(() => {
    if (phase !== 'live') return;
    const id = window.setInterval(() => {
      if (startedAt.current) setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [phase]);

  // Después de cortar: transcripción y resumen llegan por webhook; se consulta unas veces.
  useEffect(() => {
    if (phase !== 'ended' || !callId) return;
    let tries = 0;
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/crm/voice/calls/${callId}`).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { call?: CallInfo } | null;
      if (stop) return;
      if (data?.call) setInfo(data.call);
      const c = data?.call;
      const pending = !c || c.transcriptStatus === 'active' || (c.transcriptStatus === 'done' && ['none', 'running'].includes(c.summaryStatus));
      tries += 1;
      if (pending && tries < 12) window.setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      stop = true;
    };
  }, [phase, callId]);

  useEffect(() => {
    if (phase === 'idle') return;
    primaryRef.current?.focus();
  }, [phase]);

  const ended = useCallback(async () => {
    const id = callIdRef.current;
    callRef.current = null;
    setMuted(false);
    setKeypad(false);
    setPhase('ended');
    if (!id) return;
    const res = await fetch(`/api/crm/voice/calls/${id}/end`, { method: 'POST' }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { call?: CallInfo } | null;
    if (data?.call) setInfo(data.call);
  }, []);

  const start = useCallback(
    async (r: BrowserCallRequest) => {
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'ended' && phaseRef.current !== 'error') return;
      setReq(r);
      setPhase('preparing');
      setError(null);
      setInfo(null);
      setOutcome('');
      setNote('');
      setSaveError(false);
      setElapsed(0);
      startedAt.current = null;
      void fetch('/api/crm/settings')
        .then((x) => (x.ok ? x.json() : null))
        .then((d: { callOutcomes?: string[] } | null) => setOutcomes(d?.callOutcomes ?? []))
        .catch(() => null);

      const res = await fetch('/api/crm/voice/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: r.phone, contactId: r.contactId, companyId: r.companyId, dealId: r.dealId }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as
        | { call?: CallInfo; to?: string; recorded?: boolean; error?: string }
        | null;
      if (!res?.ok || !data?.call || !data.to) {
        setError(data?.error ?? 'failed');
        setPhase('error');
        return;
      }
      const id = data.call.id;
      setCallId(id);
      callIdRef.current = id;
      setRecorded(Boolean(data.recorded));

      const tok = tokenRef.current ?? (await fetchToken());
      tokenRef.current = tok;
      if (tok?.fake) {
        // Dispositivo simulado: los mismos pasos que reportaría Twilio.
        const fake = (action: string, durationSec?: number) =>
          fetch('/api/crm/voice/fake', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ callId: id, action, durationSec }),
          }).catch(() => null);
        await fake('connect');
        setPhase('ringing');
        callRef.current = {
          on: () => undefined,
          mute: () => undefined,
          accept: () => undefined,
          reject: () => undefined,
          sendDigits: () => undefined,
          parameters: {},
          disconnect: () => {
            const secs = startedAt.current ? Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)) : 0;
            void fake('hangup', secs).then(async (x) => {
              const d = (await x?.json().catch(() => null)) as { call?: CallInfo } | null;
              if (d?.call) setInfo(d.call);
              void ended();
            });
          },
        };
        window.setTimeout(() => {
          if (phaseRef.current !== 'ringing' || callIdRef.current !== id) return;
          void fake('answer').then(() => {
            if (phaseRef.current !== 'ringing') return;
            startedAt.current = Date.now();
            setPhase('live');
          });
        }, 1200);
        return;
      }

      try {
        const device = await getDevice();
        const call = await device.connect({ params: { To: data.to, CallId: id } });
        callRef.current = call;
        setPhase('ringing');
        call.on('accept', () => {
          startedAt.current = Date.now();
          setPhase('live');
        });
        call.on('disconnect', () => void ended());
        call.on('cancel', () => void ended());
        call.on('reject', () => void ended());
        call.on('error', () => {
          setError('call_failed');
          void ended();
        });
      } catch {
        setError('device_failed');
        setPhase('error');
        await fetch(`/api/crm/voice/calls/${id}/end`, { method: 'POST' }).catch(() => null);
      }
    },
    [ended, fetchToken, getDevice],
  );

  useEffect(() => {
    function onCall(e: Event) {
      const detail = (e as CustomEvent<BrowserCallRequest>).detail;
      if (detail?.phone) void start(detail);
    }
    window.addEventListener(CALL_EVENT, onCall);
    return () => window.removeEventListener(CALL_EVENT, onCall);
  }, [start]);

  const close = useCallback(() => {
    setPhase('idle');
    setReq(null);
    setCallId(null);
    setInfo(null);
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (phase !== 'ended' && phase !== 'error') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, close]);

  function hangup() {
    callRef.current?.disconnect();
    if (phaseRef.current === 'preparing') void ended();
  }

  function toggleMute() {
    const next = !muted;
    callRef.current?.mute(next);
    setMuted(next);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!callId || saving) return;
    setSaving(true);
    setSaveError(false);
    const res = await fetch(`/api/crm/voice/calls/${callId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: outcome || undefined, note: note.trim() || undefined }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setSaveError(true);
      return;
    }
    close();
  }

  if (phase === 'idle') return null;

  const who = req?.name || formatPhoneDisplay(req?.phone) || formatPhoneDisplay(incomingFrom);
  const outcomeLabel = (o: string) => (isDefaultOutcome(o) ? t(`calls.outcomes.${o}`) : o);
  const statusText =
    phase === 'preparing'
      ? t('voice.preparing')
      : phase === 'ringing'
        ? t('voice.ringing')
        : phase === 'live'
          ? mmss(elapsed)
          : phase === 'incoming'
            ? t('voice.incoming')
            : phase === 'ended'
              ? t('voice.ended', { duration: mmss(info?.durationSec ?? elapsed) })
              : '';

  return (
    <section className="call-dock" role="dialog" aria-modal="false" aria-label={t('voice.dockLabel')} data-phase={phase}>
      <header className="call-dock-head">
        <CrmIcon name="headset" size={16} />
        <div className="call-dock-who">
          <strong>{who}</strong>
          {req?.name && req.phone ? <span className="muted">{formatPhoneDisplay(req.phone)}</span> : null}
        </div>
        <span className="call-dock-status" aria-live="polite">
          {statusText}
        </span>
      </header>

      {recorded && (phase === 'ringing' || phase === 'live') && (
        <p className="call-dock-note muted">{t('voice.recordingOn')}</p>
      )}

      {phase === 'incoming' && (
        <div className="call-dock-actions">
          <button
            type="button"
            ref={primaryRef}
            className="btn btn-solid btn-small"
            onClick={() => {
              callRef.current?.accept();
              startedAt.current = Date.now();
              setPhase('live');
            }}
          >
            {t('voice.accept')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => {
              callRef.current?.reject();
              setPhase('idle');
            }}
          >
            {t('voice.decline')}
          </button>
        </div>
      )}

      {(phase === 'preparing' || phase === 'ringing' || phase === 'live') && (
        <>
          <div className="call-dock-actions">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              aria-pressed={muted}
              disabled={phase !== 'live'}
              onClick={toggleMute}
            >
              <CrmIcon name={muted ? 'micOff' : 'mic'} />
              <span>{muted ? t('voice.unmute') : t('voice.mute')}</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              aria-pressed={keypad}
              aria-controls="call-dock-keypad"
              disabled={phase !== 'live'}
              onClick={() => setKeypad((k) => !k)}
            >
              <CrmIcon name="keypad" />
              <span>{t('voice.keypad')}</span>
            </button>
            <button type="button" ref={primaryRef} className="btn btn-danger btn-small call-dock-hangup" onClick={hangup}>
              <CrmIcon name="hangup" />
              <span>{t('voice.hangup')}</span>
            </button>
          </div>
          {keypad && phase === 'live' && (
            <div className="call-dock-keypad" id="call-dock-keypad" role="group" aria-label={t('voice.keypad')}>
              {KEYS.map((k) => (
                <button key={k} type="button" className="btn btn-ghost btn-small" onClick={() => callRef.current?.sendDigits(k)}>
                  {k}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {phase === 'error' && (
        <>
          <p className="form-error" role="alert">
            {t.has(`voice.errors.${error}`) ? t(`voice.errors.${error}`) : t('voice.errors.failed')}
          </p>
          <div className="call-dock-actions">
            <button type="button" ref={primaryRef} className="btn btn-ghost btn-small" onClick={close}>
              {t('common.close')}
            </button>
          </div>
        </>
      )}

      {phase === 'ended' && (
        <form className="call-dock-form" onSubmit={save}>
          {error && <p className="form-error">{t.has(`voice.errors.${error}`) ? t(`voice.errors.${error}`) : t('voice.errors.failed')}</p>}
          <p className="muted call-dock-note" aria-live="polite">
            {info?.transcriptStatus === 'active'
              ? t('voice.transcribing')
              : info?.transcriptStatus === 'done' && info.summaryStatus === 'running'
                ? t('voice.summarizing')
                : info?.summaryStatus === 'done'
                  ? t('voice.summaryReady')
                  : info?.summaryStatus && t.has(`voice.summaryStatus.${info.summaryStatus}`) && info.summaryStatus !== 'none'
                    ? t(`voice.summaryStatus.${info.summaryStatus}`)
                    : t('voice.loggedNote')}
          </p>
          <label className="field">
            <span className="field-label">{t('calls.outcome')}</span>
            <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">{t('voice.keepOutcome')}</option>
              {outcomes.map((o) => (
                <option key={o} value={o}>
                  {outcomeLabel(o)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('calls.note')}</span>
            <textarea className="textarea" rows={2} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} />
          </label>
          {saveError && (
            <p className="form-error" role="alert">
              {t('voice.saveFailed')}
            </p>
          )}
          <div className="call-dock-actions">
            <button type="submit" ref={primaryRef} className="btn btn-solid btn-small" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={close}>
              {t('common.close')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
