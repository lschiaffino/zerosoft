'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkCommandDto } from '@/lib/talk-commands';
import type { TalkGuestDto, TalkGuestInviteDto } from '@/lib/talk-guests';
import type { TalkProfileDto, TalkProfileField } from '@/lib/talk-profile';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { errorText } from './Composer';
import { Modal } from './Dialogs';
import { fmtFull } from './Message';
import { Avatar } from './MessageBody';
import { useTalk } from './talk-context';

function localTime(tz: string, locale: string): string | null {
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(new Date());
  } catch {
    return null;
  }
}

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

/** Tarjeta de perfil (como el perfil de Slack): cargo, hora local, estado, campos del workspace y "Mensaje". */
export function ProfileDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const person = ctx.people.get(userId);
  const profile = ctx.boot.profiles?.find((p) => p.userId === userId);
  const presence = ctx.presence.get(userId);
  const me = userId === ctx.boot.me;
  const time = profile?.timezone ? localTime(profile.timezone, ctx.locale) : null;
  return (
    <Modal
      title={person?.name ?? t('common.someone')}
      onClose={onClose}
      foot={
        <>
          {me ? (
            <button type="button" className="btn btn-sm" onClick={() => ctx.dialog({ kind: 'edit-profile' })} data-testid="talk-edit-profile">
              {t('profile.edit')}
            </button>
          ) : null}
          <a
            className="btn btn-primary btn-sm"
            href={`/${ctx.locale}/app/talk?dm=${encodeURIComponent(userId)}`}
            onClick={(e) => {
              e.preventDefault();
              void ctx
                .api<{ id: string }>('/api/talk/dms', { method: 'POST', json: { userIds: me ? [] : [userId] } })
                .then((c) => {
                  ctx.refreshBoot();
                  ctx.dialog(null);
                  ctx.open({ channelId: c.id });
                })
                .catch((err) => ctx.toast(errorText(t, err), 'error'));
            }}
          >
            {t('profile.message')}
          </a>
        </>
      }
    >
      <div className="talk-profile" data-testid="talk-profile">
        <Avatar id={userId} size={72} presence />
        <div className="talk-profile-main">
          <p className="talk-profile-name">
            {person?.name}
            {profile?.pronouns ? <span className="talk-muted"> ({profile.pronouns})</span> : null}
            {person?.guest ? <span className="badge badge-outline">{t('guests.badge')}</span> : null}
          </p>
          {profile?.title && <p className="talk-profile-title">{profile.title}</p>}
          <p className="talk-muted">
            {presence?.active ? t('status.active') : t('status.away')}
            {presence?.dndUntil || presence?.snoozed ? ` · ${t('status.dnd')}` : ''}
            {presence?.statusEmoji || presence?.statusText ? ` · ${presence.statusEmoji} ${presence.statusText}` : ''}
          </p>
        </div>
      </div>
      <dl className="talk-profile-fields">
        {time && (
          <>
            <dt>{t('profile.localTime')}</dt>
            <dd>
              {time} <span className="talk-muted">({profile!.timezone})</span>
            </dd>
          </>
        )}
        {person?.email && (
          <>
            <dt>{t('profile.emailLabel')}</dt>
            <dd>
              <a href={`mailto:${person.email}`}>{person.email}</a>
            </dd>
          </>
        )}
        {profile?.phone && (
          <>
            <dt>{t('profile.phone')}</dt>
            <dd>{profile.phone}</dd>
          </>
        )}
        {(ctx.boot.profileFields ?? []).map((f) =>
          profile?.fields[f.id] ? (
            <div key={f.id} className="talk-profile-pair">
              <dt>{f.label}</dt>
              <dd>{profile.fields[f.id]}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </Modal>
  );
}

export function EditProfileDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const cur = ctx.boot.profiles?.find((p) => p.userId === ctx.boot.me);
  const guessTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return '';
    }
  }, []);
  const [form, setForm] = useState<Omit<TalkProfileDto, 'userId'>>({
    title: cur?.title ?? '',
    pronouns: cur?.pronouns ?? '',
    phone: cur?.phone ?? '',
    timezone: cur?.timezone || guessTz || '',
    fields: { ...(cur?.fields ?? {}) },
  });
  const zones = useMemo(() => timeZones(), []);
  async function save() {
    try {
      await ctx.api('/api/talk/profile', { method: 'PATCH', json: form });
      ctx.refreshBoot();
      ctx.toast(t('dialogs.saved'));
      onClose();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <Modal
      title={t('profile.editTitle')}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
          {t('common.save')}
        </button>
      }
    >
      <form
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('profile.title')}</span>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={100} placeholder={t('profile.titlePh')} autoFocus />
        </label>
        <label className="ui-field">
          <span className="label">{t('profile.pronouns')}</span>
          <input className="input" value={form.pronouns} onChange={(e) => setForm({ ...form, pronouns: e.target.value })} maxLength={40} />
        </label>
        <label className="ui-field">
          <span className="label">{t('profile.phone')}</span>
          <input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={32} />
        </label>
        <label className="ui-field">
          <span className="label">{t('profile.timezone')}</span>
          {zones.length ? (
            <select className="select" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              <option value="">{t('profile.noTimezone')}</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="America/Argentina/Buenos_Aires" />
          )}
          <span className="ui-help">{t('profile.timezoneHelp')}</span>
        </label>
        {(ctx.boot.profileFields ?? []).map((f) => (
          <label key={f.id} className="ui-field">
            <span className="label">{f.label}</span>
            <input className="input" value={form.fields[f.id] ?? ''} onChange={(e) => setForm({ ...form, fields: { ...form.fields, [f.id]: e.target.value } })} maxLength={200} />
          </label>
        ))}
      </form>
    </Modal>
  );
}

export function SectionDialog({ sectionId, channelId, name: initial, onClose }: { sectionId?: string; channelId?: string; name?: string; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [name, setName] = useState(initial ?? '');
  async function save() {
    if (!name.trim()) return;
    try {
      await ctx.api('/api/talk/sections', { method: 'POST', json: sectionId ? { action: 'update', id: sectionId, name } : { action: 'create', name, channelId } });
      ctx.refreshBoot();
      onClose();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <Modal
      title={sectionId ? t('sections.renameTitle') : t('sections.newTitle')}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-primary btn-sm" disabled={!name.trim()} onClick={() => void save()}>
          {sectionId ? t('common.save') : t('sections.create')}
        </button>
      }
    >
      <form
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('sections.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus placeholder={t('sections.namePh')} />
          <span className="ui-help">{t('sections.help')}</span>
        </label>
      </form>
    </Modal>
  );
}

/** Invitar a alguien de afuera a uno o más canales (admins). */
export function InviteGuestDialog({ channelId, onClose, onDone }: { channelId?: string; onClose: () => void; onDone?: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<string[]>(channelId ? [channelId] : []);
  const [busy, setBusy] = useState(false);
  const chans = ctx.channels.filter((c) => (c.kind === 'public' || c.kind === 'private') && !c.archived);
  async function send() {
    setBusy(true);
    try {
      const res = await ctx.api<{ kind: 'added' | 'invited'; emailed?: boolean }>('/api/talk/guests', { method: 'POST', json: { email, channelIds: picked, locale: ctx.locale } });
      ctx.toast(res.kind === 'added' ? t('guests.added') : res.emailed ? t('guests.invited', { email }) : t('guests.invitedNoEmail'));
      onDone?.();
      onClose();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('guests.inviteTitle')}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !email.includes('@') || !picked.length} onClick={() => void send()}>
          {t('guests.send')}
        </button>
      }
    >
      <form
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <p className="talk-muted">{t('guests.inviteHelp')}</p>
        <label className="ui-field">
          <span className="label">{t('guests.emailLabel')}</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus maxLength={254} placeholder="name@company.com" />
        </label>
        <fieldset className="ui-field">
          <legend className="label">{t('guests.channels')}</legend>
          <ul className="talk-picker-list">
            {chans.map((c) => (
              <li key={c.id}>
                <label className="talk-picker-item">
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                  <span>
                    {c.kind === 'private' ? '🔒' : '#'}
                    {c.name}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </form>
    </Modal>
  );
}

type AdminTab = 'guests' | 'apps' | 'fields' | 'data';

/** Ajustes del workspace en Talk (admins): invitados, apps (slash commands), campos de perfil, retención y export. */
export function AdminDialog({ initialTab, onClose }: { initialTab?: AdminTab; onClose: () => void }) {
  const t = useTranslations('talk');
  const [tab, setTab] = useState<AdminTab>(initialTab ?? 'guests');
  return (
    <Modal title={t('admin.title')} onClose={onClose} wide>
      <div className="talk-tabs is-inline" role="tablist" aria-label={t('admin.title')}>
        {(['guests', 'apps', 'fields', 'data'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="talk-tab" onClick={() => setTab(k)}>
            {t(`admin.tab_${k}`)}
          </button>
        ))}
      </div>
      {tab === 'guests' && <GuestsAdmin />}
      {tab === 'apps' && <AppsAdmin />}
      {tab === 'fields' && <FieldsAdmin />}
      {tab === 'data' && <DataAdmin />}
    </Modal>
  );
}

function GuestsAdmin() {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [data, setData] = useState<{ guests: TalkGuestDto[]; invites: TalkGuestInviteDto[] } | null>(null);
  const [error, setError] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TalkGuestDto | null>(null);
  const load = () =>
    ctx
      .api<{ guests: TalkGuestDto[]; invites: TalkGuestInviteDto[] }>('/api/talk/guests')
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch(() => setError(true));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => {
    const c = ctx.channelById.get(id);
    return c ? `#${c.name}` : t('guests.hiddenChannel');
  };
  return (
    <div className="ui-fields talk-admin-pane">
      <p className="talk-muted">{t('guests.adminHelp')}</p>
      <div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setInviting(true)} data-testid="talk-invite-guest">
          {t('guests.invite')}
        </button>
      </div>
      {error ? (
        <p className="ui-help" role="alert">
          {t('errors.loadView')}
        </p>
      ) : !data ? (
        <p className="talk-muted">{t('common.loading')}</p>
      ) : data.guests.length === 0 && data.invites.length === 0 ? (
        <p className="talk-muted">{t('guests.none')}</p>
      ) : (
        <ul className="talk-admin-list">
          {data.guests.map((g) => (
            <li key={g.userId} className="talk-admin-row">
              <Avatar id={g.userId} size={24} />
              <span className="talk-admin-main">
                <span>{g.name}</span>
                <span className="talk-muted">
                  {g.email} · {g.channelIds.length ? g.channelIds.map(name).join(', ') : t('guests.noChannels')}
                </span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(g)}>
                {t('guests.remove')}
              </button>
            </li>
          ))}
          {data.invites.map((i) => (
            <li key={i.id} className="talk-admin-row">
              <span className="talk-admin-main">
                <span>{i.email}</span>
                <span className="talk-muted">
                  {t('guests.pending', { when: fmtFull(i.expiresAt, ctx.locale) })} · {i.channelIds.map(name).join(', ')}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  void ctx
                    .api(`/api/talk/guests?inviteId=${encodeURIComponent(i.id)}`, { method: 'DELETE' })
                    .then(load)
                    .catch((err) => ctx.toast(errorText(t, err), 'error'))
                }
              >
                {t('guests.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {inviting && <InviteGuestDialog onClose={() => setInviting(false)} onDone={() => void load()} />}
      {removing && (
        <ConfirmDialog
          open
          danger
          title={t('guests.removeTitle', { name: removing.name })}
          body={t('guests.removeBody')}
          confirmLabel={t('guests.remove')}
          cancelLabel={t('common.cancel')}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const g = removing;
            setRemoving(null);
            void ctx
              .api(`/api/talk/guests?userId=${encodeURIComponent(g.userId)}`, { method: 'DELETE' })
              .then(() => {
                ctx.toast(t('guests.removed'));
                ctx.refreshBoot();
                return load();
              })
              .catch((err) => ctx.toast(errorText(t, err), 'error'));
          }}
        />
      )}
    </div>
  );
}

function AppsAdmin() {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [list, setList] = useState<TalkCommandDto[] | null>(null);
  const [form, setForm] = useState({ command: '', url: '', description: '', usageHint: '' });
  const [secret, setSecret] = useState<{ command: string; secret: string } | null>(null);
  const load = () =>
    ctx
      .api<{ commands: TalkCommandDto[] }>('/api/talk/commands')
      .then((r) => setList(r.commands))
      .catch(() => setList([]));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function create() {
    try {
      const r = await ctx.api<{ command: TalkCommandDto; secret: string }>('/api/talk/commands', { method: 'POST', json: form });
      setSecret({ command: r.command.command, secret: r.secret });
      setForm({ command: '', url: '', description: '', usageHint: '' });
      ctx.refreshBoot();
      void load();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <div className="ui-fields talk-admin-pane">
      <p className="talk-muted">{t('commands.help')}</p>
      {secret && (
        <div className="talk-secret" role="status">
          <p>{t('commands.secretOnce', { command: secret.command })}</p>
          <code className="talk-secret-value" data-testid="talk-command-secret">
            {secret.secret}
          </code>
        </div>
      )}
      {list === null ? (
        <p className="talk-muted">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="talk-muted">{t('commands.none')}</p>
      ) : (
        <ul className="talk-admin-list">
          {list.map((c) => (
            <li key={c.id} className="talk-admin-row">
              <span className="talk-admin-main">
                <span>
                  <code>{c.command}</code> {c.usageHint && <span className="talk-muted">{c.usageHint}</span>}
                </span>
                <span className="talk-muted">
                  {c.description} {c.url ? `· ${c.url}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  void ctx
                    .api(`/api/talk/commands?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
                    .then(() => {
                      ctx.refreshBoot();
                      return load();
                    })
                    .catch((err) => ctx.toast(errorText(t, err), 'error'))
                }
              >
                {t('commands.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="talk-admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h3 className="label">{t('commands.add')}</h3>
        <div className="talk-admin-grid">
          <label className="ui-field">
            <span className="label">{t('commands.command')}</span>
            <input className="input" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="/deploy" maxLength={33} required />
          </label>
          <label className="ui-field">
            <span className="label">{t('commands.url')}</span>
            <input className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" required />
          </label>
          <label className="ui-field">
            <span className="label">{t('commands.description')}</span>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} />
          </label>
          <label className="ui-field">
            <span className="label">{t('commands.usage')}</span>
            <input className="input" value={form.usageHint} onChange={(e) => setForm({ ...form, usageHint: e.target.value })} maxLength={100} placeholder="[env]" />
          </label>
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!form.command || !form.url}>
          {t('commands.create')}
        </button>
      </form>
    </div>
  );
}

function FieldsAdmin() {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [fields, setFields] = useState<Array<{ id?: string; label: string }>>((ctx.boot.profileFields ?? []).map((f: TalkProfileField) => ({ id: f.id, label: f.label })));
  async function save() {
    try {
      await ctx.api('/api/talk/profile', { method: 'PUT', json: { fields: fields.filter((f) => f.label.trim()) } });
      ctx.refreshBoot();
      ctx.toast(t('dialogs.saved'));
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <div className="ui-fields talk-admin-pane">
      <p className="talk-muted">{t('profile.fieldsHelp')}</p>
      <ul className="talk-fields-edit">
        {fields.map((f, i) => (
          <li key={f.id ?? `new-${i}`} className="talk-fields-row">
            <input className="input" value={f.label} maxLength={60} aria-label={t('profile.fieldLabel')} onChange={(e) => setFields((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <button type="button" className="btn btn-ghost btn-sm" aria-label={t('profile.removeField', { name: f.label || '…' })} onClick={() => setFields((p) => p.filter((_, j) => j !== i))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="talk-details-actions">
        <button type="button" className="btn btn-sm" disabled={fields.length >= 12} onClick={() => setFields((p) => [...p, { label: '' }])}>
          {t('profile.addField')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

function DataAdmin() {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [settings, setSettings] = useState<{ retentionDays: number | null; editWindowMinutes: number | null } | null>(null);
  const [turn, setTurn] = useState<boolean | null>(null);
  useEffect(() => {
    void ctx
      .api<{ settings: { retentionDays: number | null; editWindowMinutes: number | null }; turn: boolean }>('/api/talk/admin')
      .then((r) => {
        setSettings(r.settings);
        setTurn(r.turn);
      })
      .catch(() => setSettings({ retentionDays: null, editWindowMinutes: null }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!settings) return;
    try {
      await ctx.api('/api/talk/admin', { method: 'PATCH', json: settings });
      ctx.toast(t('dialogs.saved'));
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  if (!settings) return <p className="talk-muted">{t('common.loading')}</p>;
  return (
    <div className="ui-fields talk-admin-pane">
      <label className="ui-field">
        <span className="label">{t('admin.retention')}</span>
        <select
          className="select"
          value={settings.retentionDays === null ? '' : String(settings.retentionDays)}
          onChange={(e) => setSettings({ ...settings, retentionDays: e.target.value ? Number(e.target.value) : null })}
          data-testid="talk-retention"
        >
          <option value="">{t('admin.retentionForever')}</option>
          {[7, 30, 90, 180, 365, 730].map((d) => (
            <option key={d} value={d}>
              {t('admin.retentionDays', { count: d })}
            </option>
          ))}
        </select>
        <span className="ui-help">{t('admin.retentionHelp')}</span>
      </label>
      <label className="ui-field">
        <span className="label">{t('admin.editWindow')}</span>
        <select className="select" value={settings.editWindowMinutes === null ? '' : String(settings.editWindowMinutes)} onChange={(e) => setSettings({ ...settings, editWindowMinutes: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t('admin.editAlways')}</option>
          {[1, 5, 15, 60, 1440, 10080].map((m) => (
            <option key={m} value={m}>
              {t('admin.editMinutes', { count: m })}
            </option>
          ))}
        </select>
      </label>
      <div className="talk-details-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
      <h3 className="label">{t('admin.export')}</h3>
      <p className="talk-muted">{t('admin.exportHelp')}</p>
      <div className="talk-details-actions">
        <a className="btn btn-sm" href="/api/talk/export?scope=public" download data-testid="talk-export-public">
          {t('admin.exportPublic')}
        </a>
        <a className="btn btn-sm" href="/api/talk/export?scope=mine" download>
          {t('admin.exportMine')}
        </a>
      </div>
      <h3 className="label">{t('admin.huddles')}</h3>
      <p className="talk-muted">{turn ? t('admin.turnOn') : t('admin.turnOff')}</p>
    </div>
  );
}
