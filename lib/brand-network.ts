/**
 * El diagrama de red de la suite: cada app es una línea y cada estación de
 * combinación es una integración que existe en el código. Si una integración
 * no está en el código, no está en el mapa.
 *
 * - CRM ← Cal: cada reserva crea/actualiza el contacto (lib/crm-integrations.ts).
 * - CRM ← Chat: la conversación se guarda en el contacto (app/api/chat/conversations/[id]/crm).
 * - Agents → CRM, Cal, Track, Flow, Docs: herramientas del agente (lib/agent-tools.ts).
 * - Chat → Agents: un widget delega en un agente (lib/agents-chat.ts).
 * - Chat ← Docs: el bot responde con páginas de Docs (lib/chat-data.ts).
 * - Flow ↔ Link, CRM, Cal, Track, Chat, Docs, Robots, Agents: eventos que
 *   disparan flows y nodos que actúan sobre cada app (lib/events.ts, lib/flow-engine.ts).
 * - Track ↔ GitHub: webhook de PRs y commits (lib/track-github.ts).
 * - Notes y Board todavía no combinan con otras líneas.
 *
 * Coordenadas en un lienzo de 960×800; todas las líneas van a 0°, 45° o 90°.
 */
import type { ProductKey } from './products';

export const NET_W = 960;
export const NET_H = 800;

export interface NetLine {
  key: ProductKey;
  /** Trazado SVG (M/H/V/L, ángulos de 45°). */
  d: string;
  /** Estación terminal: el link a la app. */
  terminal: { x: number; y: number };
  /** Posición del nombre de la línea (texto de señalética). */
  label: { x: number; y: number; anchor: 'start' | 'end' };
}

export interface NetStation {
  id: string;
  x: number;
  y: number;
  /** Líneas que pasan por la estación (dos o más: combinación). */
  lines: ProductKey[];
  /** Producto cuya página explica la integración. */
  href: ProductKey;
  /** Eje del par de anillos de una combinación. */
  axis: 'h' | 'v';
  /** Nombre visible: dónde va y con qué anclaje. */
  label: { dx: number; dy: number; anchor: 'start' | 'end' | 'middle' };
  /** Estación fuera de la suite (GitHub). */
  external?: boolean;
}

export const NET_LINES: NetLine[] = [
  { key: 'flow', d: 'M300 160H660L740 240V560L660 640H300L220 560V240Z', terminal: { x: 300, y: 160 }, label: { x: 300, y: 124, anchor: 'start' } },
  { key: 'crm', d: 'M60 400H480', terminal: { x: 60, y: 400 }, label: { x: 40, y: 364, anchor: 'start' } },
  { key: 'cal', d: 'M480 40V400', terminal: { x: 480, y: 40 }, label: { x: 514, y: 49, anchor: 'start' } },
  { key: 'chat', d: 'M480 770V400', terminal: { x: 480, y: 770 }, label: { x: 514, y: 779, anchor: 'start' } },
  { key: 'agents', d: 'M120 760L800 80', terminal: { x: 120, y: 760 }, label: { x: 152, y: 783, anchor: 'start' } },
  { key: 'docs', d: 'M60 700H560L620 640', terminal: { x: 60, y: 700 }, label: { x: 40, y: 664, anchor: 'start' } },
  { key: 'link', d: 'M60 280H220', terminal: { x: 60, y: 280 }, label: { x: 40, y: 244, anchor: 'start' } },
  { key: 'track', d: 'M920 240V80H600V160', terminal: { x: 920, y: 240 }, label: { x: 940, y: 292, anchor: 'end' } },
  { key: 'robots', d: 'M900 520H740', terminal: { x: 900, y: 520 }, label: { x: 940, y: 484, anchor: 'end' } },
  { key: 'notes', d: 'M760 690H920', terminal: { x: 760, y: 690 }, label: { x: 940, y: 664, anchor: 'end' } },
  { key: 'board', d: 'M760 760H920', terminal: { x: 760, y: 760 }, label: { x: 940, y: 734, anchor: 'end' } },
];

export const NET_STATIONS: NetStation[] = [
  { id: 'contacts', x: 480, y: 400, lines: ['crm', 'cal', 'chat', 'agents'], href: 'crm', axis: 'h', label: { dx: 52, dy: 44, anchor: 'start' } },
  { id: 'crmEvents', x: 220, y: 400, lines: ['crm', 'flow'], href: 'flow', axis: 'v', label: { dx: 30, dy: -18, anchor: 'start' } },
  { id: 'bookings', x: 480, y: 160, lines: ['cal', 'flow'], href: 'cal', axis: 'h', label: { dx: -52, dy: 44, anchor: 'end' } },
  { id: 'messages', x: 480, y: 640, lines: ['chat', 'flow'], href: 'chat', axis: 'h', label: { dx: -52, dy: -26, anchor: 'end' } },
  { id: 'clicks', x: 220, y: 280, lines: ['link', 'flow'], href: 'link', axis: 'v', label: { dx: 30, dy: -18, anchor: 'start' } },
  { id: 'issues', x: 600, y: 160, lines: ['track', 'flow'], href: 'track', axis: 'h', label: { dx: 0, dy: -30, anchor: 'middle' } },
  { id: 'pages', x: 620, y: 640, lines: ['docs', 'flow'], href: 'docs', axis: 'h', label: { dx: 0, dy: -30, anchor: 'middle' } },
  { id: 'runs', x: 740, y: 520, lines: ['robots', 'flow'], href: 'robots', axis: 'v', label: { dx: -30, dy: 6, anchor: 'end' } },
  { id: 'agentFlows', x: 690, y: 190, lines: ['agents', 'flow'], href: 'agents', axis: 'v', label: { dx: -30, dy: 6, anchor: 'end' } },
  { id: 'agentIssues', x: 800, y: 80, lines: ['agents', 'track'], href: 'agents', axis: 'h', label: { dx: 0, dy: -30, anchor: 'middle' } },
  { id: 'knowledge', x: 180, y: 700, lines: ['agents', 'docs'], href: 'agents', axis: 'h', label: { dx: 46, dy: 42, anchor: 'start' } },
  { id: 'answers', x: 480, y: 700, lines: ['chat', 'docs'], href: 'chat', axis: 'h', label: { dx: -52, dy: 40, anchor: 'end' } },
  { id: 'github', x: 920, y: 160, lines: ['track'], href: 'track', axis: 'v', label: { dx: -30, dy: 6, anchor: 'end' }, external: true },
];
