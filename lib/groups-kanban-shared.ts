/**
 * Lines: lo que comparten el servidor (lib/groups-kanban.ts) y la vista
 * kanban de la bandeja (components/groups/InboxKanban.tsx). Sin imports de
 * servidor.
 */

/** De dónde salen las columnas: etapas del equipo, mis etapas o una propiedad de la empresa de HubSpot. */
export type KanbanSource = 'team' | 'me' | 'hs';

/** El tablero elegido: 'team', 'me' o 'hs:<nombre de la propiedad>'. */
export type KanbanBoard = string;

export const KANBAN_TEAM = 'team';
export const KANBAN_ME = 'me';
export const KANBAN_HS_PREFIX = 'hs:';

/** La columna de los chats sin etapa (o sin valor en HubSpot, o sin empresa vinculada). */
export const KANBAN_NONE = 'none';

/** Colores de una etapa: los mismos nombres que las etiquetas de Lines (.gr-label-*). */
export const KANBAN_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type KanbanColor = (typeof KANBAN_COLORS)[number];

/** Tope de etapas por tablero. */
export const KANBAN_MAX_STAGES = 30;
/** Tope de chats que se reparten en el tablero (los que siguen en orden de la bandeja quedan afuera y se avisa). */
export const KANBAN_MAX_CHATS = 1000;
/** Tarjetas por columna que vienen en la respuesta (el conteo es el total). */
export const KANBAN_CARDS_PER_COLUMN = 100;

export function boardSource(board: string): { source: KanbanSource; prop: string } | null {
  if (board === KANBAN_TEAM) return { source: 'team', prop: '' };
  if (board === KANBAN_ME) return { source: 'me', prop: '' };
  if (board.startsWith(KANBAN_HS_PREFIX)) {
    const prop = board.slice(KANBAN_HS_PREFIX.length);
    if (/^[A-Za-z0-9_.-]{1,120}$/.test(prop)) return { source: 'hs', prop };
  }
  return null;
}

export function cleanStageColor(raw: unknown): KanbanColor {
  return (KANBAN_COLORS as readonly string[]).includes(String(raw)) ? (raw as KanbanColor) : 'gray';
}

export interface KanbanStageDto {
  id: string;
  name: string;
  color: KanbanColor;
  position: number;
}

/** Una columna del tablero. `id` es el de la etapa, el valor de la propiedad de HubSpot o KANBAN_NONE. */
export interface KanbanColumnDto<Card = unknown> {
  id: string;
  name: string;
  color: KanbanColor;
  /** Chats en esta columna con los filtros puestos (solo los que ve quien mira). */
  count: number;
  cards: Card[];
  /** HubSpot: un valor que la propiedad ya no ofrece (no se puede mover nada hacia acá). */
  stale?: boolean;
}

/** Por qué no se pueden mover tarjetas en este tablero. */
export type KanbanReadOnly = 'admin' | 'hubspot_scope' | 'hubspot_role' | 'hubspot_read_only' | null;

export interface KanbanHubspotProp {
  name: string;
  label: string;
}

export interface KanbanBoardDto<Card = unknown> {
  board: string;
  source: KanbanSource;
  columns: Array<KanbanColumnDto<Card>>;
  /** Se pueden mover tarjetas (null) o por qué no. */
  readOnly: KanbanReadOnly;
  /** Puede crear, renombrar, ordenar y borrar las etapas de este tablero. */
  canEditStages: boolean;
  /** Había más chats que KANBAN_MAX_CHATS con estos filtros. */
  truncated: boolean;
  /** Columnas que esta persona plegó en este tablero. */
  collapsed: string[];
  /** HubSpot conectado: propiedades de selección de la empresa que se pueden elegir como tablero. */
  hubspot: { connected: boolean; props: KanbanHubspotProp[] };
  /** HubSpot: chats de esta vista sin empresa vinculada (no se pueden mover). */
  unlinked?: string[];
}
