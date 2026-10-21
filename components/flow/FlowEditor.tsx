'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Background,
  BackgroundVariant,
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
import AdvancedSection from '@/components/ui/AdvancedSection';
import ProductGlyph from '@/components/brand/ProductGlyph';
import BrandSymbol from '@/components/brand/BrandSymbol';
import type { FlowDto } from '@/lib/flow';
import {
  EVENT_SAMPLES,
  NODE_DEFS,
  NODE_TYPES,
  defaultConfig,
  isHookTrigger,
  isTriggerType,
  nodeOutputs,
  type FlowEventType,
  type FlowGraph,
  type FlowNodeType,
} from '@/lib/flow-schema';
import FlowNodeCard, { type FlowCanvasNode } from './FlowNodeCard';
import NodeConfigPanel, { type EditorRefs, type VariableOption } from './NodeConfigPanel';
import RunsPanel, { type RunDetail } from './RunsPanel';
import StepTest from './StepTest';
import VersionsPanel from './VersionsPanel';
import { CATEGORY_ORDER, flattenPaths, i18nKey, nodeApp } from './flow-ui';

interface Props {
  flow: FlowDto;
  webhooks: Array<{ nodeId: string; token: string }>;
  lastOutputs: Record<string, unknown>;
  canEdit: boolean;
  refs: Omit<EditorRefs, 'flowId'>;
  /** Corrida a abrir al entrar (?run=<id>, p. ej. desde el email de falla). */
  initialRunId?: string | null;
}

const nodeTypes = { flow: FlowNodeCard };
const TABS = ['editor', 'runs', 'versions'] as const;
type EditorTab = (typeof TABS)[number];
const DND_MIME = 'application/x-zerosoft-flow-node';
/** Medidas aproximadas del cartel del nodo (styles/flow.css .flow-node), para centrarlo. */
const NODE_W = 248;
const NODE_H = 80;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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
      if (cfg.mode === 'until') return `${t('options.until')} ${s(cfg.until)}`.trim();
      if (cfg.mode === 'resume') return t('options.resume');
      return `${Number(cfg.amount) || 0} ${t(`options.${s(cfg.unit) || 'minutes'}`)}`;
    case 'logic.approval':
      return s(cfg.to) || s(cfg.slackChannel) || s(cfg.subject).slice(0, 60);
    case 'data.table':
      return t(`options.${s(cfg.operation) || 'find'}`);
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
    case 'app.track_update':
      return [s(cfg.issue), s(cfg.status)].filter(Boolean).join(' → ');
    case 'app.crm_update':
      return t(`options.${s(cfg.entity) || 'contact'}`);
    case 'app.crm_task':
      return s(cfg.subject).slice(0, 60);
    case 'action.webhook_reply':
      return `${Number(cfg.statusCode) || 200} ${t(`options.${s(cfg.contentType) || 'json'}`)}`;
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

function Editor({ flow: initialFlow, webhooks: initialHooks, lastOutputs, canEdit, refs: baseRefs, initialRunId }: Props) {
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
  const [tab, setTab] = useState<EditorTab>(initialRunId ? 'runs' : 'editor');
  const [errorFlowId, setErrorFlowId] = useState<string>(initialFlow.errorFlowId ?? '');
  const [failureAlerts, setFailureAlerts] = useState(initialFlow.failureAlerts);
  const [autoReplay, setAutoReplay] = useState(initialFlow.autoReplay);
  // Credenciales creadas desde el editor (modal del nodo) se suman a las del server.
  const [newCreds, setNewCreds] = useState<EditorRefs['credentials']>([]);
  const refs = useMemo<EditorRefs>(
    () => ({ ...baseRefs, credentials: [...baseRefs.credentials, ...newCreds], flowId: initialFlow.id }),
    [baseRefs, newCreds, initialFlow.id],
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const testRef = useRef<HTMLDialogElement>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [testInput, setTestInput] = useState('{}');
  const [testError, setTestError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runRef, setRunRef] = useState<{ id: string | null; key: number }>({ id: initialRunId ?? null, key: 0 });
  const [shownRun, setShownRun] = useState<RunDetail | null>(null);
  const [paletteQ, setPaletteQ] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, unknown>>(lastOutputs);
  // Salidas fijadas: datos de prueba para "Probar paso" y el selector de variables.
  const [pins, setPins] = useState<Record<string, unknown>>(initialFlow.pins ?? {});
  const samples = useMemo(() => ({ ...outputs, ...pins }), [outputs, pins]);
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

  // Estado del último paso y resumen de la config en cada nodo.
  const displayNodes = useMemo(() => {
    return nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        status: stepStatus.get(n.id),
        summary: summaryOf(n.data.type, n.data.config, t),
      },
    }));
  }, [nodes, stepStatus, t]);

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
      // Desde la paleta (sin posición) el nodo puede caer fuera de la vista: el canvas lo sigue.
      if (!position) {
        window.requestAnimationFrame(() =>
          rf.setCenter(pos.x + NODE_W / 2, pos.y + NODE_H / 2, { zoom: rf.getZoom(), duration: reducedMotion() ? 0 : 240 }),
        );
      }
    },
    [readOnly, trigger, nodes, selected, setNodes, setEdges, markDirty, rf],
  );

  /** Desde Ejecuciones: vuelve al editor con el nodo elegido y centrado. */
  const openNode = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      setNodes((list) => list.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })));
      setSelectedId(id);
      // El canvas se monta de nuevo al volver a la pestaña: su fitView inicial encuadra este nodo.
      setFocusId(id);
      setTab('editor');
    },
    [nodes, setNodes],
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
      body: JSON.stringify({
        name,
        description,
        graph,
        version: flow.version,
        errorFlowId: errorFlowId || null,
        failureAlerts,
        autoReplay,
      }),
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
  }, [readOnly, flow.id, flow.version, name, description, graph, errorFlowId, failureAlerts, autoReplay, t]);

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
    if (trigger) {
      const sample = pins[trigger.id] ?? triggerSample(trigger.data.type, trigger.data.config);
      setTestInput(JSON.stringify(sample, null, 2));
    }
    testRef.current?.showModal();
  }

  /** Datos de prueba de un paso: los del trigger y la salida (fijada o de la última corrida) de los anteriores. */
  function stepSample(id: string): unknown {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return {};
    const trig = graph.nodes.find((n) => isTriggerType(n.type));
    const triggerData = trig ? (samples[trig.id] ?? triggerSample(trig.type, trig.config)) : {};
    if (isTriggerType(node.type)) return triggerData;
    const nodesData: Record<string, unknown> = {};
    for (const a of ancestorsOf(graph, id)) {
      if (a !== trig?.id && samples[a] !== undefined) nodesData[a] = samples[a];
    }
    return { trigger: triggerData, nodes: nodesData };
  }

  async function savePin(nodeId: string, output: unknown): Promise<boolean> {
    const res = await fetch(`/api/flow/flows/${flow.id}/pins`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, output }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { pins?: Record<string, unknown> } | null;
    if (!res?.ok || !data?.pins) return false;
    setPins(data.pins);
    return true;
  }

  function closeTest() {
    testRef.current?.close();
  }

  async function runTest() {
    setTestError(null);
    let input: unknown;
    try {
      input = JSON.parse(testInput || '{}');
    } catch {
      setTestError(t('editor.invalidJson'));
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
    closeTest();
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
        const sample = samples[id] ?? triggerSample(node.type, node.config);
        for (const p of flattenPaths(sample, '')) {
          out.push({ path: `trigger.${p}`, sample: p.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], sample) });
        }
        if (out.every((v) => !v.path.startsWith('trigger'))) out.push({ path: 'trigger', sample });
      } else {
        const sample = samples[id];
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
    out.push(
      { path: 'flow.name', sample: name },
      { path: 'run.id', sample: undefined },
      // URL que retoma un Esperar en modo "hasta una llamada" de la corrida.
      { path: 'run.resumeUrl', sample: undefined },
      { path: 'now', sample: undefined },
    );
    return out;
  }, [selected, graph, samples, name]);

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

  const [copied, setCopied] = useState(false);
  async function copyHook(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Sin permiso de portapapeles: el campo queda seleccionable a mano.
    }
  }

  function onTabKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(tab);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setTab(TABS[next]);
    document.getElementById(`flow-tab-${TABS[next]}`)?.focus();
  }

  function triggerExtra() {
    if (!selected) return null;
    if (isHookTrigger(selected.data.type)) {
      const url = hookUrl(selected.id);
      return (
        <div className="ui-field">
          <p className="label">{t('editor.webhookUrl')}</p>
          {url && !dirty ? (
            <div className="ui-input-group">
              <input className="input data" readOnly value={url} aria-label={t('editor.webhookUrl')} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-secondary" onClick={() => void copyHook(url)}>
                {copied ? t('editor.copied') : t('editor.copy')}
              </button>
            </div>
          ) : (
            <p className="ui-help">{t('editor.webhookSaveFirst')}</p>
          )}
          {selected.data.type === 'trigger.webhook' && <p className="ui-help">{t('editor.webhookHint')}</p>}
        </div>
      );
    }
    if (selected.data.type === 'trigger.schedule' && flow.enabled && flow.nextRunAt) {
      return (
        <p className="ui-help" suppressHydrationWarning>
          {t('editor.nextRun')}: {new Date(flow.nextRunAt).toLocaleString()}
        </p>
      );
    }
    return null;
  }

  const tabLabels: Record<EditorTab, string> = {
    editor: t('editor.editorTab'),
    runs: t('editor.runsTab'),
    versions: t('editor.versionsTab'),
  };

  return (
    <div className="flow-editor">
      <header className="flow-bar">
        <div className="flow-bar-main">
          <Link href="/app/flow" className="btn btn-ghost btn-icon" aria-label={t('editor.back')} title={t('editor.back')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
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
          <div className="flow-bar-right">
            <span className={`flow-msg${message ? ` is-${message.kind}` : ''}`} role="status">
              {message?.text ?? (dirty ? t('editor.unsaved') : '')}
              {message && shownRun && tab === 'editor' && (
                <button type="button" className="flow-link" onClick={() => setTab('runs')}>
                  {t('editor.viewSteps')}
                </button>
              )}
            </span>
            <label className="ui-switch">
              <input
                type="checkbox"
                role="switch"
                checked={flow.enabled}
                disabled={readOnly}
                onChange={(e) => void setEnabled(e.target.checked)}
              />
              <span>{flow.enabled ? t('editor.enabled') : t('editor.disabled')}</span>
            </label>
            {canEdit && (
              <>
                <button type="button" className="btn btn-secondary" onClick={openTest} aria-busy={running || undefined}>
                  {t('editor.testRun')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void save()}
                  disabled={!dirty && !saving}
                  aria-busy={saving || undefined}
                  aria-keyshortcuts="Meta+S Control+S"
                >
                  {saving ? t('editor.saving') : t('editor.save')}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="ui-tabs flow-tabs" role="tablist" aria-label={t('editor.nameLabel')} onKeyDown={onTabKey}>
          {TABS.map((key) => (
            <button
              key={key}
              id={`flow-tab-${key}`}
              type="button"
              role="tab"
              className="ui-tab"
              aria-selected={tab === key}
              aria-controls="flow-tabpanel"
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
            >
              {tabLabels[key]}
            </button>
          ))}
        </div>
      </header>

      <div id="flow-tabpanel" role="tabpanel" aria-labelledby={`flow-tab-${tab}`} className="flow-tabpanel">
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
            onOpenNode={openNode}
          />
        ) : (
          <div className={`flow-workspace${readOnly ? ' is-readonly' : ''}`}>
            {!readOnly && (
              <aside className="flow-palette" aria-label={t('editor.palette')} data-open={paletteOpen || undefined}>
                <button
                  type="button"
                  className="btn btn-secondary btn-block flow-palette-toggle"
                  aria-expanded={paletteOpen}
                  aria-controls="flow-palette-list"
                  onClick={() => setPaletteOpen((v) => !v)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {t('editor.addStep')}
                </button>
                <div id="flow-palette-list" className="flow-palette-list">
                  <input
                    className="input"
                    type="search"
                    placeholder={t('editor.search')}
                    aria-label={t('editor.search')}
                    value={paletteQ}
                    onChange={(e) => setPaletteQ(e.target.value)}
                  />
                  {paletteGroups.length === 0 && <p className="ui-help">{t('editor.noResults')}</p>}
                  {paletteGroups.map((g) => (
                    <div key={g.cat} className="flow-palette-group" role="group" aria-labelledby={`flow-cat-${g.cat}`}>
                      <p className="flow-palette-cat" id={`flow-cat-${g.cat}`}>
                        {t(`categories.${g.cat}`)}
                      </p>
                      {g.items.map((type) => {
                        const app = nodeApp(type);
                        return (
                          <button
                            key={type}
                            type="button"
                            className="flow-palette-item"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(DND_MIME, type);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onClick={() => {
                              addNode(type);
                              setPaletteOpen(false);
                            }}
                            title={t(`nodes.${i18nKey(type)}.desc`)}
                          >
                            {app ? <ProductGlyph product={app} size={12} /> : <BrandSymbol size={12} />}
                            <span>{t(`nodes.${i18nKey(type)}.title`)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
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
                fitViewOptions={focusId ? { nodes: [{ id: focusId }], padding: 0.3, maxZoom: 1 } : { padding: 0.3, maxZoom: 1 }}
                minZoom={0.25}
                maxZoom={1.5}
                defaultEdgeOptions={{ type: 'smoothstep' }}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Lines} gap={32} lineWidth={1} color="var(--flow-grid)" />
                <Controls showInteractive={false} />
              </ReactFlow>
              {nodes.length <= 1 && !readOnly && <p className="flow-canvas-hint">{t('editor.canvasHint')}</p>}
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
                  onCredentialCreated={(c) => setNewCreds((list) => [...list, c])}
                  extra={triggerExtra()}
                  test={
                    <StepTest
                      key={selected.id}
                      flowId={flow.id}
                      nodeId={selected.id}
                      type={selected.data.type}
                      config={selected.data.config}
                      sample={stepSample(selected.id)}
                      pinned={pins[selected.id]}
                      canEdit={canEdit}
                      onResult={(r) => {
                        if (r.status === 'success') setOutputs((o) => ({ ...o, [selected.id]: r.output }));
                      }}
                      onPin={(output) => savePin(selected.id, output)}
                    />
                  }
                />
              ) : (
                <div className="flow-config">
                  <div className="flow-config-head">
                    <h2 className="flow-config-title">{t('editor.flowSettings')}</h2>
                    <p className="ui-help">{t('editor.selectNode')}</p>
                  </div>
                  <div className="ui-field">
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
                  <div className="ui-field">
                    <label className="ui-check">
                      <input
                        type="checkbox"
                        checked={failureAlerts}
                        disabled={readOnly}
                        onChange={(e) => {
                          setFailureAlerts(e.target.checked);
                          markDirty();
                        }}
                      />
                      <span>{t('editor.failureAlerts')}</span>
                    </label>
                    <p className="ui-help">{t('editor.failureAlertsHint')}</p>
                  </div>
                  <div className="ui-field">
                    <label className="ui-check">
                      <input
                        type="checkbox"
                        checked={autoReplay}
                        disabled={readOnly}
                        onChange={(e) => {
                          setAutoReplay(e.target.checked);
                          markDirty();
                        }}
                      />
                      <span>{t('editor.autoReplay')}</span>
                    </label>
                    <p className="ui-help">{t('editor.autoReplayHint')}</p>
                  </div>
                  <AdvancedSection storageKey="flow.settings" hint={errorFlowId ? t('editor.advancedChanged', { n: 1 }) : undefined}>
                    <div className="ui-field">
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
                      <p className="ui-help">{t('editor.errorFlowHint')}</p>
                    </div>
                    <p className="ui-help">{t('editor.templateHelp')}</p>
                  </AdvancedSection>
                  {readOnly && <p className="ui-help">{t('list.adminOnly')}</p>}
                  {!readOnly && (
                    <div className="flow-config-foot">
                      <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void removeFlow()}>
                        {t('editor.deleteFlow')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      <dialog ref={testRef} className="ui-modal" aria-labelledby="flow-test-title" onClose={() => setTestError(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runTest();
          }}
        >
          <div className="ui-modal-head">
            <h2 id="flow-test-title" className="ui-modal-title">
              {t('editor.testRun')}
            </h2>
          </div>
          <div className="ui-modal-body ui-fields">
            <div className="ui-field">
              <label className="label" htmlFor="flow-test-input">
                {t('editor.testInput')}
              </label>
              <textarea
                id="flow-test-input"
                className="textarea data"
                rows={12}
                value={testInput}
                spellCheck={false}
                aria-invalid={testError ? true : undefined}
                aria-describedby="flow-test-hint"
                onChange={(e) => setTestInput(e.target.value)}
                autoFocus
              />
              <p className="ui-help" id="flow-test-hint">
                {t('editor.testInputHint')}
              </p>
              {testError && (
                <p className="ui-error" role="alert">
                  {testError}
                </p>
              )}
            </div>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={closeTest}>
              {t('editor.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={running || undefined}>
              {running ? t('editor.running') : t('editor.run')}
            </button>
          </div>
        </form>
      </dialog>
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
