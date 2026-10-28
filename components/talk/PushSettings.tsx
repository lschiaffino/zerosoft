'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { registerAppServiceWorker } from '@/lib/sw-client';
import type { TalkPrefs } from '@/lib/talk-extras';
import { useTalk } from './talk-context';

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Push del navegador para Talk: activa este navegador (la misma suscripción
 * que Groups y Chat, con el service worker de la suite) y elige qué avisa.
 */
export function PushSettings({ value, onChange }: { value: TalkPrefs['push']; onChange: (v: TalkPrefs['push']) => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [support, setSupport] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupport(ok);
    if (ok)
      void navigator.serviceWorker
        .getRegistration('/')
        .then(async (reg) => setSubscribed(Boolean(await reg?.pushManager.getSubscription())))
        .catch(() => undefined);
  }, []);

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      const keyRes = await fetch('/api/groups/push');
      const { publicKey } = (await keyRes.json()) as { publicKey: string | null };
      if (!publicKey) throw new Error('push_disabled');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setNote({ tone: 'error', text: t('push.denied') });
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await registerAppServiceWorker({ force: true }));
      if (!reg) throw new Error('no_sw');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const res = await fetch('/api/groups/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error('push_failed');
      setSubscribed(true);
      setNote({ tone: 'ok', text: t('push.on') });
    } catch {
      setNote({ tone: 'error', text: t('push.failed') });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/groups/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => null);
        await sub.unsubscribe().catch(() => null);
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="ui-field talk-radios">
      <legend className="label">{t('push.title')}</legend>
      {!ctx.boot.pushAvailable ? (
        <p className="ui-help">{t('push.unavailable')}</p>
      ) : !support ? (
        <p className="ui-help">{t('push.unsupported')}</p>
      ) : (
        <div className="talk-details-actions">
          {subscribed ? (
            <button type="button" className="btn btn-sm" onClick={() => void disable()} disabled={busy}>
              {t('push.disable')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void enable()} disabled={busy} aria-busy={busy || undefined}>
              {t('push.enable')}
            </button>
          )}
        </div>
      )}
      {note && (
        <p className="ui-help" role={note.tone === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
      {(['mentions', 'all', 'off'] as const).map((v) => (
        <label key={v} className="ui-check">
          <input type="radio" name="push" checked={value === v} onChange={() => onChange(v)} />
          <span>{t(`push.level_${v}`)}</span>
        </label>
      ))}
    </fieldset>
  );
}
