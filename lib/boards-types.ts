/**
 * Board — tipos y límites compartidos entre servidor y cliente.
 */

/**
 * Tope de la escena serializada (elementos + archivos embebidos). Queda por
 * debajo del límite de body de las funciones de Vercel (4.5 MB).
 */
export const BOARD_MAX_SCENE_BYTES = 4 * 1024 * 1024;
/** Tope de la miniatura SVG de la grilla. */
export const BOARD_MAX_THUMB_BYTES = 150 * 1024;

export interface BoardScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface BoardSummary {
  id: string;
  name: string;
  thumbnail: string | null;
  version: number;
  shared: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface BoardDetail extends BoardSummary {
  scene: BoardScene;
  share_token: string | null;
}
