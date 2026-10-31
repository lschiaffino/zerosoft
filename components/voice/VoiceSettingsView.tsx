'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import FormSection from '@/components/ui/FormSection';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import {
  VOICE_BUILTIN_TEMPLATES,
  VOICE_CONTEXTS,
  VOICE_LANGUAGES,
  VOICE_SHORTCUTS,
  VOICE_TONES,
  type VoiceDictionaryEntry,
  type VoiceDictionaryKind,
  type VoicePrompt,
  type VoiceSettings,
  type VoiceTemplate,
  type VoiceWorkspaceSettings,
} from '@/lib/voice-types';
import { voiceErrorKey } from './voice-ui';
import { McpSection, MeetingsSettings, PromptsSettings, TeamUsage } from './VoiceSettingsMore';

interface Props {
  settings: VoiceSettings;
  dictionary: VoiceDictionaryEntry[];
  templates: VoiceTemplate[];
  recipes: VoicePrompt[];
  transforms: VoicePrompt[];
  workspace: VoiceWorkspaceSettings;
  isAdmin: boolean;
  provider: string;
  apiBase: string;
}

const TABS = ['dictation', 'dictionary', 'templates', 'prompts', 'meetings', 'team', 'desktop'] as const;

/**
 * /app/voice/settings: dictado (atajo, idioma, estilos, Command Mode),
 * diccionario (propio y del equipo), plantillas, recipes y transforms,
 * reuniones (avisos y retención), uso del equipo (admins) y escritorio,
 * MCP y webhooks.
 */
export default function VoiceSettingsView(props: Props) {
  const t = useTranslations('voice.settings');
  const search = useSearchParams();
  const tabs = TABS.filter((k) => k !== 'team' || props.isAdmin);
  const tab = (tabs as readonly string[]).includes(search.get('tab') ?? '') ? (search.get('tab') as (typeof TABS)[number]) : 'dictation';
  return (
    <div className="app-page ui-page vc-page">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <SettingsTabs mode="query" param="tab" layout="top" label={t('title')} items={tabs.map((k) => ({ key: k, label: t(`tabs.${k}`) }))}>
        {tab === 'dictation' && <DictationSettings initial={props.settings} />}
        {tab === 'dictionary' && <DictionarySettings initial={props.dictionary} isAdmin={props.isAdmin} />}
        {tab === 'templates' && <TemplatesSettings initial={props.templates} />}
        {tab === 'prompts' && <PromptsSettings recipes={props.recipes} transforms={props.transforms} />}
        {tab === 'meetings' && <MeetingsSettings initial={props.settings} workspace={props.workspace} canEditWorkspace={props.isAdmin} />}
        {tab === 'team' && props.isAdmin && <TeamUsage />}
        {tab === 'desktop' && (
          <>
            <DesktopSettings provider={props.provider} />
            <McpSection apiBase={props.apiBase} />
          </>
        )}
      </SettingsTabs>
    </div>
  );
}

function DictationSettings({ initial }: { initial: VoiceSettings }) {
  const t = useTranslations('voice.settings.dictation');
  const tCtx = useTranslations('voice.contexts');
  const tTone = useTranslations('voice.tones');
  const tLang = useTranslations('voice.languages');
  const [s, setS] = useState(initial);

  async function save(next: Partial<VoiceSettings>): Promise<string | void> {
    const res = await fetch('/api/voice/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { settings?: VoiceSettings } | null;
    if (!res?.ok || !data?.settings) return t('saveError');
    setS(data.settings);
    // El dictado global (DictationHost) relee el atajo y el botón.
    window.dispatchEvent(new Event('zs:voice-settings'));
  }

  return (
    <>
      <FormSection
        title={t('generalTitle')}
        description={t('generalDesc')}
        onSubmit={(fd) =>
          save({
            shortcut: String(fd.get('shortcut')),
            language: String(fd.get('language')),
            showBar: fd.get('showBar') === 'on',
            aiCleanup: fd.get('aiCleanup') === 'on',
            commandMode: fd.get('commandMode') === 'on',
            learnCorrections: fd.get('learnCorrections') === 'on',
          })
        }
      >
        <div className="ui-fields ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="vc-shortcut">
              {t('shortcut')}
            </label>
            <select id="vc-shortcut" name="shortcut" className="select" defaultValue={s.shortcut}>
              {VOICE_SHORTCUTS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <p className="ui-help">{t('shortcutHelp')}</p>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="vc-language">
              {t('language')}
            </label>
            <select id="vc-language" name="language" className="select" defaultValue={s.language}>
              {VOICE_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {tLang(l)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="ui-switch">
          <input type="checkbox" name="showBar" defaultChecked={s.showBar} />
          <span>{t('showBar')}</span>
        </label>
        <label className="ui-switch">
          <input type="checkbox" name="aiCleanup" defaultChecked={s.aiCleanup} />
          <span>{t('aiCleanup')}</span>
        </label>
        <label className="ui-switch">
          <input type="checkbox" name="commandMode" defaultChecked={s.commandMode} />
          <span>{t('commandMode')}</span>
        </label>
        <p className="ui-help">{t('commandModeHelp', { shortcut: s.shortcut })}</p>
        <label className="ui-switch">
          <input type="checkbox" name="learnCorrections" defaultChecked={s.learnCorrections} />
          <span>{t('learnCorrections')}</span>
        </label>
      </FormSection>
      <FormSection
        title={t('stylesTitle')}
        description={t('stylesDesc')}
        onSubmit={(fd) => save({ styles: Object.fromEntries(VOICE_CONTEXTS.map((c) => [c, String(fd.get(`style-${c}`))])) as VoiceSettings['styles'] })}
      >
        <div className="ui-fields ui-fields-2">
          {VOICE_CONTEXTS.map((c) => (
            <div className="ui-field" key={c}>
              <label className="label" htmlFor={`vc-style-${c}`}>
                {tCtx(c)}
              </label>
              <select id={`vc-style-${c}`} name={`style-${c}`} className="select" defaultValue={s.styles[c]}>
                {VOICE_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tTone(tone)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </FormSection>
    </>
  );
}

function DictionarySettings({ initial, isAdmin }: { initial: VoiceDictionaryEntry[]; isAdmin: boolean }) {
  const t = useTranslations('voice.settings.dictionary');
  const tErr = useTranslations('voice.errors');
  const [entries, setEntries] = useState(initial);
  const [kind, setKind] = useState<VoiceDictionaryKind>('word');
  const [phrase, setPhrase] = useState('');
  const [replacement, setReplacement] = useState('');
  const [team, setTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<VoiceDictionaryEntry | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!phrase.trim() || (kind !== 'word' && !replacement.trim()) || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/voice/dictionary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, phrase, replacement: kind === 'word' ? undefined : replacement, shared: team || undefined }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (VoiceDictionaryEntry & { error?: string }) | null;
    setBusy(false);
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? (res ? 'generic' : 'network'));
      return;
    }
    setEntries((list) => [...list, data]);
    setPhrase('');
    setReplacement('');
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    const prev = entries;
    setEntries((list) => list.filter((x) => x.id !== id));
    const res = await fetch(`/api/voice/dictionary/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setEntries(prev);
      setError('generic');
    }
  }

  return (
    <FormSection title={t('title')} description={t('desc')}>
      <form className="vc-dict-form" onSubmit={add}>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as VoiceDictionaryKind)} aria-label={t('kind')}>
          <option value="word">{t('kinds.word')}</option>
          <option value="replace">{t('kinds.replace')}</option>
          <option value="snippet">{t('kinds.snippet')}</option>
        </select>
        <input className="input" value={phrase} onChange={(e) => setPhrase(e.target.value)} maxLength={100} aria-label={t(`phrase.${kind}`)} placeholder={t(`phrase.${kind}`)} />
        {kind !== 'word' && (
          <input
            className="input"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            maxLength={2000}
            aria-label={t(`replacement.${kind}`)}
            placeholder={t(`replacement.${kind}`)}
          />
        )}
        <button type="submit" className="btn btn-secondary" disabled={busy || !phrase.trim() || (kind !== 'word' && !replacement.trim())}>
          {t('add')}
        </button>
      </form>
      {isAdmin && (
        <label className="ui-check vc-team-check">
          <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} />
          <span>{t('teamCheck')}</span>
        </label>
      )}
      <p className="ui-help">
        {t(`help.${kind}`)} {t('teamHelp')}
      </p>
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}
      {entries.length === 0 ? (
        <EmptyState compact body={t('empty')} />
      ) : (
        <ul className="vc-list" aria-label={t('title')}>
          {entries.map((e) => (
            <li key={e.id} className="vc-row" data-testid="voice-dictionary-row">
              <span className="vc-row-main">
                <span className="vc-row-title">{e.phrase}</span>
                <span className="vc-muted vc-row-meta">
                  {e.shared && `${t('teamBadge')} · `}
                  {t(`kinds.${e.kind}`)}
                  {e.replacement && ` → ${e.replacement}`}
                </span>
              </span>
              {(!e.shared || isAdmin) && (
                <span className="vc-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(e)}>
                    {t('delete')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t('deleteTitle')}
        body={t('deleteBody', { phrase: deleting?.phrase ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </FormSection>
  );
}

function TemplatesSettings({ initial }: { initial: VoiceTemplate[] }) {
  const t = useTranslations('voice.settings.templates');
  const tTpl = useTranslations('voice.templates.builtin');
  const tErr = useTranslations('voice.errors');
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<{ id: string | null; name: string; instructions: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<VoiceTemplate | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !editing.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(editing.id ? `/api/voice/templates/${editing.id}` : '/api/voice/templates', {
      method: editing.id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: editing.name, instructions: editing.instructions }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (VoiceTemplate & { error?: string }) | null;
    setBusy(false);
    if (!res?.ok || !data?.id) {
      setError(data?.error ?? (res ? 'generic' : 'network'));
      return;
    }
    setList((l) => (editing.id ? l.map((x) => (x.id === data.id ? data : x)) : [...l, data]));
    setEditing(null);
  }

  async function remove() {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    const res = await fetch(`/api/voice/templates/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setError('generic');
      return;
    }
    setList((l) => l.filter((x) => x.id !== id));
  }

  return (
    <>
      <FormSection
        title={t('customTitle')}
        description={t('customDesc')}
        footer={
          !editing && (
            <button type="button" className="btn btn-secondary" onClick={() => setEditing({ id: null, name: '', instructions: '' })}>
              {t('new')}
            </button>
          )
        }
      >
        {editing && (
          <form className="vc-template-form" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}>
            <div className="ui-field">
              <label className="label" htmlFor="vc-tpl-name">
                {t('name')}
              </label>
              <input id="vc-tpl-name" className="input" value={editing.name} maxLength={100} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="vc-tpl-instr">
                {t('instructions')}
              </label>
              <textarea
                id="vc-tpl-instr"
                className="textarea"
                rows={6}
                value={editing.instructions}
                maxLength={4000}
                placeholder={t('instructionsPlaceholder')}
                onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
              />
              <p className="ui-help">{t('instructionsHelp')}</p>
            </div>
            <div className="vc-send-row">
              <button type="submit" className="btn btn-primary" disabled={busy || !editing.name.trim()}>
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
          <EmptyState compact body={t('empty')} />
        ) : (
          <ul className="vc-list" aria-label={t('customTitle')}>
            {list.map((tp) => (
              <li key={tp.id} className="vc-row" data-testid="voice-template-row">
                <span className="vc-row-main">
                  <span className="vc-row-title">{tp.name}</span>
                  {tp.instructions && <span className="vc-muted vc-row-meta">{tp.instructions.split('\n').filter(Boolean).slice(0, 3).join(' · ')}</span>}
                </span>
                <span className="vc-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: tp.id, name: tp.name, instructions: tp.instructions })}>
                    {t('edit')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(tp)}>
                    {t('delete')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </FormSection>
      <FormSection title={t('builtinTitle')} description={t('builtinDesc')}>
        <ul className="vc-list">
          {VOICE_BUILTIN_TEMPLATES.map((k) => (
            <li key={k} className="vc-row">
              <span className="vc-row-main">
                <span className="vc-row-title">{tTpl(k)}</span>
                <span className="vc-muted vc-row-meta">{t(`builtinSections.${k}`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </FormSection>
      <ConfirmDialog
        open={!!deleting}
        title={t('deleteTitle')}
        body={t('deleteBody', { name: deleting?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function DesktopSettings({ provider }: { provider: string }) {
  const t = useTranslations('voice.settings.desktop');
  return (
    <>
      <FormSection title={t('title')} description={t('desc')}>
        <p className="vc-notice">{t('unsigned')}</p>
        <ol className="vc-steps">
          <li>
            {t('step1')} <Link href="/download">{t('step1Link')}</Link>
          </li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
        </ol>
        <p>
          <Link className="btn btn-secondary" href="/download">
            {t('source')}
          </Link>
        </p>
      </FormSection>
      <FormSection title={t('whatTitle')} description={t('whatDesc')}>
        <ul className="vc-points">
          <li>{t('what1')}</li>
          <li>{t('what2')}</li>
          <li>{t('what3')}</li>
        </ul>
        <p className="ui-help">{t('provider', { provider })}</p>
      </FormSection>
    </>
  );
}
