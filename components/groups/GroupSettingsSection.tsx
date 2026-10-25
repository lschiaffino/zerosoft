'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ChatDto } from '@/lib/groups';
import type { ProviderCaps } from '@/lib/groups-provider';
import { api, useErrorText } from './ui';

const EPHEMERAL = [0, 86_400, 604_800, 7_776_000] as const;

/**
 * Ajustes del grupo en WhatsApp: foto, quién escribe, quién edita la info,
 * mensajes temporales (si el proveedor los tiene) y salir del grupo.
 */
export default function GroupSettingsSection({
  chat,
  caps,
  onChange,
  showToast,
}: {
  chat: ChatDto;
  caps: ProviderCaps;
  onChange: (c: ChatDto) => void;
  showToast: (msg: string, bad?: boolean) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save(body: Record<string, unknown>) {
    // Las casillas y el selector cambian en el momento; si WhatsApp lo rechaza, vuelven atrás.
    const before = chat;
    const optimistic: Partial<ChatDto> = {};
    if (typeof body.announce === 'boolean') optimistic.announce = body.announce;
    if (typeof body.locked === 'boolean') optimistic.locked = body.locked;
    if (typeof body.ephemeral === 'number') optimistic.ephemeral = body.ephemeral;
    if (Object.keys(optimistic).length) onChange({ ...chat, ...optimistic });
    setBusy(true);
    const res = await api<ChatDto>(`/api/groups/chats/${chat.id}/group`, { body: { action: 'settings', ...body } });
    setBusy(false);
    if (!res.data) {
      onChange(before);
      showToast(errText(res.error), true);
      return;
    }
    onChange(res.data);
    showToast(t('common.saved'));
  }

  async function picture(file: File) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      showToast(errText('invalid_image'), true);
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/groups/upload', { method: 'POST', body: form }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { url?: string; mimetype?: string; error?: string } | undefined;
    setBusy(false);
    if (!res?.ok || !data?.url) {
      showToast(errText(data?.error ?? 'upload_failed'), true);
      return;
    }
    await save({ picture: { url: data.url, mimetype: data.mimetype ?? file.type } });
  }

  async function leave() {
    setLeaving(false);
    setBusy(true);
    const res = await api<ChatDto>(`/api/groups/chats/${chat.id}/group`, { body: { action: 'leave' } });
    setBusy(false);
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    onChange(res.data);
    showToast(t('groupSettings.left'));
    router.refresh();
  }

  if (chat.leftAt) {
    return (
      <section className="gr-detail-section">
        <h3 className="gr-detail-title">{t('groupSettings.title')}</h3>
        <p className="gr-banner" role="status">
          {t('groupSettings.leftBanner')}
        </p>
      </section>
    );
  }

  return (
    <section className="gr-detail-section" aria-busy={busy || undefined}>
      <h3 className="gr-detail-title">{t('groupSettings.title')}</h3>
      <div className="gr-group-photo">
        {chat.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={chat.pictureUrl} alt={t('groupSettings.photoAlt')} width={48} height={48} />
        ) : (
          <span className="gr-group-photo-empty" aria-hidden="true" />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          aria-label={t('groupSettings.addPhoto')}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void picture(f);
          }}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          {chat.pictureUrl ? t('groupSettings.changePhoto') : t('groupSettings.addPhoto')}
        </button>
        {chat.pictureUrl && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void save({ picture: null })} disabled={busy}>
            {t('common.remove')}
          </button>
        )}
      </div>
      <label className="gr-check-label">
        <input type="checkbox" className="ui-check" checked={chat.announce} disabled={busy} onChange={(e) => void save({ announce: e.target.checked })} />
        {t('groupSettings.announce')}
      </label>
      <label className="gr-check-label">
        <input type="checkbox" className="ui-check" checked={chat.locked} disabled={busy} onChange={(e) => void save({ locked: e.target.checked })} />
        {t('groupSettings.locked')}
      </label>
      {caps.ephemeral ? (
        <label className="ui-field">
          <span className="label">{t('groupSettings.ephemeral')}</span>
          <select className="select" value={chat.ephemeral} disabled={busy} onChange={(e) => void save({ ephemeral: Number(e.target.value) })}>
            {EPHEMERAL.map((s) => (
              <option key={s} value={s}>
                {t(`groupSettings.ephemeralOptions.${s}`)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="ui-help">{t('groupSettings.ephemeralUnsupported')}</p>
      )}
      <p className="ui-help">{t('groupSettings.help')}</p>
      <div>
        <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setLeaving(true)} disabled={busy}>
          {t('groupSettings.leave')}
        </button>
      </div>
      <ConfirmDialog
        open={leaving}
        title={t('groupSettings.leaveTitle', { name: chat.name })}
        body={t('groupSettings.leaveBody')}
        confirmLabel={t('groupSettings.leave')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void leave()}
        onCancel={() => setLeaving(false)}
      />
    </section>
  );
}
