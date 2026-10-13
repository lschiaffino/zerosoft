'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import {
  AGENT_TEMPLATE_KEYS,
  AGENT_TOOL_KEYS,
  type AgentDto,
  type AgentTemplateKey,
  type AgentToolKey,
} from '@/lib/agents-config';
import type { AgentKnowledgeUrlDto, AgentWidgetOption } from '@/lib/agents';
import AgentChat from './AgentChat';
import AgentConversations from './AgentConversations';
import { api, chatLabels, errorText } from './agents-ui';

export interface EditorRefs {
  docsPages: Array<{ id: string; title: string; isPublic: boolean }>;
  widgets: AgentWidgetOption[];
  eventTypes: Array<{ id: string; title: string; durationMin: number }>;
  projects: Array<{ id: string; name: string }>;
  flows: Array<{ id: string; name: string }>;
}

interface Props extends EditorRefs {
  agent: AgentDto;
  urls: AgentKnowledgeUrlDto[];
  canEdit: boolean;
  aiEnabled: boolean;
  origin: string;
  initialTab?: string;
  initialConversationId?: string | null;
}

const TABS = ['instructions', 'knowledge', 'tools', 'channels', 'playground', 'conversations'] as const;
type Tab = (typeof TABS)[number];

type Draft = Omit<AgentDto, 'id' | 'createdAt' | 'updatedAt'>;

function toDraft(a: AgentDto): Draft {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = a;
  void _id;
  void _c;
  void _u;
  return JSON.parse(JSON.stringify(rest)) as Draft;
}

const lines = (raw: string) =>
  raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Editor de un agente (/app/agents/[id]) con pestañas. */
export default function AgentEditor(props: Props) {
  const { canEdit, aiEnabled, origin } = props;
  const t = useTranslations('agents');
  const router = useRouter();
  const [agent, setAgent] = useState(props.agent);
  const [draft, setDraft] = useState<Draft>(() => toDraft(props.agent));
  const [avoidRaw, setAvoidRaw] = useState(props.agent.guardrails.avoidTopics.join('\n'));
  const [keywordsRaw, setKeywordsRaw] = useState(props.agent.handoff.keywords.join(', '));
  const [domainsRaw, setDomainsRaw] = useState(props.agent.tools.httpAllowedDomains.join('\n'));
  const [urls, setUrls] = useState(props.urls);
  const [widgets, setWidgets] = useState(props.widgets);
  const [tab, setTab] = useState<Tab>(TABS.includes(props.initialTab as Tab) ? (props.initialTab as Tab) : 'instructions');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const payload = useMemo(
    () => ({
      ...draft,
      model: draft.model?.trim() || null,
      publicHandle: draft.publicHandle?.trim().toLowerCase() || null,
      guardrails: { ...draft.guardrails, avoidTopics: lines(avoidRaw) },
      handoff: { ...draft.handoff, keywords: lines(keywordsRaw) },
      tools: { ...draft.tools, httpAllowedDomains: lines(domainsRaw) },
    }),
    [draft, avoidRaw, keywordsRaw, domainsRaw],
  );
  const saved = useMemo(() => JSON.stringify(toDraft(agent)), [agent]);
  const dirty = JSON.stringify(payload) !== saved;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') !== tab) {
      url.searchParams.set('tab', tab);
      if (tab !== 'conversations') url.searchParams.delete('c');
      window.history.replaceState(null, '', url.toString());
    }
  }, [tab]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    const res = await api<{ agent?: AgentDto; urls?: AgentKnowledgeUrlDto[]; field?: string }>(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok || !res.data.agent) {
      const field = res.data.field ? ` (${t.has(`fields.${res.data.field}` as never) ? t(`fields.${res.data.field}` as never) : res.data.field})` : '';
      setNotice({ kind: 'error', text: errorText(t, res.data.error) + field });
      return;
    }
    setAgent(res.data.agent);
    setDraft(toDraft(res.data.agent));
    setAvoidRaw(res.data.agent.guardrails.avoidTopics.join('\n'));
    setKeywordsRaw(res.data.agent.handoff.keywords.join(', '));
    setDomainsRaw(res.data.agent.tools.httpAllowedDomains.join('\n'));
    if (res.data.urls) setUrls(res.data.urls);
    setNotice({ kind: 'ok', text: t('editor.saved') });
  }

  async function remove() {
    if (!window.confirm(t('editor.deleteConfirm', { name: agent.name }))) return;
    const res = await api(`/api/agents/${agent.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setNotice({ kind: 'error', text: errorText(t, res.data.error) });
      return;
    }
    router.push('/app/agents');
  }

  async function refreshUrls() {
    setRefreshing(true);
    const res = await api<{ urls?: AgentKnowledgeUrlDto[] }>(`/api/agents/${agent.id}/knowledge`, { method: 'POST' });
    setRefreshing(false);
    if (res.ok && res.data.urls) setUrls(res.data.urls);
    else setNotice({ kind: 'error', text: errorText(t, res.data.error) });
  }

  async function assignWidget(widgetId: string, assigned: boolean) {
    const res = await api<{ widgets?: AgentWidgetOption[] }>(`/api/agents/${agent.id}/widgets`, {
      method: 'POST',
      body: JSON.stringify({ widgetId, assigned }),
    });
    if (res.ok && res.data.widgets) setWidgets(res.data.widgets);
    else setNotice({ kind: 'error', text: errorText(t, res.data.error) });
  }

  function applyTemplate(key: AgentTemplateKey) {
    if (draft.instructions.trim() && !window.confirm(t('instructions.replaceConfirm'))) return;
    setDraft((d) => ({
      ...d,
      instructions: t(`templates.${key}.instructions`),
      welcomeMessage: d.welcomeMessage || t(`templates.${key}.welcome`),
    }));
  }

  function toggleTool(key: AgentToolKey, on: boolean) {
    setDraft((d) => {
      const enabled = on ? [...new Set([...d.tools.enabled, key])] : d.tools.enabled.filter((k) => k !== key);
      // Reservar sin poder ver disponibilidad no tiene sentido: van juntas.
      if (on && key === 'cal_book_meeting' && !enabled.includes('cal_get_availability')) enabled.push('cal_get_availability');
      return { ...d, tools: { ...d.tools, enabled } };
    });
  }

  function addUrl() {
    const u = newUrl.trim();
    if (!u) return;
    try {
      const parsed = new URL(u);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      setNotice({ kind: 'error', text: t('errors.invalid_url') });
      return;
    }
    if (!draft.knowledge.urls.includes(u)) set('knowledge', { ...draft.knowledge, urls: [...draft.knowledge.urls, u] });
    setNewUrl('');
  }

  const ro = !canEdit;
  const publicUrl = draft.publicHandle ? `${origin}/a/${draft.publicHandle}` : null;
  const savedPublicUrl = agent.publicHandle ? `${origin}/a/${agent.publicHandle}` : null;
  const apiSnippet = `curl -X POST ${origin}/api/v1/agents/${agent.id}/messages \\
  -H "Authorization: Bearer $ZEROSOFT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hi! Do you ship to Brazil?"}'`;
  const toolNeeds = (key: AgentToolKey): string | null => {
    if ((key === 'cal_get_availability' || key === 'cal_book_meeting') && !draft.tools.calEventTypeId) return t('tools.needsEventType');
    if (key === 'track_create_issue' && !draft.tools.trackProjectId) return t('tools.needsProject');
    if (key === 'run_flow' && draft.tools.flowIds.length === 0) return t('tools.needsFlows');
    if (key === 'http_request' && lines(domainsRaw).length === 0) return t('tools.needsDomains');
    return null;
  };

  return (
    <div className="app-page ag-editor">
      <div className="ag-editor-head">
        <Link href="/app/agents" className="ag-back">
          ← {t('editor.back')}
        </Link>
        <div className="ag-editor-title">
          <input
            className="ag-emoji-input"
            value={draft.emoji}
            maxLength={8}
            disabled={ro}
            aria-label={t('editor.emoji')}
            onChange={(e) => set('emoji', e.target.value)}
          />
          <input
            className="ag-name-input"
            value={draft.name}
            maxLength={80}
            disabled={ro}
            aria-label={t('editor.name')}
            placeholder={t('editor.namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
          <label className="ag-switch">
            <input type="checkbox" checked={draft.enabled} disabled={ro} onChange={(e) => set('enabled', e.target.checked)} />
            <span className="ag-switch-track" aria-hidden="true" />
            <span className="ag-switch-label">{draft.enabled ? t('list.enabled') : t('list.disabled')}</span>
          </label>
          <span className="ag-editor-spacer" />
          {notice && (
            <span className={`ag-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
            </span>
          )}
          {canEdit && (
            <>
              <button type="button" className="ag-link is-danger" onClick={remove}>
                {t('editor.delete')}
              </button>
              <button type="button" className="btn btn-solid btn-small" disabled={!dirty || saving} onClick={save}>
                {saving ? t('editor.saving') : dirty ? t('editor.save') : t('editor.upToDate')}
              </button>
            </>
          )}
        </div>
        {ro && <p className="muted ag-note">{t('editor.readOnly')}</p>}
        {!aiEnabled && (
          <div className="ag-banner" role="note">
            <strong>{t('aiOff.title')}</strong>
            <span>{t('aiOff.body')}</span>
          </div>
        )}
        <div className="ag-tabs" role="tablist" aria-label={t('editor.tabsLabel')}>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`ag-tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`ag-panel-${k}`}
              className={`ag-tab${tab === k ? ' is-active' : ''}`}
              onClick={() => setTab(k)}
            >
              {t(`tabs.${k}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'instructions' && (
        <div className="ag-panel" role="tabpanel" id="ag-panel-instructions" aria-labelledby="ag-tab-instructions">
          <section className="ag-card">
            <div className="ag-card-head">
              <div>
                <h3>{t('instructions.title')}</h3>
                <p className="muted">{t('instructions.hint')}</p>
              </div>
              {canEdit && (
                <select
                  className="select ag-select-sm"
                  value=""
                  aria-label={t('instructions.template')}
                  onChange={(e) => e.target.value && applyTemplate(e.target.value as AgentTemplateKey)}
                >
                  <option value="">{t('instructions.template')}</option>
                  {AGENT_TEMPLATE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {t(`templates.${k}.name`)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <textarea
              className="textarea ag-instructions"
              rows={14}
              value={draft.instructions}
              disabled={ro}
              placeholder={t('instructions.placeholder')}
              onChange={(e) => set('instructions', e.target.value)}
            />
            <p className="muted ag-hint">{t('instructions.safety')}</p>
          </section>

          <section className="ag-card">
            <h3>{t('instructions.welcomeTitle')}</h3>
            <input
              className="input"
              value={draft.welcomeMessage}
              maxLength={500}
              disabled={ro}
              placeholder={t('instructions.welcomePlaceholder')}
              onChange={(e) => set('welcomeMessage', e.target.value)}
            />
            <p className="muted ag-hint">{t('instructions.welcomeHint')}</p>
          </section>

          <div className="ag-grid-2">
            <section className="ag-card">
              <h3>{t('handoff.title')}</h3>
              <label className="ag-check">
                <input
                  type="checkbox"
                  checked={draft.handoff.onRequest}
                  disabled={ro}
                  onChange={(e) => set('handoff', { ...draft.handoff, onRequest: e.target.checked })}
                />
                {t('handoff.onRequest')}
              </label>
              <label className="ag-check">
                <input
                  type="checkbox"
                  checked={draft.handoff.onUnsure}
                  disabled={ro}
                  onChange={(e) => set('handoff', { ...draft.handoff, onUnsure: e.target.checked })}
                />
                {t('handoff.onUnsure')}
              </label>
              <label className="ag-field">
                <span className="label">{t('handoff.keywords')}</span>
                <input
                  className="input"
                  value={keywordsRaw}
                  disabled={ro}
                  placeholder={t('handoff.keywordsPlaceholder')}
                  onChange={(e) => setKeywordsRaw(e.target.value)}
                />
                <span className="muted ag-hint">{t('handoff.keywordsHint')}</span>
              </label>
              <label className="ag-field">
                <span className="label">{t('handoff.message')}</span>
                <input
                  className="input"
                  value={draft.handoff.message}
                  maxLength={500}
                  disabled={ro}
                  placeholder={t('handoff.messagePlaceholder')}
                  onChange={(e) => set('handoff', { ...draft.handoff, message: e.target.value })}
                />
              </label>
              {!draft.tools.enabled.includes('handoff_to_human') && <p className="ag-warn">{t('handoff.toolOff')}</p>}
            </section>

            <section className="ag-card">
              <h3>{t('guardrails.title')}</h3>
              <label className="ag-field">
                <span className="label">{t('guardrails.avoid')}</span>
                <textarea
                  className="textarea"
                  rows={4}
                  value={avoidRaw}
                  disabled={ro}
                  placeholder={t('guardrails.avoidPlaceholder')}
                  onChange={(e) => setAvoidRaw(e.target.value)}
                />
              </label>
              <label className="ag-field">
                <span className="label">{t('guardrails.maxChars')}</span>
                <input
                  className="input"
                  type="number"
                  min={100}
                  max={4000}
                  step={50}
                  value={draft.guardrails.maxReplyChars}
                  disabled={ro}
                  onChange={(e) => set('guardrails', { ...draft.guardrails, maxReplyChars: Number(e.target.value) || 800 })}
                />
              </label>
              <div className="ag-row-fields">
                <label className="ag-field">
                  <span className="label">{t('model.title')}</span>
                  <input
                    className="input mono"
                    value={draft.model ?? ''}
                    disabled={ro}
                    placeholder={t('model.placeholder')}
                    onChange={(e) => set('model', e.target.value)}
                  />
                </label>
                <label className="ag-field">
                  <span className="label">
                    {t('model.temperature')} <span className="mono">{draft.temperature.toFixed(1)}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={draft.temperature}
                    disabled={ro}
                    onChange={(e) => set('temperature', Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="muted ag-hint">{t('model.hint')}</p>
            </section>
          </div>
        </div>
      )}

      {tab === 'knowledge' && (
        <div className="ag-panel" role="tabpanel" id="ag-panel-knowledge" aria-labelledby="ag-tab-knowledge">
          {!draft.tools.enabled.includes('search_knowledge') && <p className="ag-warn">{t('knowledge.toolOff')}</p>}
          <section className="ag-card">
            <h3>{t('knowledge.docsTitle')}</h3>
            <p className="muted">{t('knowledge.docsHint')}</p>
            <label className="ag-check">
              <input
                type="checkbox"
                checked={draft.knowledge.allPublicDocs}
                disabled={ro}
                onChange={(e) => set('knowledge', { ...draft.knowledge, allPublicDocs: e.target.checked })}
              />
              {t('knowledge.allPublic')}
            </label>
            {props.docsPages.length === 0 ? (
              <p className="muted ag-hint">
                {t('knowledge.noPages')} <Link href="/app/docs">{t('knowledge.openDocs')}</Link>
              </p>
            ) : (
              <ul className="ag-checklist">
                {props.docsPages.map((p) => {
                  const viaPublic = draft.knowledge.allPublicDocs && p.isPublic;
                  const checked = viaPublic || draft.knowledge.docsPageIds.includes(p.id);
                  return (
                    <li key={p.id}>
                      <label className="ag-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={ro || viaPublic}
                          onChange={(e) =>
                            set('knowledge', {
                              ...draft.knowledge,
                              docsPageIds: e.target.checked
                                ? [...draft.knowledge.docsPageIds, p.id]
                                : draft.knowledge.docsPageIds.filter((x) => x !== p.id),
                            })
                          }
                        />
                        <span>{p.title || t('knowledge.untitledPage')}</span>
                        <span className="ag-meta mono">{p.isPublic ? t('knowledge.public') : t('knowledge.private')}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {draft.knowledge.docsPageIds.some((id) => props.docsPages.find((p) => p.id === id && !p.isPublic)) && (
              <p className="ag-warn">{t('knowledge.privateWarn')}</p>
            )}
          </section>

          <section className="ag-card">
            <div className="ag-card-head">
              <div>
                <h3>{t('knowledge.urlsTitle')}</h3>
                <p className="muted">{t('knowledge.urlsHint')}</p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={refreshing || urls.length === 0 || dirty}
                  title={dirty ? t('knowledge.saveFirst') : undefined}
                  onClick={refreshUrls}
                >
                  {refreshing ? t('knowledge.refreshing') : t('knowledge.refresh')}
                </button>
              )}
            </div>
            {draft.knowledge.urls.length > 0 && (
              <ul className="ag-urls">
                {draft.knowledge.urls.map((u) => {
                  const row = urls.find((r) => r.url === u);
                  const status = row?.status ?? 'pending';
                  return (
                    <li key={u}>
                      <span className={`ag-dot is-${status}`} aria-hidden="true" />
                      <span className="ag-url-main">
                        <a href={u} target="_blank" rel="noreferrer">
                          {row?.title || u}
                        </a>
                        <span className="muted mono">
                          {status === 'ok'
                            ? t('knowledge.fetched', { chars: row?.chars ?? 0 })
                            : status === 'error'
                              ? t('knowledge.failed', { error: row?.error ?? '' })
                              : t('knowledge.pending')}
                        </span>
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          className="ag-link"
                          onClick={() => set('knowledge', { ...draft.knowledge, urls: draft.knowledge.urls.filter((x) => x !== u) })}
                        >
                          {t('knowledge.remove')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit && (
              <form
                className="ag-inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  addUrl();
                }}
              >
                <input
                  className="input"
                  type="url"
                  value={newUrl}
                  placeholder="https://example.com/pricing"
                  aria-label={t('knowledge.addUrl')}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
                <button type="submit" className="btn btn-small" disabled={!newUrl.trim() || draft.knowledge.urls.length >= 20}>
                  {t('knowledge.addUrl')}
                </button>
              </form>
            )}
            {dirty && draft.knowledge.urls.some((u) => !urls.find((r) => r.url === u)) && (
              <p className="muted ag-hint">{t('knowledge.saveFirst')}</p>
            )}
          </section>

          <section className="ag-card">
            <h3>{t('knowledge.cannedTitle')}</h3>
            <p className="muted">{t('knowledge.cannedHint')}</p>
            <select
              className="select"
              value={draft.knowledge.cannedFromWidgetId ?? ''}
              disabled={ro}
              onChange={(e) => set('knowledge', { ...draft.knowledge, cannedFromWidgetId: e.target.value || null })}
            >
              <option value="">{t('knowledge.cannedNone')}</option>
              {widgets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </section>
        </div>
      )}

      {tab === 'tools' && (
        <div className="ag-panel" role="tabpanel" id="ag-panel-tools" aria-labelledby="ag-tab-tools">
          <p className="muted ag-intro">{t('tools.intro')}</p>
          <div className="ag-tool-list">
            {AGENT_TOOL_KEYS.map((key) => {
              const on = draft.tools.enabled.includes(key);
              const needs = on ? toolNeeds(key) : null;
              return (
                <section key={key} className={`ag-tool-row${on ? ' is-on' : ''}`}>
                  <div className="ag-tool-row-head">
                    <label className="ag-switch">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={ro}
                        onChange={(e) => toggleTool(key, e.target.checked)}
                        aria-label={t(`tools.items.${key}.name`)}
                      />
                      <span className="ag-switch-track" aria-hidden="true" />
                    </label>
                    <div className="ag-tool-row-text">
                      <h3>
                        {t(`tools.items.${key}.name`)} <span className="ag-meta mono">{key}</span>
                      </h3>
                      <p className="muted">{t(`tools.items.${key}.desc`)}</p>
                      {needs && <p className="ag-warn">{needs}</p>}
                    </div>
                  </div>
                  {on && key === 'cal_get_availability' && (
                    <div className="ag-tool-config">
                      <label className="ag-field">
                        <span className="label">{t('tools.eventType')}</span>
                        <select
                          className="select"
                          value={draft.tools.calEventTypeId ?? ''}
                          disabled={ro}
                          onChange={(e) => set('tools', { ...draft.tools, calEventTypeId: e.target.value || null })}
                        >
                          <option value="">{t('tools.choose')}</option>
                          {props.eventTypes.map((et) => (
                            <option key={et.id} value={et.id}>
                              {et.title} · {et.durationMin} min
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="ag-field ag-field-sm">
                        <span className="label">{t('tools.days')}</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={30}
                          value={draft.tools.calDays}
                          disabled={ro}
                          onChange={(e) => set('tools', { ...draft.tools, calDays: Math.min(30, Math.max(1, Number(e.target.value) || 7)) })}
                        />
                      </label>
                      {props.eventTypes.length === 0 && (
                        <p className="muted ag-hint">
                          {t('tools.noEventTypes')} <Link href="/app/calendar/event-types/new">{t('tools.create')}</Link>
                        </p>
                      )}
                    </div>
                  )}
                  {on && key === 'cal_book_meeting' && <p className="muted ag-hint ag-tool-config">{t('tools.bookingSafety')}</p>}
                  {on && key === 'track_create_issue' && (
                    <div className="ag-tool-config">
                      <label className="ag-field">
                        <span className="label">{t('tools.project')}</span>
                        <select
                          className="select"
                          value={draft.tools.trackProjectId ?? ''}
                          disabled={ro}
                          onChange={(e) => set('tools', { ...draft.tools, trackProjectId: e.target.value || null })}
                        >
                          <option value="">{t('tools.choose')}</option>
                          {props.projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  {on && key === 'run_flow' && (
                    <div className="ag-tool-config">
                      <span className="label">{t('tools.flows')}</span>
                      {props.flows.length === 0 ? (
                        <p className="muted ag-hint">
                          {t('tools.noFlows')} <Link href="/app/flow">{t('tools.create')}</Link>
                        </p>
                      ) : (
                        <ul className="ag-checklist">
                          {props.flows.map((f) => (
                            <li key={f.id}>
                              <label className="ag-check">
                                <input
                                  type="checkbox"
                                  checked={draft.tools.flowIds.includes(f.id)}
                                  disabled={ro}
                                  onChange={(e) =>
                                    set('tools', {
                                      ...draft.tools,
                                      flowIds: e.target.checked
                                        ? [...draft.tools.flowIds, f.id]
                                        : draft.tools.flowIds.filter((x) => x !== f.id),
                                    })
                                  }
                                />
                                {f.name}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {on && key === 'http_request' && (
                    <div className="ag-tool-config">
                      <label className="ag-field">
                        <span className="label">{t('tools.domains')}</span>
                        <textarea
                          className="textarea mono"
                          rows={3}
                          value={domainsRaw}
                          disabled={ro}
                          placeholder={'api.example.com\nexample.org'}
                          onChange={(e) => setDomainsRaw(e.target.value)}
                        />
                      </label>
                      <p className="ag-warn">{t('tools.httpWarn')}</p>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'channels' && (
        <div className="ag-panel" role="tabpanel" id="ag-panel-channels" aria-labelledby="ag-tab-channels">
          <section className="ag-card">
            <h3>{t('channels.chatTitle')}</h3>
            <p className="muted">{t('channels.chatHint')}</p>
            {widgets.length === 0 ? (
              <p className="muted ag-hint">
                {t('channels.noWidgets')} <Link href="/app/chat/widgets/new">{t('tools.create')}</Link>
              </p>
            ) : (
              <ul className="ag-widget-list">
                {widgets.map((w) => {
                  const mine = w.agentId === agent.id;
                  const other = w.agentId && !mine;
                  return (
                    <li key={w.id}>
                      <span className="ag-widget-name">{w.name}</span>
                      <span className="muted ag-meta">
                        {mine ? t('channels.answeredByThis') : other ? t('channels.answeredByOther') : t(`channels.source.${w.botEnabled ? w.botSource : 'off'}`)}
                      </span>
                      {canEdit && (
                        <button type="button" className="btn btn-small" onClick={() => assignWidget(w.id, !mine)}>
                          {mine ? t('channels.unassign') : t('channels.assign')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="ag-card">
            <h3>{t('channels.publicTitle')}</h3>
            <p className="muted">{t('channels.publicHint')}</p>
            <div className="ag-inline-form">
              <span className="ag-prefix mono">{origin.replace(/^https?:\/\//, '')}/a/</span>
              <input
                className="input mono"
                value={draft.publicHandle ?? ''}
                maxLength={40}
                disabled={ro}
                placeholder={t('channels.handlePlaceholder')}
                aria-label={t('channels.handle')}
                onChange={(e) => set('publicHandle', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              />
            </div>
            {savedPublicUrl && publicUrl === savedPublicUrl ? (
              <p className="ag-hint">
                <a href={savedPublicUrl} target="_blank" rel="noreferrer" className="mono">
                  {savedPublicUrl}
                </a>
                {!agent.enabled && <span className="ag-warn"> {t('channels.disabledWarn')}</span>}
              </p>
            ) : (
              <p className="muted ag-hint">{draft.publicHandle ? t('channels.saveToPublish') : t('channels.publicOff')}</p>
            )}
          </section>

          <section className="ag-card">
            <h3>{t('channels.apiTitle')}</h3>
            <p className="muted">
              {t('channels.apiHint')} <Link href="/app/settings">{t('channels.apiKeys')}</Link>
            </p>
            <pre className="ag-code">{apiSnippet}</pre>
            <p className="muted ag-hint">{t('channels.apiContinue')}</p>
          </section>
        </div>
      )}

      {tab === 'playground' && (
        <div className="ag-panel" role="tabpanel" id="ag-panel-playground" aria-labelledby="ag-tab-playground">
          <p className="muted ag-intro">{dirty ? t('playground.unsaved') : t('playground.intro')}</p>
          <AgentChat
            key={`${agent.id}-${agent.updatedAt}`}
            endpoint={`/api/agents/${agent.id}/messages`}
            labels={chatLabels(t)}
            welcome={agent.welcomeMessage || undefined}
            showTools
            disabledReason={aiEnabled ? null : t('playground.aiOff')}
            onConversation={() => setHistoryKey((k) => k + 1)}
          />
        </div>
      )}

      {tab === 'conversations' && (
        <div className="ag-panel" role="tabpanel" id="ag-panel-conversations" aria-labelledby="ag-tab-conversations">
          <AgentConversations key={historyKey} agentId={agent.id} initialConversationId={props.initialConversationId ?? null} />
        </div>
      )}
    </div>
  );
}
