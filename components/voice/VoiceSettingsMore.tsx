'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import {
  VOICE_REMINDER_MINUTES,
  VOICE_RETENTION_DAYS,
  type VoicePrompt,
  type VoicePromptKind,
  type VoiceSettings,
  type VoiceWorkspaceSettings,
} from '@/lib/voice-types';
import type { TeamUsageRow } from '@/lib/voice-library';
import { voiceErrorKey } from './voice-ui';

// ---------- Recipes y transforms ----------

function PromptList({ kind, initial }: { kind: VoicePromptKind; initial: VoicePrompt[] }) {
  const t = useTranslations('voice.settings.prompts');
  const tErr = useTranslations('voice.errors');
  const tPrompts = useTranslations('voice.prompts');
  const builtin = Object.entries(tPrompts.raw(kind === 'recipe' ? 'recipes' : 'transforms') as Record<string, { name: string; prompt: string }>);
  const highlight = useSearchParams().get('prompt');
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<{ id: string | null; name: string; prompt: string; shared: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<VoicePrompt | null>(null);
  const k = kind === 'recipe' ? 'recipes' : 'transforms';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !editing.name.trim() || !editing.prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(editing.id ? `/api/voice/prompts/${editing.id}` : '/api/voice/prompts', {
      method: editing.id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, name: editing.name, prompt: editing.prompt, shared: editing.shared }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (VoicePrompt & { error?: string }) | null;
    setBusy(false);
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? 'network');
      return;
    }
    setList((l) => (editing.id ? l.map((x) => (x.id === data.id ? data : x)) : [...l, data]).sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(null);
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    const prev = list;
    setList((l) => l.filter((x) => x.id !== id));
    const res = await fetch(`/api/voice/prompts/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setList(prev);
      setError('generic');
    }
  }

  return (
    <FormSection
      title={t(`${k}.title`)}
      description={t(`${k}.desc`)}
      footer={
        !editing && (
          <button type="button" className="btn btn-secondary" onClick={() => setEditing({ id: null, name: '', prompt: '', shared: false })}>
            {t(`${k}.new`)}
          </button>
        )
      }
    >
      {editing && (
        <form className="vc-template-form" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}>
          <div className="ui-field">
            <label className="label" htmlFor={`vc-${kind}-name`}>
              {t('name')}
            </label>
            <input id={`vc-${kind}-name`} className="input" value={editing.name} maxLength={80} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor={`vc-${kind}-prompt`}>
              {t('prompt')}
            </label>
            <textarea
              id={`vc-${kind}-prompt`}
              className="textarea"
              rows={4}
              value={editing.prompt}
              maxLength={4000}
              placeholder={t(`${k}.placeholder`)}
              onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
            />
          </div>
          <label className="ui-switch">
            <input type="checkbox" checked={editing.shared} onChange={(e) => setEditing({ ...editing, shared: e.target.checked })} />
            <span>{t('shared')}</span>
          </label>
          <div className="vc-send-row">
            <button type="submit" className="btn btn-primary" disabled={busy || !editing.name.trim() || !editing.prompt.trim()}>
              {t('save')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              {t('cancel')}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}
      {list.length === 0 && !editing ? (
        <EmptyState compact body={t(`${k}.empty`)} />
      ) : (
        <ul className="vc-list" aria-label={t(`${k}.title`)}>
          {list.map((p) => (
            <li key={p.id} className={`vc-row${highlight === p.id ? ' is-highlight' : ''}`} data-testid={`voice-${kind}-row`} id={`prompt-${p.id}`}>
              <span className="vc-row-main">
                <span className="vc-row-title">{kind === 'recipe' ? `/${p.name}` : p.name}</span>
                <span className="vc-muted vc-row-meta">
                  {p.shared && `${p.mine ? t('sharedBadge') : t('fromTeam')} · `}
                  {p.prompt}
                </span>
              </span>
              {p.mine && (
                <span className="vc-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: p.id, name: p.name, prompt: p.prompt, shared: p.shared })}>
                    {t('edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(p)}>
                    {t('delete')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3 className="vc-h3 vc-builtin-title">{t('builtinTitle')}</h3>
      <ul className="vc-list">
        {builtin.map(([key, v]) => (
          <li key={key} className="vc-row">
            <span className="vc-row-main">
              <span className="vc-row-title">{kind === 'recipe' ? `/${v.name}` : v.name}</span>
              <span className="vc-muted vc-row-meta">{v.prompt}</span>
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!deleting}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </FormSection>
  );
}

export function PromptsSettings({ recipes, transforms }: { recipes: VoicePrompt[]; transforms: VoicePrompt[] }) {
  const highlight = useSearchParams().get('prompt');
  useEffect(() => {
    if (highlight) document.getElementById(`prompt-${highlight}`)?.scrollIntoView({ block: 'center' });
  }, [highlight]);
  return (
    <>
      <PromptList kind="recipe" initial={recipes} />
      <PromptList kind="transform" initial={transforms} />
    </>
  );
}

// ---------- Reuniones: avisos y retención ----------

export function MeetingsSettings({
  initial,
  workspace,
  canEditWorkspace,
}: {
  initial: VoiceSettings;
  workspace: VoiceWorkspaceSettings;
  canEditWorkspace: boolean;
}) {
  const t = useTranslations('voice.settings.meetings');
  const [s, setS] = useState(initial);
  const [ws, setWs] = useState(workspace);
  const [perm, setPerm] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default');
  useEffect(() => {
    setPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  async function save(next: Partial<VoiceSettings>): Promise<string | void> {
    const res = await fetch('/api/voice/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { settings?: VoiceSettings } | null;
    if (!res?.ok || !data?.settings) return t('saveError');
    setS(data.settings);
    window.dispatchEvent(new Event('zs:voice-settings'));
  }

  async function saveWorkspace(next: Partial<VoiceWorkspaceSettings>): Promise<string | void> {
    const res = await fetch('/api/voice/workspace', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { settings?: VoiceWorkspaceSettings } | null;
    if (!res?.ok || !data?.settings) return t('saveError');
    setWs(data.settings);
  }

  const days = (n: number) => (n === 0 ? t('never') : t('daysN', { n }));

  return (
    <>
      <FormSection
        title={t('remindersTitle')}
        description={t('remindersDesc')}
        onSubmit={(fd) => save({ reminders: fd.get('reminders') === 'on', reminderMinutes: Number(fd.get('reminderMinutes')) })}
      >
        <label className="ui-switch">
          <input type="checkbox" name="reminders" defaultChecked={s.reminders} />
          <span>{t('reminders')}</span>
        </label>
        <div className="ui-field">
          <label className="label" htmlFor="vc-rem-min">
            {t('minutes')}
          </label>
          <select id="vc-rem-min" name="reminderMinutes" className="select" defaultValue={String(s.reminderMinutes)}>
            {VOICE_REMINDER_MINUTES.map((m) => (
              <option key={m} value={m}>
                {t('minutesN', { n: m })}
              </option>
            ))}
          </select>
        </div>
        <p className="ui-help">
          {t('calendarsHelp')} <Link href="/app/calendar/settings">{t('calendarsLink')}</Link>
        </p>
        {perm === 'granted' ? (
          <p className="ui-help">{t('notifyOn')}</p>
        ) : perm === 'denied' ? (
          <p className="ui-help">{t('notifyBlocked')}</p>
        ) : perm === 'default' ? (
          <p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const p = await Notification.requestPermission().catch(() => 'denied' as const);
                setPerm(p);
              }}
            >
              {t('notifyBtn')}
            </button>
          </p>
        ) : null}
      </FormSection>
      <FormSection title={t('retentionTitle')} description={t('retentionDesc')} onSubmit={(fd) => save({ retentionDays: Number(fd.get('retentionDays')) })}>
        <div className="ui-field">
          <label className="label" htmlFor="vc-retention">
            {t('retention')}
          </label>
          <select id="vc-retention" name="retentionDays" className="select" defaultValue={String(s.retentionDays)}>
            {VOICE_RETENTION_DAYS.map((d) => (
              <option key={d} value={d}>
                {days(d)}
              </option>
            ))}
          </select>
        </div>
        {ws.retentionDays > 0 && <p className="ui-help">{t('workspaceCurrent', { value: days(ws.retentionDays) })}</p>}
      </FormSection>
      {canEditWorkspace && (
        <FormSection title={t('workspaceTitle')} description={t('workspaceDesc')} onSubmit={(fd) => saveWorkspace({ retentionDays: Number(fd.get('wsRetention')) })}>
          <div className="ui-field">
            <label className="label" htmlFor="vc-ws-retention">
              {t('workspaceLimit')}
            </label>
            <select id="vc-ws-retention" name="wsRetention" className="select" defaultValue={String(ws.retentionDays)}>
              {VOICE_RETENTION_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? t('noLimit') : days(d)}
                </option>
              ))}
            </select>
          </div>
        </FormSection>
      )}
    </>
  );
}

// ---------- Uso del equipo ----------

const APP_KEYS = new Set(['docs', 'notes', 'crm', 'track', 'chat', 'talk', 'voice', 'calendar', 'board', 'groups', 'flow', 'desktop', 'other']);

export function TeamUsage() {
  const t = useTranslations('voice.settings.team');
  const tApps = useTranslations('voice.dictation.apps');
  const format = useFormatter();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<TeamUsageRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(false);
    void fetch(`/api/voice/usage?days=${days}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ people: TeamUsageRow[] }>) : Promise.reject(new Error('usage'))))
      .then((d) => alive && setRows(d.people))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [days]);
  const active = rows?.filter((r) => r.dictations || r.meetings) ?? [];
  return (
    <FormSection title={t('title')} description={t('desc')}>
      <div className="ui-field vc-team-days">
        <label className="label" htmlFor="vc-team-days">
          {t('period')}
        </label>
        <select id="vc-team-days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              {t('lastN', { n: d })}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      ) : !rows ? (
        <p className="vc-muted" role="status">
          {t('loading')}
        </p>
      ) : active.length === 0 ? (
        <EmptyState compact body={t('empty')} />
      ) : (
        <>
          <dl className="vc-stats">
            <div>
              <dt>{t('activePeople')}</dt>
              <dd className="num">{format.number(active.length)}</dd>
            </div>
            <div>
              <dt>{t('words')}</dt>
              <dd className="num">{format.number(active.reduce((n, r) => n + r.words, 0))}</dd>
            </div>
            <div>
              <dt>{t('meetings')}</dt>
              <dd className="num">{format.number(active.reduce((n, r) => n + r.meetings, 0))}</dd>
            </div>
          </dl>
          <div className="vc-table-wrap">
            <table className="vc-table" data-testid="voice-team-usage">
              <thead>
                <tr>
                  <th scope="col">{t('person')}</th>
                  <th scope="col" className="num">
                    {t('dictations')}
                  </th>
                  <th scope="col" className="num">
                    {t('words')}
                  </th>
                  <th scope="col" className="num">
                    {t('meetings')}
                  </th>
                  <th scope="col" className="num">
                    {t('meetingMinutes')}
                  </th>
                  <th scope="col">{t('topApps')}</th>
                  <th scope="col">{t('lastActive')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.personId}>
                    <th scope="row">
                      {r.name || r.email}
                      {r.name && <span className="vc-muted vc-table-sub">{r.email}</span>}
                    </th>
                    <td className="num">{format.number(r.dictations)}</td>
                    <td className="num">{format.number(r.words)}</td>
                    <td className="num">{format.number(r.meetings)}</td>
                    <td className="num">{format.number(r.meetingMinutes)}</td>
                    <td>{r.topApps.map((a) => tApps(APP_KEYS.has(a.app) ? a.app : 'other')).join(', ') || '·'}</td>
                    <td suppressHydrationWarning>{r.lastActive ? format.dateTime(new Date(r.lastActive), { dateStyle: 'medium' }) : t('never')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </FormSection>
  );
}

// ---------- MCP y webhooks ----------

export function McpSection({ apiBase }: { apiBase: string }) {
  const t = useTranslations('voice.settings.desktop');
  const endpoint = `${apiBase}/voice/mcp`;
  const config = JSON.stringify({ mcpServers: { 'zerosoft-voice': { url: endpoint, headers: { Authorization: 'Bearer zs_…' } } } }, null, 2);
  return (
    <>
      <FormSection title={t('mcpTitle')} description={t('mcpDesc')}>
        <ol className="vc-steps">
          <li>
            {t('mcpStep1')} <Link href="/app/settings/api">{t('step2Link')}</Link>
          </li>
          <li>
            {t('mcpStep2')} <code className="data">{endpoint}</code>
          </li>
        </ol>
        <pre className="vc-code data">{config}</pre>
        <p className="ui-help">{t('mcpTools')}</p>
      </FormSection>
      <FormSection title={t('webhooksTitle')} description={t('webhooksDesc')}>
        <p>
          <Link className="btn btn-secondary" href="/app/settings/api#webhooks">
            {t('webhooksLink')}
          </Link>
        </p>
      </FormSection>
    </>
  );
}
