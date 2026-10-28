/**
 * Board — galería de plantillas. Cada plantilla es una escena de Excalidraw
 * de verdad (rectángulos con texto adentro, flechas unidas a sus formas,
 * títulos), armada con los textos del idioma de quien la crea. Puro: el
 * servidor la usa para crear la pizarra y el cliente para la vista previa.
 */
import type { BoardScene } from './boards-types';

export const BOARD_TEMPLATES = [
  'retro',
  'brainstorm',
  'userFlow',
  'kanban',
  'roadmap',
  'swot',
  'mindMap',
  'priorityMatrix',
  'journey',
  'leanCanvas',
] as const;
export type BoardTemplateKey = (typeof BOARD_TEMPLATES)[number];

export function isBoardTemplate(key: unknown): key is BoardTemplateKey {
  return (BOARD_TEMPLATES as readonly string[]).includes(String(key));
}

/** Textos de la plantilla: `t('retro.title')`, etc. (namespace board.templates). */
export type TemplateText = (key: string) => string;

// Paleta de Excalidraw (la misma del selector de colores).
const INK = '#1e1e1e';
const YELLOW = '#ffec99';
const GREEN = '#b2f2bb';
const RED = '#ffc9c9';
const BLUE = '#a5d8ff';
const VIOLET = '#d0bfff';
const TINT_GREEN = '#ebfbee';
const TINT_RED = '#fff5f5';
const TINT_BLUE = '#e7f5ff';
const TINT_GRAY = '#f8f9fa';

const FONT_HAND = 5; // Excalifont, la letra por defecto de Excalidraw 0.18
const LINE_HEIGHT = 1.25;
const CHAR_W = 0.55; // ancho medio de un carácter, en proporción al tamaño

type El = Record<string, unknown> & { id: string; type: string; x: number; y: number; width: number; height: number };

class Builder {
  elements: El[] = [];
  private n = 0;
  constructor(private newId: () => string) {}

  private base(type: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): El {
    this.n += 1;
    const el: El = {
      id: this.newId(),
      type,
      x,
      y,
      width,
      height,
      angle: 0,
      strokeColor: INK,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1000 + this.n * 7919,
      version: 1,
      versionNonce: 2000 + this.n * 104729,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      ...extra,
    };
    this.elements.push(el);
    return el;
  }

  /** Texto suelto (títulos, encabezados de columna). */
  text(x: number, y: number, text: string, fontSize = 20, extra: Record<string, unknown> = {}): El {
    const lines = text.split('\n');
    const width = Math.ceil(Math.max(...lines.map((l) => l.length), 1) * fontSize * CHAR_W);
    const height = Math.ceil(lines.length * fontSize * LINE_HEIGHT);
    return this.base('text', x, y, width, height, {
      text,
      originalText: text,
      fontSize,
      fontFamily: FONT_HAND,
      textAlign: 'left',
      verticalAlign: 'top',
      containerId: null,
      autoResize: true,
      lineHeight: LINE_HEIGHT,
      ...extra,
    });
  }

  /** Forma (rectángulo, elipse, rombo) con texto centrado adentro, opcional. */
  shape(
    type: 'rectangle' | 'ellipse' | 'diamond',
    x: number,
    y: number,
    width: number,
    height: number,
    opts: { fill?: string; label?: string; fontSize?: number; stroke?: string; dashed?: boolean; rounded?: boolean } = {},
  ): El {
    const el = this.base(type, x, y, width, height, {
      backgroundColor: opts.fill ?? 'transparent',
      strokeColor: opts.stroke ?? INK,
      strokeStyle: opts.dashed ? 'dashed' : 'solid',
      roundness: opts.rounded === false ? null : type === 'rectangle' ? { type: 3 } : { type: 2 },
    });
    if (opts.label) this.label(el, opts.label, opts.fontSize ?? 20);
    return el;
  }

  /** Nota adhesiva: rectángulo de color con texto. */
  sticky(x: number, y: number, label: string, fill = YELLOW, width = 160, height = 120): El {
    return this.shape('rectangle', x, y, width, height, { fill, label, fontSize: 18 });
  }

  private label(container: El, text: string, fontSize: number) {
    // Las formas de Excalidraw dejan menos lugar útil que el rectángulo que las contiene.
    const inner = container.type === 'rectangle' ? container.width - 20 : container.width * 0.6;
    const wrapped = wrap(text, Math.max(4, Math.floor(inner / (fontSize * CHAR_W))));
    const lines = wrapped.split('\n');
    const width = Math.min(inner, Math.ceil(Math.max(...lines.map((l) => l.length)) * fontSize * CHAR_W));
    const height = Math.ceil(lines.length * fontSize * LINE_HEIGHT);
    const t = this.text(container.x + (container.width - width) / 2, container.y + (container.height - height) / 2, wrapped, fontSize, {
      originalText: text,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: container.id,
      width,
      autoResize: true,
    });
    container.boundElements = [...((container.boundElements as unknown[] | null) ?? []), { type: 'text', id: t.id }];
  }

  /** Flecha unida a dos formas (se mueve con ellas), del borde de una al borde de la otra. */
  arrow(from: El, to: El, opts: { head?: boolean } = {}): El {
    const a = edgePoint(from, center(to));
    const b = edgePoint(to, center(from));
    const el = this.base('arrow', a.x, a.y, Math.abs(b.x - a.x), Math.abs(b.y - a.y), {
      points: [
        [0, 0],
        [b.x - a.x, b.y - a.y],
      ],
      lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap: 6 },
      endBinding: { elementId: to.id, focus: 0, gap: 6 },
      startArrowhead: null,
      endArrowhead: opts.head === false ? null : 'arrow',
      elbowed: false,
      roundness: { type: 2 },
    });
    for (const target of [from, to]) {
      target.boundElements = [...((target.boundElements as unknown[] | null) ?? []), { type: 'arrow', id: el.id }];
    }
    return el;
  }
}

function center(el: El): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/** Punto del borde (del rectángulo que contiene a la forma) en dirección a `toward`, con un margen. */
function edgePoint(el: El, toward: { x: number; y: number }): { x: number; y: number } {
  const c = center(el);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = el.width / 2 + 6;
  const hh = el.height / 2 + 6;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: Math.round(c.x + dx * scale), y: Math.round(c.y + dy * scale) };
}

/** Corta el texto en líneas de hasta `max` caracteres, por palabras. */
export function wrap(text: string, max: number): string {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= max) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

function randomId(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 20; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

function columns(b: Builder, t: TemplateText, prefix: string, cols: Array<{ key: string; tint: string; note: string; notes: number }>) {
  const W = 340;
  const H = 600;
  cols.forEach((c, i) => {
    const x = i * (W + 24);
    b.shape('rectangle', x, 0, W, H, { fill: c.tint, rounded: false });
    b.text(x + 20, 20, t(`${prefix}.${c.key}`), 24);
    for (let k = 0; k < c.notes; k++) {
      b.sticky(x + 20 + (k % 2) * 160, 80 + Math.floor(k / 2) * 140, t(`${prefix}.${c.note}`), noteColor(c.tint), 140, 120);
    }
  });
}

function noteColor(tint: string): string {
  if (tint === TINT_GREEN) return GREEN;
  if (tint === TINT_RED) return RED;
  if (tint === TINT_BLUE) return BLUE;
  return YELLOW;
}

const BUILDERS: Record<'retro' | 'brainstorm' | 'userFlow' | 'kanban' | 'roadmap', (b: Builder, t: TemplateText) => void> = {
  retro(b, t) {
    b.text(0, -90, t('retro.title'), 36);
    b.text(0, -40, t('retro.hint'), 18, { strokeColor: '#495057' });
    columns(b, t, 'retro', [
      { key: 'wentWell', tint: TINT_GREEN, note: 'noteWell', notes: 2 },
      { key: 'toImprove', tint: TINT_RED, note: 'noteImprove', notes: 2 },
      { key: 'actions', tint: TINT_BLUE, note: 'noteAction', notes: 1 },
    ]);
  },
  brainstorm(b, t) {
    b.text(-380, -360, t('brainstorm.title'), 36);
    const topic = b.shape('ellipse', -150, -80, 300, 160, { fill: VIOLET, label: t('brainstorm.topic'), fontSize: 24 });
    const fills = [YELLOW, GREEN, BLUE, RED, YELLOW, GREEN];
    for (let i = 0; i < 6; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 6;
      const cx = Math.round(Math.cos(angle) * 420);
      const cy = Math.round(Math.sin(angle) * 270);
      const note = b.sticky(cx - 80, cy - 60, t('brainstorm.idea'), fills[i]);
      b.arrow(topic, note, { head: false });
    }
  },
  userFlow(b, t) {
    b.text(0, -100, t('userFlow.title'), 36);
    const start = b.shape('ellipse', 0, 0, 160, 80, { fill: GREEN, label: t('userFlow.start') });
    const landing = b.shape('rectangle', 240, -10, 200, 100, { fill: TINT_GRAY, label: t('userFlow.landing') });
    const decide = b.shape('diamond', 520, -40, 220, 160, { fill: YELLOW, label: t('userFlow.decision'), fontSize: 18 });
    const signIn = b.shape('rectangle', 820, -190, 200, 100, { fill: TINT_GRAY, label: t('userFlow.signIn') });
    const signUp = b.shape('rectangle', 820, 130, 200, 100, { fill: TINT_GRAY, label: t('userFlow.signUp') });
    const done = b.shape('ellipse', 1100, 0, 180, 80, { fill: BLUE, label: t('userFlow.done') });
    b.arrow(start, landing);
    b.arrow(landing, decide);
    b.arrow(decide, signIn);
    b.arrow(decide, signUp);
    b.arrow(signIn, done);
    b.arrow(signUp, done);
    b.text(700, -150, t('userFlow.yes'), 18);
    b.text(700, 150, t('userFlow.no'), 18);
  },
  kanban(b, t) {
    b.text(0, -70, t('kanban.title'), 36);
    columns(b, t, 'kanban', [
      { key: 'backlog', tint: TINT_GRAY, note: 'task', notes: 3 },
      { key: 'todo', tint: TINT_BLUE, note: 'task', notes: 2 },
      { key: 'doing', tint: TINT_RED, note: 'task', notes: 1 },
      { key: 'done', tint: TINT_GREEN, note: 'task', notes: 1 },
    ]);
  },
  roadmap(b, t) {
    b.text(0, -120, t('roadmap.title'), 36);
    const LANE_W = 200;
    const COL_W = 300;
    const ROW_H = 160;
    const quarters = ['q1', 'q2', 'q3', 'q4'];
    quarters.forEach((q, i) => {
      b.shape('rectangle', LANE_W + i * COL_W, -50, COL_W, 50, { fill: TINT_GRAY, label: t(`roadmap.${q}`), rounded: false });
    });
    const lanes: Array<{ key: string; fill: string; bars: Array<[number, number]> }> = [
      { key: 'product', fill: BLUE, bars: [[0, 2], [2, 4]] },
      { key: 'design', fill: VIOLET, bars: [[0, 1], [1, 3]] },
      { key: 'engineering', fill: GREEN, bars: [[1, 3], [3, 4]] },
    ];
    lanes.forEach((lane, r) => {
      const y = r * ROW_H;
      b.shape('rectangle', 0, y, LANE_W + quarters.length * COL_W, ROW_H, { rounded: false, stroke: '#ced4da' });
      b.text(20, y + 20, t(`roadmap.${lane.key}`), 22);
      for (const [from, to] of lane.bars) {
        b.shape('rectangle', LANE_W + from * COL_W + 12, y + 50, (to - from) * COL_W - 24, 70, { fill: lane.fill, label: t('roadmap.initiative'), fontSize: 18 });
      }
    });
    b.shape('diamond', LANE_W + 2 * COL_W - 30, lanes.length * ROW_H + 20, 60, 60, { fill: YELLOW });
    b.text(LANE_W + 2 * COL_W + 40, lanes.length * ROW_H + 36, t('roadmap.milestone'), 20);
  },
};

/** Cuadrantes 2×2 con título y una nota de ejemplo cada uno (SWOT, matriz de prioridades). */
function quadrants(b: Builder, t: TemplateText, prefix: string, keys: string[], tints: string[], note: string) {
  const W = 420;
  const H = 320;
  keys.forEach((k, i) => {
    const x = (i % 2) * (W + 20);
    const y = Math.floor(i / 2) * (H + 20);
    b.shape('rectangle', x, y, W, H, { fill: tints[i], rounded: false });
    b.text(x + 20, y + 16, t(`${prefix}.${k}`), 24);
    b.sticky(x + 20, y + 70, t(`${prefix}.${note}`), noteColor(tints[i]), 160, 110);
  });
}

const MORE_BUILDERS: Record<'swot' | 'mindMap' | 'priorityMatrix' | 'journey' | 'leanCanvas', (b: Builder, t: TemplateText) => void> = {
  swot(b, t) {
    b.text(0, -70, t('swot.title'), 36);
    quadrants(b, t, 'swot', ['strengths', 'weaknesses', 'opportunities', 'threats'], [TINT_GREEN, TINT_RED, TINT_BLUE, TINT_GRAY], 'note');
  },
  mindMap(b, t) {
    b.text(-420, -330, t('mindMap.title'), 36);
    const root = b.shape('rectangle', -120, -40, 240, 80, { fill: VIOLET, label: t('mindMap.center'), fontSize: 24 });
    const branches: Array<[number, number, string]> = [
      [-460, -200, BLUE],
      [-460, 120, GREEN],
      [260, -200, YELLOW],
      [260, 120, RED],
    ];
    branches.forEach(([x, y, fill], i) => {
      const node = b.shape('rectangle', x, y, 200, 70, { fill, label: t('mindMap.branch'), fontSize: 20 });
      b.arrow(root, node, { head: false });
      for (let k = 0; k < 2; k++) {
        const leafX = x < 0 ? x - 230 : x + 230;
        const leaf = b.shape('rectangle', leafX, y - 40 + k * 110, 180, 56, { fill: TINT_GRAY, label: t('mindMap.idea'), fontSize: 16 });
        b.arrow(node, leaf, { head: false });
      }
      void i;
    });
  },
  priorityMatrix(b, t) {
    b.text(0, -110, t('priorityMatrix.title'), 36);
    b.text(0, -60, t('priorityMatrix.axes'), 18, { strokeColor: '#495057' });
    quadrants(b, t, 'priorityMatrix', ['quickWins', 'bigBets', 'fillIns', 'moneyPits'], [TINT_GREEN, TINT_BLUE, TINT_GRAY, TINT_RED], 'note');
  },
  journey(b, t) {
    b.text(0, -110, t('journey.title'), 36);
    const stages = ['discover', 'consider', 'buy', 'use', 'recommend'];
    const rows = ['actions', 'feelings', 'opportunities'];
    const COL = 260;
    const ROW = 170;
    const LABEL = 180;
    stages.forEach((st, i) => {
      b.shape('rectangle', LABEL + i * COL, -50, COL - 12, 44, { fill: BLUE, label: t(`journey.${st}`), rounded: false, fontSize: 18 });
    });
    rows.forEach((r, j) => {
      const y = j * ROW + 10;
      b.text(0, y + 20, t(`journey.${r}`), 20);
      stages.forEach((_, i) => {
        b.sticky(LABEL + i * COL + 20, y, t('journey.note'), j === 1 ? RED : j === 2 ? GREEN : YELLOW, 200, 130);
      });
    });
  },
  leanCanvas(b, t) {
    b.text(0, -70, t('leanCanvas.title'), 36);
    // Las nueve cajas del Lean Canvas: cinco columnas arriba y dos filas abajo.
    const W = 260;
    const H = 420;
    const cells: Array<[string, number, number, number, number]> = [
      ['problem', 0, 0, W, H],
      ['solution', W, 0, W, H / 2],
      ['metrics', W, H / 2, W, H / 2],
      ['value', 2 * W, 0, W, H],
      ['advantage', 3 * W, 0, W, H / 2],
      ['channels', 3 * W, H / 2, W, H / 2],
      ['segments', 4 * W, 0, W, H],
      ['costs', 0, H, (5 * W) / 2, 200],
      ['revenue', (5 * W) / 2, H, (5 * W) / 2, 200],
    ];
    for (const [key, x, y, w, h] of cells) {
      b.shape('rectangle', x, y, w, h, { fill: key === 'value' ? TINT_BLUE : TINT_GRAY, rounded: false });
      b.text(x + 16, y + 14, t(`leanCanvas.${key}`), 20);
    }
  },
};

/** Escena de Excalidraw de la plantilla con los textos de `t`. `newId` se inyecta en los tests. */
export function buildTemplateScene(key: BoardTemplateKey, t: TemplateText, newId: () => string = randomId): BoardScene {
  const b = new Builder(newId);
  if (key in BUILDERS) BUILDERS[key as keyof typeof BUILDERS](b, t);
  else MORE_BUILDERS[key as keyof typeof MORE_BUILDERS](b, t);
  return { elements: b.elements, appState: { viewBackgroundColor: '#ffffff' }, files: {} };
}

// ---------- Elementos desde la API / MCP ----------

/** Lo que una integración puede agregar: stickies, textos y formas, y flechas entre ellos (por índice). */
export interface ElementSpec {
  kind: 'sticky' | 'text' | 'rectangle' | 'ellipse' | 'diamond';
  text?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Relleno (#rrggbb) o, en stickies, una clave de color ya resuelta. */
  fill?: string;
  tags?: string[];
  fontSize?: number;
}

/**
 * Elementos de Excalidraw de verdad (con texto ligado y flechas pegadas a sus
 * formas) a partir de especificaciones simples. `connect` une specs por índice.
 */
export function buildSpecElements(
  specs: ElementSpec[],
  connect: Array<{ from: number; to: number }> = [],
  newId: () => string = randomId,
): Array<Record<string, unknown>> {
  const b = new Builder(newId);
  const made: El[] = specs.map((s) => {
    const text = (s.text ?? '').slice(0, 2000);
    if (s.kind === 'text') return b.text(s.x, s.y, text || ' ', s.fontSize ?? 20);
    if (s.kind === 'sticky') {
      const el = b.sticky(s.x, s.y, text || ' ', s.fill ?? YELLOW, s.width ?? 200, s.height ?? 150);
      el.customData = { sticky: true, tags: s.tags ?? [] };
      return el;
    }
    return b.shape(s.kind, s.x, s.y, s.width ?? 200, s.height ?? 100, { fill: s.fill, label: text || undefined, fontSize: s.fontSize });
  });
  for (const c of connect) {
    const from = made[c.from];
    const to = made[c.to];
    if (from && to && from !== to && from.type !== 'text' && to.type !== 'text') b.arrow(from, to);
  }
  return b.elements;
}

// ---------- Vista previa de la galería ----------

export type PreviewShape =
  | { kind: 'rect' | 'ellipse' | 'diamond'; x: number; y: number; w: number; h: number; fill: string }
  | { kind: 'line'; points: Array<[number, number]> }
  | { kind: 'text'; x: number; y: number; w: number; h: number };

/** Formas simplificadas + viewBox para dibujar la plantilla en chico (SVG del cliente). */
export function templatePreview(scene: BoardScene): { viewBox: string; shapes: PreviewShape[] } {
  const els = scene.elements as El[];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const shapes: PreviewShape[] = [];
  for (const e of els) {
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.width);
    maxY = Math.max(maxY, e.y + e.height);
    if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') {
      shapes.push({
        kind: e.type === 'rectangle' ? 'rect' : e.type,
        x: e.x,
        y: e.y,
        w: e.width,
        h: e.height,
        fill: String(e.backgroundColor ?? 'transparent'),
      });
    } else if (e.type === 'arrow') {
      const pts = (e.points as Array<[number, number]>).map(([px, py]) => [e.x + px, e.y + py] as [number, number]);
      shapes.push({ kind: 'line', points: pts });
    } else if (e.type === 'text') {
      // El texto va como una raya: a ese tamaño no se lee.
      shapes.push({ kind: 'text', x: e.x, y: e.y + e.height * 0.35, w: e.width * 0.8, h: Math.max(4, e.height * 0.3) });
    }
  }
  if (!Number.isFinite(minX)) return { viewBox: '0 0 10 10', shapes: [] };
  const pad = 20;
  return { viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`, shapes };
}
