'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
} from '@xyflow/react';
import { Link, useRouter } from '@/i18n/navigation';
import type { FlowDto } from '@/lib/flow';
import {
  EVENT_SAMPLES,
  NODE_DEFS,
  NODE_TYPES,
  defaultConfig,
  isTriggerType,
  nodeOutputs,
  type FlowEventType,
  type FlowGraph,
  type FlowNodeType,
} from '@/lib/flow-schema';
import FlowNodeCard, { type FlowCanvasNode } from './FlowNodeCard';
import NodeConfigPanel, { type EditorRefs, type VariableOption } from './NodeConfigPanel';
import RunsPanel, { type RunDetail } from './RunsPanel';
import VersionsPanel from './VersionsPanel';
import { CATEGORY_COLOR, CATEGORY_ORDER, flattenPaths, i18nKey } from './flow-ui';

interface Props {
  flow: FlowDto;
  webhooks: Array<{ nodeId: string; token: string }>;
  lastOutputs: Record<string, unknown>;
  canEdit: boolean;
  refs: Omit<EditorRefs, 'flowId'>;
}

const nodeTypes = { flow: FlowNodeCard };
const DND_MIME = 'application/x-zerosoft-flow-node';

function toCanvas(graph: FlowGraph): { nodes: FlowCanvasNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: 'flow' as const,
      position: n.position ?? { x: 0, y: 0 },
      data: { type: n.type, config: n.config ?? {} },
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? 'out',
    })),
  };
}

function toGraph(nodes: FlowCanvasNode[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: n.data.config,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? 'out' })),
  };
}

/** Id corto y legible para un nodo nuevo: http_1, email_2… */
function newNodeId(type: FlowNodeType, existing: Set<string>): string {
  const base = type.split('.')[1].replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'node';
  for (let i = 1; ; i++) {
    const id = `${base}_${i}`;
    if (!existing.has(id)) return id;
  }
}

function summaryOf(type: FlowNodeType, cfg: Record<string, unknown>, t: ReturnType<typeof useTranslations>): string {
  const s = (v: unknown) => String(v ?? '').trim();
  switch (type) {
    case 'trigger.event':
      return cfg.event ? t(`events.${i18nKey(s(cfg.event))}`) : '';
    case 'trigger.schedule':
      if (cfg.mode === 'cron') return `${s(cfg.cron)} (${s(cfg.timezone) || 'UTC'})`;
      return cfg.mode === 'interval'
        ? t('editor.everySummary', { n: Number(cfg.every) || 1, unit: t(`options.${s(cfg.unit) || 'hours'}`) })
        : t('editor.dailySummary', { time: s(cfg.time) || '09:00', tz: s(cfg.timezone) || 'UTC' });
    case 'trigger.stripe':
      return s(cfg.events) || t('editor.allEvents');
    case 'app.slack':
      return s(cfg.channel) || s(cfg.text).slice(0, 60);
    case 'app.google_sheets':
      return `${t(`options.${s(cfg.operation) || 'append'}`)} · ${s(cfg.range)}`;
    case 'app.gmail':
      return s(cfg.to) || s(cfg.subject);
    case 'app.stripe':
    case 'app.notion':
      return t(`options.${s(cfg.operation) || (type === 'app.stripe' ? 'create_customer' : 'create_page')}`);
    case 'app.discord':
      return s(cfg.content).slice(0, 60);
    case 'app.telegram':
      return s(cfg.chatId) || s(cfg.text).slice(0, 60);
    case 'ai.agent':
      return s(cfg.message).slice(0, 60);
    case 'data.code':
      return s(cfg.code).split('\n')[0].slice(0, 60);
    case 'data.merge':
      return cfg.mode === 'aggregate' ? `${t(`options.${s(cfg.operation) || 'collect'}`)} ${s(cfg.field)}`.trim() : t('options.merge');
    case 'logic.delay':
      return `${Number(cfg.amount) || 0} ${t(`options.${s(cfg.unit) || 'minutes'}`)}`;
    case 'action.http':
      return `${s(cfg.method) || 'POST'} ${s(cfg.url)}`.trim();
    case 'action.email':
      return s(cfg.to) || s(cfg.subject);
    case 'logic.if':
    case 'logic.filter': {
      const n = Array.isArray(cfg.conditions) ? cfg.conditions.length : 0;
      return t('editor.conditionsCount', { n });
    }
    case 'logic.loop':
      return s(cfg.items);
    case 'logic.switch':
      return s(cfg.value);
    case 'ai.text':
      return s(cfg.prompt).slice(0, 60);
    case 'app.track_issue':
    case 'app.docs_page':
      return s(cfg.title).slice(0, 60);
    case 'app.crm_contact':
      return s(cfg.email);
    case 'app.link':
      return s(cfg.url);
    default:
      return '';
  }
}

/** Ancestros de un nodo (para ofrecer sus salidas como variables). */
function ancestorsOf(graph: FlowGraph, id: string): string[] {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) {
      if (e.target === cur && !seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return [...seen];
}

function insideLoop(graph: FlowGraph, id: string): boolean {
  // Un nodo está en el cuerpo de un loop si algún camino hacia él sale por 'item'.
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) {
      if (e.target !== cur || seen.has(`${e.source}:${e.sourceHandle}`)) continue;
      seen.add(`${e.source}:${e.sourceHandle}`);
      const src = graph.nodes.find((n) => n.id === e.source);
      if (src?.type === 'logic.loop' && (e.sourceHandle ?? 'out') === 'item') return true;
      stack.push(e.source);
    }
  }
  return false;
}

function triggerSample(type: FlowNodeType, cfg: Record<string, unknown>): unknown {
  switch (type) {
    case 'trigger.event': {
      const ev = String(cfg.event ?? '') as FlowEventType;
      return { ...(EVENT_SAMPLES[ev] ?? {}), event: { type: ev, at: '' } };
    }
    case 'trigger.webhook':
      return { method: 'POST', body: { email: 'ada@example.com' }, query: {}, headers: {} };
    case 'trigger.schedule':
      return { scheduledAt: '', firedAt: '' };
    case 'trigger.manual':
      try {
        return JSON.parse(String(cfg.sample ?? '{}'));
      } catch {
        return {};
      }
    default:
      return {};
  }
}

function Editor({ flow: initialFlow, webhooks: initialHooks, lastOutputs, canEdit, refs: baseRefs }: Props) {
  const t = useTranslations('flow');
  const rf = useReactFlow();
  const router = useRouter();
  const initial = useMemo(() => toCanvas(initialFlow.graph), [initialFlow.graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowCanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [flow, setFlow] = useState(initialFlow);
  const [name, setName] = useState(initialFlow.name);
  const [description, setDescription] = useState(initialFlow.description);
  const [webhooks, setWebhooks] = useState(initialHooks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'editor' | 'runs' | 'versions'>('editor');
  const [errorFlowId, setErrorFlowId] = useState<string>(initialFlow.errorFlowId ?? '');
  const refs = useMemo<EditorRefs>(() => ({ ...baseRefs, flowId: initialFlow.id }), [baseRefs, initialFlow.id]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testInput, setTestInput] = useState('{}');
  const [running, setRunning] = useState(false);
  const [runRef, setRunRef] = useState<{ id: string | null; key: number }>({ id: null, key: 0 });
  const [shownRun, setShownRun] = useState<RunDetail | null>(null);
  const [paletteQ, setPaletteQ] = useState('');
  const [outputs, setOutputs] = useState<Record<string, unknown>>(lastOutputs);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const readOnly = !canEdit;

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const trigger = nodes.find((n) => isTriggerType(n.data.type)) ?? null;

  // Estado del último run en cada nodo + resumen.
  const stepStatus = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of shownRun?.steps ?? []) map.set(s.nodeId, s.status);
    return map;
  }, [shownRun]);

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, status: stepStatus.get(n.id), summary: summaryOf(n.data.type, n.data.config, t) },
      })),
    [nodes, stepStatus, t],
  );

  // Aristas de la rama de error: en otro color.
  const displayEdges = useMemo(
    () => edges.map((e) => (e.sourceHandle === 'error' ? { ...e, className: 'is-error' } : e)),
    [edges],
  );

  const markDirty = useCallback(() => {
    setDirty(true);
    setMessage(null);
  }, []);

  const updateConfig = useCallback(
    (id: string, config: Record<string, unknown>) => {
      setNodes((list) => list.map((n) => (n.id === id ? { ...n, data: { ...n.data, config } } : n)));
      // Si cambian los casos de un switch, se descartan aristas de salidas que ya no existen.
      setEdges((list) =>
        list.filter((e) => {
          if (e.source !== id) return true;
          const node = nodes.find((n) => n.id === id);
          if (!node) return true;
          return nodeOutputs({ type: node.data.type, config }).includes(e.sourceHandle ?? 'out');
        }),
      );
      markDirty();
    },
    [setNodes, setEdges, nodes, markDirty],
  );

  const addNode = useCallback(
    (type: FlowNodeType, position?: { x: number; y: number }) => {
      if (readOnly) return;
      if (isTriggerType(type) && trigger) {
        // Un solo trigger: se reemplaza el tipo del existente.
        setNodes((list) =>
          list.map((n) =>
            n.id === trigger.id
              ? { ...n, selected: true, data: { type, config: defaultConfig(type) } }
              : { ...n, selected: false },
          ),
        );
        setSelectedId(trigger.id);
        markDirty();
        return;
      }
      const ids = new Set(nodes.map((n) => n.id));
      const id = newNodeId(type, ids);
      const anchor = selected ?? nodes[nodes.length - 1];
      const pos = position ?? (anchor ? { x: anchor.position.x, y: anchor.position.y + 140 } : { x: 0, y: 0 });
      // El nodo nuevo queda seleccionado (también para React Flow, que si no
      // emite un cambio de selección vacío y cerraría el panel).
      setNodes((list) => [
        ...list.map((n) => (n.selected ? { ...n, selected: false } : n)),
        { id, type: 'flow', position: pos, selected: true, data: { type, config: defaultConfig(type) } },
      ]);
      // Conecta automáticamente desde el nodo seleccionado si tiene una sola salida.
      if (!position && anchor) {
        const outs = nodeOutputs({ type: anchor.data.type, config: anchor.data.config });
        if (outs.length === 1) {
          setEdges((list) => addEdge({ id: `e_${anchor.id}_${id}`, source: anchor.id, target: id, sourceHandle: outs[0] }, list));
        }
      }
      setSelectedId(id);
      markDirty();
    },
    [readOnly, trigger, nodes, selected, setNodes, setEdges, markDirty],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((list) =>
        addEdge(
          { ...c, id: `e_${c.source}_${c.sourceHandle ?? 'out'}_${c.target}_${Math.random().toString(36).slice(2, 6)}` },
          list,
        ),
      );
      markDirty();
    },
    [setEdges, markDirty],
  );

  const isValidConnection: IsValidConnection<Edge> = useCallback(
    (c) => {
      if (c.source === c.target) return false;
      const target = nodes.find((n) => n.id === c.target);
      if (!target || isTriggerType(target.data.type)) return false;
      // Sin ciclos: el destino no puede llegar al origen.
      const stack = [c.target];
      const seen = new Set<string>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === c.source) return false;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const e of edges) if (e.source === cur) stack.push(e.target);
      }
      return true;
    },
    [nodes, edges],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((list) => list.filter((n) => n.id !== id));
      setEdges((list) => list.filter((e) => e.source !== id && e.target !== id));
      setSelectedId(null);
      markDirty();
    },
    [setNodes, setEdges, markDirty],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly) return false;
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/flow/flows/${flow.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description, graph, version: flow.version, errorFlowId: errorFlowId || null }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | { flow?: FlowDto; webhooks?: Props['webhooks']; error?: string; nodeId?: string }
      | null;
    setSaving(false);
    if (!res?.ok || !data?.flow) {
      const code = data?.error ?? 'generic';
      const text = t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
      setMessage({ kind: 'error', text: data?.nodeId ? `${text} (${data.nodeId})` : text });
      if (data?.nodeId) setSelectedId(data.nodeId);
      return false;
    }
    setFlow(data.flow);
    setWebhooks(data.webhooks ?? []);
    setDirty(false);
    setMessage({ kind: 'ok', text: t('editor.saved') });
    return true;
  }, [readOnly, flow.id, flow.version, name, description, graph, errorFlowId, t]);

  /** Restaurar una versión: el canvas toma el grafo restaurado. */
  const onRestored = useCallback(
    (next: FlowDto, hooks: Props['webhooks']) => {
      const canvas = toCanvas(next.graph);
      setNodes(canvas.nodes);
      setEdges(canvas.edges);
      setFlow(next);
      setWebhooks(hooks);
      setSelectedId(null);
      setDirty(false);
      setTab('editor');
      setMessage({ kind: 'ok', text: t('versions.restored', { n: next.version }) });
    },
    [setNodes, setEdges, t],
  );

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (dirty && !(await save())) return;
      const res = await fetch(`/api/flow/flows/${flow.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { flow?: FlowDto } | null;
      if (data?.flow) setFlow(data.flow);
      else setMessage({ kind: 'error', text: t('errors.generic') });
    },
    [dirty, save, flow.id, t],
  );

  // ⌘S guarda.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Aviso al salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  async function removeFlow() {
    if (!window.confirm(t('editor.deleteFlowConfirm'))) return;
    const res = await fetch(`/api/flow/flows/${flow.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setMessage({ kind: 'error', text: t('errors.generic') });
      return;
    }
    setDirty(false);
    router.replace('/app/flow');
    router.refresh();
  }

  function openTest() {
    if (trigger) setTestInput(JSON.stringify(triggerSample(trigger.data.type, trigger.data.config), null, 2));
    setTestOpen(true);
  }

  async function runTest() {
    let input: unknown;
    try {
      input = JSON.parse(testInput || '{}');
    } catch {
      setMessage({ kind: 'error', text: t('editor.invalidJson') });
      return;
    }
    if (dirty && !(await save())) return;
    setRunning(true);
    const res = await fetch(`/api/flow/flows/${flow.id}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: input && typeof input === 'object' && !Array.isArray(input) ? input : {} }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { run?: RunDetail; error?: string } | null;
    setRunning(false);
    setTestOpen(false);
    if (!data?.run) {
      const code = data?.error ?? 'generic';
      setMessage({ kind: 'error', text: t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic') });
      return;
    }
    setShownRun(data.run);
    setRunRef((r) => ({ id: data.run!.id, key: r.key + 1 }));
    const next: Record<string, unknown> = { ...outputs };
    for (const s of data.run.steps) if (s.status === 'success') next[s.nodeId] = s.output;
    setOutputs(next);
    setMessage({
      kind: data.run.status === 'failed' ? 'error' : 'ok',
      text: `${t('editor.testResult', { status: t(`runs.status.${data.run.status}`) })}${data.run.error ? ` · ${data.run.error}` : ''}`,
    });
  }

  const variables = useMemo<VariableOption[]>(() => {
    if (!selected) return [];
    const out: VariableOption[] = [];
    const g = graph;
    if (insideLoop(g, selected.id)) {
      out.push({ path: 'loop.item', sample: undefined }, { path: 'loop.index', sample: 0 });
    }
    for (const id of ancestorsOf(g, selected.id)) {
      const node = g.nodes.find((n) => n.id === id);
      if (!node) continue;
      if (isTriggerType(node.type)) {
        const sample = outputs[id] ?? triggerSample(node.type, node.config);
        for (const p of flattenPaths(sample, '')) {
          out.push({ path: `trigger.${p}`, sample: p.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], sample) });
        }
        if (out.every((v) => !v.path.startsWith('trigger'))) out.push({ path: 'trigger', sample });
      } else {
        const sample = outputs[id];
        const base = `nodes.${id}.output`;
        if (sample === undefined) out.push({ path: base, sample: undefined });
        else
          for (const p of flattenPaths(sample, '')) {
            out.push({
              path: `${base}.${p}`,
              sample: p.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], sample),
            });
          }
      }
    }
    out.push({ path: 'flow.name', sample: name }, { path: 'run.id', sample: undefined }, { path: 'now', sample: undefined });
    return out;
  }, [selected, graph, outputs, name]);

  const paletteGroups = useMemo(() => {
    const q = paletteQ.trim().toLowerCase();
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      items: NODE_TYPES.filter((type) => NODE_DEFS[type].category === cat).filter((type) => {
        if (!q) return true;
        const title = t(`nodes.${i18nKey(type)}.title`).toLowerCase();
        const desc = t(`nodes.${i18nKey(type)}.desc`).toLowerCase();
        return title.includes(q) || desc.includes(q) || type.includes(q);
      }),
    })).filter((g) => g.items.length > 0);
  }, [paletteQ, t]);

  function onDrop(e: DragEvent) {
    const type = e.dataTransfer.getData(DND_MIME) as FlowNodeType;
    if (!type || !NODE_DEFS[type]) return;
    e.preventDefault();
    addNode(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }

  const hookUrl = (nodeId: string) => {
    const token = webhooks.find((w) => w.nodeId === nodeId)?.token;
    if (!token) return null;
    return `${typeof window === 'undefined' ? '' : window.location.origin}/api/flow/hooks/${token}`;
  };

  function triggerExtra() {
    if (!selected) return null;
    if (selected.data.type === 'trigger.webhook') {
      const url = hookUrl(selected.id);
      return (
        <div className="flow-field">
          <p className="label">{t('editor.webhookUrl')}</p>
          {url && !dirty ? (
            <div className="flow-copy">
              <code className="mono">{url}</code>
              <button type="button" className="btn btn-small" onClick={() => void navigator.clipboard?.writeText(url)}>
                {t('editor.copy')}
              </button>
            </div>
          ) : (
            <p className="muted">{t('editor.webhookSaveFirst')}</p>
          )}
          <p className="muted flow-hint">{t('editor.webhookHint')}</p>
        </div>
      );
    }
    if (selected.data.type === 'trigger.schedule' && flow.enabled && flow.nextRunAt) {
      return (
        <p className="muted flow-hint">
          {t('editor.nextRun')}: {new Date(flow.nextRunAt).toLocaleString()}
        </p>
      );
    }
    return null;
  }

  return (
    <div className="flow-editor">
      <header className="flow-bar">
        <Link href="/app/flow" className="flow-back" aria-label={t('editor.back')}>
          ←
        </Link>
        <input
          className="flow-name"
          value={name}
          readOnly={readOnly}
          aria-label={t('editor.nameLabel')}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
        />
        <div className="flow-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'editor'} className={tab === 'editor' ? 'is-active' : ''} onClick={() => setTab('editor')}>
            {t('editor.editorTab')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'runs'} className={tab === 'runs' ? 'is-active' : ''} onClick={() => setTab('runs')}>
            {t('editor.runsTab')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'versions'}
            className={tab === 'versions' ? 'is-active' : ''}
            onClick={() => setTab('versions')}
          >
            {t('editor.versionsTab')}
          </button>
        </div>
        <div className="flow-bar-right">
          {message && (
            <span className={`flow-msg is-${message.kind}`} role="status">
              {message.text}
              {shownRun && message.kind && tab === 'editor' && (
                <button type="button" className="flow-link" onClick={() => setTab('runs')}>
                  {t('editor.viewSteps')}
                </button>
              )}
            </span>
          )}
          {dirty && !message && <span className="flow-msg muted">{t('editor.unsaved')}</span>}
          <label className="flow-switch">
            <input type="checkbox" checked={flow.enabled} disabled={readOnly} onChange={(e) => void setEnabled(e.target.checked)} />
            <span className="flow-switch-track" aria-hidden="true" />
            <span className="flow-switch-label">{flow.enabled ? t('editor.enabled') : t('editor.disabled')}</span>
          </label>
          {canEdit && (
            <>
              <button type="button" className="btn btn-small" onClick={openTest} disabled={running}>
                {running ? t('editor.running') : t('editor.testRun')}
              </button>
              <button type="button" className="btn btn-small btn-solid" onClick={() => void save()} disabled={saving || !dirty}>
                {saving ? t('editor.saving') : t('editor.save')}
              </button>
            </>
          )}
        </div>
      </header>

      {tab === 'versions' ? (
        <VersionsPanel flowId={flow.id} currentVersion={flow.version} canEdit={canEdit} dirty={dirty} onRestored={onRestored} />
      ) : tab === 'runs' ? (
        <RunsPanel
          flowId={flow.id}
          selectedRunId={runRef.id}
          refreshKey={runRef.key}
          onSelect={setShownRun}
          canEdit={canEdit}
          dirty={dirty}
          onRerun={(run) => {
            setShownRun(run);
            setRunRef((r) => ({ id: run.id, key: r.key + 1 }));
          }}
        />
      ) : (
        <div className={`flow-workspace${readOnly ? ' is-readonly' : ''}`}>
          {!readOnly && (
            <aside className="flow-palette" aria-label={t('editor.palette')}>
              <input
                className="input"
                placeholder={t('editor.search')}
                aria-label={t('editor.search')}
                value={paletteQ}
                onChange={(e) => setPaletteQ(e.target.value)}
              />
              {paletteGroups.length === 0 && <p className="muted flow-pad">{t('editor.noResults')}</p>}
              {paletteGroups.map((g) => (
                <div key={g.cat} className="flow-palette-group">
                  <p className="flow-palette-cat">{t(`categories.${g.cat}`)}</p>
                  {g.items.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="flow-palette-item"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_MIME, type);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => addNode(type)}
                      title={t(`nodes.${i18nKey(type)}.desc`)}
                    >
                      <span className="flow-palette-bar" style={{ background: CATEGORY_COLOR[g.cat] }} aria-hidden="true" />
                      <span>{t(`nodes.${i18nKey(type)}.title`)}</span>
                    </button>
                  ))}
                </div>
              ))}
            </aside>
          )}

          <div className="flow-canvas" ref={wrapperRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <ReactFlow<FlowCanvasNode, Edge>
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes) => {
                onNodesChange(changes);
                if (changes.some((c) => c.type === 'position' || c.type === 'remove')) markDirty();
              }}
              onEdgesChange={(changes) => {
                onEdgesChange(changes);
                if (changes.some((c) => c.type === 'remove')) markDirty();
              }}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
              onPaneClick={() => setSelectedId(null)}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              elementsSelectable
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
              minZoom={0.25}
              maxZoom={1.5}
              defaultEdgeOptions={{ type: 'smoothstep' }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {nodes.length <= 1 && !readOnly && <p className="flow-canvas-hint muted">{t('editor.canvasHint')}</p>}
          </div>

          <aside className="flow-side" aria-label={t('editor.settings')}>
            {selected ? (
              <NodeConfigPanel
                key={selected.id}
                nodeId={selected.id}
                type={selected.data.type}
                config={selected.data.config}
                readOnly={readOnly}
                variables={variables}
                refs={refs}
                onChange={(cfg) => updateConfig(selected.id, cfg)}
                onDelete={() => deleteNode(selected.id)}
                extra={triggerExtra()}
              />
            ) : (
              <div className="flow-config">
                <h3>{t('editor.settings')}</h3>
                <p className="muted flow-config-desc">{t('editor.selectNode')}</p>
                <div className="flow-field">
                  <label className="label" htmlFor="flow-desc">
                    {t('editor.description')}
                  </label>
                  <textarea
                    id="flow-desc"
                    className="textarea"
                    rows={3}
                    value={description}
                    readOnly={readOnly}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      markDirty();
                    }}
                  />
                </div>
                <div className="flow-field">
                  <label className="label" htmlFor="flow-error-flow">
                    {t('editor.errorFlow')}
                  </label>
                  <select
                    id="flow-error-flow"
                    className="select"
                    value={errorFlowId}
                    disabled={readOnly}
                    onChange={(e) => {
                      setErrorFlowId(e.target.value);
                      markDirty();
                    }}
                  >
                    <option value="">{t('editor.errorFlowNone')}</option>
                    {refs.flows
                      .filter((f) => f.id !== flow.id)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                  <p className="muted flow-hint">{t('editor.errorFlowHint')}</p>
                </div>
                {readOnly && <p className="muted flow-hint">{t('list.adminOnly')}</p>}
                {!readOnly && (
                  <button type="button" className="btn btn-small btn-ghost flow-delete" onClick={() => void removeFlow()}>
                    {t('editor.deleteFlow')}
                  </button>
                )}
                <p className="muted flow-hint">{t('editor.templateHelp')}</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {testOpen && (
        <div className="flow-modal-backdrop" onClick={() => setTestOpen(false)}>
          <div className="flow-modal" role="dialog" aria-modal="true" aria-labelledby="flow-test-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="flow-test-title">{t('editor.testRun')}</h3>
            <p className="muted">{t('editor.testInputHint')}</p>
            <textarea
              className="textarea mono"
              rows={12}
              value={testInput}
              aria-label={t('editor.testInput')}
              onChange={(e) => setTestInput(e.target.value)}
              autoFocus
            />
            <div className="flow-modal-actions">
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setTestOpen(false)}>
                {t('editor.cancel')}
              </button>
              <button type="button" className="btn btn-small btn-solid" onClick={() => void runTest()} disabled={running}>
                {running ? t('editor.running') : t('editor.run')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
