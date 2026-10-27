'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import {
  AGENT_MAX_SITEMAPS,
  AGENT_MAX_URLS,
  AGENT_SETTINGS_CHANNELS,
  AGENT_TEMPLATE_KEYS,
  AGENT_TOOL_GROUP_ORDER,
  agentToolsInGroup,
  isApprovableTool,
  suggestAgentHandle,
  type AgentDto,
  type AgentSecretHeaderDto,
  type AgentTemplateKey,
  type AgentTestCaseDto,
  type AgentToolKey,
} from '@/lib/agents-config';
import type { AgentKnowledgeUrlDto, AgentWidgetOption } from '@/lib/agents';
import type { AgentVersioningDto } from '@/lib/agents-versions';
import type { AgentKnowledgeFileDto, AgentQaDto, AgentSitemapStatusDto } from '@/lib/agents-knowledge';
import type { AgentMcpServerDto } from '@/lib/agents-mcp';
import type { AgentRuleIssue } from '@/lib/agents-quality';
import { PRODUCT_CONFIG } from '@/lib/products';
import PageHeader from '@/components/ui/PageHeader';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import EmptyState from '@/components/ui/EmptyState';
import ProductGlyph from '@/components/brand/ProductGlyph';
import AgentChat from './AgentChat';
import AgentConversations from './AgentConversations';
import AgentAnalytics from './AgentAnalytics';
import AgentTests, { testSummary } from './AgentTests';
import AgentSecretHeaders from './AgentSecretHeaders';
import AgentVersions from './AgentVersions';
import AgentKnowledgeExtra from './AgentKnowledgeExtra';
import AgentMcp from './AgentMcp';
import AgentReplay from './AgentReplay';
import AgentBlocked from './AgentBlocked';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useConfirm } from './useConfirm';
import { api, chatLabels, errorText } from './agents-ui';
import { parseDbUtc } from '@/lib/utils';

export interface EditorRefs {
  docsPages: Array<{ id: string; title: string; isPublic: boolean; restricted?: boolean }>;
  /** El agente tiene páginas de teamspaces que quien edita no ve. */
  hiddenDocsPages?: boolean;
  widgets: AgentWidgetOption[];
  eventTypes: Array<{ id: string; title: string; durationMin: number }>;
  projects: Array<{ id: string; name: string }>;
  flows: Array<{ id: string; name: string }>;
  robots: Array<{ id: string; name: string }>;
}

interface Props extends EditorRefs {
  agent: AgentDto;
  urls: AgentKnowledgeUrlDto[];
  canEdit: boolean;
  aiEnabled: boolean;
  origin: string;
  initialTab?: string;
  initialConversationId?: string | null;
  /** Headers secretos de http_request (solo nombre y dominio; vacío si no puede editar). */
  secretHeaders: AgentSecretHeaderDto[];
  tests: AgentTestCaseDto[];
  versioning: AgentVersioningDto;
  files: AgentKnowledgeFileDto[];
  qa: AgentQaDto[];
  sitemaps: AgentSitemapStatusDto[];
  /** Servidores MCP (sin el token; vacío si no puede editar). */
  mcpServers: AgentMcpServerDto[];
}

const TABS = ['instructions', 'knowledge', 'tools', 'channels', 'playground', 'conversations', 'analytics', 'versions'] as const;
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
  const [confirmNode, ask] = useConfirm();
  const format = useFormatter();
  const router = useRouter();
  const [agent, setAgent] = useState(props.agent);
  const [draft, setDraft] = useState<Draft>(() => toDraft(props.agent));
  const [avoidRaw, setAvoidRaw] = useState(props.agent.guardrails.avoidTopics.join('\n'));
  const [keywordsRaw, setKeywordsRaw] = useState(props.agent.handoff.keywords.join(', '));
  const [domainsRaw, setDomainsRaw] = useState(props.agent.tools.httpAllowedDomains.join('\n'));
  const [wordsRaw, setWordsRaw] = useState(props.agent.settings.blockedWords.join(', '));
  const [countriesRaw, setCountriesRaw] = useState(props.agent.settings.blockedCountries.join(', '));
  const [scorecardRaw, setScorecardRaw] = useState(props.agent.settings.scorecard.join('\n'));
  const [versioning, setVersioning] = useState(props.versioning);
  const [publishing, setPublishing] = useState(false);
  const [versionsKey, setVersionsKey] = useState(0);
  const [sitemaps, setSitemaps] = useState(props.sitemaps);
  const [newSitemap, setNewSitemap] = useState({ url: '', prefix: '' });
  const [sitemapError, setSitemapError] = useState<string | null>(null);
  const [rules, setRules] = useState<{ issues: AgentRuleIssue[]; aiError?: string } | null>(null);
  const [checkingRules, setCheckingRules] = useState(false);
  const [convFilter, setConvFilter] = useState<'all' | 'review'>('all');
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState('');
  const statusRef = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (publishOpen) window.setTimeout(() => noteRef.current?.focus(), 0);
  }, [publishOpen]);
  const [focusStatus, setFocusStatus] = useState(false);
  useEffect(() => {
    if (publishOpen || !focusStatus) return;
    const timer = window.setTimeout(() => {
      statusRef.current?.focus();
      setFocusStatus(false);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [publishOpen, focusStatus]);
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
  const [secretHeaders, setSecretHeaders] = useState(props.secretHeaders);
  const [tests, setTests] = useState(props.tests);
  const [testPrefill, setTestPrefill] = useState<{ question: string; nonce: number } | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const payload = useMemo(
    () => ({
      ...draft,
      model: draft.model?.trim() || null,
      publicHandle: draft.publicHandle?.trim().toLowerCase() || null,
      guardrails: { ...draft.guardrails, avoidTopics: lines(avoidRaw) },
      handoff: { ...draft.handoff, keywords: lines(keywordsRaw) },
      tools: { ...draft.tools, httpAllowedDomains: lines(domainsRaw) },
      settings: {
        ...draft.settings,
        blockedWords: lines(wordsRaw),
        blockedCountries: lines(countriesRaw).map((c) => c.toUpperCase()),
        scorecard: scorecardRaw
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
      },
    }),
    [draft, avoidRaw, keywordsRaw, domainsRaw, wordsRaw, countriesRaw, scorecardRaw],
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
    setWordsRaw(a.settings.blockedWords.join(', '));
    setCountriesRaw(a.settings.blockedCountries.join(', '));
    setScorecardRaw(a.settings.scorecard.join('\n'));
  }

  async function save() {
    if (!canEdit || !dirty || saving) return;
    setSaving(true);
    setNotice(null);
    const res = await api<{
      agent?: AgentDto;
      urls?: AgentKnowledgeUrlDto[];
      field?: string;
      versioning?: AgentVersioningDto | null;
      sitemaps?: AgentSitemapStatusDto[];
    }>(`/api/agents/${agent.id}`, {
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
    if (res.data.versioning) setVersioning(res.data.versioning);
    if (res.data.sitemaps) setSitemaps(res.data.sitemaps);
    setVersionsKey((k) => k + 1);
    setNotice({ kind: 'ok', text: res.data.versioning?.enabled ? t('versions.savedDraft') : t('editor.saved') });
  }

  async function publish() {
    if (!canEdit || dirty || publishing) return;
    if (versioning.enabled && !versioning.hasDraft) return;
    setPublishing(true);
    setNotice(null);
    const res = await api<{ agent?: AgentDto; versioning?: AgentVersioningDto }>(`/api/agents/${agent.id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ note: publishNote.trim() }),
    });
    setPublishing(false);
    setPublishOpen(false);
    setPublishNote('');
    // El foco queda en el estado de la versión (lo anuncia el lector de pantalla), después de cerrar el diálogo.
    setFocusStatus(true);
    if (!res.ok || !res.data.agent || !res.data.versioning) {
      setNotice({ kind: 'error', text: errorText(t, res.data.error) });
      return;
    }
    applyVersion(res.data.agent, res.data.versioning);
    setNotice({ kind: 'ok', text: t('versions.published', { number: res.data.versioning.liveNumber ?? 1 }) });
  }

  async function discardDraft() {
    if (!canEdit || !versioning.hasDraft || !(await ask({ title: t('versions.discardConfirm'), confirmLabel: t('versions.discard'), danger: true }))) return;
    const res = await api<{ agent?: AgentDto; versioning?: AgentVersioningDto }>(`/api/agents/${agent.id}/versions`, { method: 'DELETE' });
    if (!res.ok || !res.data.agent || !res.data.versioning) {
      setNotice({ kind: 'error', text: errorText(t, res.data.error) });
      return;
    }
    applyVersion(res.data.agent, res.data.versioning);
    setNotice({ kind: 'ok', text: t('versions.discarded') });
  }

  function applyVersion(a: AgentDto, v: AgentVersioningDto) {
    setAgent(a);
    resetFrom(a);
    setVersioning(v);
    setVersionsKey((k) => k + 1);
  }

  async function checkRules() {
    setCheckingRules(true);
    const res = await api<{ issues?: AgentRuleIssue[]; aiError?: string }>(`/api/agents/${agent.id}/quality`, {
      method: 'POST',
      body: JSON.stringify({ action: 'rules' }),
    });
    setCheckingRules(false);
    if (!res.ok) {
      setRules({ issues: [], aiError: res.data.error ?? 'generic' });
      return;
    }
    setRules({ issues: res.data.issues ?? [], aiError: res.data.aiError });
  }

  function addSitemap() {
    const url = newSitemap.url.trim();
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      setSitemapError(t('errors.invalid_url'));
      return;
    }
    setSitemapError(null);
    if (draft.knowledge.sitemaps.some((x) => x.url === url)) return;
    set('knowledge', { ...draft.knowledge, sitemaps: [...draft.knowledge.sitemaps, { url, prefix: newSitemap.prefix.trim() }] });
    setNewSitemap({ url: '', prefix: '' });
  }
  saveRef.current = () => void save();

  async function remove() {
    if (!(await ask({ title: t('editor.deleteConfirm', { name: agent.name }), confirmLabel: t('editor.delete'), danger: true }))) return;
    const res = await api(`/api/agents/${agent.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setNotice({ kind: 'error', text: errorText(t, res.data.error) });
      return;
    }
    router.push('/app/agents');
  }

  async function refreshUrls() {
    setRefreshing(true);
    const res = await api<{ urls?: AgentKnowledgeUrlDto[]; sitemaps?: AgentSitemapStatusDto[] }>(`/api/agents/${agent.id}/knowledge`, { method: 'POST' });
    setRefreshing(false);
    if (res.ok && res.data.urls) {
      setUrls(res.data.urls);
      if (res.data.sitemaps) setSitemaps(res.data.sitemaps);
    } else setNotice({ kind: 'error', text: errorText(t, res.data.error) });
  }

  // Sitemaps en cola o páginas bajando: se refresca el progreso mientras la pestaña está abierta.
  const sitemapsBusy = sitemaps.some((s) => s.status === 'pending' || (s.status === 'ok' && s.fetched + s.failed < s.pages));
  useEffect(() => {
    if (tab !== 'knowledge' || !sitemapsBusy) return;
    const timer = window.setInterval(async () => {
      const res = await api<{ urls?: AgentKnowledgeUrlDto[]; sitemaps?: AgentSitemapStatusDto[] }>(`/api/agents/${agent.id}/knowledge`);
      if (res.ok && res.data.sitemaps) setSitemaps(res.data.sitemaps);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [tab, sitemapsBusy, agent.id]);

  async function assignWidget(widgetId: string, assigned: boolean) {
    const res = await api<{ widgets?: AgentWidgetOption[] }>(`/api/agents/${agent.id}/widgets`, {
      method: 'POST',
      body: JSON.stringify({ widgetId, assigned }),
    });
    if (res.ok && res.data.widgets) setWidgets(res.data.widgets);
    else setNotice({ kind: 'error', text: errorText(t, res.data.error) });
  }

  async function applyTemplate(key: AgentTemplateKey) {
    if (draft.instructions.trim() && !(await ask({ title: t('instructions.replaceConfirm'), confirmLabel: t('instructions.replace') }))) return;
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

  /** Pedir la aprobación de alguien del equipo antes de que la acción corra. */
  function toggleApproval(key: AgentToolKey, on: boolean) {
    if (!isApprovableTool(key)) return;
    setDraft((d) => {
      const current = d.tools.requireApproval ?? [];
      const requireApproval = on ? [...new Set([...current, key])] : current.filter((k) => k !== key);
      return { ...d, tools: { ...d.tools, requireApproval } };
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
    if (key === 'run_robot' && draft.tools.robotIds.length === 0) return t('tools.needsRobots');
    if (key.startsWith('docs_') && draft.tools.docsPageIds.length === 0) return t('tools.needsDocsPages');
    if (key === 'http_request' && lines(domainsRaw).length === 0) return t('tools.needsDomains');
    if (key === 'mcp_call' && props.mcpServers.length === 0) return t('tools.needsMcp');
    return null;
  };
  const wide = tab === 'playground' || tab === 'conversations' || tab === 'analytics' || tab === 'versions';
  const summary = testSummary(tests);

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
        {on && isApprovableTool(key) && (
          <label className="ui-check ag-tool-config ag-tool-approval">
            <input
              type="checkbox"
              checked={(draft.tools.requireApproval ?? []).includes(key)}
              disabled={ro}
              onChange={(e) => toggleApproval(key, e.target.checked)}
            />{' '}
            {key === 'http_request' ? t('tools.approvalHttp') : key === 'mcp_call' ? t('tools.approvalMcp') : t('tools.approval')}
          </label>
        )}
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
        {key === 'docs_read_pages' && draft.tools.enabled.some((k) => k.startsWith('docs_')) && (
          <fieldset className="ag-tool-config ag-fieldset" data-testid="ag-docs-pages">
            <legend className="label">{t('tools.docsPages')}</legend>
            {props.docsPages.length === 0 ? (
              <p className="ui-help">
                {t('tools.noDocsPages')} <Link href="/app/docs">{t('tools.create')}</Link>
              </p>
            ) : (
              <ul className="ag-checklist">
                {props.docsPages.map((p) => (
                  <li key={p.id}>
                    <label className="ui-check">
                      <input
                        type="checkbox"
                        checked={draft.tools.docsPageIds.includes(p.id)}
                        disabled={ro}
                        onChange={(e) =>
                          set('tools', {
                            ...draft.tools,
                            docsPageIds: e.target.checked ? [...draft.tools.docsPageIds, p.id] : draft.tools.docsPageIds.filter((x) => x !== p.id),
                          })
                        }
                      />
                      {p.title || t('tools.untitledPage')}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="ui-help">{t('tools.docsPagesHint')}</p>
            {draft.publicHandle !== null && props.docsPages.some((p) => p.restricted && draft.tools.docsPageIds.includes(p.id)) && (
              <p className="ui-help ag-warn-inline" role="status" data-testid="ag-docs-private-public">
                {t('tools.docsPrivatePublic')}
              </p>
            )}
            {draft.publicHandle !== null && props.hiddenDocsPages && (
              <p className="ui-help ag-warn-inline" role="status" data-testid="ag-docs-hidden-public">
                {t('tools.docsHiddenPublic')}
              </p>
            )}
          </fieldset>
        )}
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
        {on && key === 'run_robot' && (
          <fieldset className="ag-tool-config ag-fieldset">
            <legend className="label">{t('tools.robots')}</legend>
            {props.robots.length === 0 ? (
              <p className="ui-help">
                {t('tools.noRobots')} <Link href="/app/robots">{t('tools.create')}</Link>
              </p>
            ) : (
              <ul className="ag-checklist">
                {props.robots.map((r) => (
                  <li key={r.id}>
                    <label className="ui-check">
                      <input
                        type="checkbox"
                        checked={draft.tools.robotIds.includes(r.id)}
                        disabled={ro}
                        onChange={(e) =>
                          set('tools', {
                            ...draft.tools,
                            robotIds: e.target.checked
                              ? [...draft.tools.robotIds, r.id]
                              : draft.tools.robotIds.filter((x) => x !== r.id),
                          })
                        }
                      />
                      {r.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="ui-help">{t('tools.robotsHint')}</p>
          </fieldset>
        )}
        {on && key === 'mcp_call' && (
          <div className="ag-tool-config">
            {canEdit ? <AgentMcp agentId={agent.id} servers={props.mcpServers} readOnly={ro} /> : <p className="ui-help">{t('mcp.adminsOnly')}</p>}
          </div>
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
            {canEdit && (
              <AgentSecretHeaders
                agentId={agent.id}
                headers={secretHeaders}
                onChange={setSecretHeaders}
                savedDomains={agent.tools.httpAllowedDomains}
                draftDomains={lines(domainsRaw).map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, ''))}
                readOnly={ro}
              />
            )}
          </div>
        )}
      </li>
    );
  }

  const canPublish = canEdit && !dirty && (!versioning.enabled || versioning.hasDraft);
  const versionStatus = (
    <span className="ag-version-status" ref={statusRef} tabIndex={-1} role="status" data-tone={versioning.hasDraft ? 'draft' : undefined}>
      {versioning.enabled
        ? versioning.hasDraft
          ? t('versions.statusDraft', { number: versioning.liveNumber ?? 1 })
          : t('versions.statusLive', { number: versioning.liveNumber ?? 1 })
        : t('versions.statusOff')}
    </span>
  );
  const saveActions = canEdit ? (
    <>
      {!dirty && versionStatus}
      {!dirty && versioning.hasDraft && (
        <button type="button" className="btn btn-ghost" onClick={() => void discardDraft()}>
          {t('versions.discard')}
        </button>
      )}
      {canPublish && (
        <button
          type="button"
          className="btn btn-secondary"
          aria-busy={publishing || undefined}
          title={versioning.enabled ? undefined : t('versions.publishFirstHint')}
          onClick={() => setPublishOpen(true)}
        >
          {publishing ? t('versions.publishing') : versioning.enabled ? t('versions.publish') : t('versions.publishFirst')}
        </button>
      )}
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
      {confirmNode}
      <ConfirmDialog
        open={publishOpen}
        title={versioning.enabled ? t('versions.publishTitle', { number: (versioning.liveNumber ?? 0) + 1 }) : t('versions.publishFirstTitle')}
        body={
          <div className="ui-field">
            <p className="ui-help">{versioning.enabled ? t('versions.publishBody') : t('versions.publishFirstHint')}</p>
            <label className="label" htmlFor="ag-publish-note">
              {t('versions.note')}
            </label>
            <input
              id="ag-publish-note"
              ref={noteRef}
              className="input"
              maxLength={300}
              value={publishNote}
              placeholder={t('versions.notePlaceholder')}
              onChange={(e) => setPublishNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void publish();
                }
              }}
            />
          </div>
        }
        confirmLabel={publishing ? t('versions.publishing') : t('versions.publish')}
        cancelLabel={t('qa.cancel')}
        busy={publishing}
        onConfirm={() => void publish()}
        onCancel={() => setPublishOpen(false)}
      />
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
                  <div className="ui-field">
                    <label className="label" htmlFor="ag-spam">
                      {t('settings.blockedWords')}
                    </label>
                    <input
                      id="ag-spam"
                      className="input"
                      value={wordsRaw}
                      disabled={ro}
                      placeholder={t('settings.blockedWordsPlaceholder')}
                      onChange={(e) => setWordsRaw(e.target.value)}
                    />
                    <p className="ui-help">{t('settings.blockedWordsHint')}</p>
                  </div>
                  {canEdit && (
                    <div className="ag-rules">
                      <div className="ag-rules-head">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={checkingRules || dirty}
                          aria-busy={checkingRules || undefined}
                          title={dirty ? t('rules.saveFirst') : undefined}
                          onClick={() => void checkRules()}
                        >
                          {checkingRules ? t('rules.checking') : t('rules.check')}
                        </button>
                        <span className="ui-help">{dirty ? t('rules.saveFirst') : t('rules.hint')}</span>
                      </div>
                      {rules && (
                        <div role="status" aria-live="polite">
                          {rules.issues.length === 0 ? (
                            <p className="ui-help">{rules.aiError ? t('rules.noneStatic') : t('rules.none')}</p>
                          ) : (
                            <ul className="ag-rows ag-rule-list">
                              {rules.issues.map((issue, i) => (
                                <li key={i} className="ag-rule">
                                  {issue.source === 'check' ? (
                                    <span>{t(`rules.codes.${issue.code ?? 'generic'}` as never, { subject: issue.subject ?? '' } as never)}</span>
                                  ) : (
                                    <>
                                      <strong>{issue.title}</strong>
                                      <span>{issue.detail}</span>
                                      {issue.suggestion && (
                                        <span className="ui-help">
                                          {t('rules.suggestion')}: {issue.suggestion}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {rules.aiError && <p className="ui-help">{t('rules.aiError', { error: errorText(t, rules.aiError) })}</p>}
                        </div>
                      )}
                    </div>
                  )}
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

            <FormSection title={t('settings.channelTitle')} description={t('settings.channelHint')}>
              <AdvancedSection storageKey="agents.channelRules" hint={t('settings.channelAdvanced')}>
                {AGENT_SETTINGS_CHANNELS.map((c) => (
                  <div key={c} className="ui-field">
                    <label className="label" htmlFor={`ag-channel-${c}`}>
                      {t(`channelNames.${c}`)}
                    </label>
                    <textarea
                      id={`ag-channel-${c}`}
                      className="textarea"
                      rows={3}
                      maxLength={4000}
                      value={draft.settings.channelInstructions[c]}
                      disabled={ro}
                      placeholder={t(`settings.channelPlaceholder.${c}`)}
                      onChange={(e) =>
                        set('settings', { ...draft.settings, channelInstructions: { ...draft.settings.channelInstructions, [c]: e.target.value } })
                      }
                    />
                  </div>
                ))}
              </AdvancedSection>
            </FormSection>

            <FormSection title={t('settings.privacyTitle')} description={t('settings.privacyHint')}>
              {(
                [
                  ['citations', 'citationsHint'],
                  ['visitorContext', 'visitorContextHint'],
                  ['memory', 'memoryHint'],
                  ['redactPii', 'redactPiiHint'],
                ] as const
              ).map(([key, hint]) => (
                <div key={key} className="ag-setting">
                  <label className="ui-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={draft.settings[key]}
                      disabled={ro}
                      aria-describedby={`ag-set-${key}`}
                      onChange={(e) => set('settings', { ...draft.settings, [key]: e.target.checked })}
                    />
                    {t(`settings.${key}`)}
                  </label>
                  <p className="ui-help" id={`ag-set-${key}`}>
                    {t(`settings.${hint}`)}
                  </p>
                </div>
              ))}
              <AdvancedSection storageKey="agents.blocking" hint={t('settings.blockingHint')}>
                <div className="ui-field">
                  <label className="label" htmlFor="ag-countries">
                    {t('settings.blockedCountries')}
                  </label>
                  <input
                    id="ag-countries"
                    className="input data"
                    value={countriesRaw}
                    disabled={ro}
                    placeholder="RU, KP"
                    onChange={(e) => setCountriesRaw(e.target.value)}
                  />
                  <p className="ui-help">{t('settings.blockedCountriesHint')}</p>
                </div>
                {canEdit && <AgentBlocked agentId={agent.id} />}
              </AdvancedSection>
            </FormSection>

            <FormSection title={t('settings.scorecardTitle')} description={t('settings.scorecardHint')}>
              <div className="ag-setting">
                <label className="ui-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={draft.settings.aiScoring}
                    disabled={ro}
                    aria-describedby="ag-set-aiScoring"
                    onChange={(e) => set('settings', { ...draft.settings, aiScoring: e.target.checked })}
                  />
                  {t('settings.aiScoring')}
                </label>
                <p className="ui-help" id="ag-set-aiScoring">
                  {t('settings.aiScoringHint')}
                </p>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor="ag-scorecard">
                  {t('settings.scorecard')}
                </label>
                <textarea
                  id="ag-scorecard"
                  className="textarea"
                  rows={3}
                  value={scorecardRaw}
                  disabled={ro}
                  placeholder={t('settings.scorecardPlaceholder')}
                  onChange={(e) => setScorecardRaw(e.target.value)}
                />
                <p className="ui-help">{t('settings.scorecardHelp')}</p>
              </div>
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
                      disabled={(urls.length === 0 && sitemaps.length === 0) || dirty}
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
                                  {t('knowledge.syncedAt', { when: format.relativeTime(parseDbUtc(row.fetchedAt)) })}
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

            <FormSection title={t('sitemaps.title')} description={t('sitemaps.hint')}>
              {draft.knowledge.sitemaps.length === 0 ? (
                <p className="ui-help">{t('sitemaps.empty')}</p>
              ) : (
                <ul className="ag-rows">
                  {draft.knowledge.sitemaps.map((sm) => {
                    const st = sitemaps.find((x) => x.url === sm.url);
                    return (
                      <li key={sm.url} className="ag-url">
                        <div className="ag-url-main">
                          <a href={sm.url} target="_blank" rel="noreferrer" className="ag-url-title data">
                            {sm.url}
                          </a>
                          <span className="ui-help">
                            {sm.prefix ? `${t('sitemaps.onlyPrefix', { prefix: sm.prefix })} · ` : ''}
                            {!st
                              ? dirty
                                ? t('knowledge.saveFirst')
                                : t('sitemaps.notRead')
                              : st.status === 'pending'
                                ? t('sitemaps.reading')
                                : st.status === 'error'
                                  ? ''
                                  : `${t('sitemaps.progress', { fetched: st.fetched, pages: st.pages })}${st.failed ? ` · ${t('sitemaps.failed', { count: st.failed })}` : ''}`}
                          </span>
                          {st?.status === 'error' && <span className="ui-error">{errorText(t, st.error)}</span>}
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`${t('knowledge.remove')}: ${sm.url}`}
                            onClick={() => set('knowledge', { ...draft.knowledge, sitemaps: draft.knowledge.sitemaps.filter((x) => x.url !== sm.url) })}
                          >
                            {t('knowledge.remove')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canEdit && draft.knowledge.sitemaps.length < AGENT_MAX_SITEMAPS && (
                <form
                  className="ag-add-row ag-sitemap-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addSitemap();
                  }}
                >
                  <div className="ui-field">
                    <label className="sr-only" htmlFor="ag-new-sitemap">
                      {t('sitemaps.url')}
                    </label>
                    <input
                      id="ag-new-sitemap"
                      className="input data"
                      type="url"
                      value={newSitemap.url}
                      placeholder="https://help.example.com/sitemap.xml"
                      aria-invalid={sitemapError ? true : undefined}
                      onChange={(e) => {
                        setNewSitemap({ ...newSitemap, url: e.target.value });
                        setSitemapError(null);
                      }}
                    />
                    {sitemapError && <p className="ui-error">{sitemapError}</p>}
                  </div>
                  <div className="ui-field ag-field-narrow">
                    <label className="sr-only" htmlFor="ag-new-sitemap-prefix">
                      {t('sitemaps.prefix')}
                    </label>
                    <input
                      id="ag-new-sitemap-prefix"
                      className="input data"
                      value={newSitemap.prefix}
                      placeholder={t('sitemaps.prefixPlaceholder')}
                      onChange={(e) => setNewSitemap({ ...newSitemap, prefix: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-secondary" disabled={!newSitemap.url.trim()}>
                    {t('sitemaps.add')}
                  </button>
                </form>
              )}
            </FormSection>


            <AgentKnowledgeExtra agentId={agent.id} canEdit={canEdit} initialFiles={props.files} initialQa={props.qa} />

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
              defaultOpen={draft.tools.enabled.includes('http_request') || draft.tools.enabled.includes('mcp_call')}
            >
              <ul className="ag-tool-list">
                {renderTool('mcp_call')}
                {renderTool('http_request')}
              </ul>
            </AdvancedSection>
          </>
        )}

        {tab === 'channels' && (
          <>
            {/* Antes de publicar: el estado de los casos de prueba y un atajo para correrlos. */}
            <div className="panel panel-quiet ag-note ag-tests-note" role="note">
              <span>
                {summary.total === 0
                  ? t('tests.publishNone')
                  : summary.ran === 0
                    ? t('tests.notRun', { total: summary.total })
                    : t('tests.summary', { passed: summary.passed, total: summary.total })}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab('playground')}>
                {summary.total === 0 ? t('tests.publishAdd') : t('tests.publishRun')}
              </button>
            </div>
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
            <p className="ui-help">{t('playground.dryRun')}</p>
            <AgentChat
              key={`${agent.id}-${agent.updatedAt}`}
              endpoint={`/api/agents/${agent.id}/messages`}
              labels={{ ...chatLabels(t), saveTest: canEdit ? t('tests.saveFromChat') : undefined }}
              welcome={agent.welcomeMessage || undefined}
              showTools
              disabledReason={aiEnabled ? null : t('playground.aiOff')}
              onConversation={() => setHistoryKey((k) => k + 1)}
              onSaveTest={canEdit ? (question) => setTestPrefill({ question, nonce: Date.now() }) : undefined}
            />
            <AgentTests
              agentId={agent.id}
              tests={tests}
              onTestsChange={setTests}
              canEdit={canEdit}
              aiEnabled={aiEnabled}
              dirty={dirty}
              prefill={testPrefill}
            />
            {canEdit && <AgentReplay agentId={agent.id} aiEnabled={aiEnabled} dirty={dirty} />}
          </>
        )}

        {tab === 'conversations' && (
          <AgentConversations
            key={`${historyKey}-${convFilter}`}
            agentId={agent.id}
            initialConversationId={props.initialConversationId ?? null}
            onOpenPlayground={() => setTab('playground')}
            canEdit={canEdit}
            initialFilter={convFilter}
          />
        )}

        {tab === 'analytics' && (
          <AgentAnalytics
            agentId={agent.id}
            canEdit={canEdit}
            onOpenConversations={() => {
              setConvFilter('all');
              setTab('conversations');
            }}
            onOpenReview={() => {
              setConvFilter('review');
              setTab('conversations');
            }}
          />
        )}

        {tab === 'versions' && (
          <AgentVersions agentId={agent.id} canEdit={canEdit} dirty={dirty} reloadKey={versionsKey} onAgent={applyVersion} />
        )}
      </div>
    </div>
  );
}
