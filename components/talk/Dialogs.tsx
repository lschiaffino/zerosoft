'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkChannelDto, TalkMessageDto } from '@/lib/talk';
import type { TalkHookDto } from '@/lib/talk-extras';
import { normalizeChannelName } from '@/lib/talk-markdown';
import { QUICK_REACTIONS, STATUS_PRESETS, TALK_EMOJI, emojiName, searchEmoji } from '@/lib/talk-emoji';
import { endOfToday, presetTime, remindPresets, schedulePresets } from '@/lib/talk-time';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Avatar } from './MessageBody';
import { errorText } from './Composer';
import { fmtFull } from './Message';
import { useTalk, type TalkDialog } from './talk-context';

/** <dialog class="ui-modal"> con foco atrapado; Esc y clic afuera cierran. */
export function Modal({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  const t = useTranslations('talk');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`ui-modal talk-modal${wide ? ' is-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id={titleId}>
          {title}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('common.close')} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="ui-modal-body">{children}</div>
      {foot && <div className="ui-modal-foot">{foot}</div>}
    </dialog>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TalkDialogs({ dialog }: { dialog: TalkDialog | null }) {
  const ctx = useTalk();
  if (!dialog) return null;
  const close = () => ctx.dialog(null);
  switch (dialog.kind) {
    case 'create-channel':
      return <CreateChannel onClose={close} />;
    case 'new-dm':
      return <NewDm onClose={close} />;
    case 'details':
      return <Details channelId={dialog.channelId} initialTab={dialog.tab ?? 'about'} onClose={close} />;
    case 'status':
      return <StatusDialog onClose={close} />;
    case 'prefs':
      return <PrefsDialog onClose={close} />;
    case 'remind':
      return <RemindDialog messageId={dialog.messageId} onClose={close} />;
    case 'schedule':
      return <ScheduleDialog d={dialog} onClose={close} />;
    case 'issue':
      return <IssueDialog message={dialog.message} onClose={close} />;
    case 'share':
      return <ShareDialog onPick={dialog.onPick} onClose={close} />;
    case 'emoji':
      return <EmojiDialog onPick={dialog.onPick} onClose={close} />;
    case 'confirm-delete-message':
      return <DeleteMessage messageId={dialog.messageId} onClose={close} />;
    case 'shortcuts':
      return <Shortcuts onClose={close} />;
  }
}

function PeoplePicker({ selected, onChange, exclude = [], label }: { selected: string[]; onChange: (ids: string[]) => void; exclude?: string[]; label: string }) {
  const t = useTranslations('talk');
  const { people } = useTalk();
  const [q, setQ] = useState('');
  const list = [...people.values()].filter((p) => !exclude.includes(p.id) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="talk-picker">
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dialogs.searchPeople')} aria-label={label} autoFocus />
      <ul className="talk-picker-list" role="listbox" aria-multiselectable="true" aria-label={label}>
        {list.length === 0 && <li className="talk-muted">{t('dialogs.noPeople')}</li>}
        {list.slice(0, 50).map((p) => {
          const on = selected.includes(p.id);
          return (
            <li key={p.id}>
              <label className="talk-picker-item">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? selected.filter((s) => s !== p.id) : [...selected, p.id])} />
                <Avatar id={p.id} size={22} presence />
                <span>{p.name}</span>
                <span className="talk-muted">{p.email}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CreateChannel({ onClose }: { onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'public' | 'private'>('public');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalized = normalizeChannelName(name);
  async function submit() {
    if (!normalized || busy) return;
    setBusy(true);
    setError('');
    try {
      const c = await ctx.api<TalkChannelDto>('/api/talk/channels', { method: 'POST', json: { name, kind, description, memberIds: members } });
      ctx.refreshBoot();
      onClose();
      ctx.open({ channelId: c.id });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('dialogs.createChannel')}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="talk-create-channel" className="btn btn-primary btn-sm" disabled={!normalized || busy}>
            {t('dialogs.create')}
          </button>
        </>
      }
    >
      <form
        id="talk-create-channel"
        className="ui-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="ui-field">
          <span className="label">{t('dialogs.channelName')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialogs.channelNamePh')} maxLength={80} autoFocus required />
          {name && normalized !== name && <span className="ui-help">{t('dialogs.willBe', { name: normalized || '-' })}</span>}
        </label>
        <label className="ui-field">
          <span className="label">{t('dialogs.description')}</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </label>
        <fieldset className="ui-field talk-radios">
          <legend className="label">{t('dialogs.visibility')}</legend>
          <label className="ui-check">
            <input type="radio" name="kind" checked={kind === 'public'} onChange={() => setKind('public')} />
            <span>
              {t('dialogs.public')} <span className="talk-muted">{t('dialogs.publicHelp')}</span>
            </span>
          </label>
          <label className="ui-check">
            <input type="radio" name="kind" checked={kind === 'private'} onChange={() => setKind('private')} />
            <span>
              {t('dialogs.private')} <span className="talk-muted">{t('dialogs.privateHelp')}</span>
            </span>
          </label>
        </fieldset>
        <div className="ui-field">
          <span className="label">{t('dialogs.addPeople')}</span>
          <PeoplePicker selected={members} onChange={setMembers} exclude={[ctx.boot.me]} label={t('dialogs.addPeople')} />
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function NewDm({ onClose }: { onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const c = await ctx.api<TalkChannelDto>('/api/talk/dms', { method: 'POST', json: { userIds: members } });
      ctx.refreshBoot();
      onClose();
      ctx.open({ channelId: c.id });
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('dialogs.newMessage')}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || members.length > 9} onClick={() => void submit()}>
            {members.length === 0 ? t('dialogs.noteToSelf') : t('dialogs.openDm')}
          </button>
        </>
      }
    >
      <p className="ui-help">{t('dialogs.dmHelp')}</p>
      <PeoplePicker selected={members} onChange={setMembers} exclude={[ctx.boot.me]} label={t('dialogs.to')} />
    </Modal>
  );
}

function Details({ channelId, initialTab, onClose }: { channelId: string; initialTab: 'about' | 'members' | 'settings' | 'integrations'; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [tab, setTab] = useState(initialTab);
  const [channel, setChannel] = useState<TalkChannelDto | null>(ctx.channelById.get(channelId) ?? null);
  const [members, setMembers] = useState<Array<{ userId: string; role: string }> | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | 'leave' | null>(null);
  const [hooks, setHooks] = useState<TalkHookDto[] | null>(null);
  const [newHook, setNewHook] = useState<string | null>(null);
  const [hookName, setHookName] = useState('');
  const [form, setForm] = useState({ name: channel?.name ?? '', topic: channel?.topic ?? '', description: channel?.description ?? '' });
  // Si la persona ya empezó a escribir, lo que llega del servidor no pisa el formulario.
  const dirty = useRef(false);
  const edit = (patch: Partial<typeof form>) => {
    dirty.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };
  const isChannel = channel ? channel.kind === 'public' || channel.kind === 'private' : true;

  useEffect(() => {
    void ctx
      .api<TalkChannelDto>(`/api/talk/channels/${channelId}`)
      .then((c) => {
        setChannel(c);
        if (!dirty.current) setForm({ name: c.name, topic: c.topic, description: c.description });
      })
      .catch(() => undefined);
    void ctx
      .api<{ members: Array<{ userId: string; role: string }> }>(`/api/talk/channels/${channelId}/members`)
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === 'integrations' && hooks === null)
      void ctx
        .api<{ hooks: TalkHookDto[] }>(`/api/talk/channels/${channelId}/hooks`)
        .then((r) => setHooks(r.hooks))
        .catch(() => setHooks([]));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(json: Record<string, unknown>, ok?: string) {
    try {
      const c = await ctx.api<TalkChannelDto>(`/api/talk/channels/${channelId}`, { method: 'PATCH', json });
      setChannel(c);
      dirty.current = false;
      setForm({ name: c.name, topic: c.topic, description: c.description });
      ctx.refreshBoot();
      if (ok) ctx.toast(ok);
      return c;
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
      return null;
    }
  }

  async function addPeople() {
    try {
      await ctx.api(`/api/talk/channels/${channelId}/members`, { method: 'POST', json: { userIds: adding } });
      setAdding([]);
      const r = await ctx.api<{ members: Array<{ userId: string; role: string }> }>(`/api/talk/channels/${channelId}/members`);
      setMembers(r.members);
      ctx.refreshBoot();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }

  async function removePerson(userId: string) {
    try {
      await ctx.api(`/api/talk/channels/${channelId}/members?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      setMembers((m) => m?.filter((x) => x.userId !== userId) ?? null);
      ctx.refreshBoot();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }

  async function doConfirm() {
    const what = confirm;
    setConfirm(null);
    try {
      if (what === 'archive') {
        await patch({ archived: !channel?.archived }, channel?.archived ? t('dialogs.unarchived') : t('dialogs.archivedToast'));
      } else if (what === 'delete') {
        await ctx.api(`/api/talk/channels/${channelId}`, { method: 'DELETE' });
        ctx.refreshBoot();
        onClose();
        ctx.open({ view: 'channel' });
        ctx.toast(t('dialogs.deletedToast'));
      } else if (what === 'leave') {
        await ctx.api(`/api/talk/channels/${channelId}/members`, { method: 'DELETE' });
        ctx.refreshBoot();
        onClose();
        ctx.open({ view: 'channel' });
      }
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }

  async function createHook() {
    try {
      const r = await ctx.api<{ hook: TalkHookDto; url: string }>(`/api/talk/channels/${channelId}/hooks`, { method: 'POST', json: { name: hookName || 'Webhook' } });
      setHooks((h) => [...(h ?? []), r.hook]);
      setNewHook(r.url);
      setHookName('');
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }

  async function deleteHook(id: string) {
    try {
      await ctx.api(`/api/talk/channels/${channelId}/hooks?hookId=${id}`, { method: 'DELETE' });
      setHooks((h) => h?.filter((x) => x.id !== id) ?? null);
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }

  if (!channel) return null;
  const title = isChannel ? `${channel.kind === 'private' ? '🔒' : '#'}${channel.name}` : ctx.channelTitle(channel);
  const memberIds = members?.map((m) => m.userId) ?? [];
  const writable = channel.isMember && !channel.archived;

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="ui-tabs" role="tablist">
        {(['about', 'members', ...(isChannel ? (['settings', 'integrations'] as const) : (['settings'] as const))] as const).map((k) => (
          <button key={k} type="button" role="tab" className="ui-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {k === 'members' ? t('details.membersTab', { count: channel.memberCount }) : t(`details.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'about' && (
        <form
          className="ui-fields talk-details"
          onSubmit={(e) => {
            e.preventDefault();
            const json: Record<string, unknown> = {};
            if (isChannel && channel.canManage && form.name !== channel.name) json.name = form.name;
            if (form.topic !== channel.topic) json.topic = form.topic;
            if (isChannel && form.description !== channel.description) json.description = form.description;
            if (Object.keys(json).length) void patch(json, t('dialogs.saved'));
          }}
        >
          {isChannel && (
            <label className="ui-field">
              <span className="label">{t('dialogs.channelName')}</span>
              <input className="input" value={form.name} disabled={!channel.canManage || channel.archived} onChange={(e) => edit({ name: e.target.value })} />
              {!channel.canManage && <span className="ui-help">{t('details.nameHelp')}</span>}
            </label>
          )}
          <label className="ui-field">
            <span className="label">{t('details.topic')}</span>
            <input className="input" value={form.topic} disabled={!writable} maxLength={250} onChange={(e) => edit({ topic: e.target.value })} />
          </label>
          {isChannel && (
            <label className="ui-field">
              <span className="label">{t('dialogs.description')}</span>
              <textarea className="textarea" rows={3} value={form.description} disabled={!writable} maxLength={1000} onChange={(e) => edit({ description: e.target.value })} />
            </label>
          )}
          <p className="ui-help">
            {t('details.created', { who: ctx.personName(channel.createdBy), when: fmtFull(channel.createdAt, ctx.locale) })}
          </p>
          {writable && (
            <div>
              <button type="submit" className="btn btn-primary btn-sm">
                {t('common.save')}
              </button>
            </div>
          )}
        </form>
      )}
      {tab === 'members' && (
        <div className="talk-details">
          {isChannel && writable && (
            <div className="ui-field">
              <span className="label">{t('dialogs.addPeople')}</span>
              <PeoplePicker selected={adding} onChange={setAdding} exclude={memberIds} label={t('dialogs.addPeople')} />
              <div>
                <button type="button" className="btn btn-sm" disabled={!adding.length} onClick={() => void addPeople()}>
                  {t('details.add', { count: adding.length })}
                </button>
              </div>
            </div>
          )}
          {members === null ? (
            <p className="talk-muted">{t('common.loading')}</p>
          ) : (
            <ul className="talk-member-list">
              {members.map((m) => (
                <li key={m.userId} className="talk-member">
                  <Avatar id={m.userId} size={24} presence />
                  <span>{ctx.personName(m.userId)}</span>
                  {m.role === 'admin' && <span className="badge badge-outline">{t('details.admin')}</span>}
                  {m.userId === ctx.boot.me && <span className="talk-muted">{t('details.you')}</span>}
                  {isChannel && channel.canManage && m.userId !== ctx.boot.me && channel.name !== 'general' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removePerson(m.userId)}>
                      {t('details.remove')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {tab === 'settings' && (
        <div className="ui-fields talk-details">
          {channel.isMember && (
            <label className="ui-field">
              <span className="label">{t('details.notify')}</span>
              <select className="select" value={channel.notify} onChange={(e) => void patch({ notify: e.target.value }, t('dialogs.saved'))}>
                <option value="default">{t('details.notifyDefault')}</option>
                <option value="all">{t('details.notifyAll')}</option>
                <option value="mentions">{t('details.notifyMentions')}</option>
                <option value="none">{t('details.notifyNone')}</option>
              </select>
            </label>
          )}
          {isChannel && channel.canManage && channel.kind === 'public' && channel.name !== 'general' && !channel.archived && (
            <div className="ui-field">
              <span className="label">{t('details.makePrivate')}</span>
              <p className="ui-help">{t('details.makePrivateHelp')}</p>
              <div>
                <button type="button" className="btn btn-sm" onClick={() => void patch({ kind: 'private' }, t('dialogs.saved'))}>
                  {t('details.makePrivateBtn')}
                </button>
              </div>
            </div>
          )}
          <div className="talk-details-actions">
            {channel.isMember && !(isChannel && channel.name === 'general') && (
              <button type="button" className="btn btn-sm" onClick={() => setConfirm('leave')}>
                {isChannel ? t('details.leave') : t('details.closeDm')}
              </button>
            )}
            {isChannel && channel.canManage && channel.name !== 'general' && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => setConfirm('archive')}>
                  {channel.archived ? t('details.unarchive') : t('details.archive')}
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirm('delete')}>
                  {t('details.delete')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {tab === 'integrations' && (
        <div className="ui-fields talk-details">
          <p className="ui-help">{t('details.hooksHelp')}</p>
          {newHook && (
            <div className="talk-hook-new" role="status">
              <p className="label">{t('details.hookUrl')}</p>
              <code className="data talk-hook-url">{newHook}</code>
              <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(newHook).then(() => ctx.toast(t('message.linkCopied')))}>
                {t('details.copy')}
              </button>
            </div>
          )}
          {hooks === null ? (
            <p className="talk-muted">{t('common.loading')}</p>
          ) : (
            <ul className="talk-member-list">
              {hooks.length === 0 && <li className="talk-muted">{t('details.noHooks')}</li>}
              {hooks.map((h) => (
                <li key={h.id} className="talk-member">
                  <span>{h.name}</span>
                  <span className="talk-muted">{fmtFull(h.createdAt, ctx.locale)}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void deleteHook(h.id)}>
                    {t('details.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {writable && (
            <form
              className="talk-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void createHook();
              }}
            >
              <input className="input" value={hookName} onChange={(e) => setHookName(e.target.value)} placeholder={t('details.hookName')} aria-label={t('details.hookName')} maxLength={60} />
              <button type="submit" className="btn btn-sm">
                {t('details.addHook')}
              </button>
            </form>
          )}
          <p className="ui-help">{t('details.flowHelp')}</p>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'delete' ? t('details.deleteTitle', { name: channel.name }) : confirm === 'archive' ? (channel.archived ? t('details.unarchive') : t('details.archiveTitle', { name: channel.name })) : t('details.leaveTitle')}
        body={confirm === 'delete' ? t('details.deleteBody') : confirm === 'archive' && !channel.archived ? t('details.archiveBody') : confirm === 'leave' && channel.kind === 'private' ? t('details.leavePrivateBody') : undefined}
        confirmLabel={confirm === 'delete' ? t('details.delete') : confirm === 'archive' ? (channel.archived ? t('details.unarchive') : t('details.archive')) : isChannel ? t('details.leave') : t('details.closeDm')}
        cancelLabel={t('common.cancel')}
        danger={confirm === 'delete'}
        onConfirm={() => void doConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </Modal>
  );
}

function StatusDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const me = ctx.presence.get(ctx.boot.me);
  const [emoji, setEmoji] = useState(me?.statusEmoji ?? '');
  const [text, setText] = useState(me?.statusText ?? '');
  const [expires, setExpires] = useState<'none' | '30' | '60' | 'today' | 'week'>('none');
  async function save(json: Record<string, unknown>, close = true) {
    try {
      await ctx.api('/api/talk/me', { method: 'PATCH', json });
      ctx.refreshBoot();
      if (close) onClose();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  function expiresAt(): string | null {
    const now = new Date();
    if (expires === '30') return new Date(now.getTime() + 30 * 60_000).toISOString();
    if (expires === '60') return new Date(now.getTime() + 3_600_000).toISOString();
    if (expires === 'today') return endOfToday(now).toISOString();
    if (expires === 'week') return presetTime('nextweek', now).toISOString();
    return null;
  }
  return (
    <Modal
      title={t('status.title')}
      onClose={onClose}
      foot={
        <>
          {(me?.statusEmoji || me?.statusText) && (
            <button type="button" className="btn btn-sm" onClick={() => void save({ status: { emoji: '', text: '', expiresAt: null } })}>
              {t('status.clear')}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save({ status: { emoji, text, expiresAt: expiresAt() } })}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <div className="talk-inline-form">
          <input className="input talk-status-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 8))} aria-label={t('status.emoji')} placeholder="🙂" />
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={100} placeholder={t('status.placeholder')} aria-label={t('status.text')} autoFocus />
        </div>
        <ul className="talk-presets">
          {STATUS_PRESETS.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                className="talk-preset"
                onClick={() => {
                  setEmoji(p.emoji);
                  setText(t(`status.presets.${p.key}`));
                  setExpires(p.minutes === 60 ? '60' : p.minutes === 30 ? '30' : p.minutes === 'today' ? 'today' : 'none');
                }}
              >
                {p.emoji} {t(`status.presets.${p.key}`)}
              </button>
            </li>
          ))}
        </ul>
        <label className="ui-field">
          <span className="label">{t('status.clearAfter')}</span>
          <select className="select" value={expires} onChange={(e) => setExpires(e.target.value as typeof expires)}>
            <option value="none">{t('status.never')}</option>
            <option value="30">{t('status.in30')}</option>
            <option value="60">{t('status.in60')}</option>
            <option value="today">{t('status.today')}</option>
            <option value="week">{t('status.week')}</option>
          </select>
        </label>
        <div className="talk-details-actions">
          <button type="button" className="btn btn-sm" aria-pressed={!!me?.away} onClick={() => void save({ away: !me?.away }, false)}>
            {me?.away ? t('status.setActive') : t('status.setAway')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={!!me?.dndUntil}
            onClick={() => void save({ dndUntil: me?.dndUntil ? null : new Date(Date.now() + 3_600_000).toISOString() }, false)}
          >
            {me?.dndUntil ? t('status.dndOff') : t('status.dndOn')}
          </button>
        </div>
        {me?.dndUntil && <p className="ui-help">{t('status.dndUntil', { when: fmtFull(me.dndUntil, ctx.locale) })}</p>}
      </div>
    </Modal>
  );
}

function PrefsDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [prefs, setPrefs] = useState(ctx.boot.prefs);
  async function save() {
    try {
      await ctx.api('/api/talk/me', { method: 'PATCH', json: { prefs } });
      ctx.refreshBoot();
      ctx.toast(t('dialogs.saved'));
      onClose();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <Modal
      title={t('prefs.title')}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={() => ctx.dialog({ kind: 'shortcuts' })}>
            {t('prefs.shortcuts')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <fieldset className="ui-field talk-radios">
          <legend className="label">{t('prefs.notify')}</legend>
          {(['all', 'mentions', 'none'] as const).map((v) => (
            <label key={v} className="ui-check">
              <input type="radio" name="notify" checked={prefs.notify === v} onChange={() => setPrefs({ ...prefs, notify: v })} />
              <span>{t(`prefs.notify_${v}`)}</span>
            </label>
          ))}
        </fieldset>
        <label className="ui-field">
          <span className="label">{t('prefs.keywords')}</span>
          <input className="input" value={prefs.keywords} onChange={(e) => setPrefs({ ...prefs, keywords: e.target.value })} placeholder={t('prefs.keywordsPh')} />
          <span className="ui-help">{t('prefs.keywordsHelp')}</span>
        </label>
        <fieldset className="ui-field talk-radios">
          <legend className="label">{t('prefs.email')}</legend>
          <label className="ui-check">
            <input type="radio" name="email" checked={prefs.email === 'mentions'} onChange={() => setPrefs({ ...prefs, email: 'mentions' })} />
            <span>{t('prefs.email_mentions')}</span>
          </label>
          <label className="ui-check">
            <input type="radio" name="email" checked={prefs.email === 'off'} onChange={() => setPrefs({ ...prefs, email: 'off' })} />
            <span>{t('prefs.email_off')}</span>
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}

function RemindDialog({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [custom, setCustom] = useState(() => toLocalInput(presetTime('tomorrow')));
  async function set(at: Date) {
    try {
      await ctx.api('/api/talk/reminders', { method: 'POST', json: { messageId, remindAt: at.toISOString() } });
      ctx.refreshBoot();
      ctx.toast(t('composer.remindSet', { when: fmtFull(at.toISOString(), ctx.locale) }));
      onClose();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    }
  }
  return (
    <Modal title={t('dialogs.remindTitle')} onClose={onClose}>
      <ul className="talk-presets">
        {remindPresets().map((p) => (
          <li key={p.key}>
            <button type="button" className="talk-preset" onClick={() => void set(p.at)}>
              {t(`time.presets.${p.key}`)} <span className="talk-muted">{fmtFull(p.at.toISOString(), ctx.locale)}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="talk-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new Date(custom);
          if (!Number.isNaN(d.getTime())) void set(d);
        }}
      >
        <input className="input" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t('dialogs.custom')} />
        <button type="submit" className="btn btn-sm">
          {t('dialogs.setReminder')}
        </button>
      </form>
    </Modal>
  );
}

function ScheduleDialog({ d, onClose }: { d: Extract<TalkDialog, { kind: 'schedule' }>; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const presets = useMemo(() => schedulePresets(), []);
  const [custom, setCustom] = useState(() => toLocalInput(presets[0].at));
  const [busy, setBusy] = useState(false);
  async function set(at: Date) {
    if (busy) return;
    setBusy(true);
    try {
      await ctx.api('/api/talk/scheduled', { method: 'POST', json: { channelId: d.channelId, parentId: d.parentId, body: d.body, fileIds: d.fileIds, sendAt: at.toISOString() } });
      d.onDone();
      ctx.refreshBoot();
      ctx.toast(t('dialogs.scheduledToast', { when: fmtFull(at.toISOString(), ctx.locale) }));
      onClose();
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
      setBusy(false);
    }
  }
  return (
    <Modal title={t('dialogs.scheduleTitle')} onClose={onClose}>
      <ul className="talk-presets">
        {presets.map((p) => (
          <li key={p.key}>
            <button type="button" className="talk-preset" disabled={busy} onClick={() => void set(p.at)}>
              {t(`time.schedule.${p.key}`)} <span className="talk-muted">{fmtFull(p.at.toISOString(), ctx.locale)}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="talk-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const at = new Date(custom);
          if (!Number.isNaN(at.getTime())) void set(at);
        }}
      >
        <input className="input" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t('dialogs.custom')} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy}>
          {busy ? t('dialogs.scheduling') : t('dialogs.scheduleBtn')}
        </button>
      </form>
    </Modal>
  );
}

function IssueDialog({ message, onClose }: { message: TalkMessageDto; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState(() => message.body.replace(/<[@#!][^>]*>/g, '').split('\n')[0].slice(0, 200));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void ctx
      .api<{ rows: Array<{ id: string; name: string }> }>('/api/track/projects?meta=1')
      .then((r) => {
        const list = r.rows ?? [];
        setProjects(list);
        if (list[0]) setProjectId(list[0].id);
      })
      .catch(() => setProjects([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit() {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const issue = await ctx.api<{ id: string; identifier: string; url: string }>(`/api/talk/messages/${message.id}/issue`, { method: 'POST', json: { projectId, title, locale: ctx.locale } });
      onClose();
      ctx.toast(t('dialogs.issueCreated', { id: issue.identifier }));
    } catch (err) {
      ctx.toast(errorText(t, err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('dialogs.issueTitle')}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="talk-issue" className="btn btn-primary btn-sm" disabled={!projectId || busy}>
            {t('dialogs.create')}
          </button>
        </>
      }
    >
      {projects === null ? (
        <p className="talk-muted">{t('common.loading')}</p>
      ) : projects.length === 0 ? (
        <p className="ui-help">{t('dialogs.noProjects')}</p>
      ) : (
        <form
          id="talk-issue"
          className="ui-fields"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="ui-field">
            <span className="label">{t('dialogs.project')}</span>
            <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('dialogs.issueName')}</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          </label>
          <p className="ui-help">{t('dialogs.issueHelp')}</p>
        </form>
      )}
    </Modal>
  );
}

function ShareDialog({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Array<{ id: string; group: string; label: string; meta?: string; href: string }>>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q.trim()) {
      setItems([]);
      return;
    }
    const id = setTimeout(() => {
      setLoading(true);
      void fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((r: { items?: Array<{ id: string; group: string; label: string; meta?: string; href: string }> }) => {
          const list = r.items ?? [];
          setItems(list.filter((x) => /^\/app\/(track\/issues|crm\/deals|docs)\/[^/?#]+$/.test(x.href)).slice(0, 12));
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <Modal title={t('dialogs.shareTitle')} onClose={onClose}>
      <p className="ui-help">{t('dialogs.shareHelp')}</p>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dialogs.shareSearch')} aria-label={t('dialogs.shareSearch')} autoFocus />
      <ul className="talk-picker-list" role="listbox" aria-label={t('dialogs.shareTitle')}>
        {loading && <li className="talk-muted">{t('common.loading')}</li>}
        {!loading && q && items.length === 0 && <li className="talk-muted">{t('dialogs.shareEmpty')}</li>}
        {items.map((it) => (
          <li key={`${it.group}-${it.id}`}>
            <button
              type="button"
              role="option"
              aria-selected="false"
              className="talk-picker-item"
              onClick={() => {
                onPick(`${window.location.origin}/${ctx.locale}${it.href}`);
                onClose();
              }}
            >
              <span className="talk-ref-kind">{it.href.includes('/track/') ? t('refs.issue') : it.href.includes('/crm/') ? t('refs.deal') : t('refs.doc')}</span>
              <span>{it.label}</span>
              {it.meta && <span className="talk-muted">{it.meta}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

const ALL_EMOJI = [...new Set(Object.values(TALK_EMOJI))];

function EmojiDialog({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const t = useTranslations('talk');
  const [q, setQ] = useState('');
  const list = q ? searchEmoji(q, 80).map((e) => e.char) : [...QUICK_REACTIONS, ...ALL_EMOJI.filter((e) => !QUICK_REACTIONS.includes(e))];
  return (
    <Modal title={t('dialogs.emojiTitle')} onClose={onClose}>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('dialogs.emojiSearch')} aria-label={t('dialogs.emojiSearch')} autoFocus />
      <div className="talk-emoji-grid" role="listbox" aria-label={t('dialogs.emojiTitle')}>
        {list.map((e) => (
          <button
            key={e}
            type="button"
            role="option"
            aria-selected="false"
            className="talk-emoji-btn"
            title={`:${emojiName(e)}:`}
            aria-label={emojiName(e)}
            onClick={() => {
              onPick(e);
              onClose();
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function DeleteMessage({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const t = useTranslations('talk');
  const ctx = useTalk();
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      open
      title={t('dialogs.deleteMessageTitle')}
      body={t('dialogs.deleteMessageBody')}
      confirmLabel={t('message.delete')}
      cancelLabel={t('common.cancel')}
      danger
      busy={busy}
      onCancel={onClose}
      onConfirm={() => {
        setBusy(true);
        void ctx
          .api(`/api/talk/messages/${messageId}`, { method: 'DELETE' })
          .then(() => {
            ctx.removeMessage(messageId);
            ctx.toast(t('dialogs.messageDeleted'));
            onClose();
          })
          .catch((err) => {
            ctx.toast(errorText(t, err), 'error');
            setBusy(false);
          });
      }}
    />
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const t = useTranslations('talk');
  const rows: Array<[string, string]> = [
    ['⌘K', t('shortcuts.jump')],
    ['Alt ↑ / ↓', t('shortcuts.prevNext')],
    ['Alt ⇧ ↑ / ↓', t('shortcuts.prevNextUnread')],
    ['Esc', t('shortcuts.markRead')],
    ['⇧ Esc', t('shortcuts.markAllRead')],
    ['↑', t('shortcuts.editLast')],
    ['⌘⇧T', t('shortcuts.threads')],
    ['⌘⇧A', t('shortcuts.activity')],
    ['⌘G', t('shortcuts.search')],
    ['⇧ Enter', t('shortcuts.newline')],
    ['⌘B / ⌘I / ⌘⇧X', t('shortcuts.format')],
    ['⌘/', t('shortcuts.help')],
  ];
  return (
    <Modal title={t('shortcuts.title')} onClose={onClose}>
      <table className="table table-compact">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>
                <span className="kbd">{k}</span>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
