'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { NumberDto } from '@/lib/groups';
import type { ConnectState, ProviderKind } from '@/lib/groups-provider';
import { Modal, api, useErrorText, useToast } from './ui';

const FIELDS: Record<ProviderKind, Array<{ key: string; secret?: boolean; placeholder?: string; optional?: boolean }>> = {
  cloud: [
    { key: 'phoneNumberId', placeholder: '123456789012345' },
    { key: 'accessToken', secret: true },
    { key: 'appSecret', secret: true },
    { key: 'verifyToken', secret: true },
    { key: 'wabaId', optional: true, placeholder: '102290129340398' },
  ],
  waha: [
    { key: 'baseUrl', placeholder: 'https://waha.example.com' },
    { key: 'apiKey', secret: true },
    { key: 'session', optional: true, placeholder: 'default' },
  ],
  evolution: [
    { key: 'baseUrl', placeholder: 'https://evolution.example.com' },
    { key: 'apiKey', secret: true },
    { key: 'session', optional: true, placeholder: 'acme' },
  ],
  fake: [],
};

/**
 * Números conectados: agregar (API oficial de Meta, WAHA, Evolution API),
 * conectar con QR, ver la URL del webhook, traer los grupos, desconectar y
 * borrar. Las credenciales se escriben y no se vuelven a mostrar.
 */
export default function NumbersSettings({ initial, providers, canEdit, openNew }: { initial: NumberDto[]; providers: ProviderKind[]; canEdit: boolean; openNew: boolean }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const router = useRouter();
  const [toast, showToast] = useToast();
  const [numbers, setNumbers] = useState(initial);
  const [adding, setAdding] = useState(openNew && canEdit);
  const [connecting, setConnecting] = useState<NumberDto | null>(null);
  const [removing, setRemoving] = useState<NumberDto | null>(null);
  const [disconnecting, setDisconnecting] = useState<NumberDto | null>(null);
  const [editing, setEditing] = useState<NumberDto | null>(null);

  const reload = useCallback(async () => {
    const res = await api<{ numbers: NumberDto[] }>('/api/groups/numbers');
    if (res.data) setNumbers(res.data.numbers);
  }, []);

  // El estado cambia solo (el teléfono se desvincula, el gateway se cae): la lista se refresca cada 10 s.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && !connecting) void reload();
    }, 10_000);
    return () => clearInterval(id);
  }, [reload, connecting]);

  async function act(n: NumberDto, action: 'disconnect' | 'sync') {
    const res = await api<{ groups?: number }>(`/api/groups/numbers/${n.id}/connect`, { body: { action } });
    if (!res.data) return showToast(errText(res.error), true);
    if (action === 'sync') showToast(t('numbers.synced', { n: res.data.groups ?? 0 }));
    void reload();
    router.refresh();
  }

  async function remove() {
    if (!removing) return;
    const res = await api(`/api/groups/numbers/${removing.id}`, { method: 'DELETE' });
    setRemoving(null);
    if (!res.data) return showToast(errText(res.error), true);
    void reload();
  }

  return (
    <div className="ui-fields">
      <div className="gr-detail-head">
        <p className="ui-help">{t('numbers.intro')}</p>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {t('numbers.add')}
          </button>
        )}
      </div>
      {numbers.length === 0 ? (
        <p className="ui-help">{t('numbers.empty')}</p>
      ) : (
        <ul className="gr-numbers">
          {numbers.map((n) => (
            <li key={n.id} className="panel gr-number">
              <div className="gr-number-main">
                <strong>{n.name}</strong>
                <span className="ui-help">
                  {t(`providers.${n.provider}.name`)} {n.phone ? `· +${n.phone}` : ''}
                </span>
                <span className={`badge ${n.status === 'connected' ? 'badge-ok' : n.status === 'error' ? 'badge-bad' : 'badge-warn'}`}>{t(`numberStatus.${n.status}`)}</span>
                {n.lastError && <span className="ui-error">{errText(n.lastError)}</span>}
              </div>
              {canEdit && (
                <div className="gr-number-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConnecting(n)}>
                    {n.status === 'connected' ? t('numbers.status') : n.status === 'disconnected' || n.status === 'error' ? t('numbers.reconnect') : t('numbers.connect')}
                  </button>
                  {n.caps.groups && n.status === 'connected' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(n, 'sync')}>
                      {t('numbers.sync')}
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(n)}>
                    {t('numbers.edit')}
                  </button>
                  {n.status === 'connected' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDisconnecting(n)}>
                      {t('numbers.disconnect')}
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(n)}>
                    {t('common.delete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <NumberForm
        open={adding || !!editing}
        editing={editing}
        providers={providers}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSaved={(n, isNew) => {
          setAdding(false);
          setEditing(null);
          void reload();
          if (isNew) setConnecting(n);
          else showToast(t('common.saved'));
        }}
      />
      <ConnectModal
        number={connecting}
        onClose={() => {
          setConnecting(null);
          void reload();
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={t('numbers.deleteTitle')}
        body={t('numbers.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={!!disconnecting}
        title={t('numbers.disconnectTitle', { name: disconnecting?.name ?? '' })}
        body={t('numbers.disconnectBody')}
        confirmLabel={t('numbers.disconnect')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          const n = disconnecting;
          setDisconnecting(null);
          if (n) void act(n, 'disconnect');
        }}
        onCancel={() => setDisconnecting(null)}
      />
      {toast}
    </div>
  );
}

function NumberForm({
  open,
  editing,
  providers,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: NumberDto | null;
  providers: ProviderKind[];
  onClose: () => void;
  onSaved: (n: NumberDto, isNew: boolean) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [provider, setProvider] = useState<ProviderKind>('waha');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setProvider(editing?.provider ?? (providers.includes('waha') ? 'waha' : providers[0]));
    setName(editing?.name ?? '');
    setConfig(editing ? Object.fromEntries(Object.entries(editing.settings).filter(([, v]) => v).map(([k, v]) => [k, String(v)])) : {});
    setError('');
  }, [open, editing, providers]);

  async function submit() {
    setBusy(true);
    setError('');
    const res = editing
      ? await api<NumberDto>(`/api/groups/numbers/${editing.id}`, { method: 'PATCH', body: { name, config } })
      : await api<NumberDto>('/api/groups/numbers', { body: { name, provider, config } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    onSaved(res.data, !editing);
  }

  return (
    <Modal
      open={open}
      wide
      title={editing ? t('numbers.editTitle') : t('numbers.addTitle')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
            {editing ? t('common.save') : t('numbers.addAndConnect')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {!editing && (
          <fieldset className="gr-provider-pick">
            <legend className="label">{t('numbers.provider')}</legend>
            {providers.map((p) => (
              <label key={p} className={`gr-provider${provider === p ? ' is-on' : ''}`}>
                <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} />
                <span>
                  <strong>{t(`providers.${p}.name`)}</strong>
                  <span className="ui-help">{t(`providers.${p}.desc`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {(provider === 'waha' || provider === 'evolution') && <p className="gr-banner is-warn">{t('numbers.bridgeRisk')}</p>}
        {provider === 'cloud' && <p className="gr-banner">{t('numbers.cloudLimits')}</p>}
        <label className="ui-field">
          <span className="label">{t('numbers.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('numbers.namePlaceholder')} />
        </label>
        {FIELDS[provider].map((f) => (
          <label key={f.key} className="ui-field">
            <span className="label">
              {t(`numbers.fields.${f.key}`)}
              {f.optional ? ` ${t('numbers.optional')}` : ''}
            </span>
            <input
              className="input"
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={config[f.key] ?? ''}
              onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
              placeholder={f.secret && editing?.configured[f.key] ? t('numbers.keepSecret') : f.placeholder}
              required={!f.optional && !(f.secret && editing?.configured[f.key])}
            />
          </label>
        ))}
        {provider === 'cloud' && <p className="ui-help">{t('numbers.cloudHelp')}</p>}
        {(provider === 'waha' || provider === 'evolution') && <p className="ui-help">{t(`numbers.${provider}Help`)}</p>}
        {provider === 'fake' && <p className="ui-help">{t('providers.fake.desc')}</p>}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** WhatsApp cambia el QR cada ~20 s; si nadie lo escanea en 2 minutos, se pide uno nuevo a mano. */
const QR_STALE_MS = 120_000;

function ConnectModal({ number, onClose }: { number: NumberDto | null; onClose: () => void }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [state, setState] = useState<ConnectState | null>(null);
  const [error, setError] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [qrAt, setQrAt] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!number) return;
    setWebhookUrl('');
    setCopied(false);
    void api<{ webhookUrl: string | null }>(`/api/groups/numbers/${number.id}`).then((r) => setWebhookUrl(r.data?.webhookUrl ?? ''));
  }, [number]);

  // Conectar (o reconectar con "Probar de nuevo" / "QR nuevo"): arranca la sesión y registra el webhook.
  useEffect(() => {
    if (!number) return;
    setState(null);
    setError('');
    setQrAt(null);
    setStartedAt(Date.now());
    void api<ConnectState>(`/api/groups/numbers/${number.id}/connect`, { body: { action: 'connect' } }).then((r) => {
      if (r.data) setState(r.data);
      else setError(errText(r.error));
    });
  }, [number, errText, attempt]);

  // Mientras espera el escaneo, consulta el estado (y el QR nuevo) cada 2 s.
  useEffect(() => {
    if (!number || !state || state.status === 'connected' || state.status === 'error') return;
    const id = setInterval(async () => {
      const r = await api<ConnectState>(`/api/groups/numbers/${number.id}/connect`);
      if (r.data) setState(r.data);
      setNow(Date.now());
    }, 2000);
    return () => clearInterval(id);
  }, [number, state]);

  const qr = state?.qr ?? '';
  useEffect(() => {
    if (qr) setQrAt(Date.now());
  }, [qr]);
  const stale = state?.status === 'qr' && now - startedAt > QR_STALE_MS;
  const retry = () => setAttempt((n) => n + 1);

  return (
    <Modal
      open={!!number}
      title={number ? t('numbers.connectTitle', { name: number.name }) : ''}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {state?.status === 'connected' ? t('numbers.done') : t('common.close')}
        </button>
      }
    >
      <div className="ui-fields" aria-live="polite">
        {error ? (
          <div className="ui-fields">
            <p className="ui-error" role="alert">
              {error}
            </p>
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
                {t('numbers.tryAgain')}
              </button>
            </div>
          </div>
        ) : !state ? (
          <p className="ui-help">{t('numbers.connecting')}</p>
        ) : state.status === 'connected' ? (
          <p className="gr-banner is-ok" role="status">
            {t('numbers.connected', { phone: state.phone ? `+${state.phone}` : '' })}
          </p>
        ) : state.qr ? (
          <div className="gr-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.qr} alt={t('numbers.qrAlt')} width={220} height={220} />
            <ol className="gr-steps">
              <li>{t('numbers.qr1')}</li>
              <li>{t('numbers.qr2')}</li>
              <li>{t('numbers.qr3')}</li>
            </ol>
            <p className="ui-help">
              {t('numbers.qrRefresh')} {qrAt ? t('numbers.qrUpdated', { s: Math.max(0, Math.round((now - qrAt) / 1000)) }) : ''}
            </p>
            {stale && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
                {t('numbers.newQr')}
              </button>
            )}
          </div>
        ) : state.status === 'disconnected' || state.status === 'error' ? (
          <div className="ui-fields">
            <p className="gr-banner is-warn" role="status">
              {t('numbers.disconnectedBanner')}
            </p>
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
                {t('numbers.newQr')}
              </button>
            </div>
          </div>
        ) : (
          <p className="ui-help">{t('numbers.waiting')}</p>
        )}
        {webhookUrl && (
          <div className="ui-field">
            <span className="label">{t('numbers.webhookUrl')}</span>
            <p className="gr-invite-link">
              <input className="input gr-mono" readOnly value={webhookUrl} onFocus={(e) => e.target.select()} aria-label={t('numbers.webhookUrl')} />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(webhookUrl).catch(() => null);
                  setCopied(true);
                }}
              >
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </p>
            <span className="ui-help">{number?.provider === 'cloud' ? t('numbers.webhookCloud') : t('numbers.webhookBridge')}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
