'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { AccountDto, NetworkStatus } from '@/lib/social';
import type { Slot } from '@/lib/social-schedule';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { api, fmtNum, initial, NetworkTag, StatusTag, useErrorText, useToast } from './shared';

interface Person {
  id: string;
  name: string;
  socialRole: string;
}

function SlotsEditor({ account }: { account: AccountDto }) {
  const t = useTranslations('social.accounts');
  const locale = useLocale();
  const errorText = useErrorText();
  const [toast, showToast] = useToast();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const weekday = (d: number) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + d)));
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  async function load() {
    try {
      setSlots((await api<{ slots: Slot[] }>(`/accounts/${account.id}/slots`)).slots);
    } catch (err) {
      showToast(errorText(err), true);
    }
  }

  async function save(next: Slot[]) {
    setBusy(true);
    try {
      setSlots((await api<{ slots: Slot[] }>(`/accounts/${account.id}/slots`, { method: 'PUT', json: { slots: next } })).slots);
      showToast(t('slotsSaved'));
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && slots === null) void load();
      }}
    >
      <summary>{t('queueTimes')}</summary>
      {slots === null ? (
        <p className="sc-muted">{t('loading')}</p>
      ) : (
        <div className="sc-slots">
          {slots.length === 0 && <p className="sc-muted sc-small">{t('noSlots')}</p>}
          {slots.map((s, i) => (
            <div key={`${s.weekday}-${s.minute}`} className="sc-row">
              <span className="sc-grow">
                {weekday(s.weekday)} {hhmm(s.minute)} <span className="sc-muted sc-small">{s.tz}</span>
              </span>
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void save(slots.filter((_, j) => j !== i))}>
                {t('remove')}
              </button>
            </div>
          ))}
          <form
            className="sc-row"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const [h, m] = String(f.get('time') || '09:00').split(':').map(Number);
              void save([...slots, { weekday: Number(f.get('weekday')), minute: h * 60 + m, tz }]);
            }}
          >
            <select className="select" name="weekday" aria-label={t('weekday')} defaultValue="1">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {weekday(d)}
                </option>
              ))}
            </select>
            <input className="input" type="time" name="time" defaultValue="09:00" aria-label={t('time')} />
            <button type="submit" className="btn btn-sm" disabled={busy} data-testid="slot-add">
              {t('addSlot')}
            </button>
          </form>
        </div>
      )}
      {toast}
    </details>
  );
}

/**
 * Cuentas conectadas y redes para conectar. Los admins conectan (OAuth o
 * contraseña de app en Bluesky), eligen quién publica en cada cuenta y
 * desconectan; una cuenta vencida pide reconectar. Las redes sin app de
 * desarrollador dicen qué tiene que cargar el admin de la instancia.
 */
export default function AccountsView({
  accounts,
  networks,
  people,
  admin,
  flash,
}: {
  accounts: AccountDto[];
  networks: NetworkStatus[];
  people: Person[];
  admin: boolean;
  flash: { connected?: string; count?: string; error?: string };
}) {
  const t = useTranslations('social.accounts');
  const tErr = useTranslations('social.errors');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [bsky, setBsky] = useState({ identifier: '', password: '' });
  const [confirm, setConfirm] = useState<AccountDto | null>(null);

  async function connect(network: string) {
    setBusy(network);
    try {
      const { url } = await api<{ url: string }>('/connect', { method: 'POST', json: { network } });
      window.location.assign(url);
    } catch (err) {
      showToast(errorText(err), true);
      setBusy(null);
    }
  }

  async function connectBluesky() {
    setBusy('bluesky');
    try {
      await api('/bluesky', { method: 'POST', json: bsky });
      setBsky({ identifier: '', password: '' });
      showToast(t('connected', { network: 'Bluesky', count: 1 }));
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  async function setMembers(account: AccountDto, ids: string[]) {
    try {
      await api(`/accounts/${account.id}`, { method: 'PATCH', json: { memberIds: ids } });
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    }
  }

  async function disconnect(account: AccountDto) {
    setBusy(`del${account.id}`);
    try {
      await api(`/accounts/${account.id}`, { method: 'DELETE' });
      setConfirm(null);
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  const members = people.filter((p) => p.socialRole !== 'admin');

  return (
    <div className="sc-page">
      {flash.connected && (
        <p className="sc-panel sc-ok" role="status" data-testid="connected-flash">
          {t('connected', { network: networks.find((n) => n.network === flash.connected)?.name ?? flash.connected, count: Number(flash.count ?? 1) })}
        </p>
      )}
      {flash.error && (
        <p className="sc-error" role="alert">
          {tErr.has(flash.error) ? tErr(flash.error) : tErr('oauth_failed')}
        </p>
      )}

      <section aria-labelledby="sc-acc-title" className="sc-page">
        <h2 id="sc-acc-title">{t('connectedTitle')}</h2>
        {accounts.length === 0 ? (
          <div className="ui-empty">
            <p className="ui-empty-title">{t('emptyTitle')}</p>
            <p className="ui-empty-body">{admin ? t('emptyBodyAdmin') : t('emptyBodyMember')}</p>
          </div>
        ) : (
          <div className="sc-list" data-testid="accounts-list">
            {accounts.map((a) => (
              <div key={a.id} className="sc-item" data-testid="account-row">
                <span className="sc-avatar" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.avatarUrl ? <img src={a.avatarUrl} alt="" /> : initial(a.name)}
                </span>
                <div className="sc-item-main">
                  <div className="sc-row">
                    <strong>{a.name}</strong>
                    {a.handle && <span className="sc-muted">@{a.handle.replace(/^@/, '')}</span>}
                  </div>
                  <div className="sc-row">
                    <NetworkTag network={a.network} name={a.networkName} />
                    <span className="sc-muted sc-small">{t(`kind_${a.kind}`)}</span>
                    {a.followers != null && <span className="sc-muted sc-small">{t('followers', { n: fmtNum(a.followers, locale) })}</span>}
                  </div>
                  {a.status !== 'connected' && (
                    <p className="sc-error sc-small">
                      {t('needsReconnect')}
                      {a.statusError ? `: ${a.statusError}` : ''}
                    </p>
                  )}
                  {admin && (
                    <details>
                      <summary>{t('whoPosts', { n: a.memberIds?.length ?? 0 })}</summary>
                      <p className="sc-muted sc-small">{t('adminsAlways')}</p>
                      <div className="sc-checks">
                        {members.length === 0 && <span className="sc-muted sc-small">{t('noMembers')}</span>}
                        {members.map((p) => (
                          <label key={p.id} className="ui-check">
                            <input
                              type="checkbox"
                              checked={a.memberIds?.includes(p.id) ?? false}
                              onChange={(e) => void setMembers(a, e.target.checked ? [...(a.memberIds ?? []), p.id] : (a.memberIds ?? []).filter((x) => x !== p.id))}
                            />
                            <span>{p.name}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                  <SlotsEditor account={a} />
                </div>
                <div className="sc-item-side">
                  <StatusTag status={a.status === 'connected' ? 'connected' : 'expired'} />
                  {admin && a.status !== 'connected' && a.network !== 'bluesky' && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => void connect(a.network)} aria-busy={busy === a.network}>
                      {t('reconnect')}
                    </button>
                  )}
                  {admin && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(a)}>
                      {t('disconnect')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {admin && (
        <section aria-labelledby="sc-net-title" className="sc-page">
          <h2 id="sc-net-title">{t('connectTitle')}</h2>
          <div className="sc-networks">
            {networks.map((n) => (
              <div key={n.network} className="sc-network" data-testid={`network-${n.network}`}>
                <NetworkTag network={n.network} name={n.name} />
                {n.method === 'app_password' ? (
                  <form
                    className="sc-checks"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void connectBluesky();
                    }}
                  >
                    <input className="input" placeholder={t('bskyHandle')} aria-label={t('bskyHandle')} value={bsky.identifier} onChange={(e) => setBsky({ ...bsky, identifier: e.target.value })} />
                    <input className="input" type="password" placeholder={t('bskyPassword')} aria-label={t('bskyPassword')} value={bsky.password} onChange={(e) => setBsky({ ...bsky, password: e.target.value })} autoComplete="off" />
                    <span className="sc-muted sc-small">{t('bskyHint')}</span>
                    <button type="submit" className="btn btn-sm" disabled={!bsky.identifier || !bsky.password || busy === 'bluesky'} aria-busy={busy === 'bluesky'}>
                      {t('connect')}
                    </button>
                  </form>
                ) : n.configured ? (
                  <button type="button" className="btn btn-sm" onClick={() => void connect(n.network)} aria-busy={busy === n.network} disabled={Boolean(busy)} data-testid={`connect-${n.network}`}>
                    {t('connect')}
                  </button>
                ) : (
                  <>
                    <span className="sc-muted sc-small">{t('notConfigured')}</span>
                    <code>{n.env.join(', ')}</code>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={t('disconnectTitle', { name: confirm?.name ?? '' })}
        body={t('disconnectBody')}
        confirmLabel={t('disconnect')}
        cancelLabel={t('cancel')}
        danger
        busy={busy === `del${confirm?.id}`}
        onConfirm={() => confirm && void disconnect(confirm)}
        onCancel={() => setConfirm(null)}
      />
      {toast}
    </div>
  );
}
