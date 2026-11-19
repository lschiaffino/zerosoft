'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { GroupsPerson, NumberDto } from '@/lib/groups';
import LineAccess from './LineAccess';
import PersonPicker from './PersonPicker';
import type { ConnectState, ProviderKind } from '@/lib/groups-provider';
import { Modal, api, useErrorText, useToast } from './ui';
import MenuSelect from '@/components/ui/MenuSelect';
import { LINE_COLORS } from '@/lib/line-colors';
import LineDot from './LineDot';
import { useRelativeTime } from './relative-time';
import { parseDbUtc } from '@/lib/utils';
import { useMounted } from '@/components/ui/useMounted';

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
 * Números conectados: agregar (API oficial de Meta, WAHA, Evolution API),
 * conectar con QR, ver la URL del webhook, traer los grupos, desconectar y
 * borrar. Las credenciales se escriben y no se vuelven a mostrar.
 */
export default function NumbersSettings({
  initial,
  providers,
  canEdit,
  isAdmin = canEdit,
  openNew,
  reconnect = null,
  people = [],
  teams = [],
  me = '',
}: {
  /** Quien mira: su nombre no hace falta en la columna Dueño ("Vos"). */
  me?: string;
  /** Owner o admin: administra todas las líneas y cambia dueños. Si no, solo las suyas (`canManage`). */
  isAdmin?: boolean;
  initial: NumberDto[];
  people?: GroupsPerson[];
  teams?: Array<{ id: string; name: string }>;
  providers: ProviderKind[];
  /** Puede agregar líneas (admins, o members con permiso para conectar números). */
  canEdit: boolean;
  openNew: boolean;
  /** Llega desde el aviso "se cayó la línea" de la bandeja: abre la conexión (QR) de ese número. */
  reconnect?: string | null;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const router = useRouter();
  const [toast, showToast] = useToast();
  const [numbers, setNumbers] = useState(initial);
  const [adding, setAdding] = useState(openNew && canEdit);
  const [connecting, setConnecting] = useState<NumberDto | null>(() => (reconnect ? (initial.find((n) => n.id === reconnect && n.canManage) ?? null) : null));
  // Número recién agregado: si se cierra el QR sin escanear, no queda uno "esperando".
  const [freshId, setFreshId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<NumberDto | null>(null);
  const [disconnecting, setDisconnecting] = useState<NumberDto | null>(null);
  const [editing, setEditing] = useState<NumberDto | null>(null);
  const [accessFor, setAccessFor] = useState<NumberDto | null>(null);
  const [ownerFilter, setOwnerFilter] = useState('');
  const owners = people.filter((p) => numbers.some((n) => n.ownerId === p.id));

  const syncStatus = useCallback((id: string, status: ConnectState['status']) => {
    setNumbers((list) => (list.some((x) => x.id === id && x.status !== status) ? list.map((x) => (x.id === id ? { ...x, status } : x)) : list));
  }, []);

  const reload = useCallback(async () => {
    const res = await api<{ numbers: NumberDto[] }>('/api/groups/numbers?stats=1');
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

  // 0: todo el historial que guardó el servidor de WhatsApp (lo normal); si no, los últimos N de cada chat.
  const [perChat, setPerChat] = useState(0);
  async function reimport(n: NumberDto) {
    const res = await api(`/api/groups/numbers/${n.id}/connect`, { body: { action: 'import', perChat } });
    if (!res.data) return showToast(errText(res.error), true);
    showToast(t('wa.reimportStarted'));
  }

  // Color de la línea: se guarda en el acto y la bandeja lo toma al volver (router.refresh).
  async function setColor(n: NumberDto, color: string) {
    const prev = n.color;
    setNumbers((list) => list.map((x) => (x.id === n.id ? { ...x, color: color as NumberDto['color'] } : x)));
    const res = await api<NumberDto>(`/api/groups/numbers/${n.id}`, { method: 'PATCH', body: { color } });
    if (!res.data) {
      setNumbers((list) => list.map((x) => (x.id === n.id ? { ...x, color: prev } : x)));
      return showToast(errText(res.error), true);
    }
    router.refresh();
  }
  // Dueño de la línea: lo elige un admin en la misma fila y se guarda en el acto.
  const [ownerBusy, setOwnerBusy] = useState('');
  async function setOwner(n: NumberDto, ownerId: string) {
    setOwnerBusy(n.id);
    const res = await api<NumberDto>(`/api/groups/numbers/${n.id}`, { method: 'PATCH', body: { ownerId: ownerId || null } });
    setOwnerBusy('');
    if (!res.data) return showToast(errText(res.error), true);
    const saved = res.data;
    setNumbers((list) => list.map((x) => (x.id === n.id ? { ...x, ...saved } : x)));
    showToast(saved.ownerName ? t('lines.ownerSaved', { name: saved.ownerName, line: n.name }) : t('lines.ownerCleared', { line: n.name }));
    router.refresh();
  }
  const colorOptions = [
    { value: '', label: t('numbers.colorNone'), lead: <span className="gr-line-dot is-none" aria-hidden="true" /> },
    ...LINE_COLORS.map((c) => ({ value: c, label: t(`numbers.colors.${c}`), lead: <LineDot color={c} /> })),
  ];

  // Tabla: desde cuándo está en su estado y hace cuánto fue el último mensaje (hora relativa, sin contenido).
  // Las horas dependen del reloj y la zona del navegador: se escriben después de montar (sin desajuste al hidratar).
  const mounted = useMounted();
  const rel = useRelativeTime();
  const locale = useLocale();
  const recent = (iso: string) => Date.now() - parseDbUtc(iso).getTime() < 7 * 86_400_000;
  const shortDate = (iso: string) => parseDbUtc(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const longDate = (iso: string) => (!mounted ? undefined : parseDbUtc(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }));
  const fresh = (iso: string) => Date.now() - parseDbUtc(iso).getTime() < 60_000;
  const since = (iso: string) => (!mounted ? '' : fresh(iso) ? t('numbers.sinceNow') : recent(iso) ? t('numbers.sinceRel', { time: rel(iso) }) : t('numbers.sinceDate', { date: shortDate(iso) }));
  const ago = (iso: string) => (!mounted ? '' : fresh(iso) ? t('numbers.lastNow') : recent(iso) ? t('numbers.lastAgo', { time: rel(iso) }) : shortDate(iso));

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
        {!canEdit && <p className="ui-help">{t('numbers.adminOnly')}</p>}
        {canEdit && !isAdmin && (
          <p className="ui-help" data-testid="numbers-member-note">
            {t('numbers.memberNote')}
          </p>
        )}
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {t('numbers.add')}
          </button>
        )}
      </div>
      <p className="ui-help" data-testid="lines-owner-help">
        {t(isAdmin ? 'lines.ownerExplainAdmin' : 'lines.ownerExplain')}
      </p>
      {owners.length > 0 && (
        <MenuSelect
          testId="lines-owner-filter"
          label={t('lines.filterOwner')}
          value={ownerFilter}
          onChange={setOwnerFilter}
          options={[{ value: '', label: t('lines.allOwners') }, ...owners.map((p) => ({ value: p.id, label: p.name || p.email }))]}
        />
      )}
      {numbers.length === 0 ? (
        <p className="ui-help">{t('numbers.empty')}</p>
      ) : (
        // Una tabla: cada línea es un <tbody> con su fila de datos y, debajo, la de acciones. En el teléfono las
        // filas se apilan como tarjetas (styles/groups.css), sin scroll lateral.
        <div className="table-wrap table-stack">
          <table className="table gr-numbers-table" data-testid="numbers-table">
            <thead>
              <tr>
                <th scope="col">{t('numbers.colLine')}</th>
                <th scope="col">{t('lines.owner')}</th>
                <th scope="col">{t('numbers.colStatus')}</th>
                <th scope="col">{t('numbers.colLastMessage')}</th>
                <th scope="col" className="num">
                  {t('numbers.colOpenChats')}
                </th>
              </tr>
            </thead>
            {numbers.filter((n) => !ownerFilter || n.ownerId === ownerFilter).map((n) => (
              <tbody key={n.id} className="gr-number" data-number-id={n.id}>
                <tr className="gr-number-row">
                  <th scope="row" className="gr-number-line">
                    <div className="gr-number-main">
                      <strong className="gr-number-name" data-testid="line-name">
                        <LineDot color={n.color} />
                        {n.name}
                      </strong>
                      <span className="ui-help">
                        {t(`providers.${n.provider}.name`)} {n.phone ? `· +${n.phone}` : ''}
                      </span>
                      {n.visibility === 'restricted' && (
                        <span className="ui-help" data-testid="line-restricted-tag">
                          {t('lines.restrictedTag')}
                        </span>
                      )}
                      {n.lastError && <span className="ui-error">{errText(n.lastError)}</span>}
                      {n.archiveSyncBroken && n.provider !== 'sample' && (
                        <span className="ui-error" role="status" data-testid="line-archive-broken">
                          {t('wa.archiveBroken')}
                        </span>
                      )}
                      {/* Qué historial trae cada tipo de conexión, sin prometer lo que el proveedor no da. */}
                      {(n.provider === 'cloud' || n.provider === 'waha') && (
                        <span className="ui-help gr-number-note" data-testid="line-history-note">
                          {t(n.provider === 'cloud' ? 'wa.historyNoneCloud' : 'wa.historyNoneWaha')}
                        </span>
                      )}
                      {(n.provider === 'managed' || n.provider === 'evolution') && (
                        <span className="ui-help gr-number-note" data-testid="line-history-note">
                          {t('wa.historyLinked')}
                        </span>
                      )}
                    </div>
                  </th>
                  <td className="gr-number-cell gr-number-owner" data-label={t('lines.owner')} data-testid="line-owner-cell">
                    {isAdmin ? (
                      <PersonPicker
                        testId="line-owner"
                        label={t('lines.ownerOf', { name: n.name })}
                        value={n.ownerId ?? ''}
                        people={people}
                        onChange={(v) => void setOwner(n, v)}
                        noneLabel={t('lines.noOwner')}
                        searchLabel={t('lines.ownerSearch')}
                        emptyLabel={t('lines.ownerNoMatch')}
                        help={t('lines.ownerHelp')}
                        busy={ownerBusy === n.id}
                      />
                    ) : (
                      <span className={n.ownerName ? undefined : 'ui-help'} data-testid="line-owner-name">
                        {n.ownerId && n.ownerId === me ? t('lines.ownerYou') : n.ownerName || t('lines.noOwner')}
                      </span>
                    )}
                  </td>
                  <td className="gr-number-cell" data-label={t('numbers.colStatus')} data-testid="line-status">
                    <span className="gr-number-status">
                      {n.provider === 'sample' ? (
                        <span className="badge">{t('sample.badge')}</span>
                      ) : (
                        <span className={`badge ${n.status === 'connected' ? 'badge-ok' : n.status === 'error' ? 'badge-bad' : 'badge-warn'}`}>{t(`numberStatus.${n.status}`)}</span>
                      )}
                      {n.provider !== 'sample' && n.statusSince && (
                        <span className="ui-help gr-number-since" data-testid="line-status-since" title={longDate(n.statusSince)}>
                          {since(n.statusSince)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="gr-number-cell" data-label={t('numbers.colLastMessage')} data-testid="line-last-message">
                    {n.stats?.lastMessageAt ? (
                      <time dateTime={n.stats.lastMessageAt} title={longDate(n.stats.lastMessageAt)}>
                        {ago(n.stats.lastMessageAt)}
                      </time>
                    ) : (
                      <span className="ui-help">{t('numbers.noMessages')}</span>
                    )}
                  </td>
                  <td className="gr-number-cell num" data-label={t('numbers.colOpenChats')} data-testid="line-open-chats">
                    {n.stats?.openChats ?? 0}
                  </td>
                </tr>
                {n.canManage && (
                  <tr className="gr-number-actions-row">
                    <td colSpan={5} className="table-stack-actions">
                      <div className="gr-number-actions">
                        <MenuSelect
                          className="gr-line-color-select"
                          testId="line-color-select"
                          label={t('numbers.color')}
                          value={n.color}
                          onChange={(v) => void setColor(n, v)}
                          options={colorOptions}
                        />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAccessFor(n)} data-testid="line-access-btn">
                          {t('lines.access')}
                        </button>
                        {n.provider === 'sample' ? (
                          <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(n)}>
                            {t('sample.clear')}
                          </button>
                        ) : (
                          <>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConnecting(n)} data-testid="line-connect-btn">
                              {n.status === 'connected' ? t('numbers.status') : n.status === 'disconnected' || n.status === 'error' ? t('numbers.reconnect') : t('numbers.connect')}
                            </button>
                            {n.caps.groups && n.status === 'connected' && (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(n, 'sync')}>
                                {t('numbers.sync')}
                              </button>
                            )}
                            {(n.provider === 'managed' || n.provider === 'evolution') && n.status === 'connected' && (
                              <span className="gr-reimport" title={t('wa.reimportHelp')}>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reimport(n)}>
                                  {t('wa.reimport')}
                                </button>
                                <span className="gr-reimport-label" aria-hidden="true">
                                  {t('wa.perChat')}
                                </span>
                                <MenuSelect
                                  label={t('wa.perChat')}
                                  value={String(perChat)}
                                  onChange={(v) => setPerChat(Number(v))}
                                  options={[0, 20, 50, 100, 200].map((v) => ({ value: String(v), label: v === 0 ? t('wa.perChatAll') : String(v) }))}
                                />
                              </span>
                            )}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(n)}>
                              {t('numbers.edit')}
                            </button>
                            {n.status === 'connected' && (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDisconnecting(n)} data-testid="line-disconnect-btn">
                                {t('numbers.disconnect')}
                              </button>
                            )}
                            <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(n)}>
                              {t('common.delete')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </table>
        </div>
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
          if (isNew) {
            setFreshId(n.id);
            setConnecting(n);
          } else showToast(t('common.saved'));
        }}
      />
      <LineAccess
        isOwner={Boolean(accessFor?.ownerId) && accessFor?.ownerId === me}
        number={accessFor}
        people={people}
        teams={teams}
        onClose={() => setAccessFor(null)}
        onSaved={(n) => {
          setNumbers((list) => list.map((x) => (x.id === n.id ? { ...x, ...n } : x)));
          setAccessFor(null);
          showToast(t('common.saved'));
          router.refresh();
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
  const [config, setConfig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setProvider(editing?.provider ?? (providers.includes('managed') ? 'managed' : providers.includes('waha') ? 'waha' : providers[0]));
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

  // Mientras espera el escaneo, consulta el estado (y el QR nuevo) cada 2 s; con la pestaña oculta
  // no consulta y, al volver, consulta en el acto. Ya conectado (o con error), deja de consultar.
  const waiting = !!number && !!state && state.status !== 'connected' && state.status !== 'error';
  useEffect(() => {
    if (!waiting || !number) return;
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      const r = await api<ConnectState>(`/api/groups/numbers/${number.id}/connect`);
      if (!alive) return;
      if (r.data) setState(r.data);
      setNow(Date.now());
    };
    const id = setInterval(poll, 2000);
    const onVisible = () => void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [number, waiting]);

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
                router.push('/app/lines/inbox');
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
