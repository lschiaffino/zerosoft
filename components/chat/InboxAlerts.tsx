'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { registerAppServiceWorker } from '@/lib/sw-client';
import ChatIcon from './icons';

const SOUND_KEY = 'zs-chat-sound';

/** Sonido de aviso activado en este navegador (por defecto, no). */
export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

function setSound(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    // Sin storage: dura lo que dura la página.
  }
}

let audio: AudioContext | null = null;

/** Dos tonos cortos con Web Audio (sin archivo de sonido). */
export function playNewMessageSound(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const now = audio.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.11);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.12);
    }
  } catch {
    // Sin audio: el aviso queda en la lista y en Notificaciones.
  }
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Avisos de la bandeja: sonido cuando un visitante escribe (este navegador) y
 * push al celular o a la compu (service worker de la suite, el mismo que usa
 * Groups). El push llega a la persona asignada, a quien sigue la conversación
 * y al dueño del widget.
 */
export default function InboxAlerts() {
  const t = useTranslations('chat');
  const [open, setOpen] = useState(false);
  const [sound, setSoundState] = useState(false);
  const [support, setSupport] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSoundState(soundEnabled());
    setSupport('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch('/api/groups/push')
      .then((r) => (r.ok ? (r.json() as Promise<{ publicKey: string | null }>) : null))
      .then((d) => setPublicKey(d?.publicKey ?? null))
      .catch(() => setPublicKey(null));
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistration('/')
        .then(async (reg) => setSubscribed(Boolean(await reg?.pushManager.getSubscription())))
        .catch(() => {});
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  function toggleSound(on: boolean) {
    setSound(on);
    setSoundState(on);
    if (on) playNewMessageSound();
  }

  async function enablePush() {
    if (!publicKey) return;
    setBusy(true);
    setNote(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setNote({ tone: 'error', text: t('alerts.denied') });
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await registerAppServiceWorker({ force: true }));
      if (!reg) throw new Error('no_sw');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const res = await fetch('/api/groups/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error('push_failed');
      setSubscribed(true);
      setNote({ tone: 'ok', text: t('alerts.pushOn') });
    } catch {
      setNote({ tone: 'error', text: t('alerts.pushFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/groups/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => null);
        await sub.unsubscribe().catch(() => null);
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-alerts" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        aria-expanded={open}
        aria-controls="chat-alerts-panel"
        aria-label={t('alerts.title')}
        title={t('alerts.title')}
        onClick={() => setOpen((o) => !o)}
        data-on={sound || subscribed || undefined}
      >
        <ChatIcon name="bell" size={16} />
      </button>
      {open && (
        <div id="chat-alerts-panel" className="chat-alerts-panel" role="dialog" aria-label={t('alerts.title')}>
          <label className="ui-switch">
            <input type="checkbox" role="switch" checked={sound} onChange={(e) => toggleSound(e.target.checked)} />
            {t('alerts.sound')}
          </label>
          <p className="ui-help">{t('alerts.soundHint')}</p>
          <div className="chat-alerts-push">
            <p className="chat-alerts-label">{t('alerts.push')}</p>
            {!support ? (
              <p className="ui-help">{t('alerts.unsupported')}</p>
            ) : publicKey === null ? (
              <p className="ui-help">{t('alerts.pushDisabled')}</p>
            ) : subscribed ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void disablePush()} disabled={busy}>
                {t('alerts.pushOff')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void enablePush()} disabled={busy} aria-busy={busy || undefined}>
                {t('alerts.pushEnable')}
              </button>
            )}
            <p className="ui-help">{t('alerts.pushHint')}</p>
          </div>
          {note && (
            <p className={note.tone === 'error' ? 'ui-error' : 'ui-help'} role="status">
              {note.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
