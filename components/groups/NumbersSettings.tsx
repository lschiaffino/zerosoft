'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { NumberDto } from '@/lib/groups';
import type { ConnectState, ProviderKind } from '@/lib/groups-provider';
import type { LineAccess, LineDto } from '@/lib/groups-lines';
import { LINE_COLORS, lineColor } from '@/lib/groups-lines-shared';
import { Modal, api, useErrorText, useRelativeTime, useToast } from './ui';

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
  managed: [],
  sample: [],
  fake: [],
};

/** Credenciales propias (Meta, WAHA, Evolution, demo): van bajo "Conexión avanzada" cuando hay QR administrado. */
const ADVANCED: ProviderKind[] = ['cloud', 'waha', 'evolution', 'fake'];

/**
 * Líneas (Ajustes › Líneas): una tabla con cada línea de WhatsApp, su color,
 * estado y desde cuándo, último mensaje, chats abiertos, quién la ve (acceso
 * por línea) y las acciones: conectar o reconectar con QR, traer grupos,
 * reimportar el historial, editar (nombre, color, credenciales),
 * desconectar y borrar. Las credenciales se escriben y no se vuelven a
 * mostrar. Se refresca sola cada 10 s.
 */
export default function NumbersSettings({
  initial,
  providers,
  canEdit,
  openNew,
  people = [],
  teams = [],
  lineAccess = false,
}: {
  initial: Array<NumberDto | LineDto>;
  providers: ProviderKind[];
  canEdit: boolean;
  openNew: boolean;
  people?: Array<{ id: string; name: string; email: string }>;
  teams?: Array<{ id: string; name: string; memberIds: string[] }>;
  /** Acceso por línea prendido (Ajustes › Acceso). */
  lineAccess?: boolean;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const router = useRouter();
  const rel = useRelativeTime();
  const [toast, showToast] = useToast();
  const [numbers, setNumbers] = useState<Array<NumberDto | LineDto>>(initial);
  const [adding, setAdding] = useState(openNew && canEdit);
  const [connecting, setConnecting] = useState<NumberDto | null>(null);
  // Número recién agregado: si se cierra el QR sin escanear, no queda uno "esperando".
  const [freshId, setFreshId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<NumberDto | null>(null);
  const [disconnecting, setDisconnecting] = useState<NumberDto | null>(null);
  const [editing, setEditing] = useState<NumberDto | null>(null);
  const [granting, setGranting] = useState<LineDto | null>(null);

  const syncStatus = useCallback((id: string, status: ConnectState['status']) => {
    setNumbers((list) => (list.some((x) => x.id === id && x.status !== status) ? list.map((x) => (x.id === id ? { ...x, status } : x)) : list));
  }, []);

  const reload = useCallback(async () => {
    const res = await api<{ lines: LineDto[] }>('/api/groups/lines');
    if (res.data) setNumbers(res.data.lines);
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

  const [perChat, setPerChat] = useState(50);
  async function reimport(n: NumberDto) {
    const res = await api(`/api/groups/numbers/${n.id}/connect`, { body: { action: 'import', perChat } });
    if (!res.data) return showToast(errText(res.error), true);
    showToast(t('wa.reimportStarted'));
    void reload();
  }

  async function remove() {
    if (!removing) return;
    const res = await api(`/api/groups/numbers/${removing.id}`, { method: 'DELETE' });
    setRemoving(null);
    if (!res.data) return showToast(errText(res.error), true);
    void reload();
  }

  const accessText = (a: LineAccess | undefined) => {
    if (!a || (a.personIds.length === 0 && a.teamIds.length === 0)) return lineAccess ? t('lines.adminsOnly') : t('lines.everyone');
    const parts = [
      ...a.teamIds.map((id) => teams.find((x) => x.id === id)?.name).filter(Boolean),
      ...a.personIds.map((id) => {
        const p = people.find((x) => x.id === id);
        return p ? p.name || p.email : null;
      }).filter(Boolean),
    ] as string[];
    return parts.length > 3 ? t('lines.accessMany', { first: parts.slice(0, 2).join(', '), n: parts.length - 2 }) : parts.join(', ');
  };

  return (
    <div className="ui-fields">
      <div className="gr-detail-head">
        <p className="ui-help">{t('numbers.intro')}</p>
        {!canEdit && <p className="ui-help">{t('numbers.adminOnly')}</p>}
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {t('numbers.add')}
          </button>
        )}
      </div>
      {numbers.length === 0 ? (
        <p className="ui-help">{t('numbers.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table gr-table gr-lines-table">
            <thead>
              <tr>
                <th scope="col">{t('lines.colLine')}</th>
                <th scope="col">{t('lines.colStatus')}</th>
                <th scope="col">{t('lines.colLast')}</th>
                <th scope="col">{t('lines.colChats')}</th>
                {canEdit && <th scope="col">{t('lines.colAccess')}</th>}
                <th scope="col">
                  <span className="sr-only">{t('lines.colActions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => {
                const line = n as Partial<LineDto> & NumberDto;
                const importing = line.import && (line.import.status === 'queued' || line.import.status === 'running');
                return (
                  <tr key={n.id} className="gr-line-row">
                    <td>
                      <div className="gr-line-cell">
                        <span className="gr-line-dot" style={{ background: line.displayColor ?? lineColor(n) }} aria-hidden="true" />
                        <span className="gr-line-name">
                          <strong>{n.name}</strong>
                          <span className="ui-help">
                            {n.phone ? `+${n.phone} · ` : ''}
                            {t(`providers.${n.provider}.name`)}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      {n.provider === 'sample' ? (
                        <span className="badge">{t('sample.badge')}</span>
                      ) : (
                        <span className="gr-line-status">
                          <span className={`badge ${n.status === 'connected' ? 'badge-ok' : n.status === 'error' ? 'badge-bad' : 'badge-warn'}`}>{t(`numberStatus.${n.status}`)}</span>
                          {n.statusAt && <span className="ui-help">{t('lines.since', { when: rel(n.statusAt) })}</span>}
                          {importing && (
                            <span className="ui-help" role="status">
                              {t('lines.importing', { done: line.import!.chatsDone, total: line.import!.chatsTotal })}
                            </span>
                          )}
                          {line.import?.status === 'error' && <span className="ui-error">{t('lines.importFailed')}</span>}
                        </span>
                      )}
                      {n.lastError && <span className="ui-error gr-line-error">{errText(n.lastError)}</span>}
                    </td>
                    <td>{line.lastMessageAt ? rel(line.lastMessageAt) : <span className="ui-help">{t('lines.noMessages')}</span>}</td>
                    <td>{line.openChats ?? '·'}</td>
                    {canEdit && (
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm gr-line-access" onClick={() => setGranting(line as LineDto)} title={t('lines.editAccessFor', { name: n.name })}>
                          {accessText(line.access)}
                        </button>
                      </td>
                    )}
                    <td>
                      {canEdit && n.provider === 'sample' && (
                        <div className="gr-number-actions">
                          <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(n)}>
                            {t('sample.clear')}
                          </button>
                        </div>
                      )}
                      {canEdit && n.provider !== 'sample' && (
                        <div className="gr-number-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConnecting(n)}>
                            {n.status === 'connected' ? t('numbers.status') : n.status === 'disconnected' || n.status === 'error' ? t('numbers.reconnect') : t('numbers.connect')}
                          </button>
                          {n.caps.groups && n.status === 'connected' && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(n, 'sync')}>
                              {t('numbers.sync')}
                            </button>
                          )}
                          {(n.provider === 'managed' || n.provider === 'evolution') && n.status === 'connected' && (
                            <span className="gr-reimport" title={t('wa.reimportHelp')}>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reimport(n)} disabled={Boolean(importing)}>
                                {t('wa.reimport')}
                              </button>
                              <label className="gr-reimport-label" htmlFor={`per-chat-${n.id}`}>
                                {t('wa.perChat')}
                              </label>
                              <select id={`per-chat-${n.id}`} className="select" value={perChat} onChange={(e) => setPerChat(Number(e.target.value))}>
                                {[20, 50, 100, 200].map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </span>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && numbers.length > 1 && <p className="ui-help">{lineAccess ? t('lines.accessOnHelp') : t('lines.accessOffHelp')}</p>}

      <LineAccessModal
        line={granting}
        people={people}
        teams={teams}
        onClose={() => setGranting(null)}
        onSaved={(id, access) => {
          setGranting(null);
          setNumbers((list) => list.map((x) => (x.id === id ? { ...x, access } : x)));
          showToast(t('common.saved'));
        }}
      />
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
          if (isNew) {
            setFreshId(n.id);
            setConnecting(n);
          } else showToast(t('common.saved'));
        }}
      />
      <ConnectModal
        number={connecting}
        onStatus={syncStatus}
        onClose={async (connected) => {
          const n = connecting;
          setConnecting(null);
          setFreshId(null);
          // QR administrado sin escanear: se borra el número y su instancia en el servidor.
          if (n && !connected && n.id === freshId && n.provider === 'managed') {
            await api(`/api/groups/numbers/${n.id}`, { method: 'DELETE' });
          }
          void reload();
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title={removing?.provider === 'sample' ? t('sample.clearTitle') : t('numbers.deleteTitle')}
        body={removing?.provider === 'sample' ? t('sample.clearBody') : removing?.provider === 'managed' ? t('numbers.deleteBodyManaged') : t('numbers.deleteBody')}
        confirmLabel={removing?.provider === 'sample' ? t('sample.clear') : t('common.delete')}
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
  const hasManaged = providers.includes('managed');
  const advanced = hasManaged ? providers.filter((p) => ADVANCED.includes(p)) : providers;
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setProvider(editing?.provider ?? (providers.includes('managed') ? 'managed' : providers.includes('waha') ? 'waha' : providers[0]));
    setName(editing?.name ?? '');
    setColor(editing?.color ?? '');
    setConfig(editing ? Object.fromEntries(Object.entries(editing.settings).filter(([, v]) => v).map(([k, v]) => [k, String(v)])) : {});
    setError('');
  }, [open, editing, providers]);

  async function submit() {
    setBusy(true);
    setError('');
    const res = editing
      ? await api<NumberDto>(`/api/groups/numbers/${editing.id}`, { method: 'PATCH', body: { name, config, color } })
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
            {editing ? t('common.save') : provider === 'managed' ? t('numbers.showQr') : t('numbers.addAndConnect')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        {!editing && (
          <fieldset className="gr-provider-pick">
            <legend className="label">{t('numbers.provider')}</legend>
            {hasManaged && (
              <label className={`gr-provider${provider === 'managed' ? ' is-on' : ''}`}>
                <input type="radio" name="provider" value="managed" checked={provider === 'managed'} onChange={() => setProvider('managed')} />
                <span>
                  <strong>
                    {t('providers.managed.name')} <span className="gr-recommended">{t('numbers.recommended')}</span>
                  </strong>
                  <span className="ui-help">{t('providers.managed.desc')}</span>
                </span>
              </label>
            )}
            {hasManaged ? (
              <details className="gr-advanced" open={provider !== 'managed' || undefined}>
                <summary>{t('numbers.advanced')}</summary>
                <div className="gr-provider-pick">
                  {advanced.map((p) => (
                    <ProviderOption key={p} p={p} provider={provider} setProvider={setProvider} />
                  ))}
                </div>
              </details>
            ) : (
              advanced.map((p) => <ProviderOption key={p} p={p} provider={provider} setProvider={setProvider} />)
            )}
          </fieldset>
        )}
        {provider === 'managed' && <p className="gr-banner is-warn">{t('numbers.managedTips')}</p>}
        {(provider === 'waha' || provider === 'evolution') && <p className="gr-banner is-warn">{t('numbers.bridgeRisk')}</p>}
        {provider === 'cloud' && <p className="gr-banner">{t('numbers.cloudLimits')}</p>}
        <label className="ui-field">
          <span className="label">{t('numbers.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('numbers.namePlaceholder')} />
        </label>
        {editing && (
          <fieldset className="gr-color-pick">
            <legend className="label">{t('lines.color')}</legend>
            <label className={`gr-color-swatch is-auto${!color ? ' is-on' : ''}`}>
              <input type="radio" name="line-color" checked={!color} onChange={() => setColor('')} />
              <span className="gr-line-dot" style={{ background: lineColor({ id: editing.id }) }} aria-hidden="true" />
              {t('lines.colorAuto')}
            </label>
            {LINE_COLORS.map((c) => (
              <label key={c} className={`gr-color-swatch${color === c ? ' is-on' : ''}`}>
                <input type="radio" name="line-color" checked={color === c} onChange={() => setColor(c)} aria-label={c} />
                <span className="gr-line-dot" style={{ background: c }} aria-hidden="true" />
              </label>
            ))}
          </fieldset>
        )}
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

function ProviderOption({ p, provider, setProvider }: { p: ProviderKind; provider: ProviderKind; setProvider: (p: ProviderKind) => void }) {
  const t = useTranslations('groups');
  return (
    <label className={`gr-provider${provider === p ? ' is-on' : ''}`}>
      <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} />
      <span>
        <strong>{t(`providers.${p}.name`)}</strong>
        <span className="ui-help">{t(`providers.${p}.desc`)}</span>
      </span>
    </label>
  );
}

/** WhatsApp cambia el QR cada ~20 s; si nadie lo escanea en 2 minutos, se pide uno nuevo a mano. */
const QR_STALE_MS = 120_000;

function ConnectModal({
  number,
  onClose: close,
  onStatus,
}: {
  number: NumberDto | null;
  onClose: (connected: boolean) => void;
  onStatus: (id: string, status: ConnectState['status']) => void;
}) {
  const t = useTranslations('groups');
  const router = useRouter();
  const errText = useErrorText();
  const [state, setState] = useState<ConnectState | null>(null);
  const [error, setError] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [qrAt, setQrAt] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // QR administrado: al conectar se traen los grupos solos.
  const managed = number?.provider === 'managed';
  const [synced, setSynced] = useState<{ busy: boolean; n: number | null; error: string }>({ busy: false, n: null, error: '' });
  const syncStarted = useRef(false);
  const onClose = () => close(state?.status === 'connected');
  // La fila de la lista (detrás del diálogo) sigue el mismo estado.
  const status = state?.status;
  useEffect(() => {
    if (number && status) onStatus(number.id, status);
  }, [number, status, onStatus]);

  useEffect(() => {
    if (!number) return;
    setWebhookUrl('');
    setCopied(false);
    syncStarted.current = false;
    setSynced({ busy: false, n: null, error: '' });
    // El webhook del servidor administrado lo registramos nosotros: no hace falta mostrarlo.
    if (number.provider === 'managed') return;
    void api<{ webhookUrl: string | null }>(`/api/groups/numbers/${number.id}`).then((r) => setWebhookUrl(r.data?.webhookUrl ?? ''));
  }, [number]);

  useEffect(() => {
    if (!number || !managed || state?.status !== 'connected' || syncStarted.current) return;
    syncStarted.current = true;
    setSynced({ busy: true, n: null, error: '' });
    void api<{ groups?: number }>(`/api/groups/numbers/${number.id}/connect`, { body: { action: 'sync' } }).then((r) =>
      setSynced({ busy: false, n: r.data ? (r.data.groups ?? 0) : null, error: r.data ? '' : errText(r.error) }),
    );
  }, [number, managed, state?.status, errText]);

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
        managed && state?.status === 'connected' ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t('common.close')}
            </button>
            <button type="button" className="btn btn-primary" disabled={synced.busy} onClick={() => {
                // La bandeja pudo quedar en caché vacía (se vio antes de conectar): se pide de nuevo.
                router.push('/app/groups/inbox');
                router.refresh();
              }}>
              {t('numbers.openInbox')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {state?.status === 'connected' ? t('numbers.done') : t('common.close')}
          </button>
        )
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
          <div className="ui-fields">
            <p className="gr-banner is-ok" role="status">
              {t('numbers.connected', { phone: state.phone ? `+${state.phone}` : '' })}
            </p>
            {managed && (
              <p className="ui-help" role="status">
                {synced.busy ? t('numbers.syncing') : synced.error ? synced.error : synced.n !== null ? t('numbers.syncedAuto', { n: synced.n }) : ''}
              </p>
            )}
          </div>
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
            {managed && <p className="ui-help gr-qr-note">{t('numbers.managedTips')}</p>}
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

/** Quién ve una línea con el acceso por línea prendido: equipos y personas. Admins y dueño ven todas siempre. */
function LineAccessModal({
  line,
  people,
  teams,
  onClose,
  onSaved,
}: {
  line: LineDto | null;
  people: Array<{ id: string; name: string; email: string }>;
  teams: Array<{ id: string; name: string; memberIds: string[] }>;
  onClose: () => void;
  onSaved: (id: string, access: LineAccess) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [personIds, setPersonIds] = useState<Set<string>>(new Set());
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!line) return;
    setPersonIds(new Set(line.access?.personIds ?? []));
    setTeamIds(new Set(line.access?.teamIds ?? []));
    setError('');
  }, [line]);
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  async function save() {
    if (!line) return;
    setBusy(true);
    const res = await api<{ access: LineAccess }>('/api/groups/lines', { method: 'PUT', body: { numberId: line.id, personIds: [...personIds], teamIds: [...teamIds] } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    onSaved(line.id, res.data.access);
  }

  return (
    <Modal
      open={!!line}
      title={line ? t('lines.accessTitle', { name: line.name }) : ''}
      onClose={onClose}
      onSubmit={() => void save()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <p className="ui-help">{t('lines.accessIntro')}</p>
        {teams.length > 0 && (
          <fieldset className="gr-check-list">
            <legend className="label">{t('lines.teams')}</legend>
            {teams.map((tm) => (
              <label key={tm.id} className="gr-check-label">
                <input type="checkbox" className="ui-check" checked={teamIds.has(tm.id)} onChange={(e) => setTeamIds(toggle(teamIds, tm.id, e.target.checked))} />
                {tm.name} <span className="ui-help">{t('lines.teamSize', { n: tm.memberIds.length })}</span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="gr-check-list">
          <legend className="label">{t('lines.people')}</legend>
          {people.map((p) => (
            <label key={p.id} className="gr-check-label">
              <input type="checkbox" className="ui-check" checked={personIds.has(p.id)} onChange={(e) => setPersonIds(toggle(personIds, p.id, e.target.checked))} />
              {p.name || p.email}
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
