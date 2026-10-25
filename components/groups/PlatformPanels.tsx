'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { GroupsPerson, LabelDto } from '@/lib/groups';
import type { PlatformSettings } from '@/lib/groups-access';
import type { AuditEntry } from '@/lib/groups-audit';
import type { IntegrationDto, IntegrationKind } from '@/lib/groups-integrations';
import type { WebhookDto } from '@/lib/webhooks';
import type { DeliveryDto } from '@/lib/webhooks';
import { INSTALL_EVENT } from './GroupsPwa';
import { LabelTag, Modal, api, useErrorText, useToast } from './ui';

// ======================================================================
// Acceso por etiqueta y teléfonos ocultos
// ======================================================================

export function AccessPanel({
  initial,
  access: initialAccess,
  labels,
  people,
  canEdit,
}: {
  initial: PlatformSettings;
  access: Record<string, string[]>;
  labels: LabelDto[];
  people: GroupsPerson[];
  canEdit: boolean;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [s, setS] = useState(initial);
  const [access, setAccess] = useState(initialAccess);
  const [editing, setEditing] = useState<LabelDto | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function save(patch: Partial<PlatformSettings>) {
    const prev = s;
    setS({ ...s, ...patch });
    const res = await api<{ settings: PlatformSettings }>('/api/groups/access', { method: 'PATCH', body: patch });
    if (!res.data) {
      setS(prev);
      return showToast(errText(res.error), true);
    }
    setS(res.data.settings);
    showToast(t('common.saved'));
  }

  async function saveGrants() {
    if (!editing) return;
    setBusy(true);
    const res = await api<{ personIds: string[] }>('/api/groups/access', { method: 'PUT', body: { labelId: editing.id, personIds: [...picked] } });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    setAccess((a) => ({ ...a, [editing.id]: res.data!.personIds }));
    setEditing(null);
  }

  const nameOf = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p ? p.name || p.email : id.slice(0, 8);
  };
  const toggleMask = (role: 'member' | 'admin', on: boolean) =>
    void save({ maskRoles: on ? [...new Set([...s.maskRoles, role])] : s.maskRoles.filter((r) => r !== role) });

  return (
    <div className="ui-fields">
      <section className="gr-detail-section" aria-labelledby="gr-access-labels">
        <h2 className="gr-detail-title" id="gr-access-labels">
          {t('access.labelsTitle')}
        </h2>
        <p className="ui-help">{t('access.labelsIntro')}</p>
        <label className="gr-check-label">
          <input type="checkbox" className="ui-check" checked={s.labelAccess} disabled={!canEdit} onChange={(e) => void save({ labelAccess: e.target.checked })} />
          {t('access.labelAccess')}
        </label>
        {labels.length === 0 ? (
          <p className="ui-help">
            {t('access.noLabels')} <Link href="/app/groups/settings?tab=labels">{t('settings.tabs.labels')}</Link>
          </p>
        ) : (
          <ul className="gr-mini-list" aria-label={t('access.labelsTitle')}>
            {labels.map((l) => {
              const ids = access[l.id] ?? [];
              return (
                <li key={l.id}>
                  <span>
                    <LabelTag name={l.name} color={l.color} />{' '}
                    <span className="ui-help">{ids.length ? ids.map(nameOf).join(', ') : t('access.nobody')}</span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setEditing(l);
                        setPicked(new Set(ids));
                      }}
                    >
                      {t('access.choose')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="ui-help">{t('access.labelsNote')}</p>
      </section>

      <section className="gr-detail-section" aria-labelledby="gr-access-mask">
        <h2 className="gr-detail-title" id="gr-access-mask">
          {t('access.maskTitle')}
        </h2>
        <p className="ui-help">{t('access.maskIntro')}</p>
        {(['member', 'admin'] as const).map((role) => (
          <label key={role} className="gr-check-label">
            <input type="checkbox" className="ui-check" checked={s.maskRoles.includes(role)} disabled={!canEdit} onChange={(e) => toggleMask(role, e.target.checked)} />
            {t(`access.mask_${role}`)}
          </label>
        ))}
        <p className="ui-help">{t('access.maskNote')}</p>
      </section>

      <Modal
        open={!!editing}
        title={t('access.chooseTitle', { name: editing?.name ?? '' })}
        onClose={() => setEditing(null)}
        onSubmit={() => void saveGrants()}
        busy={busy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
              {t('common.save')}
            </button>
          </>
        }
      >
        <ul className="gr-pick-list">
          {people.map((p) => (
            <li key={p.id}>
              <label className="gr-check-label">
                <input
                  type="checkbox"
                  className="ui-check"
                  checked={picked.has(p.id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                />
                <span className="gr-pick-name">{p.name || p.email}</span>
              </label>
            </li>
          ))}
        </ul>
      </Modal>
      {toast}
    </div>
  );
}

// ======================================================================
// Log de auditoría (del chat o del workspace)
// ======================================================================

const AUDIT_FILTERS = ['', 'assigned', 'unassigned', 'closed', 'reopened', 'labels', 'renamed', 'deleted', 'exported', 'members', 'ticket_created', 'ticket_updated', 'ticket_deleted'];

export function AuditLog({ chatId, people, compact = false }: { chatId?: string; people: GroupsPerson[]; compact?: boolean }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (chatId) q.set('chat', chatId);
    if (action) q.set('action', action);
    if (actor) q.set('actor', actor);
    q.set('limit', compact ? '30' : '200');
    const res = await api<{ entries: AuditEntry[] }>(`/api/groups/audit?${q.toString()}`);
    if (res.data) {
      setEntries(res.data.entries);
      setError('');
    } else setError(errText(res.error));
  }, [chatId, action, actor, compact, errText]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (id: string | null, kind: string) => {
    if (kind === 'api') return 'API';
    if (kind === 'mcp') return 'MCP';
    if (kind === 'flow') return 'Flow';
    if (!id) return t('audit.system');
    const p = people.find((x) => x.id === id);
    return p ? p.name || p.email : id.slice(0, 8);
  };
  const describe = (e: AuditEntry) => {
    const d = e.detail as Record<string, unknown>;
    const v = {
      to: d.to ? nameOf(String(d.to), 'person') : '',
      added: Array.isArray(d.added) ? (d.added as string[]).join(', ') : '',
      removed: Array.isArray(d.removed) ? (d.removed as string[]).join(', ') : '',
      name: String(d.to ?? ''),
      n: String(d.number ?? ''),
      type: String(d.type ?? ''),
      count: String(d.count ?? ''),
      action: d.action ? t(`audit.memberActions.${String(d.action)}`) : '',
      status: d.status ? t(`ticketStatus.${String(d.status)}`) : '',
    };
    return t(`audit.actions.${e.action}`, v);
  };

  return (
    <div className="ui-fields gr-audit">
      <div className="gr-inline-form">
        <select className="select" value={action} onChange={(e) => setAction(e.target.value)} aria-label={t('audit.filterAction')}>
          {AUDIT_FILTERS.map((a) => (
            <option key={a} value={a}>
              {a ? t(`audit.filter.${a}`) : t('audit.allActions')}
            </option>
          ))}
        </select>
        <select className="select" value={actor} onChange={(e) => setActor(e.target.value)} aria-label={t('audit.filterActor')}>
          <option value="">{t('audit.everyone')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.email}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="ui-error" role="alert">
          {error}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            {t('audit.retry')}
          </button>
        </p>
      ) : entries === null ? (
        <p className="ui-help" aria-busy="true">
          {t('audit.loading')}
        </p>
      ) : entries.length === 0 ? (
        <p className="ui-help">{action || actor ? t('audit.emptyFiltered') : t('audit.empty')}</p>
      ) : (
        <ol className="gr-audit-list" aria-label={t('audit.title')}>
          {entries.map((e) => (
            <li key={e.id}>
              <span>
                <strong>{nameOf(e.actorId, e.actorKind)}</strong> {describe(e)}
                {!chatId && e.chatName && (
                  <>
                    {' · '}
                    {e.chatId && e.action !== 'deleted' ? <Link href={`/app/groups/inbox/${e.chatId}`}>{e.chatName}</Link> : e.chatName}
                  </>
                )}
              </span>
              <time className="ui-help" dateTime={e.createdAt}>
                {new Date(e.createdAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ======================================================================
// Integraciones: webhooks, Slack, Freshdesk, Zoho Desk, Zapier y MCP
// ======================================================================

const eventKey = (e: string) => e.replace(/\./g, '_');

function WebhooksSection({ events, canEdit }: { events: string[]; canEdit: boolean }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [rows, setRows] = useState<WebhookDto[] | null>(null);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<string[]>(['groups.message.received', 'groups.ticket.created']);
  const [secret, setSecret] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<WebhookDto | null>(null);
  const [log, setLog] = useState<DeliveryDto[] | null>(null);
  const [removing, setRemoving] = useState<WebhookDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ webhooks: WebhookDto[] }>('/api/groups/webhooks');
    if (res.data) setRows(res.data.webhooks);
    else setError(errText(res.error));
  }, [errText]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    const res = await api<{ id: string; secret: string }>('/api/groups/webhooks', { body: { url: url.trim(), events: picked } });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    setSecret(res.data.secret);
    setUrl('');
    await load();
  }
  async function openLog(w: WebhookDto) {
    setLogFor(w);
    setLog(null);
    const res = await api<{ deliveries: DeliveryDto[] }>(`/api/groups/webhooks/${w.id}`);
    setLog(res.data?.deliveries ?? []);
  }
  async function resend(d: DeliveryDto) {
    const res = await api(`/api/groups/webhooks/deliveries/${d.id}`, { body: {} });
    if (!res.data) return showToast(errText(res.error), true);
    showToast(t('integrations.resent'));
    if (logFor) await openLog(logFor);
  }
  async function test(w: WebhookDto) {
    const res = await api(`/api/groups/webhooks/${w.id}`, { method: 'PATCH', body: { action: 'test' } });
    showToast(res.data ? t('integrations.testSent') : errText(res.error), !res.data);
    await load();
  }
  async function toggle(w: WebhookDto) {
    const res = await api(`/api/groups/webhooks/${w.id}`, { method: 'PATCH', body: { active: !w.active } });
    if (!res.data) return showToast(errText(res.error), true);
    await load();
  }
  async function remove() {
    if (!removing) return;
    const res = await api(`/api/groups/webhooks/${removing.id}`, { method: 'DELETE' });
    if (!res.data) showToast(errText(res.error), true);
    setRemoving(null);
    await load();
  }

  return (
    <section className="gr-detail-section" aria-labelledby="gr-int-webhooks">
      <h2 className="gr-detail-title" id="gr-int-webhooks">
        {t('integrations.webhooksTitle')}
      </h2>
      <p className="ui-help">{t('integrations.webhooksIntro')}</p>
      {canEdit && (
        <form
          className="ui-fields"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && picked.length) void create();
          }}
        >
          <label className="ui-field">
            <span className="label">{t('integrations.url')}</span>
            <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" required />
          </label>
          <fieldset className="ui-field">
            <legend className="label">{t('integrations.events')}</legend>
            <div className="gr-event-grid">
              {events.map((ev) => (
                <label key={ev} className="gr-check-label">
                  <input
                    type="checkbox"
                    className="ui-check"
                    checked={picked.includes(ev)}
                    onChange={() => setPicked((p) => (p.includes(ev) ? p.filter((x) => x !== ev) : [...p, ev]))}
                  />
                  {t(`integrations.event.${eventKey(ev)}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !url.trim() || picked.length === 0} aria-busy={busy || undefined}>
              {t('integrations.addWebhook')}
            </button>
          </div>
        </form>
      )}
      {secret && (
        <div className="gr-banner" role="status">
          <span>
            {t('integrations.secretOnce')} <code className="gr-mono">{secret}</code>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSecret(null)}>
            {t('common.close')}
          </button>
        </div>
      )}
      {error ? (
        <p className="ui-error">{error}</p>
      ) : rows === null ? (
        <p className="ui-help">{t('audit.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="ui-help">{t('integrations.noWebhooks')}</p>
      ) : (
        <ul className="gr-mini-list" aria-label={t('integrations.webhooksTitle')}>
          {rows.map((w) => (
            <li key={w.id}>
              <span>
                <span className="gr-mono">{w.url}</span>
                <span className="ui-help">
                  {' '}
                  · {w.events.filter((e) => e.startsWith('groups.')).length} {t('integrations.eventsCount')}
                  {!w.active && ` · ${t('integrations.paused')}`}
                  {w.lastDelivery && ` · ${t('integrations.last', { status: w.lastDelivery.status, code: String(w.lastDelivery.responseCode ?? '-') })}`}
                </span>
              </span>
              <span className="gr-inline-form">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openLog(w)}>
                  {t('integrations.log')}
                </button>
                {canEdit && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void test(w)}>
                      {t('integrations.test')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggle(w)}>
                      {w.active ? t('integrations.pause') : t('integrations.resume')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(w)}>
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!logFor}
        wide
        title={t('integrations.logTitle')}
        onClose={() => setLogFor(null)}
        foot={
          <button type="button" className="btn btn-ghost" onClick={() => setLogFor(null)}>
            {t('common.close')}
          </button>
        }
      >
        {log === null ? (
          <p className="ui-help">{t('audit.loading')}</p>
        ) : log.length === 0 ? (
          <p className="ui-help">{t('integrations.noDeliveries')}</p>
        ) : (
          <ul className="gr-mini-list">
            {log.map((d) => (
              <li key={d.id}>
                <span>
                  <strong className="gr-mono">{d.event}</strong>{' '}
                  <span className={d.status === 'failed' ? 'ui-error' : 'ui-help'}>
                    {t(`integrations.delivery.${d.status}`)} · {d.responseCode ?? '-'} · {t('integrations.attempts', { n: d.attempts })}
                    {d.lastError ? ` · ${d.lastError}` : ''}
                  </span>
                  <br />
                  <time className="ui-help" dateTime={d.createdAt}>
                    {new Date(d.createdAt).toLocaleString(locale)}
                  </time>
                  <details>
                    <summary className="ui-help">{t('integrations.payload')}</summary>
                    <pre className="gr-mono gr-payload">{d.payload}</pre>
                  </details>
                </span>
                {canEdit && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void resend(d)}>
                    {t('integrations.resend')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        open={!!removing}
        title={t('integrations.deleteWebhook')}
        body={removing?.url ?? ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast}
    </section>
  );
}

const FIELDS: Record<IntegrationKind, Array<{ key: string; secret?: boolean; type?: string; placeholder?: string }>> = {
  slack: [{ key: 'webhookUrl', secret: true, type: 'url', placeholder: 'https://hooks.slack.com/services/…' }],
  freshdesk: [{ key: 'domain', placeholder: 'acme.freshdesk.com' }, { key: 'apiKey', secret: true }, { key: 'requesterEmail', type: 'email' }],
  zoho: [
    { key: 'dc', placeholder: 'com' },
    { key: 'clientId' },
    { key: 'clientSecret', secret: true },
    { key: 'refreshToken', secret: true },
    { key: 'orgId' },
    { key: 'departmentId' },
  ],
};
const SLACK_EVENTS = ['groups.ticket.created', 'groups.ticket.updated', 'groups.message.received'];

function IntegrationCard({ kind, initial, canEdit }: { kind: IntegrationKind; initial: IntegrationDto | null; canEdit: boolean }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [row, setRow] = useState(initial);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<string[]>(initial?.events.length ? initial.events : ['groups.ticket.created']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);

  function edit() {
    const f: Record<string, string> = {};
    for (const fd of FIELDS[kind]) f[fd.key] = fd.secret ? '' : (row?.settings as Record<string, string> | undefined)?.[fd.key] ?? '';
    setForm(f);
    setError('');
    setOpen(true);
  }
  async function save() {
    setBusy(true);
    setError('');
    const res = await api<IntegrationDto>('/api/groups/integrations', { body: { kind, config: form, events, active: true } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    setRow(res.data);
    setOpen(false);
    showToast(t('common.saved'));
  }
  async function test() {
    const res = await api(`/api/groups/integrations/${kind}`, { body: {} });
    showToast(res.data ? t('integrations.testOk') : errText(res.error), !res.data);
  }
  async function remove() {
    const res = await api(`/api/groups/integrations/${kind}`, { method: 'DELETE' });
    setRemoving(false);
    if (res.data) setRow(null);
    else showToast(errText(res.error), true);
  }

  return (
    <li className="gr-integration">
      <span>
        <strong>{t(`integrations.${kind}.name`)}</strong> <span className="ui-help">{t(`integrations.${kind}.desc`)}</span>
        <br />
        <span className={row?.lastError ? 'ui-error' : 'ui-help'}>
          {row ? (row.lastError ? t('integrations.error', { code: errText(row.lastError) || row.lastError }) : t('integrations.connected')) : t('integrations.notConnected')}
        </span>
      </span>
      {canEdit && (
        <span className="gr-inline-form">
          <button type="button" className="btn btn-secondary btn-sm" onClick={edit}>
            {row ? t('integrations.edit') : t('integrations.connect')}
          </button>
          {row && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void test()}>
                {t('integrations.test')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(true)}>
                {t('integrations.disconnect')}
              </button>
            </>
          )}
        </span>
      )}
      <Modal
        open={open}
        title={t(`integrations.${kind}.name`)}
        onClose={() => setOpen(false)}
        onSubmit={() => void save()}
        busy={busy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
              {t('common.save')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          <p className="ui-help">{t(`integrations.${kind}.help`)}</p>
          {FIELDS[kind].map((fd) => (
            <label key={fd.key} className="ui-field">
              <span className="label">{t(`integrations.fields.${fd.key}`)}</span>
              {kind === 'zoho' && fd.key === 'dc' ? (
                <select className="select" value={form.dc || 'com'} onChange={(e) => setForm({ ...form, dc: e.target.value })}>
                  {['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'com.cn', 'sa'].map((d) => (
                    <option key={d} value={d}>
                      zoho.{d}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  type={fd.secret ? 'password' : fd.type ?? 'text'}
                  autoComplete="off"
                  value={form[fd.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })}
                  placeholder={fd.secret && row?.configured[fd.key] ? t('integrations.keep') : fd.placeholder}
                />
              )}
            </label>
          ))}
          {kind === 'slack' && (
            <fieldset className="ui-field">
              <legend className="label">{t('integrations.events')}</legend>
              {SLACK_EVENTS.map((ev) => (
                <label key={ev} className="gr-check-label">
                  <input
                    type="checkbox"
                    className="ui-check"
                    checked={events.includes(ev)}
                    onChange={() => setEvents((p) => (p.includes(ev) ? p.filter((x) => x !== ev) : [...p, ev]))}
                  />
                  {t(`integrations.event.${eventKey(ev)}`)}
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={removing}
        title={t('integrations.disconnectTitle', { name: t(`integrations.${kind}.name`) })}
        body={t('integrations.disconnectBody')}
        confirmLabel={t('integrations.disconnect')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
      />
      {toast}
    </li>
  );
}

export function IntegrationsPanel({
  integrations,
  events,
  canEdit,
  mcpUrl,
}: {
  integrations: IntegrationDto[];
  events: string[];
  canEdit: boolean;
  mcpUrl: string;
}) {
  const t = useTranslations('groups');
  const [toast, showToast] = useToast();
  return (
    <div className="ui-fields">
      <section className="gr-detail-section" aria-labelledby="gr-int-apps">
        <h2 className="gr-detail-title" id="gr-int-apps">
          {t('integrations.appsTitle')}
        </h2>
        <ul className="gr-mini-list">
          {(['slack', 'freshdesk', 'zoho'] as const).map((k) => (
            <IntegrationCard key={k} kind={k} initial={integrations.find((i) => i.kind === k) ?? null} canEdit={canEdit} />
          ))}
          <li className="gr-integration">
            <span>
              <strong>Zapier</strong> <span className="ui-help">{t('integrations.zapier')}</span>
            </span>
          </li>
        </ul>
      </section>
      <WebhooksSection events={events} canEdit={canEdit} />
      <section className="gr-detail-section" aria-labelledby="gr-int-mcp">
        <h2 className="gr-detail-title" id="gr-int-mcp">
          {t('integrations.mcpTitle')}
        </h2>
        <p className="ui-help">{t('integrations.mcpIntro')}</p>
        <div className="gr-inline-form">
          <input className="input gr-mono" readOnly value={mcpUrl} aria-label={t('integrations.mcpUrl')} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(mcpUrl).then(() => showToast(t('integrations.copied')));
            }}
          >
            {t('integrations.copy')}
          </button>
        </div>
        <pre className="gr-mono gr-payload">{`{
  "mcpServers": {
    "zerosoft-groups": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer zs_…" }
    }
  }
}`}</pre>
        <p className="ui-help">
          {t('integrations.mcpTools')} <Link href="/app/settings/workspace">{t('api.keys')}</Link>
        </p>
      </section>
      {toast}
    </div>
  );
}

// ======================================================================
// App mobile y de escritorio: instalar y notificaciones
// ======================================================================

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function AppsPanel() {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null | undefined>(undefined);
  const [devices, setDevices] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [support, setSupport] = useState(true);
  const [permission, setPermission] = useState<string>('default');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setCanInstall(Boolean(window.__groupsInstall));
    sync();
    window.addEventListener(INSTALL_EVENT, sync);
    setInstalled(window.matchMedia?.('(display-mode: standalone)').matches ?? false);
    setSupport('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
    if ('Notification' in window) setPermission(Notification.permission);
    void api<{ publicKey: string | null; devices: number }>('/api/groups/push').then((r) => {
      setPublicKey(r.data?.publicKey ?? null);
      setDevices(r.data?.devices ?? 0);
    });
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistration('/').then(async (reg) => setSubscribed(Boolean(await reg?.pushManager.getSubscription())));
    }
    return () => window.removeEventListener(INSTALL_EVENT, sync);
  }, []);

  async function install() {
    const p = window.__groupsInstall;
    if (!p) return;
    await p.prompt();
    const choice = await p.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') setInstalled(true);
    window.__groupsInstall = null;
    setCanInstall(false);
  }

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return showToast(t('apps.denied'), true);
      const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/groups-sw.js', { scope: '/' }));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const res = await api<{ devices: number }>('/api/groups/push', { body: { subscription: sub.toJSON() } });
      if (!res.data) return showToast(errText(res.error), true);
      setDevices(res.data.devices);
      setSubscribed(true);
      showToast(t('apps.enabled'));
    } catch {
      showToast(errText('push_failed'), true);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const res = await api<{ devices: number }>('/api/groups/push', { method: 'DELETE', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe().catch(() => null);
      if (res.data) setDevices(res.data.devices);
    }
    setSubscribed(false);
    setBusy(false);
  }

  async function test() {
    const res = await api('/api/groups/push/test', { body: { title: t('apps.testTitle'), body: t('apps.testBody') } });
    showToast(res.data ? t('apps.testSent') : errText(res.error), !res.data);
  }

  return (
    <div className="ui-fields">
      <section className="gr-detail-section" aria-labelledby="gr-apps-install">
        <h2 className="gr-detail-title" id="gr-apps-install">
          {t('apps.installTitle')}
        </h2>
        <p className="ui-help">{t('apps.installIntro')}</p>
        {installed ? (
          <p role="status">{t('apps.installed')}</p>
        ) : canInstall ? (
          <div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void install()}>
              {t('apps.install')}
            </button>
          </div>
        ) : (
          <ul className="gr-steps">
            <li>{t('apps.howDesktop')}</li>
            <li>{t('apps.howAndroid')}</li>
            <li>{t('apps.howIos')}</li>
          </ul>
        )}
      </section>
      <section className="gr-detail-section" aria-labelledby="gr-apps-push">
        <h2 className="gr-detail-title" id="gr-apps-push">
          {t('apps.pushTitle')}
        </h2>
        <p className="ui-help">{t('apps.pushIntro')}</p>
        {publicKey === undefined ? (
          <p className="ui-help">{t('audit.loading')}</p>
        ) : publicKey === null ? (
          <p className="ui-help">{t('apps.pushDisabled')}</p>
        ) : !support ? (
          <p className="ui-help">{t('apps.unsupported')}</p>
        ) : (
          <>
            <p className="ui-help" role="status">
              {subscribed ? t('apps.onHere') : permission === 'denied' ? t('apps.denied') : t('apps.offHere')} · {t('apps.devices', { n: devices })}
            </p>
            <div className="gr-inline-form">
              {subscribed ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void disable()} disabled={busy}>
                  {t('apps.disable')}
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void enable()} disabled={busy || permission === 'denied'} aria-busy={busy || undefined}>
                  {t('apps.enable')}
                </button>
              )}
              {devices > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void test()}>
                  {t('apps.test')}
                </button>
              )}
            </div>
          </>
        )}
      </section>
      {toast}
    </div>
  );
}
