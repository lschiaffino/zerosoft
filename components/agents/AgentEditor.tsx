'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import {
  AGENT_MAX_URLS,
  AGENT_TEMPLATE_KEYS,
  AGENT_TOOL_GROUP_ORDER,
  agentToolsInGroup,
  suggestAgentHandle,
  type AgentDto,
  type AgentTemplateKey,
  type AgentToolKey,
} from '@/lib/agents-config';
import type { AgentKnowledgeUrlDto, AgentWidgetOption } from '@/lib/agents';
import { PRODUCT_CONFIG } from '@/lib/products';
import PageHeader from '@/components/ui/PageHeader';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import EmptyState from '@/components/ui/EmptyState';
import ProductGlyph from '@/components/brand/ProductGlyph';
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

/** Editor de un agente (/app/agents/[id]) con pestañas y un solo Guardar. */
export default function AgentEditor(props: Props) {
  const { canEdit, aiEnabled, origin } = props;
  const t = useTranslations('agents');
  const format = useFormatter();
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
  const [urlError, setUrlError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

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

  // ⌘S / Ctrl+S guarda desde cualquier pestaña.
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function resetFrom(a: AgentDto) {
    setDraft(toDraft(a));
    setAvoidRaw(a.guardrails.avoidTopics.join('\n'));
    setKeywordsRaw(a.handoff.keywords.join(', '));
    setDomainsRaw(a.tools.httpAllowedDomains.join('\n'));
  }

  async function save() {
    if (!canEdit || !dirty || saving) return;
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
    resetFrom(res.data.agent);
    if (res.data.urls) setUrls(res.data.urls);
    setNotice({ kind: 'ok', text: t('editor.saved') });
  }
  saveRef.current = () => void save();

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
      setUrlError(t('errors.invalid_url'));
      return;
    }
    setUrlError(null);
    if (!draft.knowledge.urls.includes(u)) set('knowledge', { ...draft.knowledge, urls: [...draft.knowledge.urls, u] });
    setNewUrl('');
  }

  function togglePublic(on: boolean) {
    set('publicHandle', on ? draft.publicHandle || agent.publicHandle || suggestAgentHandle(draft.name) || '' : null);
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.indexOf(tab);
    const next =
      e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length]
      : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length]
      : e.key === 'Home' ? TABS[0]
      : e.key === 'End' ? TABS[TABS.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(apiSnippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* sin permiso de portapapeles: el bloque sigue seleccionable */
    }
  }

  const ro = !canEdit;
  const publicOn = draft.publicHandle !== null;
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
  const wide = tab === 'playground' || tab === 'conversations';

  function renderTool(key: AgentToolKey) {
    const on = draft.tools.enabled.includes(key);
    const needs = on ? toolNeeds(key) : null;
    const descId = `ag-tool-desc-${key}`;
    return (
      <li key={key} className="ag-tool-row">
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            checked={on}
            disabled={ro}
            aria-describedby={descId}
            onChange={(e) => toggleTool(key, e.target.checked)}
          />
          <span className="ag-tool-name">{t(`tools.items.${key}.name`)}</span>
        </label>
        <p className="ui-help ag-tool-desc" id={descId}>
          {t(`tools.items.${key}.desc`)}
        </p>
        {needs && <p className="ui-error ag-tool-desc">{needs}</p>}
        {on && key === 'cal_get_availability' && (
          <div className="ag-tool-config">
            {props.eventTypes.length === 0 ? (
              <p className="ui-help">
                {t('tools.noEventTypes')} <Link href="/app/calendar/event-types/new">{t('tools.create')}</Link>
              </p>
            ) : (
              <div className="ag-config-row">
                <div className="ui-field">
                  <label className="label" htmlFor="ag-event-type">
                    {t('tools.eventType')}
                  </label>
                  <select
                    id="ag-event-type"
                    className="select"
                    value={draft.tools.calEventTypeId ?? ''}
                    disabled={ro}
                    aria-invalid={!draft.tools.calEventTypeId || undefined}
                    onChange={(e) => set('tools', { ...draft.tools, calEventTypeId: e.target.value || null })}
                  >
                    <option value="">{t('tools.choose')}</option>
                    {props.eventTypes.map((et) => (
                      <option key={et.id} value={et.id}>
                        {et.title} · {et.durationMin} min
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ui-field ag-field-num">
                  <label className="label" htmlFor="ag-cal-days">
                    {t('tools.days')}
                  </label>
                  <input
                    id="ag-cal-days"
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={30}
                    value={draft.tools.calDays}
                    disabled={ro}
                    onChange={(e) => set('tools', { ...draft.tools, calDays: Math.min(30, Math.max(1, Number(e.target.value) || 7)) })}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {on && key === 'cal_book_meeting' && <p className="ui-help ag-tool-config">{t('tools.bookingSafety')}</p>}
        {on && key === 'track_create_issue' && (
          <div className="ag-tool-config">
            <div className="ui-field">
              <label className="label" htmlFor="ag-track-project">
                {t('tools.project')}
              </label>
              <select
                id="ag-track-project"
                className="select"
                value={draft.tools.trackProjectId ?? ''}
                disabled={ro}
                aria-invalid={!draft.tools.trackProjectId || undefined}
                onChange={(e) => set('tools', { ...draft.tools, trackProjectId: e.target.value || null })}
              >
                <option value="">{t('tools.choose')}</option>
                {props.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {on && key === 'run_flow' && (
          <fieldset className="ag-tool-config ag-fieldset">
            <legend className="label">{t('tools.flows')}</legend>
            {props.flows.length === 0 ? (
              <p className="ui-help">
                {t('tools.noFlows')} <Link href="/app/flow">{t('tools.create')}</Link>
              </p>
            ) : (
              <ul className="ag-checklist">
                {props.flows.map((f) => (
                  <li key={f.id}>
                    <label className="ui-check">
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
          </fieldset>
        )}
        {on && key === 'http_request' && (
          <div className="ag-tool-config">
            <div className="ui-field">
              <label className="label" htmlFor="ag-http-domains">
                {t('tools.domains')}
              </label>
              <textarea
                id="ag-http-domains"
                className="textarea data"
                rows={3}
                value={domainsRaw}
                disabled={ro}
                placeholder={'api.example.com\nexample.org'}
                onChange={(e) => setDomainsRaw(e.target.value)}
              />
              <p className="ui-help">{t('tools.httpWarn')}</p>
            </div>
          </div>
        )}
      </li>
    );
  }

  const saveActions = canEdit ? (
    <>
      <span
        className="ag-save-note"
        role={notice?.kind === 'error' ? 'alert' : 'status'}
        data-tone={notice?.kind ?? (dirty ? 'dirty' : undefined)}
      >
        {notice ? notice.text : dirty ? t('editor.unsaved') : ''}
      </span>
      {/* Sin cambios no hay nada que guardar: Descartar y Guardar aparecen recién con el formulario sucio. */}
      {dirty && (
        <>
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => resetFrom(agent)}>
            {t('editor.discard')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            aria-busy={saving || undefined}
            aria-keyshortcuts="Meta+S Control+S"
            title={t('editor.shortcut')}
            onClick={save}
          >
            {saving ? t('editor.saving') : t('editor.save')}
          </button>
        </>
      )}
    </>
  ) : null;

  return (
    <div className="app-page ui-page ag-editor">
      <PageHeader
        back={{ href: '/app/agents', label: t('editor.back') }}
        title={draft.name.trim() || t('editor.untitled')}
        description={
          <label className="ui-switch">
            <input
              type="checkbox"
              role="switch"
              checked={draft.enabled}
              disabled={ro}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            <span>{draft.enabled ? t('list.enabled') : t('list.disabled')}</span>
            <span className="sr-only">{t('editor.enabled')}</span>
          </label>
        }
        actions={saveActions}
      />
      {ro && <p className="ui-help">{t('editor.readOnly')}</p>}
      {!aiEnabled && (
        <div className="panel panel-quiet ag-note" role="note">
          <strong>{t('aiOff.title')}</strong> {t('aiOff.body')}
        </div>
      )}

      <div className="ui-tabs" role="tablist" aria-label={t('editor.tabsLabel')}>
        {TABS.map((k) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[k] = el;
            }}
            type="button"
            role="tab"
            id={`ag-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`ag-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            className="ui-tab"
            onClick={() => setTab(k)}
            onKeyDown={onTabKey}
          >
            {t(`tabs.${k}`)}
            {k === 'tools' && <span className="ui-tab-count">{draft.tools.enabled.length}</span>}
          </button>
        ))}
      </div>

      <div
        className={`ag-panel${wide ? '' : ' ag-panel-narrow'}`}
        role="tabpanel"
        id={`ag-panel-${tab}`}
        aria-labelledby={`ag-tab-${tab}`}
      >
        {tab === 'instructions' && (
          <>
            <FormSection title={t('instructions.title')} description={t('instructions.hint')}>
              <div className="ui-field">
                <label className="label" htmlFor="ag-name">
                  {t('editor.name')}
                </label>
                <input
                  id="ag-name"
                  className="input"
                  value={draft.name}
                  maxLength={80}
                  disabled={ro}
                  placeholder={t('editor.namePlaceholder')}
                  onChange={(e) => set('name', e.target.value)}
                />
              </div>
              {canEdit && (
                <div className="ui-field">
                  <label className="label" htmlFor="ag-template">
                    {t('instructions.templateLabel')}
                  </label>
                  <select
                    id="ag-template"
                    className="select"
                    value=""
                    aria-describedby="ag-template-help"
                    onChange={(e) => e.target.value && applyTemplate(e.target.value as AgentTemplateKey)}
                  >
                    <option value="">{t('instructions.template')}</option>
                    {AGENT_TEMPLATE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {t(`templates.${k}.name`)}
                      </option>
                    ))}
                  </select>
                  <p className="ui-help" id="ag-template-help">
                    {t('instructions.templateHelp')}
                  </p>
                </div>
              )}
              <div className="ui-field">
                <label className="label" htmlFor="ag-instructions">
                  {t('instructions.instructionsLabel')}
                </label>
                <textarea
                  id="ag-instructions"
                  className="textarea ag-instructions"
                  rows={14}
                  value={draft.instructions}
                  disabled={ro}
                  aria-describedby="ag-instructions-help"
                  placeholder={t('instructions.placeholder')}
                  onChange={(e) => set('instructions', e.target.value)}
                />
                <p className="ui-help" id="ag-instructions-help">
                  {t('instructions.instructionsHelp')} {t('instructions.safety')}
                </p>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor="ag-welcome">
                  {t('instructions.welcomeTitle')}
                </label>
                <input
                  id="ag-welcome"
                  className="input"
                  value={draft.welcomeMessage}
                  maxLength={500}
                  disabled={ro}
                  aria-describedby="ag-welcome-help"
                  placeholder={t('instructions.welcomePlaceholder')}
                  onChange={(e) => set('welcomeMessage', e.target.value)}
                />
                <p className="ui-help" id="ag-welcome-help">
                  {t('instructions.welcomeHint')}
                </p>
              </div>

              <AdvancedSection storageKey="agents.instructions" hint={t('instructions.advancedHint')}>
                <fieldset className="ag-fieldset">
                  <legend className="ag-legend">{t('handoff.title')}</legend>
                  <label className="ui-check">
                    <input
                      type="checkbox"
                      checked={draft.handoff.onRequest}
                      disabled={ro}
                      onChange={(e) => set('handoff', { ...draft.handoff, onRequest: e.target.checked })}
                    />
                    {t('handoff.onRequest')}
                  </label>
                  <label className="ui-check">
                    <input
                      type="checkbox"
                      checked={draft.handoff.onUnsure}
                      disabled={ro}
                      onChange={(e) => set('handoff', { ...draft.handoff, onUnsure: e.target.checked })}
                    />
                    {t('handoff.onUnsure')}
                  </label>
                  <div className="ui-fields-2">
                    <div className="ui-field">
                      <label className="label" htmlFor="ag-keywords">
                        {t('handoff.keywords')}
                      </label>
                      <input
                        id="ag-keywords"
                        className="input"
                        value={keywordsRaw}
                        disabled={ro}
                        aria-describedby="ag-keywords-help"
                        placeholder={t('handoff.keywordsPlaceholder')}
                        onChange={(e) => setKeywordsRaw(e.target.value)}
                      />
                      <p className="ui-help" id="ag-keywords-help">
                        {t('handoff.keywordsHint')}
                      </p>
                    </div>
                    <div className="ui-field">
                      <label className="label" htmlFor="ag-handoff-msg">
                        {t('handoff.message')}
                      </label>
                      <input
                        id="ag-handoff-msg"
                        className="input"
                        value={draft.handoff.message}
                        maxLength={500}
                        disabled={ro}
                        placeholder={t('handoff.messagePlaceholder')}
                        onChange={(e) => set('handoff', { ...draft.handoff, message: e.target.value })}
                      />
                    </div>
                  </div>
                  {!draft.tools.enabled.includes('handoff_to_human') && <p className="ui-error">{t('handoff.toolOff')}</p>}
                </fieldset>

                <fieldset className="ag-fieldset">
                  <legend className="ag-legend">{t('guardrails.title')}</legend>
                  <div className="ui-field">
                    <label className="label" htmlFor="ag-avoid">
                      {t('guardrails.avoid')}
                    </label>
                    <textarea
                      id="ag-avoid"
                      className="textarea"
                      rows={3}
                      value={avoidRaw}
                      disabled={ro}
                      placeholder={t('guardrails.avoidPlaceholder')}
                      onChange={(e) => setAvoidRaw(e.target.value)}
                    />
                  </div>
                  <div className="ui-field ag-field-num">
                    <label className="label" htmlFor="ag-max-chars">
                      {t('guardrails.maxChars')}
                    </label>
                    <input
                      id="ag-max-chars"
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={100}
                      max={4000}
                      step={50}
                      value={draft.guardrails.maxReplyChars}
                      disabled={ro}
                      onChange={(e) => set('guardrails', { ...draft.guardrails, maxReplyChars: Number(e.target.value) || 800 })}
                    />
                  </div>
                </fieldset>

                <fieldset className="ag-fieldset">
                  <legend className="ag-legend">{t('model.section')}</legend>
                  <div className="ui-fields-2">
                    <div className="ui-field">
                      <label className="label" htmlFor="ag-model">
                        {t('model.title')}
                      </label>
                      <input
                        id="ag-model"
                        className="input data ag-model"
                        value={draft.model ?? ''}
                        disabled={ro}
                        spellCheck={false}
                        autoCapitalize="off"
                        placeholder={t('model.placeholder')}
                        onChange={(e) => set('model', e.target.value)}
                      />
                    </div>
                    <div className="ui-field">
                      <label className="label" htmlFor="ag-temp">
                        {t('model.temperature')} <span className="data">{draft.temperature.toFixed(1)}</span>
                      </label>
                      <input
                        id="ag-temp"
                        className="ag-range"
                        type="range"
                        min={0}
                        max={1}
                        step={0.1}
                        value={draft.temperature}
                        disabled={ro}
                        onChange={(e) => set('temperature', Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <p className="ui-help">{t('model.hint')}</p>
                </fieldset>
              </AdvancedSection>
            </FormSection>

            {canEdit && (
              <FormSection
                tone="danger"
                title={t('editor.dangerTitle')}
                description={t('editor.dangerBody')}
                footer={
                  <button type="button" className="btn btn-primary btn-danger ag-foot-end" onClick={remove}>
                    {t('editor.delete')}
                  </button>
                }
              />
            )}
          </>
        )}

        {tab === 'knowledge' && (
          <>
            {!draft.tools.enabled.includes('search_knowledge') && (
              <p className="panel panel-quiet ag-note" role="note">
                {t('knowledge.toolOff')}
              </p>
            )}
            <FormSection title={t('knowledge.docsTitle')} description={t('knowledge.docsHint')}>
              {props.docsPages.length === 0 ? (
                <EmptyState
                  quiet
                  product="docs"
                  title={t('knowledge.noPages')}
                  action={{ label: t('knowledge.openDocs'), href: '/app/docs' }}
                />
              ) : (
                <>
                  <label className="ui-check">
                    <input
                      type="checkbox"
                      checked={draft.knowledge.allPublicDocs}
                      disabled={ro}
                      onChange={(e) => set('knowledge', { ...draft.knowledge, allPublicDocs: e.target.checked })}
                    />
                    {t('knowledge.allPublic')}
                  </label>
                  <ul className="ag-checklist ag-rows">
                    {props.docsPages.map((p) => {
                      const viaPublic = draft.knowledge.allPublicDocs && p.isPublic;
                      const checked = viaPublic || draft.knowledge.docsPageIds.includes(p.id);
                      return (
                        <li key={p.id}>
                          <label className="ui-check">
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
                            {p.title || t('knowledge.untitledPage')}
                          </label>
                          <span className={`badge${p.isPublic ? '' : ' badge-warn'}`}>
                            {p.isPublic ? t('knowledge.public') : t('knowledge.private')}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {draft.knowledge.docsPageIds.some((id) => props.docsPages.find((p) => p.id === id && !p.isPublic)) && (
                <p className="ui-error">{t('knowledge.privateWarn')}</p>
              )}
            </FormSection>

            <FormSection
              title={t('knowledge.urlsTitle')}
              description={t('knowledge.urlsHint')}
              footer={
                canEdit ? (
                  <>
                    <p className="ui-section-note">
                      {dirty && draft.knowledge.urls.some((u) => !urls.find((r) => r.url === u)) ? t('knowledge.saveFirst') : ''}
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={urls.length === 0 || dirty}
                      aria-busy={refreshing || undefined}
                      title={dirty ? t('knowledge.saveFirst') : undefined}
                      onClick={refreshUrls}
                    >
                      {refreshing ? t('knowledge.refreshing') : t('knowledge.refresh')}
                    </button>
                  </>
                ) : undefined
              }
            >
              {draft.knowledge.urls.length === 0 ? (
                <p className="ui-help">{t('knowledge.urlsEmpty')}</p>
              ) : (
                <ul className="ag-rows">
                  {draft.knowledge.urls.map((u) => {
                    const row = urls.find((r) => r.url === u);
                    const status = row?.status ?? 'pending';
                    return (
                      <li key={u} className="ag-url">
                        <div className="ag-url-main">
                          <a href={u} target="_blank" rel="noreferrer" className="ag-url-title">
                            {row?.title || u}
                          </a>
                          <span className="ui-help">
                            {status === 'ok'
                              ? t('knowledge.fetched', { chars: row?.chars ?? 0 })
                              : status === 'error'
                                ? t('knowledge.failed', { error: row?.error ?? '' })
                                : t('knowledge.pending')}
                            {row?.fetchedAt && (
                              <>
                                {' · '}
                                <time dateTime={row.fetchedAt} suppressHydrationWarning>
                                  {t('knowledge.syncedAt', { when: format.relativeTime(new Date(row.fetchedAt)) })}
                                </time>
                              </>
                            )}
                          </span>
                        </div>
                        <span className={`badge${status === 'ok' ? ' badge-ok' : status === 'error' ? ' badge-bad' : ''}`}>
                          {t(`knowledge.status.${status}`)}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`${t('knowledge.remove')}: ${row?.title || u}`}
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
                  className="ag-add-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addUrl();
                  }}
                >
                  <div className="ui-field">
                    <label className="sr-only" htmlFor="ag-new-url">
                      {t('knowledge.addUrl')}
                    </label>
                    <input
                      id="ag-new-url"
                      className="input data"
                      type="url"
                      value={newUrl}
                      placeholder="https://example.com/pricing"
                      aria-invalid={urlError ? true : undefined}
                      aria-describedby={urlError ? 'ag-new-url-error' : undefined}
                      onChange={(e) => {
                        setNewUrl(e.target.value);
                        setUrlError(null);
                      }}
                    />
                    {urlError && (
                      <p className="ui-error" id="ag-new-url-error">
                        {urlError}
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="btn btn-secondary"
                    disabled={!newUrl.trim() || draft.knowledge.urls.length >= AGENT_MAX_URLS}
                  >
                    {t('knowledge.addUrl')}
                  </button>
                </form>
              )}
            </FormSection>

            <AdvancedSection storageKey="agents.knowledge" hint={t('knowledge.advancedHint')}>
              <div className="ui-field ag-field-half">
                <label className="label" htmlFor="ag-canned">
                  {t('knowledge.cannedTitle')}
                </label>
                <select
                  id="ag-canned"
                  className="select"
                  value={draft.knowledge.cannedFromWidgetId ?? ''}
                  disabled={ro}
                  aria-describedby="ag-canned-help"
                  onChange={(e) => set('knowledge', { ...draft.knowledge, cannedFromWidgetId: e.target.value || null })}
                >
                  <option value="">{t('knowledge.cannedNone')}</option>
                  {widgets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <p className="ui-help" id="ag-canned-help">
                  {t('knowledge.cannedHint')}
                </p>
              </div>
            </AdvancedSection>
          </>
        )}

        {tab === 'tools' && (
          <>
            <p className="ui-help ag-intro">{t('tools.intro')}</p>
            <div className="ag-tool-groups">
              {AGENT_TOOL_GROUP_ORDER.map((g) => (
                <section key={g.key} className="ag-tool-group" aria-labelledby={`ag-group-${g.key}`}>
                  <h2 className="ag-tool-group-title" id={`ag-group-${g.key}`}>
                    <ProductGlyph product={g.product} size={12} />
                    {PRODUCT_CONFIG[g.product].name}
                  </h2>
                  <ul className="ag-tool-list">{agentToolsInGroup(g.key).map(renderTool)}</ul>
                </section>
              ))}
            </div>
            <AdvancedSection
              storageKey="agents.tools"
              hint={t('tools.advancedHint')}
              defaultOpen={draft.tools.enabled.includes('http_request')}
            >
              <ul className="ag-tool-list">{renderTool('http_request')}</ul>
            </AdvancedSection>
          </>
        )}

        {tab === 'channels' && (
          <>
            <FormSection title={t('channels.chatTitle')} description={t('channels.chatHint')}>
              {widgets.length === 0 ? (
                <EmptyState
                  quiet
                  product="chat"
                  title={t('channels.noWidgets')}
                  action={canEdit ? { label: t('channels.createWidget'), href: '/app/chat/widgets/new' } : undefined}
                />
              ) : (
                <ul className="ag-rows">
                  {widgets.map((w) => {
                    const mine = w.agentId === agent.id;
                    const other = w.agentId && !mine;
                    return (
                      <li key={w.id} className="ag-widget">
                        <span className="ag-widget-name">{w.name}</span>
                        <span className={`badge${mine ? ' badge-ok' : ''}`}>
                          {mine
                            ? t('channels.answeredByThis')
                            : other
                              ? t('channels.answeredByOther')
                              : t(`channels.source.${w.botEnabled ? w.botSource : 'off'}`)}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            className={`btn btn-sm ${mine ? 'btn-ghost' : 'btn-secondary'}`}
                            onClick={() => assignWidget(w.id, !mine)}
                          >
                            {mine ? t('channels.unassign') : t('channels.assign')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </FormSection>

            <FormSection title={t('channels.publicTitle')} description={t('channels.publicHint')}>
              <label className="ui-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={publicOn}
                  disabled={ro}
                  onChange={(e) => togglePublic(e.target.checked)}
                />
                {t('channels.publicToggle')}
              </label>
              {publicOn && (
                <div className="ui-field">
                  <label className="label" htmlFor="ag-handle">
                    {t('channels.handle')}
                  </label>
                  <div className="ui-input-group">
                    <span className="ui-addon data">{origin.replace(/^https?:\/\//, '')}/a/</span>
                    <input
                      id="ag-handle"
                      className="input data"
                      value={draft.publicHandle ?? ''}
                      maxLength={40}
                      disabled={ro}
                      spellCheck={false}
                      autoCapitalize="off"
                      placeholder={t('channels.handlePlaceholder')}
                      onChange={(e) => set('publicHandle', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    />
                  </div>
                  {savedPublicUrl && publicUrl === savedPublicUrl ? (
                    <p className="ui-help">
                      <a href={savedPublicUrl} target="_blank" rel="noreferrer" className="data">
                        {savedPublicUrl}
                      </a>
                      {!agent.enabled && <span className="ag-warn-inline"> {t('channels.disabledWarn')}</span>}
                    </p>
                  ) : (
                    <p className="ui-help">{draft.publicHandle ? t('channels.saveToPublish') : t('channels.publicOff')}</p>
                  )}
                </div>
              )}
            </FormSection>

            <FormSection
              title={t('channels.apiTitle')}
              description={
                <>
                  {t('channels.apiHint')} <Link href="/app/settings">{t('channels.apiKeys')}</Link>
                </>
              }
            >
              <div className="ag-code-wrap">
                <pre className="ag-code data">{apiSnippet}</pre>
                <button type="button" className="btn btn-secondary btn-sm ag-copy" onClick={copySnippet}>
                  <span aria-live="polite">{copied ? t('channels.copied') : t('channels.copy')}</span>
                </button>
              </div>
              <p className="ui-help">{t('channels.apiContinue')}</p>
            </FormSection>
          </>
        )}

        {tab === 'playground' && (
          <>
            <p className={dirty ? 'ui-error' : 'ui-help'}>{dirty ? t('playground.unsaved') : t('playground.intro')}</p>
            <AgentChat
              key={`${agent.id}-${agent.updatedAt}`}
              endpoint={`/api/agents/${agent.id}/messages`}
              labels={chatLabels(t)}
              welcome={agent.welcomeMessage || undefined}
              showTools
              disabledReason={aiEnabled ? null : t('playground.aiOff')}
              onConversation={() => setHistoryKey((k) => k + 1)}
            />
          </>
        )}

        {tab === 'conversations' && (
          <AgentConversations
            key={historyKey}
            agentId={agent.id}
            initialConversationId={props.initialConversationId ?? null}
            onOpenPlayground={() => setTab('playground')}
          />
        )}
      </div>
    </div>
  );
}
